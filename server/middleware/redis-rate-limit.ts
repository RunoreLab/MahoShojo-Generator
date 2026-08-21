import type { MiddlewareHandler } from 'hono';
import { getClientIpFromHeaders } from '@/lib/arena/battle-report-log-utils';
import type { HonoAppVariables } from '@/server/middleware/request-metadata';
import type { RedisService } from '@/server/redis/runtime';

const resolveIdentity = (request: Request): string =>
  getClientIpFromHeaders(request.headers)?.trim() || 'unknown';

export const redisRateLimit = (
  redis: RedisService,
  options: {
    namespace: string;
    limit: number;
    windowSeconds: number;
  },
): MiddlewareHandler<{ Variables: HonoAppVariables }> => {
  return async (context, next) => {
    const result = await redis.consumeFixedWindow({
      ...options,
      identity: resolveIdentity(context.req.raw),
    });

    if (!result) {
      await next();
      return;
    }

    context.header('x-ratelimit-limit', String(result.limit));
    context.header('x-ratelimit-remaining', String(result.remaining));
    if (!result.allowed) {
      context.header('retry-after', String(result.retryAfterSeconds));
      context.res = context.json(
        {
          error: '请求过于频繁',
          code: 'RATE_LIMITED',
          retryAfterSeconds: result.retryAfterSeconds,
        },
        429,
      );
      return;
    }

    await next();
  };
};
