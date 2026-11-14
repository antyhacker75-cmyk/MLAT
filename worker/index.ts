import { matchup, proTips, type AiPayload } from '../functions/api/ai/_shared';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  GEMINI_API_KEY?: string;
}

const RONE_API_BASE = 'https://arena.rone.dev/api';
const PUBLIC_CACHE_TTL_SECONDS = 60;
const PUBLIC_CACHE_MAX_AGE_SECONDS = 24 * 60 * 60;
const UPSTREAM_TIMEOUT_MS = 15_000;

function json(body: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  responseHeaders.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function isCacheablePublicPath(method: string, path: string): boolean {
  return method === 'GET' && (path.startsWith('/heroes') || path.startsWith('/academy'));
}

function getCacheFreshUntil(response: Response): number {
  const value = Number(response.headers.get('x-mlat-fresh-until') || 0);
  return Number.isFinite(value) ? value : 0;
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/api/ai/matchup-analysis') {
    try {
      const body = await request.json() as { payload?: AiPayload; forceRefresh?: boolean };
      if (!body.payload?.heroId || !body.payload?.heroName) {
        return json({ error: 'Hero matchup context is required.' }, 400);
      }
      return json(await matchup(body.payload, env, body.forceRefresh === true));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Matchup analysis unavailable.' }, 500);
    }
  }

  if (request.method === 'POST' && url.pathname === '/api/ai/pro-tips') {
    try {
      const body = await request.json() as { payload?: AiPayload; forceRefresh?: boolean };
      if (!body.payload?.heroId || !body.payload?.heroName) {
        return json({ error: 'Hero meta context is required.' }, 400);
      }
      return json(await proTips(body.payload, env, body.forceRefresh === true));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Pro Tips unavailable.' }, 500);
    }
  }

  if (url.pathname.startsWith('/api/mlbb/')) {
    const subPath = url.pathname.slice('/api/mlbb'.length) || '/';
    const target = new URL(RONE_API_BASE + subPath);
    target.search = url.search;
    const cacheable = isCacheablePublicPath(request.method, subPath);
    const cache = caches.default;
    const cacheKey = new Request(target.toString(), { method: 'GET' });
    const staleCandidate = cacheable ? await cache.match(cacheKey) : undefined;
    const now = Date.now();

    if (staleCandidate && getCacheFreshUntil(staleCandidate) > now) {
      const freshResponse = new Response(staleCandidate.body, staleCandidate);
      freshResponse.headers.set('X-Data-Source', 'memory-cache');
      return freshResponse;
    }

    const sendStale = () => {
      if (!staleCandidate) return null;
      const cachedAt = Number(staleCandidate.headers.get('x-mlat-cached-at') || 0);
      if (!Number.isFinite(cachedAt) || now - cachedAt > PUBLIC_CACHE_MAX_AGE_SECONDS * 1000) {
        return null;
      }
      const headers = new Headers(staleCandidate.headers);
      headers.set('X-Data-Source', 'stale-cache');
      headers.set('Cache-Control', 'no-store');
      headers.delete('x-mlat-fresh-until');
      headers.delete('x-mlat-cached-at');
      return new Response(staleCandidate.body, {
        status: staleCandidate.status,
        statusText: staleCandidate.statusText,
        headers,
      });
    };

    const headers = new Headers({ Accept: 'application/json' });
    const authorization = request.headers.get('Authorization');
    if (authorization) headers.set('Authorization', authorization);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
    }

    try {
      const maxAttempts = cacheable ? 3 : 1;
      let upstream: Response | null = null;
      let raw = '';

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        upstream = await fetch(target.toString(), {
          method: request.method,
          headers,
          body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        raw = await upstream.text();

        const retryable = [502, 503, 504].includes(upstream.status);
        if (!retryable || attempt === maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      }

      if (!upstream) throw new Error('Upstream response missing');

      const contentType = upstream.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        if (upstream.status >= 500) {
          const stale = sendStale();
          if (stale) return stale;
        }
        return json({
          code: upstream.status || 502,
          message: 'Upstream API returned an unexpected response.',
          detail: raw.slice(0, 200),
        }, upstream.status || 502);
      }

      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        const stale = upstream.status >= 500 ? sendStale() : null;
        if (stale) return stale;
        return json({ code: 502, message: 'Upstream API returned invalid JSON.' }, 502);
      }

      if (!upstream.ok && upstream.status >= 500) {
        const stale = sendStale();
        if (stale) return stale;
      }

      const responseHeaders = new Headers({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': cacheable
          ? 'public, max-age=0, s-maxage=' + PUBLIC_CACHE_MAX_AGE_SECONDS
          : 'no-store',
      });

      if (cacheable && upstream.ok) {
        const cachedAt = Date.now();
        responseHeaders.set('x-mlat-cached-at', String(cachedAt));
        responseHeaders.set('x-mlat-fresh-until', String(cachedAt + PUBLIC_CACHE_TTL_SECONDS * 1000));
        const response = new Response(JSON.stringify(data), {
          status: upstream.status,
          headers: responseHeaders,
        });
        await cache.put(cacheKey, response.clone());
        response.headers.set('X-Data-Source', 'upstream');
        return response;
      }

      return new Response(JSON.stringify(data), {
        status: upstream.status,
        headers: responseHeaders,
      });
    } catch (error) {
      const stale = sendStale();
      if (stale) return stale;
      const timeout = error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      return json({
        code: timeout ? 504 : 502,
        message: timeout ? 'Rone Arena API request timed out. Please try again.' : 'Unable to reach Rone Arena API.',
      }, timeout ? 504 : 502);
    }
  }

  return json({ error: 'API route not found.' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
