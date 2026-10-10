// b2-A 提取前 f772781a4 的冻结对拍参照。来源：Web NarrativeHistoryModal、
// useNarrativeHistoryStore、lib/arena/adjudication-events、useBattleStore、questionnaireRequest。
// 仅将宿主 ID/时钟替换为参数并导出函数；不跟随新纯核实现更新。
import type { NarrativeHistoryDataCardV1, NarrativeHistoryEntry } from '../../src/arena-types';
import { normalizeNarrativeHistoryTitleFallback } from '../../src/narrative-history-operations';

const parseTime = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
};

export const normalizeImportedEntries = (input: unknown, randomUUID: () => string): NarrativeHistoryEntry[] => {
  const extractEntries = (payload: unknown): unknown[] => {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];

    const obj = payload as any;
    if (Array.isArray(obj.entries)) return obj.entries;
    if (obj.templateId === 'narrative-history' && Array.isArray(obj.data?.entries)) return obj.data.entries;
    return [];
  };

  const rawEntries = extractEntries(input);
  return rawEntries
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const title = typeof (raw as any).title === 'string' ? (raw as any).title.trim() : '';
      const content = typeof (raw as any).content === 'string' ? (raw as any).content.trim() : '';
      if (!content) return null;

      const createdAt =
        parseTime((raw as any).createdAt) ??
        parseTime((raw as any).created_at) ??
        new Date(0).toISOString();
      const updatedAt =
        parseTime((raw as any).updatedAt) ??
        parseTime((raw as any).updated_at) ??
        createdAt;

      return {
        id: typeof (raw as any).id === 'string' ? (raw as any).id : randomUUID(),
        title: (title || '未命名战报').slice(0, 120),
        content,
        createdAt,
        updatedAt,
      } satisfies NarrativeHistoryEntry;
    })
    .filter((item): item is NarrativeHistoryEntry => Boolean(item));
};

export const buildNarrativeHistoryCardPayload = (entries: NarrativeHistoryEntry[], lastUpdatedAt: string | null, now: () => string): NarrativeHistoryDataCardV1 => {
  return {
    templateId: 'narrative-history',
    version: 1,
    title: '叙事历史',
    updatedAt: lastUpdatedAt ?? now(),
    entries: [...entries],
  };
};


export const updateEntry = (entries: NarrativeHistoryEntry[], id: string, patch: { title?: string; content?: string }, nowIso: () => string) => {
  const nextTitle = patch.title === undefined ? undefined : patch.title.toString().trim().slice(0, 120);
  const nextContent = patch.content === undefined ? undefined : patch.content.toString();
  return entries.map((entry) => {
    if (entry.id !== id) return entry;
    const updatedAt = nowIso();
    return {
      ...entry,
      ...(nextTitle !== undefined ? { title: nextTitle || normalizeNarrativeHistoryTitleFallback(entry.content) } : {}),
      ...(nextContent !== undefined ? { content: nextContent } : {}),
      updatedAt,
    };
  });
};
