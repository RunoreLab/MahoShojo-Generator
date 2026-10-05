import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createArenaRoomCheckpointCommit } from '@mahoshojo/multiplayer-core';

const redisClient = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  connect: vi.fn(async () => undefined),
  destroy: vi.fn(),
  eval: vi.fn(),
  get: vi.fn<() => Promise<string | null>>(async () => null),
  info: vi.fn(),
  isOpen: true,
  isReady: true,
  on: vi.fn(),
  ping: vi.fn(async () => 'PONG'),
  xRead: vi.fn(async () => null),
}));

const redisBlockingPool = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  destroy: vi.fn(),
  isOpen: true,
  on: vi.fn(),
  ping: vi.fn(async () => 'PONG'),
  xRead: vi.fn<() => Promise<Array<{
    name: string;
    messages: Array<{ id: string; message: Record<string, string> }>;
  }> | null>>(async () => null),
}));

vi.mock('redis', () => ({
  createClient: vi.fn(() => redisClient),
  createClientPool: vi.fn(() => redisBlockingPool),
}));

import { createClientPool } from 'redis';
import {
  RedisRuntime,
  type RedisRuntimeObserver,
} from '#/redis/runtime';
import { createArenaRoomTransition } from './arena-room-fixtures';

beforeEach(() => {
  vi.restoreAllMocks();
  redisClient.on.mockReset();
  redisClient.connect.mockResolvedValue(undefined);
  redisClient.eval.mockResolvedValue([1, 60_000]);
  redisClient.info.mockResolvedValue('');
  redisClient.get.mockResolvedValue(null);
  redisClient.ping.mockResolvedValue('PONG');
  redisClient.xRead.mockResolvedValue(null);
  redisClient.isOpen = true;
  redisClient.isReady = true;
  redisBlockingPool.connect.mockReset();
  redisBlockingPool.connect.mockResolvedValue(undefined);
  redisBlockingPool.destroy.mockReset();
  redisBlockingPool.on.mockReset();
  redisBlockingPool.ping.mockReset();
  redisBlockingPool.ping.mockResolvedValue('PONG');
  redisBlockingPool.xRead.mockReset();
  redisBlockingPool.xRead.mockResolvedValue(null);
  redisBlockingPool.isOpen = true;
});

describe('RedisRuntime shutdown', () => {
  it('Room Redis 命令记录固定 room latency/outcome，并向 checkpoint observer 透传', async () => {
    const observeRedisOperation = vi.fn<RedisRuntimeObserver['observeRedisOperation']>();
    const observeArenaRoomRuntime = vi.fn();
    const redis = new RedisRuntime('redis://example.test:6379', true, {
      observeRedisOperation,
      observeRedisServerStats: vi.fn(),
      observeArenaRoomRuntime,
    });
    const store = redis.getRoomStore();

    await expect(store.load('room-1'))
      .rejects.toThrow('REDIS_ROOM_CHECKPOINT_UNAVAILABLE');
    await redis.connect();
    await expect(store.load('room-1')).resolves.toBeNull();

    expect(observeRedisOperation).toHaveBeenCalledWith({
      operation: 'room',
      outcome: 'unavailable',
      durationMs: 0,
    });
    expect(observeRedisOperation).toHaveBeenCalledWith({
      operation: 'room',
      outcome: 'ok',
      durationMs: expect.any(Number),
    });
    expect(observeArenaRoomRuntime).toHaveBeenCalledWith(expect.objectContaining({
      event: 'checkpoint',
      operation: 'load',
      outcome: 'missing',
    }));
  });

  it('Room Redis observer 抛错不改变 timeout fail-closed 结果', async () => {
    vi.useFakeTimers();
    redisClient.get.mockImplementation(() => new Promise(() => undefined));
    const observeRedisOperation = vi.fn<RedisRuntimeObserver['observeRedisOperation']>(
      (observation) => {
        if (observation.operation === 'room') throw new Error('observer-secret-canary');
      },
    );
    const redis = new RedisRuntime('redis://example.test:6379', true, {
      observeRedisOperation,
      observeRedisServerStats: vi.fn(),
      observeArenaRoomRuntime: () => {
        throw new Error('checkpoint-observer-secret-canary');
      },
    }, 100);
    try {
      await redis.connect();
      const load = redis.getRoomStore().load('room-1');
      const rejected = expect(load).rejects.toThrow('REDIS_ROOM_COMMAND_TIMEOUT');
      await vi.advanceTimersByTimeAsync(100);

      await rejected;
      expect(redis.getStatus().lastError).toBe('REDIS_ROOM_COMMAND_TIMEOUT');
      expect(observeRedisOperation).toHaveBeenCalledWith({
        operation: 'room',
        outcome: 'error',
        durationMs: expect.any(Number),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('只向 Room runtime 暴露窄 checkpoint port，并在 Redis 未 ready 时 fail closed', async () => {
    const redis = new RedisRuntime('redis://example.test:6379', true);
    const store = redis.getRoomStore();

    await expect(store.load('room-1')).rejects.toThrow('REDIS_ROOM_CHECKPOINT_UNAVAILABLE');
    await expect(store.save({
      commit: createArenaRoomCheckpointCommit(createArenaRoomTransition()),
    }))
      .rejects.toThrow('REDIS_ROOM_CHECKPOINT_UNAVAILABLE');

    await redis.connect();
    await expect(store.load('room-1')).resolves.toBeNull();
  });

  it('Room ticket replay port 与 checkpoint 共用有界 Redis command/fail-closed 语义', async () => {
    const redis = new RedisRuntime('redis://example.test:6379', true);
    const replay = redis.getRoomTicketReplayStore();
    const input = { jti: 'jti-1', nowMs: 1_000, expiresAtMs: 31_000 };

    await expect(replay.consume(input)).rejects.toThrow('REDIS_ROOM_CHECKPOINT_UNAVAILABLE');
    await redis.connect();
    redisClient.eval.mockResolvedValueOnce('consumed');
    await expect(replay.consume(input)).resolves.toEqual({ kind: 'consumed' });
  });

  it('Room checkpoint 命令永久 pending 时有界 fail closed 且不反射 Redis secret', async () => {
    vi.useFakeTimers();
    redisClient.get.mockImplementation(() => new Promise(() => undefined));
    const redis = new RedisRuntime('redis://user:secret@example.test:6379', true, undefined, 100);
    try {
      await redis.connect();
      const checkpoint = redis.getRoomStore().load('room-1');
      const rejectedCheckpoint = expect(checkpoint).rejects.toThrow('REDIS_ROOM_COMMAND_TIMEOUT');
      await vi.advanceTimersByTimeAsync(100);

      await rejectedCheckpoint;
      expect(redis.getStatus().lastError).toBe('REDIS_ROOM_COMMAND_TIMEOUT');
      expect(JSON.stringify(redis.getStatus())).not.toMatch(/user:secret|example\.test/u);
    } finally {
      vi.useRealTimers();
    }
  });

  it('只向 route runtime 暴露窄 generation replay port，并在 Redis 未 ready 时 fail closed', async () => {
    const redis = new RedisRuntime('redis://example.test:6379', true);
    const store = redis.getGenerationReplayStore();

    await expect(store.reserve({
      actorKey: 'user:42',
      generationRequestId: 'request-1234',
      generationId: 'generation-1234',
      payloadHash: 'payload-hash',
      producerToken: 'producer-token-1',
      now: '2026-08-25T04:00:00.000Z',
      leaseExpiresAt: '2026-08-25T04:01:00.000Z',
    })).rejects.toThrow('REDIS_GENERATION_REPLAY_UNAVAILABLE');

    await redis.connect();
    redisClient.eval.mockResolvedValueOnce(['created', 'generation-1234']);
    await expect(store.reserve({
      actorKey: 'user:42',
      generationRequestId: 'request-1234',
      generationId: 'generation-1234',
      payloadHash: 'payload-hash',
      producerToken: 'producer-token-1',
      now: '2026-08-25T04:00:00.000Z',
      leaseExpiresAt: '2026-08-25T04:01:00.000Z',
    })).resolves.toMatchObject({ kind: 'created', generationId: 'generation-1234' });
  });

  it('generation 阻塞读 pending 时 append 仍通过主连接先完成', async () => {
    const redis = new RedisRuntime('redis://example.test:6379', true);
    await redis.connect();
    let resolveXRead!: (value: Array<{
      name: string;
      messages: Array<{ id: string; message: Record<string, string> }>;
    }>) => void;
    redisClient.eval
      .mockResolvedValueOnce(['events', '[]'])
      .mockResolvedValueOnce(['1-0'])
      .mockResolvedValueOnce([
        'events',
        JSON.stringify([{ id: '1-0', type: 'markdown', data: '{"chunk":"A"}' }]),
      ]);
    redisBlockingPool.xRead.mockImplementationOnce(() => new Promise((resolve) => {
      resolveXRead = resolve;
    }));
    const store = redis.getGenerationReplayStore();
    const read = store.readAfter({
      generationId: 'generation-streaming-1',
      after: null,
      blockMs: 1_000,
    });
    let readSettled = false;
    void read.then(
      () => {
        readSettled = true;
      },
      () => {
        readSettled = true;
      },
    );
    await vi.waitFor(() => {
      expect(redisBlockingPool.xRead).toHaveBeenCalledTimes(1);
    });

    await expect(store.appendEvents({
      generationId: 'generation-streaming-1',
      producerToken: 'producer-token-1',
      events: [{ type: 'markdown', data: { chunk: 'A' } }],
      now: '2026-08-25T04:00:00.000Z',
    })).resolves.toEqual({
      owned: true,
      events: [{ id: '1-0', type: 'markdown', data: { chunk: 'A' } }],
    });
    expect(readSettled).toBe(false);
    expect(redisClient.eval).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('GEN_APPEND_V1'),
      expect.any(Object),
    );

    resolveXRead([{
      name: 'mahoshojo:gen:v1:generation-streaming-1:events',
      messages: [{ id: '1-0', message: { type: 'markdown', data: '{"chunk":"A"}' } }],
    }]);
    await expect(read).resolves.toEqual({
      kind: 'events',
      events: [{ id: '1-0', type: 'markdown', data: { chunk: 'A' } }],
    });
    expect(redisClient.xRead).not.toHaveBeenCalled();
  });

  it('generation 阻塞池保留 inactivity timeout 并用更短 PING 保活最小连接', async () => {
    const redis = new RedisRuntime('redis://example.test:6379', true);

    await redis.connect();

    expect(vi.mocked(createClientPool)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pingInterval: 1_000,
        socket: expect.objectContaining({
          socketTimeout: 3_000,
        }),
      }),
      expect.objectContaining({
        acquireTimeout: 1_500,
        maximum: 32,
        minimum: 1,
      }),
    );
  });

  it('readiness ping 同时验证 generation blocking pool', async () => {
    const redis = new RedisRuntime('redis://example.test:6379', true);
    await redis.connect();
    redisBlockingPool.ping.mockRejectedValueOnce(new Error('pool unavailable'));

    await expect(redis.ping()).resolves.toBe(false);

    expect(redisClient.ping).toHaveBeenCalledOnce();
    expect(redisBlockingPool.ping).toHaveBeenCalledOnce();
    expect(redis.getStatus().lastError).toBe('REDIS_PING_FAILED');
  });

  it('Redis client 错误只保留固定状态码与低基数日志', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const redis = new RedisRuntime('redis://user:secret@example.test:6379', false);
    await redis.connect();
    const errorListener = redisClient.on.mock.calls.find(([event]) => event === 'error')?.[1];

    expect(errorListener).toBeTypeOf('function');
    errorListener?.(new Error('redis://user:secret@example.test:6379 connection lost'));

    expect(redis.getStatus().lastError).toBe('REDIS_CONNECTION_ERROR');
    expect(errorSpy).toHaveBeenCalledWith('[hono][redis] 连接异常', {
      errorClass: 'connection_error',
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/user:secret|example\.test/u);
  });

  it('Redis required 连接失败时只抛出固定错误码', async () => {
    redisClient.connect.mockRejectedValueOnce(
      new Error('redis://user:secret@example.test:6379 connect failed'),
    );
    const redis = new RedisRuntime('redis://user:secret@example.test:6379', true);

    await expect(redis.connect()).rejects.toThrow('REDIS_CONNECT_FAILED');
    expect(redis.getStatus().lastError).toBe('REDIS_CONNECT_FAILED');
  });

  it('generation 阻塞读连接池启动失败时销毁双通道并 fail closed', async () => {
    redisBlockingPool.connect.mockRejectedValueOnce(new Error('pool endpoint secret failed'));
    const redis = new RedisRuntime('redis://user:secret@example.test:6379', true);

    await expect(redis.connect()).rejects.toThrow('REDIS_CONNECT_FAILED');

    expect(redisClient.destroy).toHaveBeenCalledTimes(1);
    expect(redisBlockingPool.destroy).toHaveBeenCalledTimes(1);
    expect(redis.getStatus()).toMatchObject({ connected: false, ready: false });
    expect(JSON.stringify(redis.getStatus())).not.toMatch(/user:secret|example\.test/u);
  });

  it('generation 阻塞读连接池不可用时使读取有界 fail closed', async () => {
    const redis = new RedisRuntime('redis://example.test:6379', true);
    await redis.connect();
    redisClient.eval.mockResolvedValueOnce(['events', '[]']);
    redisBlockingPool.isOpen = false;

    await expect(redis.getGenerationReplayStore().readAfter({
      generationId: 'generation-streaming-unavailable',
      after: null,
      blockMs: 1_000,
    })).rejects.toThrow('REDIS_GENERATION_REPLAY_UNAVAILABLE');
  });

  it('观测 Redis 命令延迟并从 INFO 读取 memory、eviction 和 hit/miss', async () => {
    redisClient.eval.mockResolvedValueOnce([2, 4_000]);
    redisClient.info.mockImplementation(async (section: string) => {
      if (section === 'memory') return '# Memory\r\nused_memory:4096\r\n';
      return '# Stats\r\nevicted_keys:7\r\nkeyspace_hits:13\r\nkeyspace_misses:5\r\n';
    });
    const observeRedisOperation = vi.fn<RedisRuntimeObserver['observeRedisOperation']>();
    const observeRedisServerStats = vi.fn<RedisRuntimeObserver['observeRedisServerStats']>();
    const observer: RedisRuntimeObserver = {
      observeRedisOperation,
      observeRedisServerStats,
    };
    const redis = new RedisRuntime('redis://example.test:6379', true, observer);

    await redis.connect();
    await expect(redis.ping()).resolves.toBe(true);
    await expect(redis.consumeFixedWindow({
      namespace: 'api',
      identity: 'sensitive-user-id',
      limit: 10,
      windowSeconds: 60,
    })).resolves.toMatchObject({ allowed: true, remaining: 8 });
    await expect(redis.sampleServerStats()).resolves.toEqual({
      usedMemoryBytes: 4_096,
      evictedKeys: 7,
      keyspaceHits: 13,
      keyspaceMisses: 5,
    });

    expect(observeRedisOperation).toHaveBeenCalledTimes(5);
    expect(observeRedisOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'connect',
      outcome: 'ok',
      durationMs: expect.any(Number),
    }));
    expect(observeRedisOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'ping',
      outcome: 'ok',
    }));
    expect(observeRedisOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'rate-limit',
      outcome: 'ok',
    }));
    expect(observeRedisOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'info',
      outcome: 'ok',
    }));
    expect(observeRedisServerStats).not.toHaveBeenCalled();
    expect(JSON.stringify(observeRedisOperation.mock.calls)).not.toContain(
      'sensitive-user-id',
    );
  });

  it('G25E2-REDIS-PREFIX：RedisRuntime 本身为所有限流 namespace 加环境前缀', async () => {
    const redis = new RedisRuntime(
      'redis://example.test:6379',
      true,
      undefined,
      undefined,
      'preview',
    );
    await redis.connect();

    await redis.consumeFixedWindow({
      namespace: 'api',
      identity: 'preview-user',
      limit: 10,
      windowSeconds: 60,
    });

    const [, options] = redisClient.eval.mock.calls.at(-1)! as unknown as [
      string,
      { keys: string[] },
    ];
    expect(options.keys[0]).toMatch(/^mahoshojo:rate-limit:preview:api:/u);
  });

  it('G25E2-REDIS-EMPTY：拒绝 malformed nested snapshot/terminal，避免把 Redis 垃圾投影成状态', async () => {
    const redis = new RedisRuntime('redis://example.test:6379', true);
    await redis.connect();
    const store = redis.getGenerationReplayStore();
    const baseState = {
      actorHash: 'actor-hash',
      reservationKey: 'reservation-key',
      generationId: 'generation-nested-001',
      generationRequestId: 'request-nested-001',
      payloadHash: 'payload-hash',
      producerToken: 'producer-token',
      status: 'running',
      updatedAt: '2026-08-25T04:00:00.000Z',
      leaseExpiresAt: '2026-08-25T04:01:00.000Z',
      cancelRequested: false,
      snapshot: {
        status: 'running',
        markdown: 'partial',
        reasoning: '',
        lastEventId: null,
        updatedAt: '2026-08-25T04:00:00.000Z',
      },
      terminal: null,
    };

    redisClient.get.mockResolvedValueOnce(JSON.stringify(baseState));
    await expect(store.readState({ generationId: baseState.generationId })).resolves.toMatchObject({
      snapshot: { status: 'running', markdown: 'partial' },
      terminal: null,
    });

    redisClient.get.mockResolvedValueOnce(JSON.stringify({
      ...baseState,
      snapshot: { ...baseState.snapshot, status: 'not-a-generation-status' },
    }));
    await expect(store.readState({ generationId: baseState.generationId }))
      .rejects.toThrow('REDIS_GENERATION_STATE_INVALID');

    redisClient.get.mockResolvedValueOnce(JSON.stringify({
      ...baseState,
      snapshot: null,
      status: 'completed',
      terminal: { status: 'not-a-terminal-status', resultRef: null },
    }));
    await expect(store.readState({ generationId: baseState.generationId }))
      .rejects.toThrow('REDIS_GENERATION_STATE_INVALID');
  });

  it('INFO 采样失败只产生固定错误指标，不抛出到 Redis 业务路径', async () => {
    redisClient.info.mockRejectedValue(new Error('redis endpoint secret unavailable'));
    const observeRedisOperation = vi.fn<RedisRuntimeObserver['observeRedisOperation']>();
    const observeRedisServerStats = vi.fn<RedisRuntimeObserver['observeRedisServerStats']>();
    const redis = new RedisRuntime('redis://example.test:6379', true, {
      observeRedisOperation,
      observeRedisServerStats,
    });
    await redis.connect();

    await expect(redis.sampleServerStats()).resolves.toBeNull();
    expect(observeRedisOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'info',
      outcome: 'error',
    }));
    expect(observeRedisServerStats).not.toHaveBeenCalled();
    expect(JSON.stringify(observeRedisOperation.mock.calls)).not.toContain('endpoint secret');
  });

  it.each([
    ['非数组', { current: 1, ttl: 1_000 }],
    ['缺少 TTL', [1]],
    ['current 为零', [0, 1_000]],
    ['current 非整数', [1.5, 1_000]],
    ['TTL 为零', [1, 0]],
    ['TTL 超出窗口', [1, 60_001]],
    ['包含 NaN', [Number.NaN, 1_000]],
  ])('固定窗口拒绝异常 Redis 响应并记录 error：%s', async (_label, rawResult) => {
    redisClient.eval.mockResolvedValueOnce(rawResult);
    const observeRedisOperation = vi.fn<RedisRuntimeObserver['observeRedisOperation']>();
    const redis = new RedisRuntime('redis://example.test:6379', true, {
      observeRedisOperation,
      observeRedisServerStats: vi.fn(),
    });
    await redis.connect();

    await expect(redis.consumeFixedWindow({
      namespace: 'api',
      identity: 'malformed-response-user',
      limit: 10,
      windowSeconds: 60,
    })).rejects.toThrow('REDIS_RATE_LIMIT_RESPONSE_INVALID');
    expect(observeRedisOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'rate-limit',
      outcome: 'error',
    }));
    expect(observeRedisOperation).not.toHaveBeenCalledWith(expect.objectContaining({
      operation: 'rate-limit',
      outcome: 'ok',
    }));
  });

  it('INFO 永久 pending 时按命令超时 fail-soft，不阻塞资源采样', async () => {
    vi.useFakeTimers();
    redisClient.info.mockImplementation(() => new Promise(() => undefined));
    const observeRedisOperation = vi.fn<RedisRuntimeObserver['observeRedisOperation']>();
    const redis = new RedisRuntime('redis://example.test:6379', true, {
      observeRedisOperation,
      observeRedisServerStats: vi.fn(),
    }, 100);
    try {
      await redis.connect();
      const sample = redis.sampleServerStats();
      await vi.advanceTimersByTimeAsync(100);

      await expect(sample).resolves.toBeNull();
      expect(observeRedisOperation.mock.calls.filter(([observation]) => (
        observation.operation === 'info' && observation.outcome === 'error'
      ))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('generation reservation 永久 pending 时有界 fail closed 并记录固定 error 指标', async () => {
    vi.useFakeTimers();
    redisClient.eval.mockImplementation(() => new Promise(() => undefined));
    const observeRedisOperation = vi.fn<RedisRuntimeObserver['observeRedisOperation']>();
    const redis = new RedisRuntime('redis://example.test:6379', true, {
      observeRedisOperation,
      observeRedisServerStats: vi.fn(),
    }, 100);
    try {
      await redis.connect();
      const reservation = redis.getGenerationReplayStore().reserve({
        actorKey: 'user:42',
        generationRequestId: 'request-timeout',
        generationId: 'generation-timeout',
        payloadHash: 'payload-hash',
        producerToken: 'producer-token-timeout',
        now: '2026-08-25T04:00:00.000Z',
        leaseExpiresAt: '2026-08-25T04:01:00.000Z',
      });
      const rejectedReservation = expect(reservation).rejects.toThrow(
        'REDIS_GENERATION_COMMAND_TIMEOUT',
      );
      await vi.advanceTimersByTimeAsync(100);

      await rejectedReservation;
      expect(redis.getStatus().lastError).toBe('REDIS_GENERATION_COMMAND_TIMEOUT');
      expect(observeRedisOperation).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'generation',
        outcome: 'error',
      }));
      expect(JSON.stringify(observeRedisOperation.mock.calls)).not.toMatch(/user:42|payload-hash/u);
    } finally {
      vi.useRealTimers();
    }
  });

  it('在请求与后台任务 drain 后直接 destroy，避免 close 后无法强制断连', async () => {
    const redis = new RedisRuntime('redis://example.test:6379', true);
    await redis.connect();

    await redis.close();

    expect(redisClient.close).not.toHaveBeenCalled();
    expect(redisClient.destroy).toHaveBeenCalledTimes(1);
    expect(redisBlockingPool.destroy).toHaveBeenCalledTimes(1);
  });

  it('forceClose 同步销毁尚未进入 dependency cleanup 的 active client', async () => {
    const redis = new RedisRuntime('redis://example.test:6379', true);
    await redis.connect();

    redis.forceClose();

    expect(redisClient.destroy).toHaveBeenCalledTimes(1);
    expect(redisBlockingPool.destroy).toHaveBeenCalledTimes(1);
  });
});
