import { serve } from '@hono/node-server';
import { createHonoApp } from '@/server/app';
import { readHonoServerConfig } from '@/server/config';
import { RedisRuntime } from '@/server/redis/runtime';
import {
  DEFAULT_WAIT_UNTIL_DRAIN_TIMEOUT_MS,
  nodeExecutionContextCoordinator,
  shutdownWithWaitUntilDrain,
} from '@/server/runtime/execution-context';
import {
  HonoRuntimeTelemetry,
  observeServerConnections,
} from '@/server/telemetry/runtime';

const config = readHonoServerConfig();
if (process.env.HONO_CONFIG_CHECK_ONLY === 'true') {
  console.info(`[hono] 配置检查通过：authMode=${config.authMode}`);
} else {
  const redis = new RedisRuntime(config.redisUrl, config.redisRequired);
  await redis.connect();

  const telemetry = new HonoRuntimeTelemetry();
  telemetry.start();
  const app = createHonoApp(config, redis, telemetry);
  const server = serve({
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  }, (info) => {
    console.info(`[hono] 服务已启动：http://${info.address}:${info.port}`);
  });
  const stopObservingConnections = observeServerConnections(server, telemetry);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[hono] 收到 ${signal}，开始优雅退出`);

    try {
      const drainResult = await shutdownWithWaitUntilDrain({
        closeDependencies: () => redis.close(),
        coordinator: nodeExecutionContextCoordinator,
        drainTimeoutMs: DEFAULT_WAIT_UNTIL_DRAIN_TIMEOUT_MS,
        stopAcceptingRequests: () => new Promise<void>((resolve) => server.close(() => resolve())),
      });
      if (drainResult.timedOut) {
        console.error(
          `[hono][waitUntil] 优雅退出等待 ${DEFAULT_WAIT_UNTIL_DRAIN_TIMEOUT_MS}ms 后超时，`
          + `仍有 ${drainResult.pendingTaskCount} 个后台任务`,
        );
      }
    } finally {
      stopObservingConnections();
      telemetry.emitSnapshot();
      telemetry.stop();
    }
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
