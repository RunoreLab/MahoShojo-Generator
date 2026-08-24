import { serve } from '@hono/node-server';
import { registerHostedRuntimeObserver } from '@mahoshojo/hosted-runtime/telemetry';
import { createHonoApp } from '#/app';
import { readHonoServerConfig } from '#/config';
import { RedisRuntime } from '#/redis/runtime';
import {
  createSingleRunShutdown,
  DEFAULT_DEPENDENCY_CLOSE_GRACE_TIMEOUT_MS,
  DEFAULT_SERVER_CLOSE_GRACE_TIMEOUT_MS,
  DEFAULT_WAIT_UNTIL_DRAIN_TIMEOUT_MS,
  nodeExecutionContextCoordinator,
  shutdownWithWaitUntilDrain,
  stopAcceptingRequestsWithGrace,
  wireGracefulShutdownSignals,
} from '#/runtime/execution-context';
import {
  HonoRuntimeTelemetry,
  observeServerConnections,
} from '#/telemetry/runtime';

const config = readHonoServerConfig();
if (process.env.HONO_CONFIG_CHECK_ONLY === 'true') {
  console.info(`[hono] 配置检查通过：authMode=${config.authMode}`);
} else {
  const telemetry = new HonoRuntimeTelemetry();
  const unregisterHostedRuntimeObserver = registerHostedRuntimeObserver(telemetry);
  const redis = new RedisRuntime(config.redisUrl, config.redisRequired, telemetry);
  const stopSamplingRedis = telemetry.setRedisResourceSampler(
    () => redis.sampleServerStats(),
  );
  await redis.connect();

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
        dependencyCloseTimeoutMs: DEFAULT_DEPENDENCY_CLOSE_GRACE_TIMEOUT_MS,
        drainTimeoutMs: DEFAULT_WAIT_UNTIL_DRAIN_TIMEOUT_MS,
        forceCloseDependencies: () => redis.forceClose(),
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
      if (drainResult.dependencyCloseTimedOut) {
        console.error(
          `[hono][shutdown] 依赖关闭等待 ${DEFAULT_DEPENDENCY_CLOSE_GRACE_TIMEOUT_MS}ms 后超时，`
          + '已强制断开剩余依赖连接',
        );
      }
    } finally {
      stopObservingConnections();
      telemetry.stop();
      await telemetry.flushSnapshot();
      stopSamplingRedis();
      unregisterHostedRuntimeObserver();
    }
  });

  wireGracefulShutdownSignals({ shutdown });
}
