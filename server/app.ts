import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { HonoServerConfig } from '@/server/config';
import { registerHealthRoutes } from '@/server/health';
import { registerRoutes } from '@/server/routes/register';
import { redisRateLimit } from '@/server/middleware/redis-rate-limit';
import { requestMetadata, type HonoAppVariables } from '@/server/middleware/request-metadata';
import type { RedisService } from '@/server/redis/runtime';
import {
  noopRuntimeTelemetry,
  type RuntimeTelemetryService,
} from '@/server/telemetry/runtime';

const REDIS_RATE_LIMIT_BYPASS_PATHS = new Set([
  '/api/health/live',
  '/api/health/ready',
]);

const matchesWildcardOrigin = (origin: string, rule: string): boolean => {
  const wildcardPrefix = /^(https?):\/\/\*\./i;
  if (!wildcardPrefix.test(rule)) return false;

  try {
    const wildcardHostPrefix = 'cors-wildcard.';
    const ruleUrl = new URL(rule.replace(wildcardPrefix, `$1://${wildcardHostPrefix}`));
    const originUrl = new URL(origin);
    const baseHostname = ruleUrl.hostname.slice(wildcardHostPrefix.length);

    if (!baseHostname
      || ruleUrl.username
      || ruleUrl.password
      || ruleUrl.pathname !== '/'
      || ruleUrl.search
      || ruleUrl.hash) {
      return false;
    }

    return originUrl.protocol === ruleUrl.protocol
      && originUrl.port === ruleUrl.port
      && originUrl.hostname.endsWith(`.${baseHostname}`);
  } catch {
    return false;
  }
};

export const isAllowedOrigin = (origin: string, allowedOrigins: string[]): string => {
  if (allowedOrigins.includes('*')) return origin;
  return allowedOrigins.some((rule) => rule === origin || matchesWildcardOrigin(origin, rule))
    ? origin
    : '';
};

export const createHonoApp = (
  config: HonoServerConfig,
  redis: RedisService,
  telemetry: RuntimeTelemetryService = noopRuntimeTelemetry,
) => {
  const app = new Hono<{ Variables: HonoAppVariables }>();

  app.use('*', requestMetadata(telemetry));
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
      'X-Mahoshojo-AI-Meta',
    ],
    exposeHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
    allowMethods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
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
  registerRoutes(app);

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
