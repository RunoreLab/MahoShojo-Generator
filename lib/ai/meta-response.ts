import type { GenerateWithAIOptions } from '@/lib/ai';
import { normalizeUsage } from '@/lib/arena/battle-report-log-utils';

export const AI_META_REQUEST_HEADER = 'x-mahoshojo-ai-meta';

const truthyValues = new Set(['1', 'true', 'yes', 'on']);

export const shouldIncludeAiMeta = (headers: Headers): boolean => {
  const raw = headers.get(AI_META_REQUEST_HEADER);
  if (typeof raw !== 'string') return false;
  return truthyValues.has(raw.trim().toLowerCase());
};

export type OptionalAiMetaResponsePayload<T> = {
  data: T;
  aiMeta: {
    aiModel?: string;
    aiUsage?: ReturnType<typeof normalizeUsage>;
    aiReasoning?: NonNullable<GenerateWithAIOptions['telemetry']>['reasoning'];
  } | null;
};

export const buildAiMetaFromTelemetry = (
  telemetry?: GenerateWithAIOptions['telemetry']
): OptionalAiMetaResponsePayload<null>['aiMeta'] => {
  const aiModel = typeof telemetry?.model === 'string' ? telemetry.model.trim() : '';
  const aiUsage = normalizeUsage(telemetry?.usage);
  const aiReasoning = telemetry?.reasoning ?? null;

  if (!aiModel && !aiUsage && !aiReasoning) return null;

  return {
    ...(aiModel ? { aiModel } : {}),
    ...(aiUsage ? { aiUsage } : {}),
    ...(aiReasoning ? { aiReasoning } : {}),
  };
};

const mergeResponseHeaders = (headers?: HeadersInit): Headers => {
  const merged = new Headers(headers);
  if (!merged.has('Content-Type')) {
    merged.set('Content-Type', 'application/json');
  }
  return merged;
};

export const buildJsonResponseWithOptionalAiMeta = <T>(params: {
  requestHeaders: Headers;
  data: T;
  telemetry?: GenerateWithAIOptions['telemetry'];
  status?: number;
  headers?: HeadersInit;
}): Response => {
  const { requestHeaders, data, telemetry, status = 200, headers } = params;
  const responseHeaders = mergeResponseHeaders(headers);

  if (!shouldIncludeAiMeta(requestHeaders)) {
    return new Response(JSON.stringify(data), {
      status,
      headers: responseHeaders,
    });
  }

  const wrapped: OptionalAiMetaResponsePayload<T> = {
    data,
    aiMeta: buildAiMetaFromTelemetry(telemetry),
  };

  return new Response(JSON.stringify(wrapped), {
    status,
    headers: responseHeaders,
  });
};
