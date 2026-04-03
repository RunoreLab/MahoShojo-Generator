export const STORY_PROMPT_CHARACTER_PARAMETERS_KEY = '角色参数' as const;

export type StoryPromptSanitizeOptions = {
  readArenaHistory: boolean;
  readCurrentState: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const sanitizeStoryPromptValue = (
  value: unknown,
  options: StoryPromptSanitizeOptions
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStoryPromptValue(item, options));
  }

  if (!isRecord(value)) return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (key === 'creationInputs' || key === 'isPreset') {
      continue;
    }
    if (!options.readArenaHistory && key === 'arena_history') {
      continue;
    }
    if (!options.readCurrentState && key === 'current_state') {
      continue;
    }

    const nextKey =
      key === 'buildState' ? STORY_PROMPT_CHARACTER_PARAMETERS_KEY : key;
    sanitized[nextKey] = sanitizeStoryPromptValue(rawValue, options);
  }

  return sanitized;
};

export const sanitizeStoryPromptRecord = (
  value: unknown,
  options: StoryPromptSanitizeOptions
): Record<string, unknown> | null => {
  const sanitized = sanitizeStoryPromptValue(value, options);
  return isRecord(sanitized) ? sanitized : null;
};

export const getStoryPromptCharacterParameters = (
  value: unknown,
  options: StoryPromptSanitizeOptions
): unknown => {
  const sanitized = sanitizeStoryPromptRecord(value, options);
  return sanitized?.[STORY_PROMPT_CHARACTER_PARAMETERS_KEY] ?? null;
};
