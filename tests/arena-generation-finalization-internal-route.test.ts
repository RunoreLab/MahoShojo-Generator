import { afterEach, describe, expect, it, vi } from 'vitest';

import { createArenaInternalAuthHeaders } from '@mahoshojo/hosted-runtime/arena-generation';

const { settle, readRanking } = vi.hoisted(() => ({
  settle: vi.fn(async () => undefined),
  readRanking: vi.fn(async (generationId: string) => ({ success: true, generationId })),
}));

vi.mock('@/lib/database/arena-ratings', () => ({
  settleArenaRatingsForGeneration: settle,
}));
vi.mock('@/app/api/arena/generation-ranking/handler', () => ({
  readGenerationRankingForGeneration: readRanking,
}));

import { appRouteHandler } from '@/app/api/internal/arena-generation/finalize/handler';

const secret = 'arena-finalization-test-secret-32-bytes';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Arena generation finalization internal route', () => {
  it('authenticates the caller and runs idempotent rating settlement before reading ranking', async () => {
    vi.stubEnv('ARENA_FINALIZATION_HMAC_SECRET', secret);
    const body = JSON.stringify({ version: 1, generationId: 'generation-1' });
    const headers = await createArenaInternalAuthHeaders({
      secret,
      method: 'POST',
      pathname: '/api/internal/arena-generation/finalize',
      body,
    });
    const response = await appRouteHandler(new Request(
      'https://web.example/api/internal/arena-generation/finalize',
      { method: 'POST', headers, body },
    ));

    expect(response.status).toBe(200);
    expect(settle).toHaveBeenCalledWith('generation-1');
    expect(readRanking).toHaveBeenCalledWith('generation-1');
  });

  it('fails closed for unsigned requests', async () => {
    vi.stubEnv('ARENA_FINALIZATION_HMAC_SECRET', secret);
    const response = await appRouteHandler(new Request(
      'https://web.example/api/internal/arena-generation/finalize',
      { method: 'POST', body: JSON.stringify({ version: 1, generationId: 'generation-1' }) },
    ));
    expect(response.status).toBe(401);
    expect(settle).not.toHaveBeenCalled();
  });
});
