import { serve } from '@hono/node-server';
import { isExpectedClientDisconnect } from '@mahoshojo/hosted-runtime/node-runtime';
import { registerHostedRuntimeObserver } from '@mahoshojo/hosted-runtime/telemetry';
import { configureDefaultNodeHostedD1ClientResolver } from '@mahoshojo/hosted-runtime/node-runtime/default-services';
import { createHonoApp } from '#/app';
import { readHonoServerConfig } from '#/config';
import { configureHonoArenaGenerationRuntime } from '#/arena-generation/runtime';
import { createRoomActorRegistry } from '#/arena-room/room-actor-registry';
import { RoomWebSocketGateway } from '#/arena-room/room-websocket-gateway';
import {
  createRoomRequestDispatcher,
  createRoomWebSocketApp,
  createRoomWebSocketServer,
} from '#/arena-room/room-websocket-transport';
import { getHonoPrimaryD1Client } from '#/d1/provider';
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
  const redis = new RedisRuntime(
    config.redisUrl,
    config.redisRequired,
    telemetry,
    undefined,
    config.redisKeyPrefix,
  );
  const stopSamplingRedis = telemetry.setRedisResourceSampler(
    () => redis.sampleServerStats(),
  );
  await redis.connect();
  configureDefaultNodeHostedD1ClientResolver(getHonoPrimaryD1Client);
  configureHonoArenaGenerationRuntime(redis, { observer: telemetry });
  const roomActors = createRoomActorRegistry({
    store: redis.getRoomStore(),
    onBackgroundError: () => {
      console.error('[hono][room-actor] idle sweep failed');
    },
  });
  roomActors.startIdleSweeper();
  const roomWebSocketGateway = new RoomWebSocketGateway({
    // GMR-05 will wire signed room-ticket authority and an explicit exact Origin list.
    // Until then both browser and installed-client upgrade attempts remain fail-closed.
    allowedBrowserOrigins: [],
  });
  const roomWebSocketServer = createRoomWebSocketServer();

  telemetry.start();
  const app = createHonoApp(config, redis, telemetry);
  const roomWebSocketApp = createRoomWebSocketApp(roomWebSocketGateway);
  const server = serve({
    fetch: createRoomRequestDispatcher(app, roomWebSocketApp),
    hostname: config.host,
    port: config.port,
    websocket: { server: roomWebSocketServer },
  }, (info) => {
    console.info(`[hono] 服务已启动：http://${info.address}:${info.port}`);
  });
  const stopObservingConnections = observeServerConnections(server, telemetry);

  const shutdown = createSingleRunShutdown(async (signal: string): Promise<void> => {
    console.info(`[hono] 收到 ${signal}，开始优雅退出`);

    try {
      const drainResult = await shutdownWithWaitUntilDrain({
        closeDependencies: async () => {
          try {
            await roomWebSocketGateway.shutdown();
          } finally {
            try {
              await roomActors.shutdown();
            } finally {
              await redis.close();
            }
          }
        },
        coordinator: nodeExecutionContextCoordinator,
        dependencyCloseTimeoutMs: DEFAULT_DEPENDENCY_CLOSE_GRACE_TIMEOUT_MS,
        drainTimeoutMs: DEFAULT_WAIT_UNTIL_DRAIN_TIMEOUT_MS,
        forceCloseDependencies: () => {
          roomWebSocketGateway.forceClose();
          roomActors.forceClose();
          redis.forceClose();
        },
        stopAcceptingRequests: async () => {
          const roomWebSocketShutdown = roomWebSocketGateway.shutdown();
          roomActors.stopAccepting();
          const closeResult = await stopAcceptingRequestsWithGrace(server, {
            timeoutMs: DEFAULT_SERVER_CLOSE_GRACE_TIMEOUT_MS,
          });
          await roomWebSocketShutdown;
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

  wireGracefulShutdownSignals({
    isExpectedUnhandledRejection: isExpectedClientDisconnect,
    shutdown,
  });
}
