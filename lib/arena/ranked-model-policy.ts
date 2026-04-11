export const STRICT_RANKED_MODEL_BLACKLIST = new Set<string>(['gemma-3-4b-it', 'gemma-3-1b-it', 'gemma-3-270m-it']);

// 严格排位默认优先模型名单（按回退顺序）。
// 说明：严格排位强调成本与速度稳定性，因此优先使用轻量模型；在模型故障/限流时按顺序回退。
export const STRICT_RANKED_MODEL_FALLBACKS = [
  'gemma-4-31b-it',
  'gemma-3-27b-it',
  'gemini-2.5-flash-lite',
  'glm-4.7',
  'gemma-3-12b-it',
  'gemini-2.5-flash',
] as const;

export const normalizeModelId = (value: unknown): string => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export const isStrictRankedModelBlacklisted = (modelId: unknown): boolean => {
  const normalized = normalizeModelId(modelId);
  if (!normalized) return false;
  return STRICT_RANKED_MODEL_BLACKLIST.has(normalized);
};
