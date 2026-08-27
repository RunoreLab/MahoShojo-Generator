import { afterEach, describe, expect, it, vi } from 'vitest';

import { createArenaInternalAuthHeaders } from '@mahoshojo/hosted-runtime/arena-generation';

const { settle, readRanking, getRuntimeD1ClientWithoutHttpFallback } = vi.hoisted(() => ({
  settle: vi.fn(async () => undefined),
  readRanking: vi.fn(async (generationId: string) => ({ success: true, generationId })),
  getRuntimeD1ClientWithoutHttpFallback: vi.fn(() => ({ prepare: vi.fn() })),
}));

vi.mock('@/lib/database/arena-ratings', () => ({
  settleArenaRatingsForGeneration: settle,
}));
vi.mock('@/app/api/arena/generation-ranking/handler', () => ({
  readGenerationRankingForGeneration: readRanking,
}));
vi.mock('@/lib/db/drizzle', () => ({
  getRuntimeD1ClientWithoutHttpFallback,
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
    const body = JSON.stringify({
      version: 1,
      generationId: 'generation-1',
      idempotencyKey: 'arena-terminal:generation-1:ratings',
    });
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
    expect(settle).toHaveBeenCalledWith({
      generationId: 'generation-1',
      idempotencyKey: 'arena-terminal:generation-1:ratings',
    });
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

  it('does not report success when durable rating settlement fails', async () => {
    vi.stubEnv('ARENA_FINALIZATION_HMAC_SECRET', secret);
    settle.mockRejectedValueOnce(new Error('D1 unavailable'));
    const body = JSON.stringify({
      version: 1,
      generationId: 'generation-1',
      idempotencyKey: 'arena-terminal:generation-1:ratings',
    });
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

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: 'ARENA_FINALIZATION_PENDING' });
    expect(readRanking).not.toHaveBeenCalled();
  });

  it('production 无 native D1 binding 时即使 HTTP Gateway 存在也在结算前 fail closed', async () => {
    vi.stubEnv('ARENA_FINALIZATION_HMAC_SECRET', secret);
    vi.stubEnv('NEXT_PUBLIC_HOSTED_API_ENVIRONMENT', 'production');
    vi.stubEnv('D1_GATEWAY_URL', 'https://gateway-secret-canary.example.test');
    getRuntimeD1ClientWithoutHttpFallback.mockReturnValueOnce(null);
    const body = JSON.stringify({
      version: 1,
      generationId: 'generation-1',
      idempotencyKey: 'arena-terminal:generation-1:ratings',
    });
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

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.not.toContain('gateway-secret-canary');
    expect(settle).not.toHaveBeenCalled();
    expect(readRanking).not.toHaveBeenCalled();
  });
});
