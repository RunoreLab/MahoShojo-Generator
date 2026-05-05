import { describe, expect, test } from 'bun:test';

import { __resetDataCardStatsRateLimitForTest, acquireDataCardStatsRateLimit } from '@/lib/data-card-stats/rate-limit';

describe('data-card stats rate limit', () => {
  test('同一 actor 在窗口内超过限制会被拒绝', () => {
    __resetDataCardStatsRateLimitForTest();

    for (let i = 0; i < 30; i += 1) {
      const result = acquireDataCardStatsRateLimit({
        actorScope: 'anonymous',
        actorKeyHash: 'hash-a',
        nowMs: 1_000 + i,
      });
      expect(result.allowed).toBe(true);
    }

    const rejected = acquireDataCardStatsRateLimit({
      actorScope: 'anonymous',
      actorKeyHash: 'hash-a',
      nowMs: 2_000,
    });

    expect(rejected).toEqual({
      allowed: false,
      retryAfterSeconds: 59,
    });
  });

  test('不同 actor 分开计数，窗口过期后恢复', () => {
    __resetDataCardStatsRateLimitForTest();

    for (let i = 0; i < 30; i += 1) {
      acquireDataCardStatsRateLimit({
        actorScope: 'anonymous',
        actorKeyHash: 'hash-a',
        nowMs: 1_000 + i,
      });
    }

    expect(
      acquireDataCardStatsRateLimit({
        actorScope: 'anonymous',
        actorKeyHash: 'hash-b',
        nowMs: 2_000,
      }),
    ).toEqual({ allowed: true, retryAfterSeconds: 0 });

    expect(
      acquireDataCardStatsRateLimit({
        actorScope: 'anonymous',
        actorKeyHash: 'hash-a',
        nowMs: 61_000,
      }),
    ).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });
});
