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

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

const resolveRequestId = (candidate: string | undefined): string => {
  const normalized = candidate?.trim();
  return normalized && SAFE_REQUEST_ID_PATTERN.test(normalized)
    ? normalized
    : randomUUID();
};

export const requestMetadata = (
  telemetry: RuntimeTelemetryService = noopRuntimeTelemetry,
): MiddlewareHandler<{ Variables: HonoAppVariables }> => {
  return async (context, next) => {
    const finishRequest = telemetry.beginRequest();
    try {
      const requestId = resolveRequestId(context.req.header('x-request-id'));
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
        status: context.res.status,
        durationMs,
      });
    } finally {
      finishRequest();
    }
  };
};
