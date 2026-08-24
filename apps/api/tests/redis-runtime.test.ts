import { describe, expect, it, vi } from 'vitest';

const redisClient = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  connect: vi.fn(async () => undefined),
  destroy: vi.fn(),
  eval: vi.fn(),
  isOpen: true,
  isReady: true,
  on: vi.fn(),
  ping: vi.fn(async () => 'PONG'),
}));

vi.mock('redis', () => ({
  createClient: vi.fn(() => redisClient),
}));

import { RedisRuntime } from '#/redis/runtime';

describe('RedisRuntime shutdown', () => {
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
