import type { MagicTeaPartyUpdateDraft } from '@/lib/magic-tea-party/types';

export type MagicTeaPartyCompatUpdateDraft = Omit<MagicTeaPartyUpdateDraft, 'meta'> & {
  meta?: Record<string, unknown>;
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const readString = (source: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
};

const readBoolean = (source: Record<string, unknown>, keys: string[]): boolean | undefined => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
};

export const mapMagicTeaPartyUpdateDraftCompat = (input: unknown): MagicTeaPartyCompatUpdateDraft | null => {
  const source = toRecord(input);
  if (!source) return null;

  const characterName = readString(source, ['characterName', 'character', 'name']);
  if (!characterName) return null;

  const roleId = readString(source, ['roleId']) ?? undefined;
  const impact = readString(source, ['impact']) ?? undefined;
  const currentStateSummary = readString(source, ['currentStateSummary', 'current_state_summary']) ?? undefined;
  const hasWinner = readBoolean(source, ['hasWinner']);
  const winner = readString(source, ['winner']) ?? undefined;
  const meta = toRecord(source.meta) ?? undefined;

  return {
    ...(roleId ? { roleId } : {}),
    characterName,
    ...(impact ? { impact } : {}),
    ...(currentStateSummary ? { currentStateSummary } : {}),
    ...(typeof hasWinner === 'boolean' ? { hasWinner } : {}),
    ...(winner ? { winner } : {}),
    ...(meta ? { meta } : {}),
  };
};
