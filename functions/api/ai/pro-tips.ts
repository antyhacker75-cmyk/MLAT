import { proTips, type AiPayload } from './_shared.ts';

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const body = (await request.json()) as { payload?: AiPayload; forceRefresh?: boolean };
    const payload = body?.payload;
    if (!payload?.heroId || !payload?.heroName) {
      return Response.json({ error: 'Hero meta context is required.' }, { status: 400 });
    }
    return Response.json(await proTips(payload, env, body.forceRefresh === true));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Pro Tips unavailable.' },
      { status: 500 },
    );
  }
};
