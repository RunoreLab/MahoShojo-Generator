import { describe, expect, test } from 'bun:test';

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
});
