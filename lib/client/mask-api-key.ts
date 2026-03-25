const DEFAULT_VISIBLE_PREFIX_LENGTH = 6;
const DEFAULT_MASK_SUFFIX = '********';

export function maskApiKeyForDisplay(apiKey: string, visiblePrefixLength = DEFAULT_VISIBLE_PREFIX_LENGTH): string {
  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) return '';

  const safeVisiblePrefixLength = Math.max(0, visiblePrefixLength);
  const visiblePrefix = normalizedApiKey.slice(0, safeVisiblePrefixLength);
  if (normalizedApiKey.length <= safeVisiblePrefixLength) return visiblePrefix;

  return `${visiblePrefix}${DEFAULT_MASK_SUFFIX}`;
}
