import { serve } from '@hono/node-server';
import { createHonoApp } from '@/server/app';
import { readHonoServerConfig } from '@/server/config';
import { RedisRuntime } from '@/server/redis/runtime';
import {
  createSingleRunShutdown,
  DEFAULT_SERVER_CLOSE_GRACE_TIMEOUT_MS,
  DEFAULT_WAIT_UNTIL_DRAIN_TIMEOUT_MS,
  nodeExecutionContextCoordinator,
  shutdownWithWaitUntilDrain,
  stopAcceptingRequestsWithGrace,
  wireGracefulShutdownSignals,
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

  const shutdown = createSingleRunShutdown(async (signal: string): Promise<void> => {
    console.info(`[hono] 收到 ${signal}，开始优雅退出`);

    try {
      const drainResult = await shutdownWithWaitUntilDrain({
        closeDependencies: () => redis.close(),
        coordinator: nodeExecutionContextCoordinator,
        drainTimeoutMs: DEFAULT_WAIT_UNTIL_DRAIN_TIMEOUT_MS,
        stopAcceptingRequests: async () => {
          const closeResult = await stopAcceptingRequestsWithGrace(server, {
            timeoutMs: DEFAULT_SERVER_CLOSE_GRACE_TIMEOUT_MS,
          });
          if (closeResult.timedOut) {
            console.error(
              `[hono][shutdown] HTTP 请求等待 ${DEFAULT_SERVER_CLOSE_GRACE_TIMEOUT_MS}ms 后超时，`
              + '已强制关闭活动连接',
            );
          }
        },
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
  });

  wireGracefulShutdownSignals({ shutdown });
}
