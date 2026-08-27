import { describe, expect, it, vi } from 'vitest';

import {
  checkpointPredecessorOf,
  createArenaRoomCheckpointCommit,
  type ArenaRoomCheckpointCommit,
  type ArenaRoomTransitionSuccess,
} from '@mahoshojo/multiplayer-core';

import {
  createRedisRoomStore,
  type RedisRoomClient,
} from '#/arena-room/redis-room-store';
import {
  closeArenaRoomTransition,
  createArenaRoomState,
  createArenaRoomTransition,
  publishArenaRoomTransition,
  recoverArenaRoomTransition,
} from './arena-room-fixtures';

const createClient = (): RedisRoomClient => ({
  eval: vi.fn(),
  get: vi.fn(async () => null),
});

const commit = (transition: ArenaRoomTransitionSuccess): ArenaRoomCheckpointCommit => (
  createArenaRoomCheckpointCommit(transition)
);

describe('RedisRoomStore', () => {
  it('以单次 Lua create 写入 versioned checkpoint、环境隔离 key 和 active TTL', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue('saved');
    const store = createRedisRoomStore({
      getClient: () => client,
      keyPrefix: 'preview',
      activeTtlSeconds: 3_600,
    });
    const created = createArenaRoomTransition();
    const state = created.nextState;

    await expect(store.save({ commit: commit(created) }))
      .resolves.toEqual({ kind: 'saved' });

    expect(client.eval).toHaveBeenCalledTimes(1);
    const [script, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(script).toContain('ROOM_CHECKPOINT_SAVE_V1');
    expect(script).toContain('raw ~= ARGV[9]');
    expect(script).toContain("redis.call('SISMEMBER', KEYS[2], candidate.roomEpoch)");
    expect(script).not.toContain("redis.call('PEXPIRE', KEYS[2]");
    expect(script).toContain("redis.call('GET', KEYS[1])");
    expect(script.indexOf("redis.call('GET', KEYS[1])"))
      .toBeLessThan(script.indexOf("redis.call('SET', KEYS[1]"));
    expect(options.keys).toEqual([
      expect.stringMatching(/^mahoshojo:room:v1:preview:[a-f0-9]{64}:checkpoint$/u),
      expect.stringMatching(/^mahoshojo:room:v1:preview:[a-f0-9]{64}:incarnations$/u),
    ]);
    expect(options.keys[0]).not.toContain('room-1');
    expect(options.keys[1]).not.toContain('room-1');
    expect(options.keys[0]!.replace(':checkpoint', ''))
      .toBe(options.keys[1]!.replace(':incarnations', ''));
    expect(options.arguments).toContain('3600000');
    expect(options.arguments.at(-1)).toBe('16');
    const serialized = options.arguments.find((argument) => argument.startsWith('{'));
    expect(serialized).toBeDefined();
    const parsed = JSON.parse(serialized!);
    expect(Object.keys(parsed).sort()).toEqual([
      'checkpointVersion',
      'controlSeq',
      'revision',
      'roomEpoch',
      'roomId',
      'state',
    ]);
    expect(parsed).toMatchObject({
      checkpointVersion: 1,
      ...checkpointPredecessorOf(state),
      state,
    });
  });

  it('把 stale predecessor 与 old epoch 映射为显式 conflict，不伪装成功', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue('conflict');
    const store = createRedisRoomStore({ getClient: () => client });
    const state = createArenaRoomState();

    await expect(store.save({ commit: commit(publishArenaRoomTransition(state)) }))
      .resolves.toEqual({ kind: 'conflict' });
  });

  it('以完整 predecessor CAS 接受 state-machine recovery epoch rollover', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue('saved');
    const store = createRedisRoomStore({ getClient: () => client });
    const initial = createArenaRoomState();

    await expect(store.save({ commit: commit(recoverArenaRoomTransition(initial)) }))
      .resolves.toEqual({ kind: 'saved' });

    const [script, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(script).toContain('candidate.roomEpoch == current.roomEpoch');
    expect(script).toContain("if epochSeen == 1 then return 'conflict' end");
    expect(script).toContain("redis.call('SISMEMBER', KEYS[2], current.roomEpoch)");
    expect(script).toContain('fenceCount + requiredEpochs');
    expect(script).toContain("redis.call('SADD', KEYS[2], currentEpochToFence)");
    expect(script).toContain('candidate.controlSeq ~= 0');
    expect(options.arguments.at(-1)).toBe('16');
    expect(JSON.parse(options.arguments.at(-4)!).roomEpoch).toBe('epoch-2');
    expect(JSON.parse(options.arguments.at(-2)!).roomEpoch).toBe('epoch-1');
  });

  it('只接受 state machine 签发的 receipt，且 transition 返回后篡改不会进入 checkpoint', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue('saved');
    const store = createRedisRoomStore({ getClient: () => client });
    const initial = createArenaRoomState();
    const transition = publishArenaRoomTransition(initial);

    await expect(store.save({
      commit: {} as ArenaRoomCheckpointCommit,
    })).rejects.toThrow('REDIS_ROOM_TRANSITION_COMMIT_INVALID');
    expect(client.eval).not.toHaveBeenCalled();

    transition.nextState.snapshot.sharedConfig.userGuidance = 'tampered-old-payload';
    await expect(store.save({ commit: commit(transition) }))
      .resolves.toEqual({ kind: 'saved' });
    const [, options] = vi.mocked(client.eval).mock.calls[0]!;
    const serialized = options.arguments.find((argument) => argument.startsWith('{'))!;
    expect(JSON.parse(serialized).state.snapshot.sharedConfig.userGuidance).toBe('已确认写入');

    const closedTransition = closeArenaRoomTransition(initial);
    closedTransition.nextState.lifecycle = structuredClone(initial.lifecycle);
    await expect(store.save({ commit: commit(closedTransition) }))
      .resolves.toEqual({ kind: 'saved' });
    const [, closedOptions] = vi.mocked(client.eval).mock.calls[1]!;
    const serializedClosed = closedOptions.arguments.find((argument) => argument.startsWith('{'))!;
    expect(JSON.parse(serializedClosed).state.lifecycle.status).toBe('closed');
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
    const closedTransition = closeArenaRoomTransition(initial);
    const closed = closedTransition.nextState;
    const before = structuredClone(closed);

    await expect(store.save({ commit: commit(closedTransition) }))
      .resolves.toEqual({ kind: 'saved' });

    const [, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(options.arguments.at(-3)).toBe('45000');
    expect(closed).toEqual(before);
  });

  it('严格 hydrate versioned envelope 并拒绝损坏或 roomId 不匹配的 Redis 数据', async () => {
    const client = createClient();
    const state = createArenaRoomState();
    const envelope = JSON.stringify({
      checkpointVersion: 1,
      ...checkpointPredecessorOf(state),
      state,
    });
    const expiringEnvelope = JSON.stringify({
      checkpointVersion: 2,
      expiryFence: 'expiring',
      ...checkpointPredecessorOf(state),
      state,
    });
    vi.mocked(client.get)
      .mockResolvedValueOnce(envelope)
      .mockResolvedValueOnce(expiringEnvelope)
      .mockResolvedValueOnce('{not-json')
      .mockResolvedValueOnce(envelope);
    vi.mocked(client.eval).mockResolvedValue('seeded');
    const store = createRedisRoomStore({ getClient: () => client });

    await expect(store.load('room-1')).resolves.toEqual(state);
    await expect(store.load('room-1')).resolves.toBeNull();
    await expect(store.load('room-1')).rejects.toThrow('REDIS_ROOM_CHECKPOINT_INVALID');
    await expect(store.load('room-other')).rejects.toThrow('REDIS_ROOM_CHECKPOINT_INVALID');
    const [script, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(script).toContain('ROOM_CHECKPOINT_BOOTSTRAP_FENCE_V1');
    expect(script).toContain("raw ~= ARGV[1]");
    expect(script).toContain("redis.call('SADD', KEYS[2], current.roomEpoch)");
    expect(options.arguments.at(-1)).toBe('16');
  });

  it('legacy fence bootstrap 与并发 checkpoint 变化冲突时重读，不返回未围住的旧 state', async () => {
    const client = createClient();
    const first = createArenaRoomState('epoch-1');
    const second = createArenaRoomState('epoch-2');
    const envelope = (state: typeof first) => JSON.stringify({
      checkpointVersion: 1,
      ...checkpointPredecessorOf(state),
      state,
    });
    vi.mocked(client.get)
      .mockResolvedValueOnce(envelope(first))
      .mockResolvedValueOnce(envelope(second));
    vi.mocked(client.eval)
      .mockResolvedValueOnce('conflict')
      .mockResolvedValueOnce('seeded');
    const store = createRedisRoomStore({ getClient: () => client });

    await expect(store.load('room-1')).resolves.toEqual(second);
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(client.eval).toHaveBeenCalledTimes(2);
  });

  it('legacy checkpoint 在 GET 后到期时仍补种旧 epoch fence，并返回 absent', async () => {
    const client = createClient();
    const state = createArenaRoomState('epoch-expired-during-load');
    const raw = JSON.stringify({
      checkpointVersion: 1,
      ...checkpointPredecessorOf(state),
      state,
    });
    vi.mocked(client.get).mockResolvedValue(raw);
    vi.mocked(client.eval).mockResolvedValue('expired');
    const store = createRedisRoomStore({ getClient: () => client });

    await expect(store.load('room-1')).resolves.toBeNull();
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining('ROOM_CHECKPOINT_BOOTSTRAP_FENCE_V1'),
      expect.objectContaining({
        arguments: [raw, 'room-1', 'epoch-expired-during-load', '16'],
      }),
    );
  });

  it('Redis 垃圾与未知 Lua 响应只上浮固定错误，不反射 checkpoint 内容', async () => {
    const client = createClient();
    vi.mocked(client.get).mockResolvedValue(JSON.stringify({
      providerApiKey: 'provider-secret-canary',
    }));
    vi.mocked(client.eval).mockResolvedValue('invalid-existing');
    const store = createRedisRoomStore({ getClient: () => client });
    const created = createArenaRoomTransition();
    const receipt = commit(created);

    const invalidLoad = store.load('room-1');
    await expect(invalidLoad).rejects.toThrow('REDIS_ROOM_CHECKPOINT_INVALID');
    await expect(invalidLoad.catch((error: unknown) => String(error)))
      .resolves.not.toContain('provider-secret-canary');
    await expect(store.save({ commit: receipt }))
      .rejects.toThrow('REDIS_ROOM_CHECKPOINT_INVALID');

    vi.mocked(client.eval).mockResolvedValueOnce({ status: 'saved' });
    await expect(store.save({ commit: commit(createArenaRoomTransition()) }))
      .rejects.toThrow('REDIS_ROOM_CHECKPOINT_RESPONSE_INVALID');
  });

  it('每个 transition/receipt 只允许一次 checkpoint 尝试，Redis 未知结果也不得盲目重放', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockRejectedValue(new Error('redis timeout'));
    const store = createRedisRoomStore({ getClient: () => client });
    const transition = createArenaRoomTransition();
    const receipt = commit(transition);

    expect(() => commit(transition)).toThrow('ARENA_ROOM_CHECKPOINT_COMMIT_INVALID');
    await expect(store.save({ commit: receipt })).rejects.toThrow('redis timeout');
    await expect(store.save({ commit: receipt }))
      .rejects.toThrow('REDIS_ROOM_TRANSITION_COMMIT_INVALID');
    expect(client.eval).toHaveBeenCalledTimes(1);

    const unknownClient = createClient();
    vi.mocked(unknownClient.eval).mockResolvedValue({ status: 'saved' });
    const unknownStore = createRedisRoomStore({ getClient: () => unknownClient });
    const unknownReceipt = commit(createArenaRoomTransition());
    await expect(unknownStore.save({ commit: unknownReceipt }))
      .rejects.toThrow('REDIS_ROOM_CHECKPOINT_RESPONSE_INVALID');
    await expect(unknownStore.save({ commit: unknownReceipt }))
      .rejects.toThrow('REDIS_ROOM_TRANSITION_COMMIT_INVALID');
    expect(unknownClient.eval).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid-fence', 'REDIS_ROOM_INCARNATION_FENCE_INVALID'],
    ['incarnation-limit', 'REDIS_ROOM_INCARNATION_LIMIT'],
  ] as const)('把 incarnation fence 响应 %s 映射为稳定错误', async (raw, expected) => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue(raw);
    const store = createRedisRoomStore({ getClient: () => client });

    await expect(store.save({ commit: commit(createArenaRoomTransition()) }))
      .rejects.toThrow(expected);
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
    const checkpoint = createArenaRoomState();

    await expect(store[operation]({ checkpoint }))
      .resolves.toEqual(expected);
    const [script, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(script).not.toContain("redis.call('PEXPIRE', KEYS[2]");
    expect(options.keys[1]).toMatch(/:incarnations$/u);
  });

  it('expire 安装不可复活 fence，且重复执行只会单调缩短 TTL', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue('expired');
    const store = createRedisRoomStore({ getClient: () => client, terminalTtlSeconds: 60 });
    const checkpoint = createArenaRoomState();

    await expect(store.expire({ checkpoint }))
      .resolves.toEqual({ kind: 'expired' });
    const [script, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(script).toContain('ROOM_CHECKPOINT_EXPIRE_V1');
    expect(script).not.toContain("redis.call('PEXPIRE', KEYS[2]");
    expect(script).toContain("redis.call('PTTL', KEYS[1])");
    expect(script).toContain('if currentTtl > 0 and currentTtl < targetTtl then');
    expect(script).toContain("redis.call('SET', KEYS[1], ARGV[8], 'PX', targetTtl)");
    expect(script).toContain('currentActive and raw ~= ARGV[7]');
    expect(script).toContain('currentExpiring and raw ~= ARGV[8]');
    expect(options.arguments.at(-4)).toBe('60000');
    expect(JSON.parse(options.arguments.at(-2)!)).toMatchObject({
      checkpointVersion: 2,
      expiryFence: 'expiring',
    });
    expect(options.arguments.at(-1)).toBe('16');
  });

  it('第二个 store 实例可恢复最后一次 acknowledged mutation，旧 epoch writer 不能覆盖', async () => {
    const values = new Map<string, string>();
    const durableClient: RedisRoomClient = {
      get: vi.fn(async (key) => values.get(key) ?? null),
      eval: vi.fn(async (script, options) => {
        const key = options.keys[0]!;
        const currentRaw = values.get(key);
        if (script.includes('ROOM_CHECKPOINT_BOOTSTRAP_FENCE_V1')) {
          return currentRaw === options.arguments[0] ? 'seeded' : 'conflict';
        }
        if (script.includes('ROOM_CHECKPOINT_SAVE_V1')) {
          const [expectedMode, expectedVersion, expectedRoomId, expectedRoomEpoch,
            expectedRevision, expectedControlSeq, serialized, , expectedRaw] = options.arguments;
          if (expectedMode === 'absent') {
            if (currentRaw !== undefined) return 'conflict';
          } else {
            if (currentRaw === undefined) return 'conflict';
            if (currentRaw !== expectedRaw) return 'conflict';
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
    const created = createArenaRoomTransition();
    const initial = created.nextState;
    const published = publishArenaRoomTransition(initial);
    const acknowledged = published.nextState;
    expect(await firstProcess.save({ commit: commit(created) })).toEqual({ kind: 'saved' });
    expect(await firstProcess.save({ commit: commit(published) })).toEqual({ kind: 'saved' });

    const restartedProcess = createRedisRoomStore({ getClient: () => durableClient });
    await expect(restartedProcess.load('room-1')).resolves.toEqual(acknowledged);

    values.clear();
    const nextEpochCreated = createArenaRoomTransition('epoch-2');
    const nextEpoch = nextEpochCreated.nextState;
    expect(await restartedProcess.save({ commit: commit(nextEpochCreated) }))
      .toEqual({ kind: 'saved' });
    expect(await firstProcess.save({ commit: commit(closeArenaRoomTransition(initial)) }))
      .toEqual({ kind: 'conflict' });
    await expect(restartedProcess.load('room-1')).resolves.toEqual(nextEpoch);
  });
});
