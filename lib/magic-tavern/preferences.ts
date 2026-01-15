import type { MagicTavernPreferences } from '@/lib/magic-tavern/types';

const STORAGE_KEY = 'magic-tavern:preferences';

export const DEFAULT_MAGIC_TAVERN_PREFERENCES: MagicTavernPreferences = {
  outputFormat: 'jsonl',
  enableChoices: false,
  choiceCount: 3,
  language: 'zh-CN',
  userDisplayName: '旅人',
};

const isChoiceCount = (value: unknown): value is 2 | 3 | 4 => value === 2 || value === 3 || value === 4;

export function readMagicTavernPreferences(): MagicTavernPreferences {
  if (typeof window === 'undefined') return DEFAULT_MAGIC_TAVERN_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MAGIC_TAVERN_PREFERENCES;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_MAGIC_TAVERN_PREFERENCES;

    const outputFormat = parsed.outputFormat === 'markdown' ? 'markdown' : 'jsonl';
    const enableChoices = typeof parsed.enableChoices === 'boolean' ? parsed.enableChoices : DEFAULT_MAGIC_TAVERN_PREFERENCES.enableChoices;
    const choiceCount = isChoiceCount(parsed.choiceCount) ? parsed.choiceCount : DEFAULT_MAGIC_TAVERN_PREFERENCES.choiceCount;
    const language = parsed.language === 'ja-JP' || parsed.language === 'en-US' ? parsed.language : 'zh-CN';
    const userDisplayName =
      typeof parsed.userDisplayName === 'string' && parsed.userDisplayName.trim()
        ? parsed.userDisplayName.trim().slice(0, 20)
        : DEFAULT_MAGIC_TAVERN_PREFERENCES.userDisplayName;

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
    return DEFAULT_MAGIC_TAVERN_PREFERENCES;
  }
}

export function writeMagicTavernPreferences(prefs: MagicTavernPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function patchMagicTavernPreferences(patch: Partial<MagicTavernPreferences>): MagicTavernPreferences {
  const current = readMagicTavernPreferences();
  const next: MagicTavernPreferences = {
    ...current,
    ...patch,
    choiceCount: isChoiceCount(patch.choiceCount) ? patch.choiceCount : current.choiceCount,
  };
  writeMagicTavernPreferences(next);
  return next;
}
