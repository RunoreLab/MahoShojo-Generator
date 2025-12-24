'use client';

import { useMemo, useRef, useState } from 'react';

import BattleDataModal from '@/components/BattleDataModal';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import { formatDateTime } from '@/lib/constants';
import { randomUUID } from '@/lib/crypto';
import { quickCheck } from '@/lib/sensitive-word-filter';

import { useNarrativeHistoryStore, type NarrativeHistorySort } from '../stores/useNarrativeHistoryStore';
import type { NarrativeHistoryDataCardV1, NarrativeHistoryEntry } from '@/types/arena';

type Props = {
  isOpen: boolean;
  onClose: () => void;
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

const parseTime = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
};

const normalizeImportedEntries = (input: unknown): NarrativeHistoryEntry[] => {
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

const buildNarrativeHistoryCardPayload = (entries: NarrativeHistoryEntry[], lastUpdatedAt: string | null): NarrativeHistoryDataCardV1 => {
  const sorted = [...entries].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return {
    templateId: 'narrative-history',
    version: 1,
    title: '叙事历史',
    updatedAt: lastUpdatedAt ?? new Date().toISOString(),
    entries: sorted,
  };
};

export function NarrativeHistoryModal({ isOpen, onClose }: Props) {
  const entries = useNarrativeHistoryStore((state) => state.entries);
  const lastUpdatedAt = useNarrativeHistoryStore((state) => state.lastUpdatedAt);
  const sort = useNarrativeHistoryStore((state) => state.sort);
  const setSort = useNarrativeHistoryStore((state) => state.setSort);
  const updateEntry = useNarrativeHistoryStore((state) => state.updateEntry);
  const deleteEntry = useNarrativeHistoryStore((state) => state.deleteEntry);
  const replaceAll = useNarrativeHistoryStore((state) => state.replaceAll);
  const clearAll = useNarrativeHistoryStore((state) => state.clear);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [showPasteImport, setShowPasteImport] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [showCloudImport, setShowCloudImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeEntry = useMemo(() => entries.find((entry) => entry.id === activeId) ?? null, [entries, activeId]);
  const sortedEntries = useMemo(() => sortEntries(entries, sort), [entries, sort]);
  const historyCardData = useMemo(
    () => (entries.length > 0 ? buildNarrativeHistoryCardPayload(entries, lastUpdatedAt) : null),
    [entries, lastUpdatedAt]
  );

  const closeAndReset = () => {
    setActiveId(null);
    setDraftTitle('');
    setDraftContent('');
    setSaveHint(null);
    setImportError(null);
    setShowPasteImport(false);
    setPasteText('');
    onClose();
  };

  const handlePick = (entry: NarrativeHistoryEntry) => {
    setActiveId(entry.id);
    setDraftTitle(entry.title);
    setDraftContent(entry.content);
    setSaveHint(null);
  };

  const handleSave = async () => {
    if (!activeEntry || !activeId) return;
    setIsSaving(true);
    setSaveHint(null);
    try {
      const rawTitle = draftTitle.trim();
      const rawContent = draftContent.trim();
      if (!rawContent) {
        setSaveHint('正文不能为空。');
        return;
      }

      const [titleCheck, contentCheck] = await Promise.all([quickCheck(rawTitle || '未命名'), quickCheck(rawContent)]);
      const nextTitle = (titleCheck.filteredText || rawTitle || '未命名').trim();
      const nextContent = (contentCheck.filteredText || rawContent).trim();

      updateEntry(activeId, { title: nextTitle, content: nextContent });

      if (titleCheck.hasSensitiveWords || contentCheck.hasSensitiveWords) {
        setSaveHint('已自动屏蔽敏感词后保存。');
      } else {
        setSaveHint('已保存。');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (!activeId) return;
    const ok = confirm('确定删除这条叙事历史记录吗？此操作不可恢复。');
    if (!ok) return;
    deleteEntry(activeId);
    setActiveId(null);
    setDraftTitle('');
    setDraftContent('');
    setSaveHint(null);
  };

  const sanitizeImportedEntries = async (rawEntries: NarrativeHistoryEntry[]): Promise<NarrativeHistoryEntry[]> => {
    const safeEntries: NarrativeHistoryEntry[] = [];
    const chunkSize = 4;
    for (let i = 0; i < rawEntries.length; i += chunkSize) {
      const slice = rawEntries.slice(i, i + chunkSize);
      const sanitized = await Promise.all(
        slice.map(async (entry) => {
          const title = entry.title?.trim() || '未命名战报';
          const content = entry.content?.trim() || '';
          const [titleCheck, contentCheck] = await Promise.all([quickCheck(title), quickCheck(content)]);
          return {
            ...entry,
            title: (titleCheck.filteredText || title).trim().slice(0, 120),
            content: (contentCheck.filteredText || content).trim(),
          };
        })
      );
      safeEntries.push(...sanitized);
    }
    return safeEntries.filter((entry) => entry.content.trim());
  };

  const replaceWithImported = async (raw: unknown) => {
    setIsImporting(true);
    setImportError(null);
    try {
      const parsedEntries = normalizeImportedEntries(raw);
      if (parsedEntries.length === 0) {
        setImportError('未找到可用的 entries（需要包含 title/content 字段）。');
        return;
      }

      if (entries.length > 0) {
        const ok = confirm(`当前已有 ${entries.length} 条叙事历史，导入将覆盖它们。是否继续？`);
        if (!ok) return;
      }

      const sanitized = await sanitizeImportedEntries(parsedEntries);
      if (sanitized.length === 0) {
        setImportError('导入内容为空，或已被过滤为空。');
        return;
      }

      replaceAll(sanitized);
      setShowPasteImport(false);
      setPasteText('');
      setImportError(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '导入失败，请检查 JSON 格式。');
    } finally {
      setIsImporting(false);
    }
  };

  const handleExport = () => {
    if (!historyCardData) {
      alert('当前没有可导出的叙事历史。');
      return;
    }
    const json = JSON.stringify(historyCardData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `叙事历史_${formatDateTime(new Date()).replace(/[:\\s]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePickFile = () => {
    setImportError(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await replaceWithImported(parsed);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '读取文件失败。');
    }
  };

  const handleClearAll = () => {
    if (entries.length === 0) return;
    const ok = confirm(`确定清空叙事历史（共 ${entries.length} 条）吗？此操作不可恢复。`);
    if (!ok) return;
    clearAll();
    setActiveId(null);
  };

  const handleImportFromCloudCard = async (payload: any) => {
    const cardId = typeof payload?._cardId === 'string' ? payload._cardId : '';
    try {
      if (payload?.templateId !== 'narrative-history' || payload?.version !== 1 || !Array.isArray(payload?.entries)) {
        throw new Error('这不是可识别的叙事历史数据卡（templateId/version/entries 不匹配）。');
      }
      await replaceWithImported(payload);
      setShowCloudImport(false);
      if (cardId) {
        setSaveHint(`已从云端数据卡导入（ID：${cardId}）。`);
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '导入失败。');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={closeAndReset}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b gap-3">
          <div>
            <div className="text-lg font-bold text-gray-800">叙事历史</div>
            <div className="text-xs text-gray-500 mt-1">
              共 {entries.length} 条{lastUpdatedAt ? `｜最近更新：${formatDateTime(lastUpdatedAt)}` : ''}
            </div>
          </div>
          <button className="text-gray-500 hover:text-gray-700 text-2xl leading-none" onClick={closeAndReset}>
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {!activeEntry ? (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm text-gray-700 font-semibold">历史列表</div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">排序</label>
                  <select
                    className="input-field text-sm"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as NarrativeHistorySort)}
                  >
                    {Object.entries(sortLabelMap).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
                  onClick={handleExport}
                  disabled={!historyCardData || isImporting}
                >
                  导出 JSON
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
                  onClick={handlePickFile}
                  disabled={isImporting}
                >
                  导入 JSON
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
                  onClick={() => {
                    setImportError(null);
                    setShowPasteImport((prev) => !prev);
                  }}
                  disabled={isImporting}
                >
                  {showPasteImport ? '收起粘贴导入' : '粘贴导入'}
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
                  onClick={() => setShowCloudImport(true)}
                  disabled={isImporting}
                  title="从我的数据卡/公开库导入叙事历史数据卡"
                >
                  从云端导入
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-60"
                  onClick={handleClearAll}
                  disabled={entries.length === 0 || isImporting}
                >
                  清空
                </button>
                <div className="ml-auto">
                  <SaveToCloudButton
                    data={historyCardData}
                    cardType="history"
                    buttonText="保存到云端"
                    className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg transition-colors"
                    style={{
                      backgroundColor: '#22c55e',
                      backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)',
                    }}
                  />
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => void handleFileChange(e)}
                />
              </div>

              {showPasteImport && (
                <div className="mt-3 space-y-2">
                  <textarea
                    className="input-field font-mono text-xs"
                    rows={6}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder="粘贴叙事历史 JSON（支持 data card / entries 数组 / { entries: [...] }）"
                    disabled={isImporting}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
                      onClick={() => {
                        setShowPasteImport(false);
                        setPasteText('');
                      }}
                      disabled={isImporting}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-60"
                      onClick={() => {
                        try {
                          const parsed = JSON.parse(pasteText);
                          void replaceWithImported(parsed);
                        } catch (error) {
                          setImportError(error instanceof Error ? error.message : 'JSON 解析失败。');
                        }
                      }}
                      disabled={isImporting || !pasteText.trim()}
                    >
                      {isImporting ? '导入中…' : '确认导入（覆盖）'}
                    </button>
                  </div>
                </div>
              )}

              {importError && <div className="mt-2 text-xs text-red-600">{importError}</div>}

              {sortedEntries.length === 0 ? (
                <div className="mt-4 text-sm text-gray-500">尚无叙事历史。开启“战报后写入叙事历史”后会自动累积。</div>
              ) : (
                <div className="mt-4 space-y-2">
                  {sortedEntries.map((entry) => (
                    <button
                      key={entry.id}
                      className="w-full text-left border border-gray-200 rounded-lg p-3 hover:border-pink-300 hover:bg-pink-50/40 transition-colors"
                      onClick={() => handlePick(entry)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold text-gray-800 truncate">{entry.title || '未命名战报'}</div>
                        <div className="text-[11px] text-gray-500 shrink-0">{formatDateTime(entry.updatedAt)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                  onClick={() => setActiveId(null)}
                  disabled={isSaving}
                >
                  ← 返回列表
                </button>
                <div className="text-xs text-gray-500">
                  创建：{formatDateTime(activeEntry.createdAt)}｜更新：{formatDateTime(activeEntry.updatedAt)}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">标题</label>
                <input
                  className="input-field"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  maxLength={120}
                  disabled={isSaving}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">正文（Markdown）</label>
                <textarea
                  className="input-field font-mono text-xs"
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  rows={14}
                  disabled={isSaving}
                />
              </div>

              {saveHint && <div className="text-xs text-gray-600">{saveHint}</div>}

              <div className="flex items-center justify-end gap-2">
                <button
                  className="px-3 py-2 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                  onClick={handleDelete}
                  disabled={isSaving}
                >
                  删除
                </button>
                <button
                  className="px-3 py-2 text-xs bg-pink-600 text-white rounded hover:bg-pink-700 disabled:opacity-60"
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                >
                  {isSaving ? '保存中…' : '保存修改'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <BattleDataModal
        isOpen={showCloudImport}
        onClose={() => setShowCloudImport(false)}
        onSelectCard={(payload) => void handleImportFromCloudCard(payload)}
        selectedType="history"
        selectionMode="single"
        titleOverride="导入叙事历史数据卡"
      />
    </div>
  );
}
