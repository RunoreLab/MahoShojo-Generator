// 模型输入专用投影；不得用于验签、持久化、导出或替换 canonical card。
export const STORY_PROMPT_CHARACTER_PARAMETERS_KEY = '角色参数' as const;
export type StoryPromptSanitizeOptions = {
  readArenaHistory: boolean;
  readCurrentState: boolean;
};
const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const CARD_INTERNAL_KEYS = new Set([
  'templateId', 'signature', 'metadata', 'isPreset', 'creationInputs',
  'adjudicationEvents', '_battle_story', '_mahoshojo', 'wantuCard',
  'createdAt', 'updatedAt', 'created_at', 'updated_at', 'extraJson', 'extra_json',
  '_cardId', '_cardName', '_cardDescription', '_cardType', '_isPublic',
  '_updatedAt', '_createdAt', '_author', '_authorName',
  '_likeCount', '_favoriteCount', '_usageCount',
]);
const cloneValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
};
// 只识别已知 schema 路径，不误删用户扩展中的同名字段或 Markdown 文本。
const projectBuildState = (value: unknown): unknown => {
  if (!isRecord(value)) return cloneValue(value);
  const result = cloneValue(value) as Record<string, unknown>;
  if (Array.isArray(value.rules)) {
    result.rules = value.rules.map((rule) => {
      if (!isRecord(rule)) return cloneValue(rule);
      return Object.fromEntries(Object.entries(rule)
        .filter(([key]) => key !== 'validationSummary')
        .map(([key, item]) => [key, cloneValue(item)]));
    });
  }
  return result;
};
export const sanitizeStoryPromptValue = (
  value: unknown,
  options: StoryPromptSanitizeOptions,
): unknown => {
  if (Array.isArray(value)) return value.map((item) => sanitizeStoryPromptValue(item, options));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (CARD_INTERNAL_KEYS.has(key)) return [];
    if (key === 'arena_history' && !options.readArenaHistory) return [];
    if (key === 'current_state' && !options.readCurrentState) return [];
    if (key === 'buildState' || key === STORY_PROMPT_CHARACTER_PARAMETERS_KEY) {
      return [[STORY_PROMPT_CHARACTER_PARAMETERS_KEY, projectBuildState(item)]];
    }
    return [[key, cloneValue(item)]];
  }));
};
export const sanitizeStoryPromptRecord = (
  value: unknown,
  options: StoryPromptSanitizeOptions,
): Record<string, unknown> | null => {
  const sanitized = sanitizeStoryPromptValue(value, options);
  return isRecord(sanitized) ? sanitized : null;
};
export const getStoryPromptCharacterParameters = (
  value: unknown,
  options: StoryPromptSanitizeOptions,
): unknown => sanitizeStoryPromptRecord(value, options)?.[STORY_PROMPT_CHARACTER_PARAMETERS_KEY] ?? null;
export const projectStoryPromptCombatant = (
  value: unknown,
  options: StoryPromptSanitizeOptions,
): unknown => {
  if (!isRecord(value) || !isRecord(value.data)) return sanitizeStoryPromptValue(value, options);
  return {
    ...(typeof value.type === 'string' ? { type: value.type } : {}),
    ...(value.teamId !== undefined ? { teamId: cloneValue(value.teamId) } : {}),
    ...(typeof value.characterGuidance === 'string' ? { characterGuidance: value.characterGuidance } : {}),
    data: sanitizeStoryPromptValue(value.data, options),
  };
};
export const projectStoryPromptMaterial = (value: unknown): unknown => sanitizeStoryPromptValue(value, {
  readArenaHistory: true,
  readCurrentState: true,
});
