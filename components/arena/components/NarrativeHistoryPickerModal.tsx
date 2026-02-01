'use client';

import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';

import { formatDateTime } from '@/lib/constants';

import { useNarrativeHistoryStore, type NarrativeHistorySort } from '../stores/useNarrativeHistoryStore';
import type { NarrativeHistoryEntry } from '@/types/arena';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  initialSelectedIds?: string[];
  onConfirm: (entries: NarrativeHistoryEntry[]) => void;
};

const sortLabelMap: Record<NarrativeHistorySort, string> = {
  updated_desc: '最新更新优先',
  updated_asc: '最早更新优先',
  created_desc: '最新创建优先',
  created_asc: '最早创建优先',
};

const sortEntries = (entries: NarrativeHistoryEntry[], sort: NarrativeHistorySort): NarrativeHistoryEntry[] => {
  const list = [...entries];
  const getTime = (value: string) => {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
  };
  list.sort((a, b) => {
    const aCreated = getTime(a.createdAt);
    const bCreated = getTime(b.createdAt);
    const aUpdated = getTime(a.updatedAt);
    const bUpdated = getTime(b.updatedAt);

    switch (sort) {
      case 'updated_asc':
        return aUpdated - bUpdated;
      case 'updated_desc':
        return bUpdated - aUpdated;
      case 'created_asc':
        return aCreated - bCreated;
      case 'created_desc':
        return bCreated - aCreated;
      default:
        return bUpdated - aUpdated;
    }
  });
  return list;
};

const normalizeQuery = (value: string): string => value.trim().toLowerCase();

export function NarrativeHistoryPickerModal({ isOpen, onClose, initialSelectedIds, onConfirm }: Props) {
  const entries = useNarrativeHistoryStore((state) => state.entries);
  const lastUpdatedAt = useNarrativeHistoryStore((state) => state.lastUpdatedAt);
  const sort = useNarrativeHistoryStore((state) => state.sort);
  const setSort = useNarrativeHistoryStore((state) => state.setSort);

  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Record<string, true>>({});

  const closeAndReset = () => {
    setQuery('');
    setSelectedIds({});
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    if (typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const next: Record<string, true> = {};
    (initialSelectedIds ?? []).forEach((id) => {
      if (typeof id === 'string' && id) next[id] = true;
    });
    setSelectedIds(next);
    setQuery('');
  }, [isOpen, initialSelectedIds]);

  const sortedEntries = useMemo(() => sortEntries(entries, sort), [entries, sort]);

  const filteredEntries = useMemo(() => {
    const q = normalizeQuery(query);
    if (!q) return sortedEntries;
    return sortedEntries.filter((entry) => {
      const title = typeof entry.title === 'string' ? entry.title : '';
      const content = typeof entry.content === 'string' ? entry.content : '';
      return `${title}\n${content}`.toLowerCase().includes(q);
    });
  }, [query, sortedEntries]);

  const selectedCount = useMemo(() => Object.keys(selectedIds).length, [selectedIds]);

  const selectedEntriesForConfirm = useMemo(() => {
    if (selectedCount === 0) return [];
    const picked = entries.filter((entry) => Boolean(selectedIds[entry.id]));
    // 用于参考的内容按时间顺序（旧 -> 新）更好读
    return [...picked].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }, [entries, selectedIds, selectedCount]);

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      if (!id) return prev;
      if (prev[id]) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: true };
    });
  };

  const handleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = { ...prev };
      filteredEntries.forEach((entry) => {
        next[entry.id] = true;
      });
      return next;
    });
  };

  const handleClearSelection = () => setSelectedIds({});

  const handleConfirm = () => {
    onConfirm(selectedEntriesForConfirm);
  };

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  const modal = (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={closeAndReset}>
      <div
        className="bg-white rounded-lg shadow-xl p-0 w-[96vw] max-w-[72rem] h-[80vh] max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b gap-3">
          <div>
            <div className="text-lg font-bold text-gray-800">选择竞技场叙事历史</div>
            <div className="text-xs text-gray-500 mt-1">
              共 {entries.length} 条{lastUpdatedAt ? `｜最近更新：${formatDateTime(lastUpdatedAt)}` : ''}｜已选 {selectedCount} 条
            </div>
          </div>
          <button className="text-gray-500 hover:text-gray-700 text-2xl leading-none" onClick={closeAndReset}>
            ×
          </button>
        </div>

        <div className="p-4 border-b space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              className="input-field text-sm flex-1 min-w-[12rem]"
              placeholder="搜索标题或正文…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="text-xs text-gray-500">排序</label>
            <select className="input-field text-sm" value={sort} onChange={(e) => setSort(e.target.value as NarrativeHistorySort)}>
              {Object.entries(sortLabelMap).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="px-3 py-2 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              onClick={handleSelectAllFiltered}
              title="将当前筛选结果全部选中"
            >
              全选（筛选结果）
            </button>
            <button
              type="button"
              className="px-3 py-2 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              onClick={handleClearSelection}
              disabled={selectedCount === 0}
            >
              全不选
            </button>
          </div>
          <p className="text-[11px] text-gray-500">
            提示：这里只会选择你浏览器里缓存的叙事历史（与竞技场页面共用同一份 localStorage 数据）。
          </p>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {filteredEntries.length === 0 ? (
            <div className="text-sm text-gray-500">没有匹配的叙事历史条目。</div>
          ) : (
            <div className="space-y-2">
              {filteredEntries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={[
                    'w-full text-left border rounded-lg p-3 transition-colors',
                    selectedIds[entry.id]
                      ? 'border-purple-300 bg-purple-50/40'
                      : 'border-gray-200 hover:border-purple-300 hover:bg-purple-50/40',
                  ].join(' ')}
                  onClick={() => toggleId(entry.id)}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 text-purple-600 border-gray-300 rounded"
                      checked={Boolean(selectedIds[entry.id])}
                      onChange={() => toggleId(entry.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-gray-800 truncate">{entry.title || '未命名战报'}</div>
                        <div className="text-[11px] text-gray-500 shrink-0">{formatDateTime(entry.updatedAt || entry.createdAt)}</div>
                      </div>
                      <div className="mt-1 text-xs text-gray-500 line-clamp-2 whitespace-pre-wrap">
                        {(entry.content || '').trim() || '（内容为空）'}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t flex items-center justify-end gap-2">
          <button type="button" className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200" onClick={closeAndReset}>
            取消
          </button>
          <button
            type="button"
            className="px-4 py-2 text-sm bg-purple-600 text-white rounded hover:bg-purple-700"
            onClick={handleConfirm}
          >
            {selectedCount > 0 ? `使用选中（${selectedCount} 条）` : '不使用叙事历史'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

