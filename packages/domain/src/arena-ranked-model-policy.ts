export const STRICT_RANKED_MODEL_BLACKLIST = new Set<string>([
  'gemma-3-4b-it',
  'gemma-3-1b-it',
  'gemma-3-270m-it',
]);

export const STRICT_RANKED_MODEL_FALLBACKS = [
  'gemma-4-31b-it',
  'gemma-3-27b-it',
  'gemini-2.5-flash-lite',
  'glm-4.7',
  'gemma-3-12b-it',
  'gemini-2.5-flash',
] as const;

export const normalizeArenaModelId = (value: unknown): string => (
  typeof value === 'string' ? value.trim().toLowerCase() : ''
);

export const isStrictRankedModelBlacklisted = (modelId: unknown): boolean => {
  const normalized = normalizeArenaModelId(modelId);
  return normalized ? STRICT_RANKED_MODEL_BLACKLIST.has(normalized) : false;
};
