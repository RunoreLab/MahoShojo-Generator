import { describe, expect, test } from 'bun:test';

import { __resetAiSessionSoftRateLimitForTest, acquireAiSessionSoftRateLimit } from '@/lib/ai-session/rate-limit';

const buildRequest = (ip: string): Request =>
  new Request('https://example.com/api/arena/session/generate-next', {
    headers: {
      'cf-connecting-ip': ip,
    },
  });

describe('ai session soft rate limit', () => {
  test('同一 session 在 cooldown 内会被拦截', () => {
    __resetAiSessionSoftRateLimitForTest();
    const req = buildRequest('1.1.1.1');

    const first = acquireAiSessionSoftRateLimit({
      req,
      actionType: 'battle_story_session_continue',
      sessionId: 'session-a',
      providerMode: 'custom',
      nowMs: 1_000,
    });
    expect(first.allowed).toBe(true);

    const second = acquireAiSessionSoftRateLimit({
      req,
      actionType: 'battle_story_session_continue',
      sessionId: 'session-a',
      providerMode: 'custom',
      nowMs: 2_000,
    });
    expect(second.allowed).toBe(false);
    if (!second.allowed) {
      expect(second.reason).toBe('session_in_flight');
    }

    if (first.allowed) first.release();

    const third = acquireAiSessionSoftRateLimit({
      req,
      actionType: 'battle_story_session_continue',
      sessionId: 'session-a',
      providerMode: 'custom',
      nowMs: 3_500,
    });
    expect(third.allowed).toBe(false);
    if (!third.allowed) {
      expect(third.reason).toBe('session_cooldown');
    }
  });

  test('释放 lease 且超过 cooldown 后可再次通过', () => {
    __resetAiSessionSoftRateLimitForTest();
    const req = buildRequest('2.2.2.2');

    const first = acquireAiSessionSoftRateLimit({
      req,
      actionType: 'battle_story_session_refresh_summary',
      sessionId: 'session-b',
      providerMode: 'custom',
      nowMs: 1_000,
    });
    expect(first.allowed).toBe(true);
    if (first.allowed) first.release();

    const second = acquireAiSessionSoftRateLimit({
      req,
      actionType: 'battle_story_session_refresh_summary',
      sessionId: 'session-b',
      providerMode: 'custom',
      nowMs: 5_000,
    });
    expect(second.allowed).toBe(true);
  });
});
