import { serve } from '@hono/node-server';
import {
  createAuthenticationResolver,
  isExpectedClientDisconnect,
} from '@mahoshojo/hosted-runtime/node-runtime';
import { createEnvSignatureService } from '@mahoshojo/hosted-runtime/node-runtime/env-signature';
import { registerHostedRuntimeObserver } from '@mahoshojo/hosted-runtime/telemetry';
import { configureDefaultNodeHostedD1ClientResolver } from '@mahoshojo/hosted-runtime/node-runtime/default-services';
import { createHonoApp } from '#/app';
import { readHonoServerConfig } from '#/config';
import { configureHonoArenaGenerationRuntime } from '#/arena-generation/runtime';
import { createArenaDataCardRefVerifier } from '#/arena-room/arena-data-card-ref-verifier';
import { createArenaRoomDirectoryService } from '#/arena-room/room-directory-service';
import type { ArenaRoomHttpDependencies } from '#/arena-room/room-http';
import { createRoomActorRegistry } from '#/arena-room/room-actor-registry';
import { createArenaRoomMembershipService } from '#/arena-room/room-membership-service';
import { createArenaRoomProposalService } from '#/arena-room/room-proposal-service';
import { createArenaRoomGenerationService } from '#/arena-room/room-generation-service';
import {
  createArenaRoomTicketCodec,
  createArenaRoomTicketSignatureService,
} from '#/arena-room/room-ticket';
import { createArenaRoomWebSocketAuthority } from '#/arena-room/room-websocket-authority';
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
  const roomGenerationPort = configureHonoArenaGenerationRuntime(redis, { observer: telemetry });
  const roomStore = redis.getRoomStore();
  const roomDirectory = createArenaRoomDirectoryService({
    authority: roomStore,
    store: redis.getRoomDirectoryStore(),
    observer: telemetry,
  });
  const roomActors = createRoomActorRegistry({
    store: roomStore,
    observer: telemetry,
    onBackgroundError: () => {
      console.error('[hono][room-actor] background task failed');
    },
  });
  roomActors.startIdleSweeper();
  const roomMemberships = createArenaRoomMembershipService({
    actors: roomActors,
  });
  const roomReferences = createArenaDataCardRefVerifier({
    getClient: getHonoPrimaryD1Client,
  });
  const roomProposals = createArenaRoomProposalService({
    memberships: roomMemberships,
    references: roomReferences,
  });
  const roomGenerations = createArenaRoomGenerationService({
    memberships: roomMemberships,
    references: roomReferences,
    generation: roomGenerationPort,
    observer: telemetry,
    onBackgroundError: () => {
      console.error('[hono][room-generation] publisher task failed');
    },
  });
  const roomWebSocketAuthority = config.arenaMultiplayerEnabled
    ? createArenaRoomWebSocketAuthority({
        actors: roomActors,
        memberships: roomMemberships,
        replay: redis.getRoomTicketReplayStore(),
        tickets: createArenaRoomTicketCodec({
          signatures: createArenaRoomTicketSignatureService(),
        }),
        observer: telemetry,
      })
    : null;
  const roomHttpDependencies: ArenaRoomHttpDependencies | undefined = roomWebSocketAuthority
    ? {
        resolveAuthentication: createAuthenticationResolver({
          signatures: createEnvSignatureService(),
          getD1Client: getHonoPrimaryD1Client,
          allowActivityToken: false,
        }),
        memberships: roomMemberships,
        proposals: roomProposals,
        generations: roomGenerations,
        directory: roomDirectory,
        websocketAuthority: roomWebSocketAuthority,
        rateLimit: ({ operation, accountUserId, roomId, limit, windowSeconds }) => (
          redis.consumeFixedWindow({
            namespace: `arena-room-http-${operation}`,
            identity: `account:${accountUserId}${roomId ? `:room:${roomId}` : ''}`,
            limit,
            windowSeconds,
          })
        ),
      }
    : undefined;
  const roomWebSocketGateway = new RoomWebSocketGateway({
    // Production/preview config rejects this Development Gate feature flag. Disabled
    // runtime keeps the GMR-04 empty-Origin/default-deny behavior unchanged.
    allowedBrowserOrigins: roomWebSocketAuthority ? config.corsOrigins : [],
    ...(roomWebSocketAuthority ? { authorize: roomWebSocketAuthority.authorize } : {}),
    observer: telemetry,
  });
  const roomWebSocketServer = createRoomWebSocketServer();

  telemetry.start();
  const app = createHonoApp(config, redis, telemetry, {
    ...(roomHttpDependencies ? { arenaRoom: roomHttpDependencies } : {}),
  });
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
