const normalizeTagIds = (value: unknown): string[] => {
  const rawList: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') rawList.push(item);
    }
  } else if (typeof value === 'string') {
    rawList.push(...value.split(','));
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of rawList) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

/** 摘要标签为数组，自有详情的 tag_ids 仍可能是数据库聚合 CSV。 */
export const getCardTagIds = (card: { tagIds?: unknown; tag_ids?: unknown } | null | undefined): string[] => {
  if (!card) return [];
  if (Array.isArray(card.tagIds)) return normalizeTagIds(card.tagIds);
  if (Array.isArray(card.tag_ids)) return normalizeTagIds(card.tag_ids);
  if (typeof card.tag_ids === 'string') return normalizeTagIds(card.tag_ids);
  return [];
};
