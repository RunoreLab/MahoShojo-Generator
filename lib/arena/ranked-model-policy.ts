export const STRICT_RANKED_MODEL_BLACKLIST = new Set<string>(['gemma-3-4b-it', 'gemma-3-1b-it', 'gemma-3-270m-it']);

export const normalizeModelId = (value: unknown): string => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export const isStrictRankedModelBlacklisted = (modelId: unknown): boolean => {
  const normalized = normalizeModelId(modelId);
  if (!normalized) return false;
  return STRICT_RANKED_MODEL_BLACKLIST.has(normalized);
};

