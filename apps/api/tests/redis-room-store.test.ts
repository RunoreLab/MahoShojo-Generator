import { describe, expect, it, vi } from 'vitest';

import {
  checkpointPredecessorOf,
  transitionArenaRoom,
  type ArenaRoomAuthorityState,
} from '@mahoshojo/multiplayer-core';

import {
  createRedisRoomStore,
  type RedisRoomClient,
} from '#/arena-room/redis-room-store';

const TIMESTAMP = '2026-08-28T00:00:00.000Z';
const NEXT_TIMESTAMP = '2026-08-28T00:01:00.000Z';

const sharedConfig = () => ({
  battleMode: 'classic' as const,
  combatants: [{
    key: 'data-card:character-1',
    ref: { id: 'character-1', kind: 'character' as const, versionToken: 'v1' },
  }],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'standard' as const,
  customStoryLength: null,
  selectedLanguage: 'zh-CN',
  historySettings: {
    readArenaHistory: true,
    readArenaHistoryLimit: 3,
    isArenaHistoryUnlimited: false,
    writeArenaHistory: true,
    readCurrentState: true,
    writeCurrentState: true,
    readNarrativeHistory: false,
    readNarrativeHistoryLimit: 10,
    isNarrativeHistoryUnlimited: false,
    writeNarrativeHistory: false,
  },
});

const hostAuthority = {
  kind: 'authenticated-user' as const,
  actorUserId: 'host-1',
  accountUserId: 101,
};

const createState = (roomEpoch = 'epoch-1'): ArenaRoomAuthorityState => {
  const result = transitionArenaRoom(null, {
    type: 'create',
    roomId: 'room-1',
    roomEpoch,
    host: {
      userId: 'host-1',
      role: 'host',
      displayName: 'Host',
      membershipState: 'active',
      joinedAt: TIMESTAMP,
    },
    sharedConfig: sharedConfig(),
    timestamp: TIMESTAMP,
  }, hostAuthority);
  if (!result.ok) throw new Error(`${result.code}:${result.reason}`);
  return result.nextState;
};

const publish = (state: ArenaRoomAuthorityState): ArenaRoomAuthorityState => {
  const result = transitionArenaRoom(state, {
    type: 'publish-config',
    expectedRoomEpoch: state.snapshot.roomEpoch,
    expectedRevision: state.snapshot.revision,
    sharedConfig: { ...state.snapshot.sharedConfig, userGuidance: '已确认写入' },
    timestamp: NEXT_TIMESTAMP,
  }, hostAuthority);
  if (!result.ok) throw new Error(`${result.code}:${result.reason}`);
  return result.nextState;
};

const close = (state: ArenaRoomAuthorityState): ArenaRoomAuthorityState => {
  const result = transitionArenaRoom(state, {
    type: 'close',
    expectedRoomEpoch: state.snapshot.roomEpoch,
    reason: 'test-close',
    timestamp: NEXT_TIMESTAMP,
  }, hostAuthority);
  if (!result.ok) throw new Error(`${result.code}:${result.reason}`);
  return result.nextState;
};

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
    const state = createState();

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
      ...checkpointPredecessorOf(state),
      state,
    });
  });

  it('把 stale predecessor 与 old epoch 映射为显式 conflict，不伪装成功', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue('conflict');
    const store = createRedisRoomStore({ getClient: () => client });
    const state = createState();

    await expect(store.save({
      checkpoint: publish(state),
      expected: checkpointPredecessorOf(state),
    })).resolves.toEqual({ kind: 'conflict' });
  });

  it('closed checkpoint 使用 terminal TTL，且序列化不会修改调用方 state', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue('saved');
    const store = createRedisRoomStore({
      getClient: () => client,
      activeTtlSeconds: 3_600,
      terminalTtlSeconds: 45,
    });
    const initial = createState();
    const closed = close(initial);
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
    const state = createState();
    const envelope = JSON.stringify({
      checkpointVersion: 1,
      ...checkpointPredecessorOf(state),
      state,
    });
    vi.mocked(client.get)
      .mockResolvedValueOnce(envelope)
      .mockResolvedValueOnce('{not-json')
      .mockResolvedValueOnce(envelope);
    const store = createRedisRoomStore({ getClient: () => client });

    await expect(store.load('room-1')).resolves.toEqual(state);
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
    const state = createState();

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
    const state = createState();

    await expect(store.save({
      checkpoint: publish(state),
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
    const predecessor = checkpointPredecessorOf(createState());

    await expect(store[operation]({ roomId: 'room-1', expected: predecessor }))
      .resolves.toEqual(expected);
  });

  it('expire 在同一 Lua fence 后设置 terminal TTL', async () => {
    const client = createClient();
    vi.mocked(client.eval).mockResolvedValue('expired');
    const store = createRedisRoomStore({ getClient: () => client, terminalTtlSeconds: 60 });
    const predecessor = checkpointPredecessorOf(createState());

    await expect(store.expire({ roomId: 'room-1', expected: predecessor }))
      .resolves.toEqual({ kind: 'expired' });
    const [script, options] = vi.mocked(client.eval).mock.calls[0]!;
    expect(script).toContain('ROOM_CHECKPOINT_EXPIRE_V1');
    expect(script).toContain("redis.call('PEXPIRE', KEYS[1], ARGV[6])");
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
    const initial = createState();
    const acknowledged = publish(initial);
    expect(await firstProcess.save({ checkpoint: initial, expected: null })).toEqual({ kind: 'saved' });
    expect(await firstProcess.save({
      checkpoint: acknowledged,
      expected: checkpointPredecessorOf(initial),
    })).toEqual({ kind: 'saved' });

    const restartedProcess = createRedisRoomStore({ getClient: () => durableClient });
    await expect(restartedProcess.load('room-1')).resolves.toEqual(acknowledged);

    const nextEpoch = createState('epoch-2');
    expect(await restartedProcess.save({
      checkpoint: nextEpoch,
      expected: checkpointPredecessorOf(acknowledged),
    })).toEqual({ kind: 'saved' });
    expect(await firstProcess.save({
      checkpoint: { ...acknowledged, lifecycle: { ...acknowledged.lifecycle, updatedAt: NEXT_TIMESTAMP } },
      expected: checkpointPredecessorOf(acknowledged),
    })).toEqual({ kind: 'conflict' });
    await expect(restartedProcess.load('room-1')).resolves.toEqual(nextEpoch);
  });
});
