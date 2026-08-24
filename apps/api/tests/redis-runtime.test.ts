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
  redisClient.connect.mockResolvedValue(undefined);
  redisClient.eval.mockResolvedValue([1, 60_000]);
  redisClient.info.mockResolvedValue('');
  redisClient.ping.mockResolvedValue('PONG');
  redisClient.isOpen = true;
  redisClient.isReady = true;
});

describe('RedisRuntime shutdown', () => {
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
    await redis.sampleServerStats();

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
    expect(observeRedisServerStats).toHaveBeenCalledWith({
      usedMemoryBytes: 4_096,
      evictedKeys: 7,
      keyspaceHits: 13,
      keyspaceMisses: 5,
    });
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

    await expect(redis.sampleServerStats()).resolves.toBeUndefined();
    expect(observeRedisOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'info',
      outcome: 'error',
    }));
    expect(observeRedisServerStats).not.toHaveBeenCalled();
    expect(JSON.stringify(observeRedisOperation.mock.calls)).not.toContain('endpoint secret');
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
