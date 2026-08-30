import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetArenaSessionSoftRateLimitForTest,
  acquireArenaSessionSoftRateLimit,
} from '../src/arena-companion/rate-limit';

const request = (ip = '203.0.113.7') => new Request('https://example.test/api/arena/session/generate-next', {
  headers: { 'cf-connecting-ip': ip },
});

describe('Arena session soft rate limit', () => {
  beforeEach(() => __resetArenaSessionSoftRateLimitForTest());

  it('同一会话拒绝并发，release 后仍保留 cooldown', () => {
    const first = acquireArenaSessionSoftRateLimit({
      req: request(),
      actionType: 'battle_story_session_continue',
      sessionId: 'session-1',
      providerMode: 'system',
      nowMs: 1_000,
    });
    expect(first.allowed).toBe(true);
    const concurrent = acquireArenaSessionSoftRateLimit({
      req: request(),
      actionType: 'battle_story_session_continue',
      sessionId: 'session-1',
      providerMode: 'system',
      nowMs: 1_100,
    });
    expect(concurrent).toMatchObject({ allowed: false, reason: 'session_in_flight' });
    if (first.allowed) first.release();
    const cooldown = acquireArenaSessionSoftRateLimit({
      req: request(),
      actionType: 'battle_story_session_continue',
      sessionId: 'session-1',
      providerMode: 'system',
      nowMs: 1_200,
    });
    expect(cooldown).toMatchObject({ allowed: false, reason: 'session_cooldown' });
  });
});
