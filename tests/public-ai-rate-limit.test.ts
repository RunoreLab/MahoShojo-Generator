import { describe, expect, mock, test } from 'bun:test';

const state = {
  verifiedByToken: new Map<string, { userId: number; expiresAt: string }>(),
};

mock.module('@/lib/auth/activity-token', () => ({
  ACTIVITY_TOKEN_HEADER: 'x-mahoshojo-activity-token',
  verifyActivityToken: async (token: string) => state.verifiedByToken.get(token) ?? null,
}));

const buildRequest = (headers: Record<string, string>): Request =>
  new Request('https://example.com/api/generate-magical-girl', {
    headers,
  });

describe('public ai rate limit', () => {
  test('同一已验证活动令牌在冷却内会被拦截', async () => {
    state.verifiedByToken = new Map([
      ['token-user-7', { userId: 7, expiresAt: '2026-12-31T00:00:00.000Z' }],
    ]);

    const { __resetPublicAiRateLimitForTest, acquirePublicAiRateLimit } = await import('@/lib/ai/public-rate-limit');
    __resetPublicAiRateLimitForTest();

    const req = buildRequest({
      'x-mahoshojo-activity-token': 'token-user-7',
      'cf-connecting-ip': '1.2.3.4',
    });

    const first = await acquirePublicAiRateLimit({
      req,
      actionType: 'magical_girl_generate',
      providerMode: 'system',
      nowMs: 1_000,
    });
    expect(first).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      identityScope: 'user',
    });

    const second = await acquirePublicAiRateLimit({
      req,
      actionType: 'magical_girl_generate',
      providerMode: 'system',
      nowMs: 2_000,
    });
    expect(second.allowed).toBe(false);
    if (!second.allowed) {
      expect(second.reason).toBe('identity_cooldown');
      expect(second.identityScope).toBe('user');
      expect(second.retryAfterSeconds).toBeGreaterThanOrEqual(59);
    }
  });

  test('匿名请求会按脱敏 IP 命中冷却', async () => {
    state.verifiedByToken = new Map();

    const { __resetPublicAiRateLimitForTest, acquirePublicAiRateLimit } = await import('@/lib/ai/public-rate-limit');
    __resetPublicAiRateLimitForTest();

    const first = await acquirePublicAiRateLimit({
      req: buildRequest({
        'cf-connecting-ip': '9.9.9.9',
      }),
      actionType: 'magical_girl_generate',
      providerMode: 'system',
      nowMs: 1_000,
    });
    expect(first.allowed).toBe(true);

    const second = await acquirePublicAiRateLimit({
      req: buildRequest({
        'cf-connecting-ip': '9.9.9.77',
      }),
      actionType: 'magical_girl_generate',
      providerMode: 'system',
      nowMs: 2_000,
    });
    expect(second.allowed).toBe(false);
    if (!second.allowed) {
      expect(second.identityScope).toBe('ip');
      expect(second.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  test('裸 user-id 头不会绕过 IP 维度冷却', async () => {
    state.verifiedByToken = new Map();

    const { __resetPublicAiRateLimitForTest, acquirePublicAiRateLimit } = await import('@/lib/ai/public-rate-limit');
    __resetPublicAiRateLimitForTest();

    const first = await acquirePublicAiRateLimit({
      req: buildRequest({
        'cf-connecting-ip': '6.6.6.6',
        'x-mahoshojo-user-id': '101',
      }),
      actionType: 'magical_girl_generate',
      providerMode: 'system',
      nowMs: 1_000,
    });
    expect(first.allowed).toBe(true);

    const second = await acquirePublicAiRateLimit({
      req: buildRequest({
        'cf-connecting-ip': '6.6.6.6',
        'x-mahoshojo-user-id': '202',
      }),
      actionType: 'magical_girl_generate',
      providerMode: 'system',
      nowMs: 2_000,
    });
    expect(second.allowed).toBe(false);
    if (!second.allowed) {
      expect(second.identityScope).toBe('ip');
    }
  });

  test('自定义通道冷却会缩短到 3 秒', async () => {
    state.verifiedByToken = new Map([
      ['token-user-9', { userId: 9, expiresAt: '2026-12-31T00:00:00.000Z' }],
    ]);

    const { __resetPublicAiRateLimitForTest, acquirePublicAiRateLimit } = await import('@/lib/ai/public-rate-limit');
    __resetPublicAiRateLimitForTest();

    const req = buildRequest({
      'x-mahoshojo-activity-token': 'token-user-9',
      'cf-connecting-ip': '3.4.5.6',
    });

    const first = await acquirePublicAiRateLimit({
      req,
      actionType: 'magical_girl_details_generate',
      providerMode: 'custom',
      nowMs: 1_000,
    });
    expect(first.allowed).toBe(true);

    const second = await acquirePublicAiRateLimit({
      req,
      actionType: 'magical_girl_details_generate',
      providerMode: 'custom',
      nowMs: 3_500,
    });
    expect(second.allowed).toBe(false);

    const third = await acquirePublicAiRateLimit({
      req,
      actionType: 'magical_girl_details_generate',
      providerMode: 'custom',
      nowMs: 4_100,
    });
    expect(third.allowed).toBe(true);
  });
});
