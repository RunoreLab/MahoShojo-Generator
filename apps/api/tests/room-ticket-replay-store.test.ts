import { describe, expect, it, vi } from 'vitest';

import {
  createRedisRoomTicketReplayStore,
  type RedisRoomTicketReplayClient,
} from '#/arena-room/redis-room-ticket-replay-store';

const createClient = (): RedisRoomTicketReplayClient => ({ eval: vi.fn() });

describe('RedisRoomTicketReplayStore', () => {
  it('以一次 Lua NX 消费短期 jti，key 不暴露 room/user/jti', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue('consumed');
    const store = createRedisRoomTicketReplayStore({
      getClient: () => client,
      keyPrefix: 'preview',
    });

    await expect(store.consume({
      jti: 'ticket-jti-secret-canary',
      nowMs: 1_000,
      expiresAtMs: 31_000,
    })).resolves.toEqual({ kind: 'consumed' });

    const [script, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(script).toContain('ROOM_TICKET_REPLAY_CONSUME_V1');
    expect(script).toContain("redis.call('SET', KEYS[1], '1', 'PX', ARGV[1], 'NX')");
    expect(options.keys).toEqual([
      expect.stringMatching(/^mahoshojo:room-ticket:v1:preview:[a-f0-9]{64}$/u),
    ]);
    expect(options.keys[0]).not.toContain('secret-canary');
    expect(options.arguments).toEqual(['30000']);
  });

  it('原子区分首次消费与 replay，并对未知响应 fail closed', async () => {
    const client = createClient();
    vi.mocked(client.eval)
      .mockResolvedValueOnce('replayed')
      .mockResolvedValueOnce({ status: 'consumed' });
    const store = createRedisRoomTicketReplayStore({ getClient: () => client });
    const input = { jti: 'jti-1', nowMs: 1_000, expiresAtMs: 2_000 };

    await expect(store.consume(input)).resolves.toEqual({ kind: 'replayed' });
    await expect(store.consume(input)).rejects.toThrow('REDIS_ROOM_TICKET_RESPONSE_INVALID');
  });

  it('在 Redis 前拒绝空/超长 jti、已过期和超过 ticket 最大 TTL 的输入', async () => {
    const client = createClient();
    const store = createRedisRoomTicketReplayStore({
      getClient: () => client,
      maxTicketTtlMs: 60_000,
    });

    await expect(store.consume({ jti: '', nowMs: 1_000, expiresAtMs: 2_000 }))
      .rejects.toThrow('REDIS_ROOM_TICKET_INPUT_INVALID');
    await expect(store.consume({ jti: 'x'.repeat(257), nowMs: 1_000, expiresAtMs: 2_000 }))
      .rejects.toThrow('REDIS_ROOM_TICKET_INPUT_INVALID');
    await expect(store.consume({ jti: 'jti-1', nowMs: 2_000, expiresAtMs: 2_000 }))
      .rejects.toThrow('REDIS_ROOM_TICKET_EXPIRED');
    await expect(store.consume({ jti: 'jti-1', nowMs: 1_000, expiresAtMs: 61_001 }))
      .rejects.toThrow('REDIS_ROOM_TICKET_TTL_INVALID');
    expect(client.eval).not.toHaveBeenCalled();
  });
});
