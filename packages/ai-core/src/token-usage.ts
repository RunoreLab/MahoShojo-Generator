/** Canonical SDK/OpenAI completionTokens includes reasoning; never rewrite it for display. */
export interface UsageLike {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  textTokens?: number;
  completionTokensIncludesReasoning?: boolean;
  [key: string]: unknown;
}

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

export const normalizeUsage = (usage: unknown): UsageLike | null => {
  if (!usage || typeof usage !== 'object') return null;
  const record = usage as Record<string, unknown>;
  const root = (record.usage ?? record.tokenUsage ?? record.usageMetadata ?? record) as Record<string, unknown>;
  if (!root || typeof root !== 'object') return null;
  const read = (...paths: string[]): number | undefined => {
    for (const path of paths) {
      let value: unknown = root;
      for (const key of path.split('.')) {
        value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
      }
      const result = count(value);
      if (result !== undefined) return result;
    }
    return undefined;
  };
  const textTokens = read('textTokens', 'outputTokenDetails.textTokens',
    'outputTokensDetails.textTokens', 'candidatesTokenCount');
  const reasoningTokens = read('reasoningTokens', 'reasoning_tokens',
    'outputTokenDetails.reasoningTokens', 'outputTokensDetails.reasoningTokens',
    'output_tokens_details.reasoning_tokens', 'completionTokensDetails.reasoningTokens',
    'completion_tokens_details.reasoning_tokens', 'thoughtsTokenCount');
  const nativeCandidates = read('candidatesTokenCount');
  const completionTokens = read('completionTokens', 'completion_tokens', 'outputTokens', 'output_tokens')
    ?? (nativeCandidates !== undefined && reasoningTokens !== undefined ? nativeCandidates + reasoningTokens : undefined);
  const fields = {
    promptTokens: read('promptTokens', 'prompt_tokens', 'inputTokens', 'input_tokens', 'promptTokenCount'),
    completionTokens,
    totalTokens: read('totalTokens', 'total_tokens', 'totalTokenCount'),
    cachedTokens: read('cachedTokens', 'cached_tokens', 'cacheTokens', 'cache_tokens',
      'cachedInputTokens', 'cached_input_tokens', 'promptCacheTokens', 'prompt_cache_tokens',
      'inputTokenDetails.cacheReadTokens', 'promptTokensDetails.cachedTokens',
      'prompt_tokens_details.cached_tokens', 'promptTokensDetails.cached_tokens', 'cachedContentTokenCount'),
    reasoningTokens,
    textTokens,
  };
  const result: UsageLike = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  if (typeof root.completionTokensIncludesReasoning === 'boolean') {
    result.completionTokensIncludesReasoning = root.completionTokensIncludesReasoning;
  }
  return Object.keys(result).length ? result : null;
};

export const getVisibleOutputTokens = (usage: unknown): number | undefined => {
  const normalized = normalizeUsage(usage);
  if (!normalized) return undefined;
  if (normalized.textTokens !== undefined) return normalized.textTokens;
  const { completionTokens, reasoningTokens } = normalized;
  if (normalized.completionTokensIncludesReasoning === false) return completionTokens;
  if (completionTokens === undefined || reasoningTokens === undefined || reasoningTokens > completionTokens) return undefined;
  return completionTokens - reasoningTokens;
};
