import {
  buildArenaTerminalEffectIdempotencyKey,
  verifyArenaInternalRequest,
} from '@mahoshojo/hosted-runtime/arena-generation';

import { readGenerationRankingForGeneration } from '@/app/api/arena/generation-ranking/handler';
import { settleArenaRatingsForGeneration } from '@/lib/database/arena-ratings';

const noStoreJson = (payload: unknown, status: number): Response => Response.json(payload, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});

export const appRouteHandler = async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return noStoreJson({ code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' }, 405);
  }
  const secret = process.env.ARENA_FINALIZATION_HMAC_SECRET?.trim() ?? '';
  if (secret.length < 32) {
    return noStoreJson({ code: 'ARENA_FINALIZATION_NOT_CONFIGURED' }, 503);
  }
  const body = await request.text();
  if (body.length > 2_048 || !await verifyArenaInternalRequest({ secret, request, body })) {
    return noStoreJson({ code: 'UNAUTHORIZED', error: 'Unauthorized' }, 401);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return noStoreJson({ code: 'INVALID_JSON', error: 'Invalid JSON' }, 400);
  }
  const input = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const generationId = typeof input.generationId === 'string' ? input.generationId.trim() : '';
  const idempotencyKey = typeof input.idempotencyKey === 'string'
    ? input.idempotencyKey.trim()
    : buildArenaTerminalEffectIdempotencyKey(generationId, 'ratings');
  if (
    input.version !== 1
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(generationId)
    || idempotencyKey !== buildArenaTerminalEffectIdempotencyKey(generationId, 'ratings')
    || Object.keys(input).some((key) => (
      key !== 'version' && key !== 'generationId' && key !== 'idempotencyKey'
    ))
  ) {
    return noStoreJson({ code: 'INVALID_REQUEST', error: 'Invalid request' }, 400);
  }

  try {
    await settleArenaRatingsForGeneration({ generationId, idempotencyKey });
    const ranking = await readGenerationRankingForGeneration(generationId);
    return noStoreJson({ success: true, ranking }, 200);
  } catch {
    return noStoreJson({
      code: 'ARENA_FINALIZATION_PENDING',
      error: 'Arena finalization remains pending',
    }, 503);
  }
};
