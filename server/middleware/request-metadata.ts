import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export type HonoAppVariables = {
  requestId: string;
};

export const requestMetadata = (): MiddlewareHandler<{ Variables: HonoAppVariables }> => {
  return async (context, next) => {
    const requestId = context.req.header('x-request-id')?.trim() || randomUUID();
    const startedAt = performance.now();
    context.set('requestId', requestId);
    context.header('x-request-id', requestId);
    context.header('x-backend-runtime', 'hono-node');

    await next();

    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
    console.info('[hono][request]', {
      requestId,
      method: context.req.method,
      path: context.req.path,
      status: context.res.status,
      durationMs,
    });
  };
};
