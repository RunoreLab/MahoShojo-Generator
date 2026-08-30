import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import {
  HOSTED_API_CORS_ALLOW_HEADERS,
  HOSTED_API_CORS_ALLOW_METHODS,
  HOSTED_API_CORS_EXPOSE_HEADERS,
  resolveHostedApiCorsOrigin,
} from '@mahoshojo/hosted-api/hosted-dr';
import type { HonoServerConfig } from '#/config';
import {
  registerArenaRoomHttpRoutes,
  type ArenaRoomHttpDependencies,
} from '#/arena-room/room-http';
import { registerHealthRoutes } from '#/health';
import { redisRateLimit } from '#/middleware/redis-rate-limit';
import { requestMetadata, type HonoAppVariables } from '#/middleware/request-metadata';
import type { RedisService } from '#/redis/runtime';
import { registerRoutes } from '#/routes/register';
import {
  noopRuntimeTelemetry,
  type RuntimeTelemetryService,
} from '#/telemetry/runtime';

const REDIS_RATE_LIMIT_BYPASS_PATHS = new Set([
  '/api/health/live',
  '/api/health/ready',
  '/api/hosted/dr-readiness',
]);

export const isAllowedOrigin = (origin: string, allowedOrigins: string[]): string => {
  return resolveHostedApiCorsOrigin(origin, allowedOrigins);
};

export const isExactAllowedOrigin = (origin: string, allowedOrigins: readonly string[]): boolean => (
  origin !== '*' && allowedOrigins.includes(origin)
);

export const createHonoApp = (
  config: HonoServerConfig,
  redis: RedisService,
  telemetry: RuntimeTelemetryService = noopRuntimeTelemetry,
  services: { readonly arenaRoom?: ArenaRoomHttpDependencies } = {},
) => {
  if (config.arenaMultiplayerEnabled && !services.arenaRoom) {
    throw new Error('Arena Room HTTP dependencies are required when multiplayer is enabled');
  }
  const app = new Hono<{ Variables: HonoAppVariables }>();

  app.use('*', requestMetadata(telemetry));
  app.use('*', secureHeaders());
  app.use('/api/*', cors({
    origin: (origin) => isAllowedOrigin(origin, config.corsOrigins),
    credentials: false,
    allowHeaders: [...HOSTED_API_CORS_ALLOW_HEADERS],
    exposeHeaders: [...HOSTED_API_CORS_EXPOSE_HEADERS],
    allowMethods: [...HOSTED_API_CORS_ALLOW_METHODS],
    maxAge: 600,
  }));

  app.use('/api/*', redisRateLimit(redis, {
    namespace: 'api',
    limit: 600,
    windowSeconds: 60,
    failureMode: config.redisRequired ? 'closed' : 'open',
    bypassPaths: REDIS_RATE_LIMIT_BYPASS_PATHS,
  }));
  app.use('/api/auth/*', redisRateLimit(redis, {
    namespace: 'auth',
    limit: 30,
    windowSeconds: 60,
    failureMode: config.redisRequired ? 'closed' : 'open',
  }));

  registerHealthRoutes(app, config, redis);
  if (config.arenaMultiplayerEnabled && services.arenaRoom) {
    registerArenaRoomHttpRoutes(app, services.arenaRoom, {
      isAllowedOrigin: (origin) => isExactAllowedOrigin(
        origin,
        config.arenaRoomAllowedOrigins,
      ),
    });
  }
  registerRoutes(app);

  app.notFound((context) => context.json({
    error: 'Not found',
    code: 'NOT_FOUND',
  }, 404));

  app.onError((_error, context) => {
    console.error('[hono][error] 未处理异常', {
      requestId: context.get('requestId'),
      method: context.req.method,
      errorClass: 'unhandled',
    });
    return context.json({
      error: 'Internal server error',
      code: 'INTERNAL_SERVER_ERROR',
      requestId: context.get('requestId'),
    }, 500);
  });

  return app;
};

export type HonoApp = ReturnType<typeof createHonoApp>;
