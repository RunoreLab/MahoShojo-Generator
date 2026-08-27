import { describe, expect, it, vi } from 'vitest';

import { checkpointPredecessorOf } from '@mahoshojo/multiplayer-core';

import {
  createRedisRoomStore,
  type RedisRoomClient,
} from '#/arena-room/redis-room-store';
import {
  closeArenaRoomState,
  createArenaRoomState,
  publishArenaRoomState,
} from './arena-room-fixtures';

const createClient = (): RedisRoomClient => ({
  eval: vi.fn(),
  get: vi.fn(async () => null),
});

describe('RedisRoomStore', () => {
  it('以单次 Lua create 写入 versioned checkpoint、环境隔离 key 和 active TTL', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue('saved');
    const store = createRedisRoomStore({
      getClient: () => client,
      keyPrefix: 'preview',
      activeTtlSeconds: 3_600,
    });
    const state = createArenaRoomState();

    await expect(store.save({ checkpoint: state, expected: null }))
      .resolves.toEqual({ kind: 'saved' });

    expect(client.eval).toHaveBeenCalledTimes(1);
    const [script, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(script).toContain('ROOM_CHECKPOINT_SAVE_V1');
    expect(script).toContain("redis.call('GET', KEYS[1])");
    expect(script.indexOf("redis.call('GET', KEYS[1])"))
      .toBeLessThan(script.indexOf("redis.call('SET', KEYS[1]"));
    expect(options.keys).toEqual([
      expect.stringMatching(/^mahoshojo:room:v1:preview:[a-f0-9]{64}:checkpoint$/u),
    ]);
    expect(options.keys[0]).not.toContain('room-1');
    expect(options.arguments).toContain('3600000');
    const serialized = options.arguments.find((argument) => argument.startsWith('{'));
    expect(serialized).toBeDefined();
    expect(JSON.parse(serialized!)).toMatchObject({
      checkpointVersion: 1,
      expiryFence: 'active',
      ...checkpointPredecessorOf(state),
      state,
    });
  });

  it('把 stale predecessor 与 old epoch 映射为显式 conflict，不伪装成功', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue('conflict');
    const store = createRedisRoomStore({ getClient: () => client });
    const state = createArenaRoomState();

    await expect(store.save({
      checkpoint: publishArenaRoomState(state),
      expected: checkpointPredecessorOf(state),
    })).resolves.toEqual({ kind: 'conflict' });
  });

  it('在 Redis I/O 前拒绝 rollback、计数器跳跃和隐式 epoch rollover 候选', async () => {
    const client = createClient();
    const store = createRedisRoomStore({ getClient: () => client });
    const initial = createArenaRoomState();
    const acknowledged = publishArenaRoomState(initial);

    await expect(store.save({
      checkpoint: initial,
      expected: checkpointPredecessorOf(acknowledged),
    })).rejects.toThrow('REDIS_ROOM_SUCCESSOR_INVALID');
    await expect(store.save({
      checkpoint: createArenaRoomState('epoch-2'),
      expected: checkpointPredecessorOf(acknowledged),
    })).rejects.toThrow('REDIS_ROOM_SUCCESSOR_INVALID');
    await expect(store.save({
      checkpoint: {
        ...acknowledged,
        snapshot: {
          ...acknowledged.snapshot,
          revision: acknowledged.snapshot.revision + 2,
          controlSeq: acknowledged.snapshot.controlSeq + 1,
        },
      },
      expected: checkpointPredecessorOf(acknowledged),
    })).rejects.toThrow('REDIS_ROOM_SUCCESSOR_INVALID');

    expect(client.eval).not.toHaveBeenCalled();
  });

  it('closed checkpoint 使用 terminal TTL，且序列化不会修改调用方 state', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue('saved');
    const store = createRedisRoomStore({
      getClient: () => client,
      activeTtlSeconds: 3_600,
      terminalTtlSeconds: 45,
    });
    const initial = createArenaRoomState();
    const closed = closeArenaRoomState(initial);
    const before = structuredClone(closed);

    await expect(store.save({
      checkpoint: closed,
      expected: checkpointPredecessorOf(initial),
    })).resolves.toEqual({ kind: 'saved' });

    const [, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(options.arguments.at(-1)).toBe('45000');
    expect(closed).toEqual(before);
  });

  it('严格 hydrate versioned envelope 并拒绝损坏或 roomId 不匹配的 Redis 数据', async () => {
    const client = createClient();
    const state = createArenaRoomState();
    const envelope = JSON.stringify({
      checkpointVersion: 1,
      expiryFence: 'active',
      ...checkpointPredecessorOf(state),
      state,
    });
    const expiringEnvelope = JSON.stringify({
      checkpointVersion: 1,
      expiryFence: 'expiring',
      ...checkpointPredecessorOf(state),
      state,
    });
    vi.mocked(client.get)
      .mockResolvedValueOnce(envelope)
      .mockResolvedValueOnce(expiringEnvelope)
      .mockResolvedValueOnce('{not-json')
      .mockResolvedValueOnce(envelope);
    const store = createRedisRoomStore({ getClient: () => client });

    await expect(store.load('room-1')).resolves.toEqual(state);
    await expect(store.load('room-1')).resolves.toBeNull();
    await expect(store.load('room-1')).rejects.toThrow('REDIS_ROOM_CHECKPOINT_INVALID');
    await expect(store.load('room-other')).rejects.toThrow('REDIS_ROOM_CHECKPOINT_INVALID');
  });

  it('Redis 垃圾与未知 Lua 响应只上浮固定错误，不反射 checkpoint 内容', async () => {
    const client = createClient();
    vi.mocked(client.get).mockResolvedValue(JSON.stringify({
      providerApiKey: 'provider-secret-canary',
    }));
    vi.mocked(client.eval).mockResolvedValue('invalid-existing');
    const store = createRedisRoomStore({ getClient: () => client });
    const state = createArenaRoomState();

    const invalidLoad = store.load('room-1');
    await expect(invalidLoad).rejects.toThrow('REDIS_ROOM_CHECKPOINT_INVALID');
    await expect(invalidLoad.catch((error: unknown) => String(error)))
      .resolves.not.toContain('provider-secret-canary');
    await expect(store.save({ checkpoint: state, expected: null }))
      .rejects.toThrow('REDIS_ROOM_CHECKPOINT_INVALID');

    vi.mocked(client.eval).mockResolvedValueOnce({ status: 'saved' });
    await expect(store.save({ checkpoint: state, expected: null }))
      .rejects.toThrow('REDIS_ROOM_CHECKPOINT_RESPONSE_INVALID');
  });

  it('在 Redis I/O 前拒绝 roomId 不一致的 predecessor', async () => {
    const client = createClient();
    const store = createRedisRoomStore({ getClient: () => client });
    const state = createArenaRoomState();

    await expect(store.save({
      checkpoint: publishArenaRoomState(state),
      expected: { ...checkpointPredecessorOf(state), roomId: 'room-other' },
    })).rejects.toThrow('REDIS_ROOM_PREDECESSOR_INVALID');
    expect(client.eval).not.toHaveBeenCalled();
  });

  it.each([
    ['delete', 'deleted', { kind: 'deleted' }],
    ['delete', 'missing', { kind: 'missing' }],
    ['delete', 'conflict', { kind: 'conflict' }],
    ['expire', 'expired', { kind: 'expired' }],
    ['expire', 'missing', { kind: 'missing' }],
    ['expire', 'conflict', { kind: 'conflict' }],
  ] as const)('%s 严格解析 fenced/idempotent 结果 %s', async (operation, raw, expected) => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue(raw);
    const store = createRedisRoomStore({ getClient: () => client, terminalTtlSeconds: 60 });
    const predecessor = checkpointPredecessorOf(createArenaRoomState());

    await expect(store[operation]({ roomId: 'room-1', expected: predecessor }))
      .resolves.toEqual(expected);
  });

  it('expire 安装不可复活 fence，且重复执行只会单调缩短 TTL', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue('expired');
    const store = createRedisRoomStore({ getClient: () => client, terminalTtlSeconds: 60 });
    const predecessor = checkpointPredecessorOf(createArenaRoomState());

    await expect(store.expire({ roomId: 'room-1', expected: predecessor }))
      .resolves.toEqual({ kind: 'expired' });
    const [script, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(script).toContain('ROOM_CHECKPOINT_EXPIRE_V1');
    expect(script).toContain("current.expiryFence = 'expiring'");
    expect(script).toContain("redis.call('PTTL', KEYS[1])");
    expect(script).toContain('if currentTtl > 0 and currentTtl < targetTtl then');
    expect(script).toContain("redis.call('SET', KEYS[1], cjson.encode(current), 'PX', targetTtl)");
    expect(options.arguments.at(-1)).toBe('60000');
  });

  it('第二个 store 实例可恢复最后一次 acknowledged mutation，旧 epoch writer 不能覆盖', async () => {
    const values = new Map<string, string>();
    const durableClient: RedisRoomClient = {
      get: vi.fn(async (key) => values.get(key) ?? null),
      eval: vi.fn(async (script, options) => {
        const key = options.keys[0]!;
        const currentRaw = values.get(key);
        if (script.includes('ROOM_CHECKPOINT_SAVE_V1')) {
          const [expectedMode, expectedVersion, expectedRoomId, expectedRoomEpoch,
            expectedRevision, expectedControlSeq, serialized] = options.arguments;
          if (expectedMode === 'absent') {
            if (currentRaw !== undefined) return 'conflict';
          } else {
            if (currentRaw === undefined) return 'conflict';
            const current = JSON.parse(currentRaw) as Record<string, unknown>;
            if (
              current.checkpointVersion !== Number(expectedVersion)
              || current.roomId !== expectedRoomId
              || current.roomEpoch !== expectedRoomEpoch
              || current.revision !== Number(expectedRevision)
              || current.controlSeq !== Number(expectedControlSeq)
            ) return 'conflict';
          }
          values.set(key, serialized!);
          return 'saved';
        }
        throw new Error('unexpected script');
      }),
    };
    const firstProcess = createRedisRoomStore({ getClient: () => durableClient });
    const initial = createArenaRoomState();
    const acknowledged = publishArenaRoomState(initial);
    expect(await firstProcess.save({ checkpoint: initial, expected: null })).toEqual({ kind: 'saved' });
    expect(await firstProcess.save({
      checkpoint: acknowledged,
      expected: checkpointPredecessorOf(initial),
    })).toEqual({ kind: 'saved' });

    const restartedProcess = createRedisRoomStore({ getClient: () => durableClient });
    await expect(restartedProcess.load('room-1')).resolves.toEqual(acknowledged);

    values.clear();
    const nextEpoch = createArenaRoomState('epoch-2');
    expect(await restartedProcess.save({ checkpoint: nextEpoch, expected: null }))
      .toEqual({ kind: 'saved' });
    expect(await firstProcess.save({
      checkpoint: closeArenaRoomState(initial),
      expected: checkpointPredecessorOf(initial),
    })).toEqual({ kind: 'conflict' });
    await expect(restartedProcess.load('room-1')).resolves.toEqual(nextEpoch);
  });
});
