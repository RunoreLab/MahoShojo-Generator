import type { AIReasoningEnvelope } from '@/types/ai-reasoning';

export const AI_META_REQUEST_HEADER = 'x-mahoshojo-ai-meta';
export const AI_META_REQUEST_VALUE = '1';

type AiMetaPayload = {
  aiModel?: string;
  aiUsage?: Record<string, unknown> | null;
  aiReasoning?: AIReasoningEnvelope | null;
};

type WrappedPayload<T> = {
  data: T;
  aiMeta: AiMetaPayload | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const reasoningStatusSet = new Set(['idle', 'thinking', 'done', 'unavailable', 'error']);
const reasoningSourceSet = new Set(['sdk', 'provider', 'heuristic', 'unknown']);

const isAIReasoningEnvelope = (value: unknown): value is AIReasoningEnvelope => {
  if (!isRecord(value)) return false;
  const status = value.status;
  const source = value.source;
  if (typeof status !== 'string' || typeof source !== 'string') return false;
  return reasoningStatusSet.has(status) && reasoningSourceSet.has(source);
};

const parseAiMetaPayload = (value: unknown): AiMetaPayload | null => {
  if (!isRecord(value)) return null;

  const aiModel = typeof value.aiModel === 'string' ? value.aiModel : undefined;
  const aiUsage = isRecord(value.aiUsage) ? value.aiUsage : null;
  const aiReasoning = isAIReasoningEnvelope(value.aiReasoning) ? value.aiReasoning : null;

  if (!aiModel && !aiUsage && !aiReasoning) return null;

  return {
    ...(aiModel ? { aiModel } : {}),
    ...(aiUsage ? { aiUsage } : {}),
    ...(aiReasoning ? { aiReasoning } : {}),
  };
};

export const readJsonWithAiMeta = async <T>(response: Response): Promise<WrappedPayload<T>> => {
  const payload = (await response.json()) as unknown;

  if (isRecord(payload) && 'data' in payload && 'aiMeta' in payload) {
    return {
      data: payload.data as T,
      aiMeta: parseAiMetaPayload(payload.aiMeta),
    };
  }

  return {
    data: payload as T,
    aiMeta: null,
  };
};
