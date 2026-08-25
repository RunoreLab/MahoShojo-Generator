const UUID_PATTERN_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(UUID_PATTERN_SOURCE, 'i');
const UUID_GLOBAL_PATTERN = new RegExp(UUID_PATTERN_SOURCE, 'gi');

export const extractPublicDataCardReferenceIds = (value: string): string[] => {
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const match of value.matchAll(UUID_GLOBAL_PATTERN)) {
    const id = match[0]?.toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
};

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
