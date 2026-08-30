const toRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const readNumericVisibility = (source: Record<string, unknown>): number | null => {
  const candidates = [source.is_public, source.isPublic, source._isPublic];
  for (const value of candidates) {
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(numeric)) return Math.floor(numeric);
  }
  return null;
};

const readBooleanVisibility = (source: Record<string, unknown>): boolean | null => {
  const candidates = [source.is_public, source.isPublic, source._isPublic];
  for (const value of candidates) {
    if (typeof value === 'boolean') return value;
  }
  return null;
};

const readVisibility = (deck: unknown): boolean | number => {
  const source = toRecord(deck);
  if (!source) return false;
  const numeric = readNumericVisibility(source);
  if (numeric !== null) return numeric;
  const bool = readBooleanVisibility(source);
  if (bool !== null) return bool;
  return false;
};

export function getDeckVisibilityValue(deck: any): -1 | 0 | 1 {
  const visibility = readVisibility(deck);
  if (visibility === -1) return -1;
  if (visibility === 1 || visibility === true) return 1;
  return 0;
}

export function isDeckBanned(deck: any): boolean {
  return getDeckVisibilityValue(deck) === -1;
}

export function getDeckStatus(deck: any): {
  status: 'public' | 'private' | 'banned';
  label: string;
  color: 'green' | 'gray' | 'red';
} {
  const visibility = getDeckVisibilityValue(deck);
  if (visibility === -1) {
    return { status: 'banned', label: '封禁', color: 'red' };
  }
  if (visibility === 1) {
    return { status: 'public', label: '公开', color: 'green' };
  }
  return { status: 'private', label: '私有', color: 'gray' };
}
