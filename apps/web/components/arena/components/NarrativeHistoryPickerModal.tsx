'use client';

import { NarrativeHistoryPicker } from '@mahoshojo/ui-web/narrative-history';
import { formatDateTime } from '@/lib/constants';
import { useNarrativeHistoryStore } from '../stores/useNarrativeHistoryStore';
import type { NarrativeHistoryEntry } from '@/types/arena';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  initialSelectedIds?: string[];
  onConfirm: (entries: NarrativeHistoryEntry[]) => void;
};

/** Route's ArenaPersistedStateBoundary owns hydration and its loading/error UI. */
export function NarrativeHistoryPickerModal(props: Props) {
  const entries = useNarrativeHistoryStore((state) => state.entries);
  const lastUpdatedAt = useNarrativeHistoryStore((state) => state.lastUpdatedAt);
  const sort = useNarrativeHistoryStore((state) => state.sort);
  const setSort = useNarrativeHistoryStore((state) => state.setSort);
  return <NarrativeHistoryPicker {...props} entries={entries} lastUpdatedAt={lastUpdatedAt}
    sort={sort} onSort={setSort} formatDateTime={formatDateTime} readStatus="ready"
    sourceHint="提示：这里只会选择你浏览器里缓存的叙事历史（与竞技场页面共用同一份 localStorage 数据）；确认后始终按 AI 提示词顺序提供给模型。" />;
}
