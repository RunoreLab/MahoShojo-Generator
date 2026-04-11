const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export const normalizePublicDataCardReferenceId = (value: string): string => {
  const trimmed = value.trim();
  const uuidMatch = trimmed.match(UUID_PATTERN);
  if (uuidMatch?.[0]) {
    return uuidMatch[0].toLowerCase();
  }

  try {
    const url = new URL(trimmed, 'https://mahoshojo.local');
    const queryId =
      url.searchParams.get('dataCardId') ??
      url.searchParams.get('cardId') ??
      url.searchParams.get('metaCardId');
    if (queryId && UUID_PATTERN.test(queryId)) {
      return queryId.match(UUID_PATTERN)![0].toLowerCase();
    }
  } catch {
    // ignore invalid URL parse
  }

  return trimmed;
};
