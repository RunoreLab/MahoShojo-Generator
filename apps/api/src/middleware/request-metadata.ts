import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import {
  instrumentStreamingResponse,
  isStreamingResponse,
  noopRuntimeTelemetry,
  type RuntimeTelemetryService,
} from '#/telemetry/runtime';

export type HonoAppVariables = {
  requestId: string;
};

export const requestMetadata = (
  telemetry: RuntimeTelemetryService = noopRuntimeTelemetry,
): MiddlewareHandler<{ Variables: HonoAppVariables }> => {
  return async (context, next) => {
    const finishRequest = telemetry.beginRequest();
    try {
      const requestId = context.req.header('x-request-id')?.trim() || randomUUID();
      const startedAt = performance.now();
      context.set('requestId', requestId);
      context.header('x-request-id', requestId);
      context.header('x-backend-runtime', 'hono-node');

      await next();

      if (isStreamingResponse(context.req.path, context.res)) {
        context.res = instrumentStreamingResponse(context.res, telemetry);
      }

      const skipsSuccessfulRequestLog = (
        context.req.method === 'GET' || context.req.method === 'OPTIONS'
      ) && context.res.status < 400;
      if (skipsSuccessfulRequestLog) return;

      const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
      console.info('[hono][request]', {
        requestId,
        method: context.req.method,
        path: context.req.path,
        status: context.res.status,
        durationMs,
      });
    } finally {
      finishRequest();
    }
  };
};
