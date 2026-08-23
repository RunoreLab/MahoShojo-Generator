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
    failureMode: 'open' | 'closed';
  },
): MiddlewareHandler<{ Variables: HonoAppVariables }> => {
  return async (context, next) => {
    let result;
    try {
      result = await redis.consumeFixedWindow({
        namespace: options.namespace,
        limit: options.limit,
        windowSeconds: options.windowSeconds,
        identity: resolveIdentity(context.req.raw),
      });
    } catch (error) {
      console.error('[hono][redis] 限速命令失败', {
        namespace: options.namespace,
        error,
      });
      if (options.failureMode === 'open') {
        await next();
        return;
      }
      context.header('retry-after', '1');
      context.res = context.json({
        error: '限速服务暂时不可用',
        code: 'RATE_LIMIT_UNAVAILABLE',
      }, 503);
      return;
    }

    if (!result) {
      if (options.failureMode === 'closed') {
        context.header('retry-after', '1');
        context.res = context.json({
          error: '限速服务暂时不可用',
          code: 'RATE_LIMIT_UNAVAILABLE',
        }, 503);
        return;
      }
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
