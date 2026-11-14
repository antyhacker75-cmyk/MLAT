import { matchup, proTips, type AiPayload } from '../functions/api/ai/_shared';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  GEMINI_API_KEY?: string;
}

const RONE_API_BASE = 'https://arena.rone.dev/api';
const publicCache = new Map<string, { expiresAt: number; response: Response }>();
const CACHE_MS = 120_000;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
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
    const cacheable = request.method === 'GET' &&
      (subPath.startsWith('/heroes') || subPath.startsWith('/academy'));
    const cached = cacheable ? publicCache.get(target.toString()) : undefined;
    if (cached && cached.expiresAt > Date.now()) return cached.response.clone();

    const headers = new Headers({ Accept: 'application/json' });
    const authorization = request.headers.get('Authorization');
    if (authorization) headers.set('Authorization', authorization);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
    }

    try {
      const upstream = await fetch(target.toString(), {
        method: request.method,
        headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      const raw = await upstream.text();
      const contentType = upstream.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return json({
          code: upstream.status || 502,
          message: 'Upstream API returned an unexpected response.',
          detail: raw.slice(0, 200),
        }, upstream.status || 502);
      }
      let data: unknown;
      try { data = JSON.parse(raw); } catch {
        return json({ code: 502, message: 'Upstream API returned invalid JSON.' }, 502);
      }
      const response = json(data, upstream.status);
      if (cacheable && upstream.ok) {
        publicCache.set(target.toString(), { expiresAt: Date.now() + CACHE_MS, response: response.clone() });
      }
      return response;
    } catch (error) {
      const timeout = error instanceof Error && error.name === 'TimeoutError';
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
