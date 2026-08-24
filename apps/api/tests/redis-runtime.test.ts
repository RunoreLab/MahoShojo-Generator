import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisClient = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  connect: vi.fn(async () => undefined),
  destroy: vi.fn(),
  eval: vi.fn(),
  info: vi.fn(),
  isOpen: true,
  isReady: true,
  on: vi.fn(),
  ping: vi.fn(async () => 'PONG'),
}));

vi.mock('redis', () => ({
  createClient: vi.fn(() => redisClient),
}));

import {
  RedisRuntime,
  type RedisRuntimeObserver,
} from '#/redis/runtime';

beforeEach(() => {
  vi.restoreAllMocks();
  redisClient.on.mockReset();
  redisClient.connect.mockResolvedValue(undefined);
  redisClient.eval.mockResolvedValue([1, 60_000]);
  redisClient.info.mockResolvedValue('');
  redisClient.ping.mockResolvedValue('PONG');
  redisClient.isOpen = true;
  redisClient.isReady = true;
});

describe('RedisRuntime shutdown', () => {
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

  it('在请求与后台任务 drain 后直接 destroy，避免 close 后无法强制断连', async () => {
    const redis = new RedisRuntime('redis://example.test:6379', true);
    await redis.connect();

    await redis.close();

    expect(redisClient.close).not.toHaveBeenCalled();
    expect(redisClient.destroy).toHaveBeenCalledTimes(1);
  });

  it('forceClose 同步销毁尚未进入 dependency cleanup 的 active client', async () => {
    const redis = new RedisRuntime('redis://example.test:6379', true);
    await redis.connect();

    redis.forceClose();

    expect(redisClient.destroy).toHaveBeenCalledTimes(1);
  });
});
