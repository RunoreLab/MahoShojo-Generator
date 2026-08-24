export interface UsageLike {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  [key: string]: unknown;
}

export const normalizeUsage = (usage: unknown): UsageLike | null => {
  if (!usage || typeof usage !== 'object') return null;
  const readNumber = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null;
  const readPath = (value: unknown, candidatePath: string): number | null => {
    let current: unknown = value;
    for (const key of candidatePath.split('.')) {
      if (!current || typeof current !== 'object') return null;
      current = (current as Record<string, unknown>)[key];
    }
    return readNumber(current);
  };
  const readFirst = (value: unknown, paths: string[]) => {
    for (const candidatePath of paths) {
      const candidate = readPath(value, candidatePath);
      if (candidate !== null) return candidate;
    }
    return null;
  };

  const record = usage as Record<string, unknown>;
  const root =
    (record.usage && typeof record.usage === 'object' ? record.usage : null)
    ?? (record.tokenUsage && typeof record.tokenUsage === 'object' ? record.tokenUsage : null)
    ?? record;
  const promptTokens = readFirst(root, ['promptTokens', 'prompt_tokens', 'inputTokens', 'input_tokens']);
  const completionTokens = readFirst(root, ['completionTokens', 'completion_tokens', 'outputTokens', 'output_tokens']);
  const totalTokens = readFirst(root, ['totalTokens', 'total_tokens']);
  const cachedTokens = readFirst(root, [
    'cachedTokens', 'cached_tokens', 'cacheTokens', 'cache_tokens',
    'promptCacheTokens', 'prompt_cache_tokens',
    'promptTokensDetails.cachedTokens', 'prompt_tokens_details.cached_tokens',
    'promptTokensDetails.cached_tokens',
  ]);
  const reasoningTokens = readFirst(root, [
    'reasoningTokens', 'reasoning_tokens',
    'outputTokensDetails.reasoningTokens', 'output_tokens_details.reasoning_tokens',
    'completionTokensDetails.reasoningTokens', 'completion_tokens_details.reasoning_tokens',
  ]);
  const normalized: UsageLike = {
    ...(promptTokens !== null ? { promptTokens } : {}),
    ...(completionTokens !== null ? { completionTokens } : {}),
    ...(totalTokens !== null ? { totalTokens } : {}),
    ...(cachedTokens !== null ? { cachedTokens } : {}),
    ...(reasoningTokens !== null ? { reasoningTokens } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : null;
};
