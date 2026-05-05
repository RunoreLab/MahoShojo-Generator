import { describe, expect, mock, test } from 'bun:test';

mock.module('server-only', () => ({}));

describe('api/data-card-stats', () => {
  test('actor 超过 stats 限流时返回 429 且不写 interaction', async () => {
    const { createDataCardStatsHandler } = await import('@/pages/api/data-card-stats');
    let recordCalled = false;
    const handler = createDataCardStatsHandler({
      getDb: () => ({ db: true } as never),
      resolveActor: async () => ({
        actorScope: 'anonymous',
        actorKeyHash: 'hash-a',
      }),
      acquireRateLimit: () => ({
        allowed: false,
        retryAfterSeconds: 12,
      }),
      recordInteraction: async () => {
        recordCalled = true;
        return { success: true, alreadyExists: false };
      },
      now: () => new Date('2026-05-05T12:00:00.000Z'),
    });

    const response = await handler(
      new Request('https://example.test/api/data-card-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: 'card-1', type: 'like' }),
      }),
    );
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
    expect(payload).toEqual({
      success: false,
      error: '请求过于频繁，请在 12 秒后重试',
      retryAfterSeconds: 12,
    });
    expect(recordCalled).toBe(false);
  });
});
