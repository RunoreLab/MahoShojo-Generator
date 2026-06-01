export const STORY_LENGTH_OPTIONS = ['default', 'short', 'standard', 'detailed', 'long'] as const;

export type StoryLengthOptionValue = (typeof STORY_LENGTH_OPTIONS)[number];

const PRESET_STORY_LENGTH_LABELS: Record<StoryLengthOptionValue, string> = {
  default: '默认',
  short: '约300字',
  standard: '约600字',
  detailed: '约1000字',
  long: '约2000字以上',
};

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

export const resolveEffectiveStoryLength = (
  storyLength: string | null | undefined,
  customStoryLength: unknown,
): string | undefined => {
  const normalizedCustomStoryLength = normalizeCustomStoryLength(customStoryLength);
  if (normalizedCustomStoryLength) return normalizedCustomStoryLength;
  if (typeof storyLength !== 'string') return undefined;
  const trimmed = storyLength.trim();
  return trimmed || undefined;
};

export const buildStoryLengthRequirementText = (input: {
  storyLength: string | null | undefined;
  customStoryLength: unknown;
  targetLabel: string;
}): string | null => {
  const normalizedCustomStoryLength = normalizeCustomStoryLength(input.customStoryLength);
  if (normalizedCustomStoryLength) {
    return `请将${input.targetLabel}的长度控制在 **约${normalizedCustomStoryLength}字** 左右。`;
  }

  const normalizedStoryLength =
    typeof input.storyLength === 'string' ? (input.storyLength.trim() as StoryLengthOptionValue) : '';
  if (!normalizedStoryLength || normalizedStoryLength === 'default') return null;
  if (!(normalizedStoryLength in PRESET_STORY_LENGTH_LABELS)) return null;

  return `请将${input.targetLabel}的长度控制在 **${PRESET_STORY_LENGTH_LABELS[normalizedStoryLength]}** 左右。`;
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
