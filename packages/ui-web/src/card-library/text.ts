export const DEFAULT_CARD_TITLE_MAX_CHARS = 100;

export const buildTitleDisplay = (value: string, maxChars = DEFAULT_CARD_TITLE_MAX_CHARS) => {
  const full = value.trim();
  if (!full) {
    return { full: '', display: '', truncated: false };
  }
  const chars = Array.from(full);
  if (chars.length <= maxChars) {
    return { full, display: full, truncated: false };
  }
  return { full, display: `${chars.slice(0, maxChars).join('')}...`, truncated: true };
};
