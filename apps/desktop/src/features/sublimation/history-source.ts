import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { NarrativeHistoryEntry } from '@mahoshojo/domain/arena-types';
import { NarrativeHistorySchema } from '@mahoshojo/domain/narrative-history';
import { formatNarrativeHistoryEntriesForReference, mergeNarrativeHistoryText } from '@mahoshojo/domain/narrative-history-operations';

export type SublimationHistorySource = {
  status: 'ready' | 'error';
  entries: NarrativeHistoryEntry[];
  lastUpdatedAt: string | null;
  unsupportedCount: number;
  message: string | null;
};

/** Read-only library adapter. No Arena store, migration, deletion or implicit repair. */
export const readSublimationHistorySource = async (
  repository: Pick<CardRepository, 'list'>,
  signal?: AbortSignal,
): Promise<SublimationHistorySource> => {
  const entries: NarrativeHistoryEntry[] = [];
  let unsupportedCount = 0;
  let lastUpdatedAt: string | null = null;
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  const seenCards = new Set<string>();
  try {
    do {
      signal?.throwIfAborted();
      const page = await repository.list({ cardTypes: ['history'], limit: 100, ...(cursor ? { cursor } : {}) });
      signal?.throwIfAborted();
      if ('unreadable' in page && Array.isArray(page.unreadable)) unsupportedCount += page.unreadable.length;
      for (const record of page.items) {
        if (record.deletedAt || seenCards.has(record.id)) continue;
        seenCards.add(record.id);
        const parsed = NarrativeHistorySchema.safeParse(record.data);
        if (!parsed.success) { unsupportedCount += 1; continue; }
        const card = parsed.data;
        if (!lastUpdatedAt || Date.parse(record.updatedAt) > Date.parse(lastUpdatedAt)) lastUpdatedAt = record.updatedAt;
        card.entries.forEach((entry, index) => {
          // The picker uses ephemeral, collision-free source identity; persisted IDs stay untouched.
          entries.push({ ...entry, id: JSON.stringify([record.id, index, entry.id]) });
        });
      }
      cursor = page.nextCursor;
      if (cursor && seenCursors.has(cursor)) throw new Error('invalid-pagination');
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    return { status: 'ready', entries, lastUpdatedAt, unsupportedCount,
      message: unsupportedCount ? `${unsupportedCount} 张历史卡格式暂不支持引用，原始数据保留在本地库。` : null };
  } catch {
    signal?.throwIfAborted();
    // Never project an incomplete or unavailable source as an empty successful read.
    return { status: 'error', entries: [], lastUpdatedAt: null, unsupportedCount: 0,
      message: '读取本地叙事历史失败，可重试或手动填写；本地库数据未修改。' };
  }
};

export const composeDesktopSublimationHistory = (
  entries: NarrativeHistoryEntry[], selectedIds: string[], manualText: string,
): string => {
  const selected = new Set(selectedIds);
  return mergeNarrativeHistoryText(formatNarrativeHistoryEntriesForReference(
    entries.filter((entry) => selected.has(entry.id)), { sourceLabel: '本地库叙事历史' },
  ), manualText);
};
