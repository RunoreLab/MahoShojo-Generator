import { serve } from '@hono/node-server';
import { createHonoApp } from '@/server/app';
import { readHonoServerConfig } from '@/server/config';
import { RedisRuntime } from '@/server/redis/runtime';

const config = readHonoServerConfig();
if (process.env.HONO_CONFIG_CHECK_ONLY === 'true') {
  console.info(`[hono] 配置检查通过：authMode=${config.authMode}`);
} else {
  const redis = new RedisRuntime(config.redisUrl, config.redisRequired);
  await redis.connect();

  const app = createHonoApp(config, redis);
  const server = serve({
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  }, (info) => {
    console.info(`[hono] 服务已启动：http://${info.address}:${info.port}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[hono] 收到 ${signal}，开始优雅退出`);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await redis.close();
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal)
        .then(() => process.exit(0))
        .catch((error: unknown) => {
          console.error('[hono] 优雅退出失败', error);
          process.exit(1);
        });
    });
  }
}
