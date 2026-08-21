import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { HonoServerConfig } from '@/server/config';
import { registerHealthRoutes } from '@/server/health';
import { registerLegacyRoutes } from '@/server/legacy/register';
import { redisRateLimit } from '@/server/middleware/redis-rate-limit';
import { requestMetadata, type HonoAppVariables } from '@/server/middleware/request-metadata';
import type { RedisService } from '@/server/redis/runtime';

const isAllowedOrigin = (origin: string, allowedOrigins: string[]): string => {
  if (allowedOrigins.includes('*')) return origin;
  return allowedOrigins.includes(origin) ? origin : '';
};

export const createHonoApp = (config: HonoServerConfig, redis: RedisService) => {
  const app = new Hono<{ Variables: HonoAppVariables }>();

  app.use('*', requestMetadata());
  app.use('*', secureHeaders());
  app.use('/api/*', cors({
    origin: (origin) => isAllowedOrigin(origin, config.corsOrigins),
    credentials: false,
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'X-Mahoshojo-Activity-Token',
      'X-Mahoshojo-User-Id',
    ],
    exposeHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
    allowMethods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  }));

  app.use('/api/*', redisRateLimit(redis, {
    namespace: 'api',
    limit: 600,
    windowSeconds: 60,
  }));
  app.use('/api/auth/*', redisRateLimit(redis, {
    namespace: 'auth',
    limit: 30,
    windowSeconds: 60,
  }));

  registerHealthRoutes(app, config, redis);
  registerLegacyRoutes(app);

  app.notFound((context) => context.json({
    error: 'Not found',
    code: 'NOT_FOUND',
  }, 404));

  app.onError((error, context) => {
    console.error('[hono][error] 未处理异常', {
      requestId: context.get('requestId'),
      method: context.req.method,
      path: context.req.path,
      error,
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
