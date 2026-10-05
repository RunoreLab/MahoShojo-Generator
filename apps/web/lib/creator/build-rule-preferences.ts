export const CREATOR_BUILD_RULE_PREFERENCE_KEY = 'mahoshojo.creator.build-rule-preference.v1';

type PreferenceStorageReader = Pick<Storage, 'getItem'>;
type PreferenceStorageWriter = Pick<Storage, 'setItem'>;

export type CreatorBuildRulePreference = {
  selectedRuleIds: string[];
  primaryRuleId: string | null;
};

const normalizeSelectedRuleIds = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;

  const normalized: string[] = [];
  const seen = new Set<string>();
  value.forEach((item) => {
    if (typeof item !== 'string') return;
    const ruleId = item.trim();
    if (!ruleId || seen.has(ruleId)) return;
    seen.add(ruleId);
    normalized.push(ruleId);
  });
  return normalized;
};

const normalizePreference = (
  selectedRuleIdsValue: unknown,
  primaryRuleIdValue: unknown,
): CreatorBuildRulePreference | null => {
  const selectedRuleIds = normalizeSelectedRuleIds(selectedRuleIdsValue);
  if (!selectedRuleIds) return null;

  const requestedPrimaryRuleId = typeof primaryRuleIdValue === 'string'
    ? primaryRuleIdValue.trim()
    : null;

  return {
    selectedRuleIds,
    primaryRuleId:
      requestedPrimaryRuleId && selectedRuleIds.includes(requestedPrimaryRuleId)
        ? requestedPrimaryRuleId
        : selectedRuleIds[0] ?? null,
  };
};

export const readCreatorBuildRulePreference = (
  storage: PreferenceStorageReader,
): CreatorBuildRulePreference | null => {
  try {
    const raw = storage.getItem(CREATOR_BUILD_RULE_PREFERENCE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (
      !parsed
      || typeof parsed !== 'object'
      || Array.isArray(parsed)
      || parsed.version !== 1
      || parsed.hasExplicitPreference !== true
    ) {
      return null;
    }

    return normalizePreference(parsed.selectedRuleIds, parsed.primaryRuleId);
  } catch {
    return null;
  }
};

export const writeCreatorBuildRulePreference = (
  storage: PreferenceStorageWriter,
  value: CreatorBuildRulePreference,
): void => {
  const normalized = normalizePreference(value.selectedRuleIds, value.primaryRuleId);
  if (!normalized) return;

  try {
    storage.setItem(CREATOR_BUILD_RULE_PREFERENCE_KEY, JSON.stringify({
      version: 1,
      hasExplicitPreference: true,
      ...normalized,
    }));
  } catch {
    // localStorage 可能不可用，忽略写入错误。
  }
};
