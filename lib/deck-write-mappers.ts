import { getDeckVisibilityValue } from '@/lib/deck-status';

type NormalizeDeckVisibilityOptions = {
  allowBanned?: boolean;
};

export const normalizeDeckVisibilityInput = (
  input: unknown,
  options: NormalizeDeckVisibilityOptions = {}
): -1 | 0 | 1 => {
  const visibility = getDeckVisibilityValue({ isPublic: input });
  if (visibility === -1 && !options.allowBanned) return 0;
  return visibility;
};
