import type { MagicTeaPartyPreferences } from '@/lib/magic-tea-party/types';

const STORAGE_KEY = 'magic-tea-party:preferences';
const LEGACY_STORAGE_KEY = 'magic-tavern:preferences';

export const DEFAULT_MAGIC_TEA_PARTY_PREFERENCES: MagicTeaPartyPreferences = {
  outputFormat: 'jsonl',
  enableChoices: false,
  choiceCount: 3,
  language: 'zh-CN',
  userDisplayName: '旅人',
};

const isChoiceCount = (value: unknown): value is 2 | 3 | 4 => value === 2 || value === 3 || value === 4;

export function readMagicTeaPartyPreferences(): MagicTeaPartyPreferences {
  if (typeof window === 'undefined') return DEFAULT_MAGIC_TEA_PARTY_PREFERENCES;
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw && !window.localStorage.getItem(STORAGE_KEY)) {
      window.localStorage.setItem(STORAGE_KEY, raw);
    }
    if (!raw) return DEFAULT_MAGIC_TEA_PARTY_PREFERENCES;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_MAGIC_TEA_PARTY_PREFERENCES;

    const outputFormat = parsed.outputFormat === 'markdown' ? 'markdown' : 'jsonl';
    const enableChoices = typeof parsed.enableChoices === 'boolean' ? parsed.enableChoices : DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.enableChoices;
    const choiceCount = isChoiceCount(parsed.choiceCount) ? parsed.choiceCount : DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.choiceCount;
    const language = parsed.language === 'ja-JP' || parsed.language === 'en-US' ? parsed.language : 'zh-CN';
    const userDisplayName =
      typeof parsed.userDisplayName === 'string' && parsed.userDisplayName.trim()
        ? parsed.userDisplayName.trim().slice(0, 20)
        : DEFAULT_MAGIC_TEA_PARTY_PREFERENCES.userDisplayName;

    const lastPresetId = typeof parsed.lastPresetId === 'string' && parsed.lastPresetId.trim() ? parsed.lastPresetId.trim() : undefined;
    const lastWorldbookPresetId =
      typeof parsed.lastWorldbookPresetId === 'string' && parsed.lastWorldbookPresetId.trim() ? parsed.lastWorldbookPresetId.trim() : undefined;

    return {
      outputFormat,
      enableChoices,
      choiceCount,
      language,
      userDisplayName,
      ...(lastPresetId ? { lastPresetId } : {}),
      ...(lastWorldbookPresetId ? { lastWorldbookPresetId } : {}),
    };
  } catch {
    return DEFAULT_MAGIC_TEA_PARTY_PREFERENCES;
  }
}

export function writeMagicTeaPartyPreferences(prefs: MagicTeaPartyPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function patchMagicTeaPartyPreferences(patch: Partial<MagicTeaPartyPreferences>): MagicTeaPartyPreferences {
  const current = readMagicTeaPartyPreferences();
  const next: MagicTeaPartyPreferences = {
    ...current,
    ...patch,
    choiceCount: isChoiceCount(patch.choiceCount) ? patch.choiceCount : current.choiceCount,
  };
  writeMagicTeaPartyPreferences(next);
  return next;
}
