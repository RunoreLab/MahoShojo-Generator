import { describe, expect, test, vi } from 'vitest';

import {
  buildGenerationRankingRateLimitResponse,
  enforceGenerationRankingRateLimit,
  type GenerationRankingRateLimitBindings,
} from '@/lib/arena/generation-ranking-rate-limit';

const createLimiter = (success: boolean) => ({
  limit: vi.fn(async (_input: { key: string }) => ({ success })),
});

describe('generation ranking rate limit', () => {
  test('使用哈希后的主体、generationId 和 IP 键', async () => {
    const actor = createLimiter(true);
    const ip = createLimiter(true);
    const bindings: GenerationRankingRateLimitBindings = {
      ARENA_RANKING_ACTOR_LIMITER: actor,
      ARENA_RANKING_IP_GENERATION_LIMITER: createLimiter(true),
      ARENA_RANKING_IP_LIMITER: ip,
    };
    const req = new Request('https://example.test/api/arena/generation-ranking?generationId=secret-generation', {
      headers: {
        authorization: 'Bearer secret-token',
        'cf-connecting-ip': '203.0.113.9',
      },
    });

    const result = await enforceGenerationRankingRateLimit({ req, generationId: 'secret-generation', bindings });

    expect(result.allowed).toBe(true);
    const keys = [actor.limit.mock.calls[0]?.[0]?.key, ip.limit.mock.calls[0]?.[0]?.key];
    expect(keys.every((key) => typeof key === 'string' && /^[a-f0-9:]+$/.test(key))).toBe(true);
    expect(keys.join(':')).not.toContain('secret');
    expect(keys.join(':')).not.toContain('203.0.113.9');
  });

  test('任一维度超限时返回带 Retry-After 的 429', async () => {
    const bindings: GenerationRankingRateLimitBindings = {
      ARENA_RANKING_ACTOR_LIMITER: createLimiter(false),
      ARENA_RANKING_IP_GENERATION_LIMITER: createLimiter(true),
      ARENA_RANKING_IP_LIMITER: createLimiter(true),
    };
    const result = await enforceGenerationRankingRateLimit({
      req: new Request('https://example.test/api/arena/generation-ranking', { headers: { 'cf-connecting-ip': '198.51.100.8' } }),
      generationId: 'generation-1',
      bindings,
    });
    const response = buildGenerationRankingRateLimitResponse(result);

    expect(result.allowed).toBe(false);
    expect(response?.status).toBe(429);
    expect(response?.headers.get('Retry-After')).toBe('10');
  });

  test('本地无 binding 时降级放行', async () => {
    const result = await enforceGenerationRankingRateLimit({
      req: new Request('https://example.test/api/arena/generation-ranking'),
      generationId: 'generation-1',
      bindings: null,
    });
    expect(result).toEqual({ allowed: true, limitedBy: null, bindingAvailable: false });
  });
});
