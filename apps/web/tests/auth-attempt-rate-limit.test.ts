import { describe, expect, test } from 'vitest';

import {
  __resetAuthAttemptRateLimitForTest,
  acquireAuthAttemptRateLimit,
} from '@/lib/auth/attempt-rate-limit';

const buildRequest = (ip: string): Request =>
  new Request('https://example.com/api/auth/login', {
    headers: {
      'cf-connecting-ip': ip,
    },
  });

describe('auth attempt rate limit', () => {
  test('register: 同一邮箱在窗口内会命中邮箱限流', () => {
    __resetAuthAttemptRateLimitForTest();
    const req = buildRequest('1.1.1.1');

    for (let i = 0; i < 3; i += 1) {
      const result = acquireAuthAttemptRateLimit({
        req,
        actionType: 'register',
        email: 'Hikari@Example.com',
        username: `hikari_${i}`,
        nowMs: 1_000,
      });
      expect(result.allowed).toBe(true);
    }

    const blocked = acquireAuthAttemptRateLimit({
      req,
      actionType: 'register',
      email: '  hikari@example.com  ',
      username: 'another_name',
      nowMs: 1_000,
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.reason).toBe('email_burst');
      expect(blocked.scope).toBe('email');
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  test('login: 同一 identifier 在窗口内会命中 identifier 限流', () => {
    __resetAuthAttemptRateLimitForTest();
    const req = buildRequest('2.2.2.2');

    for (let i = 0; i < 8; i += 1) {
      const result = acquireAuthAttemptRateLimit({
        req,
        actionType: 'login',
        identifier: 'TestUser',
        nowMs: 2_000,
      });
      expect(result.allowed).toBe(true);
    }

    const blocked = acquireAuthAttemptRateLimit({
      req,
      actionType: 'login',
      identifier: ' testuser ',
      nowMs: 2_000,
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.reason).toBe('identifier_burst');
      expect(blocked.scope).toBe('identifier');
    }
  });

  test('login: 同一 IP 即使切换 identifier 也会命中 IP 限流', () => {
    __resetAuthAttemptRateLimitForTest();
    const req = buildRequest('3.3.3.3');

    for (let i = 0; i < 12; i += 1) {
      const result = acquireAuthAttemptRateLimit({
        req,
        actionType: 'login',
        identifier: `user-${i}`,
        nowMs: 3_000,
      });
      expect(result.allowed).toBe(true);
    }

    const blocked = acquireAuthAttemptRateLimit({
      req,
      actionType: 'login',
      identifier: 'user-13',
      nowMs: 3_000,
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.reason).toBe('ip_burst');
      expect(blocked.scope).toBe('ip');
    }
  });

  test('native-grant: 同一授权用户在窗口内命中用户维度限流', () => {
    __resetAuthAttemptRateLimitForTest();
    const req = buildRequest('4.4.4.4');

    for (let i = 0; i < 8; i += 1) {
      const result = acquireAuthAttemptRateLimit({
        req,
        actionType: 'native-grant',
        identifier: 'auth-user-1',
        nowMs: 4_000,
      });
      expect(result.allowed).toBe(true);
    }

    const blocked = acquireAuthAttemptRateLimit({
      req,
      actionType: 'native-grant',
      identifier: 'auth-user-1',
      nowMs: 4_000,
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.reason).toBe('identifier_burst');
      expect(blocked.scope).toBe('identifier');
    }
  });

  test('native-exchange: 没有共享 identifier 桶，不同来源互不误伤', () => {
    __resetAuthAttemptRateLimitForTest();

    // 每个来源只调用一次：旧实现把全部请求记到固定 'native-exchange' 标识上，
    // 8 次之后任何用户都会被 429；现在只允许按来源 IP 的突发桶。
    for (let i = 0; i < 32; i += 1) {
      const result = acquireAuthAttemptRateLimit({
        req: buildRequest(`10.0.0.${i}`),
        actionType: 'native-exchange',
        nowMs: 5_000,
      });
      expect(result.allowed).toBe(true);
    }
  });

  test('native-exchange: 同一 IP 的突发仍受 IP 限流约束', () => {
    __resetAuthAttemptRateLimitForTest();
    const req = buildRequest('10.1.0.9');

    for (let i = 0; i < 24; i += 1) {
      const result = acquireAuthAttemptRateLimit({
        req,
        actionType: 'native-exchange',
        nowMs: 6_000,
      });
      expect(result.allowed).toBe(true);
    }

    const blocked = acquireAuthAttemptRateLimit({
      req,
      actionType: 'native-exchange',
      nowMs: 6_000,
    });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.reason).toBe('ip_burst');
      expect(blocked.scope).toBe('ip');
    }
  });

  test('native-* 桶不消耗站点登录的 IP 配额', () => {
    __resetAuthAttemptRateLimitForTest();
    const req = buildRequest('5.5.5.5');

    // 打满 native-grant 的 IP 桶（12 次，identifier 各不相同以免先撞用户桶）。
    for (let i = 0; i < 12; i += 1) {
      const result = acquireAuthAttemptRateLimit({
        req,
        actionType: 'native-grant',
        identifier: `auth-user-${i}`,
        nowMs: 7_000,
      });
      expect(result.allowed).toBe(true);
    }
    const grantBlocked = acquireAuthAttemptRateLimit({
      req,
      actionType: 'native-grant',
      identifier: 'auth-user-next',
      nowMs: 7_000,
    });
    expect(grantBlocked.allowed).toBe(false);
    if (!grantBlocked.allowed) {
      expect(grantBlocked.scope).toBe('ip');
    }

    // 同一 IP 的站点登录不受影响——native 端点不复用 login:ip 桶。
    const login = acquireAuthAttemptRateLimit({
      req,
      actionType: 'login',
      identifier: 'site-user',
      nowMs: 7_000,
    });
    expect(login.allowed).toBe(true);
  });
});
