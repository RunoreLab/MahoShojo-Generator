import type { SharedHistorySettings } from '@mahoshojo/contracts/arena-room';

import { quickCheck } from '@/lib/sensitive-word-filter';
import { limitNarrativeHistoryEntriesForPrompt } from '@/lib/narrative-history';
import { useNarrativeHistoryStore } from '@/components/arena/stores/useNarrativeHistoryStore';
import type { NarrativeHistoryEntry } from '@/types/arena';
import type { ArenaRoomControllerState } from './controller';

export type ArenaNarrativeHistoryRequestEntry = Readonly<{
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}>;

export type ArenaNarrativeHistoryRequestMaterialization = Readonly<{
  readLimit: number | null | undefined;
  entries: readonly ArenaNarrativeHistoryRequestEntry[] | undefined;
}>;

export const materializeArenaNarrativeHistoryForRequest = (
  settings: Pick<
    SharedHistorySettings,
    'readNarrativeHistory' | 'readNarrativeHistoryLimit' | 'isNarrativeHistoryUnlimited'
  >,
  entries: readonly NarrativeHistoryEntry[],
): ArenaNarrativeHistoryRequestMaterialization => {
  if (!settings.readNarrativeHistory) {
    return Object.freeze({ readLimit: undefined, entries: undefined });
  }
  const readLimit = settings.isNarrativeHistoryUnlimited
    ? null
    : Math.max(1, settings.readNarrativeHistoryLimit);
  const ordered = entries.filter((entry) => (
    typeof entry?.content === 'string' && entry.content.trim().length > 0
  ));
  const limited = limitNarrativeHistoryEntriesForPrompt([...ordered], readLimit);
  return Object.freeze({
    readLimit,
    entries: Object.freeze(limited.map((entry) => Object.freeze({
      title: entry.title,
      content: entry.content,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }))),
  });
};

export type ArenaNarrativeHistoryResultWrite = Readonly<{
  title: string;
  contentMarkdown: string;
  generationId: string | null;
}>;

const extractTitleFromBattleMarkdown = (markdown: string): string => {
  const lines = markdown.split(/\r?\n/u).map((line) => line.trim());
  for (const line of lines) {
    if (!line) continue;
    const heading = line.match(/^#{1,3}\s*(.+)$/u);
    if (heading?.[1]) return heading[1].trim().slice(0, 120);
    return line.slice(0, 120);
  }
  return '未命名战报';
};

export const selectArenaRoomNarrativeHistoryResultWrite = (
  state: ArenaRoomControllerState,
): ArenaNarrativeHistoryResultWrite | null => {
  const session = state.session;
  if (
    !session
    || session.self.role !== 'host'
    || !session.snapshot.sharedConfig.historySettings.writeNarrativeHistory
    || state.generation.phase !== 'completed'
    || !state.generation.finalAuthoritative
  ) return null;
  const contentMarkdown = state.generation.authoritativeMarkdown.trim();
  if (!contentMarkdown) return null;
  return Object.freeze({
    title: extractTitleFromBattleMarkdown(contentMarkdown),
    contentMarkdown,
    generationId: state.generation.mirror?.generationId
      ?? state.generation.generationRecordId
      ?? null,
  });
};

export const appendArenaNarrativeHistoryResult = async (
  payload: ArenaNarrativeHistoryResultWrite,
): Promise<void> => {
  try {
    const title = payload.title.trim();
    const content = payload.contentMarkdown.trim();
    if (!content) return;
    const [titleCheck, contentCheck] = await Promise.all([
      quickCheck(title || '未命名战报'),
      quickCheck(content),
    ]);
    useNarrativeHistoryStore.getState().appendEntry({
      title: (titleCheck.filteredText || title || '未命名战报').trim(),
      content: (contentCheck.filteredText || content).trim(),
      generationId: payload.generationId,
    });
  } catch (error) {
    console.warn('写入叙事历史失败（已忽略）', error);
  }
};
