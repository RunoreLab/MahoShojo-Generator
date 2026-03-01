import { getDeckVisibilityValue } from '@/lib/deck-status';

type NormalizeDeckVisibilityOptions = {
  allowBanned?: boolean;
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export const readDeckVisibilityInput = (input: unknown): unknown => {
  const source = toRecord(input);
  if (!source) return undefined;
  if (Object.prototype.hasOwnProperty.call(source, 'isPublic')) return source.isPublic;
  if (Object.prototype.hasOwnProperty.call(source, 'is_public')) return source.is_public;
  return undefined;
};

export const normalizeDeckVisibilityInput = (
  input: unknown,
  options: NormalizeDeckVisibilityOptions = {}
): -1 | 0 | 1 => {
  const visibility = getDeckVisibilityValue({ isPublic: input });
  if (visibility === -1 && !options.allowBanned) return 0;
  return visibility;
};
