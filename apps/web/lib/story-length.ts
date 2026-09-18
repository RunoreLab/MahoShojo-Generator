export const normalizeCustomStoryLength = (value: unknown): string => {
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0) {
    return String(value);
  }

  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return '';
  const normalized = trimmed.replace(/^0+/, '');
  return normalized || '';
};

export const hasCustomStoryLength = (value: unknown): boolean => {
  return normalizeCustomStoryLength(value).length > 0;
};

export const formatStoryLengthSummaryLabel = (
  storyLength: string | null | undefined,
  customStoryLength: unknown,
): string => {
  const normalizedCustomStoryLength = normalizeCustomStoryLength(customStoryLength);
  const normalizedStoryLength =
    typeof storyLength === 'string' && storyLength.trim() ? storyLength.trim() : 'default';

  if (normalizedCustomStoryLength) {
    return `自定义 ${normalizedCustomStoryLength} 字（预设：${normalizedStoryLength}）`;
  }

  return normalizedStoryLength;
};
