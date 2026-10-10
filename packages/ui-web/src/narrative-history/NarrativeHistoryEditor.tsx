'use client';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getPromptOrderedNarrativeHistoryEntries, narrativeHistoryImportModeLabelMap, narrativeHistorySortLabelMap, sortNarrativeHistoryEntries, type NarrativeHistoryImportMode, type NarrativeHistoryReorderDirection, type NarrativeHistorySort } from '@mahoshojo/domain/narrative-history-operations';
import type { NarrativeHistoryEntry } from '@mahoshojo/domain/arena-types';
import { useBaseModalAccessibility } from '../modal';
import { useArenaInputLifecycle, type ArenaInputLifecyclePorts } from '../arena/input-lifecycle';

export type NarrativeHistoryActionResult = { hint?: string; cancelled?: boolean } | void;
export type NarrativeHistoryEditorProps = ArenaInputLifecyclePorts & Readonly<{
  isOpen: boolean;
  onClose: () => void;
  entries: NarrativeHistoryEntry[];
  lastUpdatedAt: string | null;
  sort: NarrativeHistorySort;
  onSortChange: (sort: NarrativeHistorySort) => void;
  formatDateTime: (value: string) => string;
  onCreate: (input: { title: string; content: string }) => NarrativeHistoryEntry | Promise<NarrativeHistoryEntry>;
  onUpdate: (id: string, input: { title: string; content: string }) => NarrativeHistoryEntry | Promise<NarrativeHistoryEntry>;
  onDelete: (id: string) => void | Promise<void>;
  onClear: () => void | Promise<void>;
  onMove: (id: string, direction: NarrativeHistoryReorderDirection) => void;
  onReorder: (movingId: string, targetId: string) => void;
  /** Import adapters validate, normalize, preserve source text and confirm replacement before writing. */
  onImportText: (text: string, mode: NarrativeHistoryImportMode) => NarrativeHistoryActionResult | Promise<NarrativeHistoryActionResult>;
  onImportFile: (file: File, mode: NarrativeHistoryImportMode) => NarrativeHistoryActionResult | Promise<NarrativeHistoryActionResult>;
  onExport: () => void | Promise<void>;
  onBrowse?: (mode: NarrativeHistoryImportMode) => void;
  browseLabel?: string;
  browseTitle?: string;
  saveAction?: ReactNode | ((disabled: boolean) => ReactNode);
  sizeIndicator?: ReactNode;
  requestDiscard: (message: string) => boolean | Promise<boolean>;
  confirmAction: (message: string) => boolean | Promise<boolean>;
  disabled?: boolean;
  busy?: boolean;
  closeBlocked?: boolean;
  externalHint?: string | null;
  externalError?: string | null;
  /** Identity changes reset the view after the host page guard. Adapters must fence asynchronous writes too. */
  scopeKey?: string;
}>;

/** Active entries retain original IDs. Display sorting never writes prompt order. No persistence, filtering or IO lives here. */
export function NarrativeHistoryEditor({ isOpen, onClose, entries, lastUpdatedAt, sort, onSortChange,
  formatDateTime, onCreate, onUpdate, onDelete, onClear, onMove, onReorder, onImportText, onImportFile,
  onExport, onBrowse, browseLabel = '从云端导入', browseTitle = '从我的数据卡/公开库导入叙事历史数据卡', saveAction, sizeIndicator, requestDiscard, confirmAction,
  disabled = false, busy = false, closeBlocked = false, externalHint, externalError, scopeKey,
  ...lifecycle }: NarrativeHistoryEditorProps) {
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [baseline, setBaseline] = useState({ title: '', content: '' });
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showPasteImport, setShowPasteImport] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<NarrativeHistoryImportMode>('append');
  const [operation, setOperation] = useState<string | null>(null);
  const pending = useRef(false);
  const scope = useRef({ key: scopeKey, isOpen });
  const revision = useRef(0);
  if (scope.current.key !== scopeKey || scope.current.isOpen !== isOpen) {
    scope.current = { key: scopeKey, isOpen }; revision.current += 1;
  }
  useEffect(() => () => { revision.current += 1; }, []);
  useEffect(() => {
    // Host identity changes happen only after its page-level guard has approved them.
    setView('list'); setActiveId(null); setDraftTitle(''); setDraftContent('');
    setBaseline({ title: '', content: '' }); setPasteText(''); setShowPasteImport(false);
    setSaveHint(null); setImportError(null); setIsReorderMode(false); setDraggingId(null);
  }, [scopeKey]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const blocked = disabled || busy || operation !== null;
  const isImporting = operation === 'import' || busy;
  const isSaving = operation === 'save';
  const dirty = Boolean(pasteText) || (view !== 'list' && (draftTitle !== baseline.title || draftContent !== baseline.content));
  const track = useArenaInputLifecycle(dirty, lifecycle, busy || operation !== null);
  const activeEntry = entries.find((entry) => entry.id === activeId) ?? null;
  const promptOrderedEntries = useMemo(() => getPromptOrderedNarrativeHistoryEntries(entries), [entries]);
  const sortedEntries = useMemo(() => isReorderMode ? promptOrderedEntries : sortNarrativeHistoryEntries(entries, sort), [entries, isReorderMode, promptOrderedEntries, sort]);
  const resetEditor = () => { setView('list'); setActiveId(null); setDraftTitle(''); setDraftContent(''); setBaseline({ title: '', content: '' }); setSaveHint(null); };
  const run = async (kind: string, action: (isCurrent: () => boolean) => void | Promise<void>) => {
    if (pending.current || disabled || busy) return;
    pending.current = true; setOperation(kind); setImportError(null);
    const current = revision.current;
    const isCurrent = () => revision.current === current;
    try { await track(() => action(isCurrent)); }
    catch (error) { if (isCurrent()) setImportError(error instanceof Error ? error.message : '操作失败，请重试'); }
    finally { pending.current = false; setOperation(null); }
  };
  const changeView = async (change: () => void) => run('confirm', async (isCurrent) => {
    if (dirty && !(await requestDiscard('放弃尚未提交的叙事历史编辑或粘贴内容？'))) return;
    if (!isCurrent()) return;
    setPasteText(''); setShowPasteImport(false); change();
  });
  const closeAndReset = async () => {
    if (closeBlocked) return;
    await changeView(() => { resetEditor(); setIsReorderMode(false); setDraggingId(null); setImportError(null); onClose(); });
  };
  const { titleId, dialogRef, initialFocusRef } = useBaseModalAccessibility({ isOpen, onClose: () => { void closeAndReset(); } });
  const handlePick = (entry: NarrativeHistoryEntry) => {
    if (isReorderMode || blocked) return;
    void changeView(() => { setView('edit'); setActiveId(entry.id); setDraftTitle(entry.title); setDraftContent(entry.content); setBaseline({ title: entry.title, content: entry.content }); setSaveHint(null); });
  };
  const handleStartCreate = () => changeView(() => { resetEditor(); setIsReorderMode(false); setDraggingId(null); setView('create'); });
  const returnToList = () => changeView(resetEditor);
  const save = () => run('save', async (isCurrent) => {
    const input = { title: draftTitle.trim(), content: draftContent.trim() };
    if (!input.content) throw new Error('正文不能为空。');
    if (view === 'edit' && (!activeId || !activeEntry)) throw new Error('原条目已不可用，请保留正文并返回列表重新选择。');
    const entry = view === 'create' ? await onCreate(input) : await onUpdate(activeId!, input);
    if (!isCurrent()) return;
    setActiveId(entry.id); setDraftTitle(entry.title); setDraftContent(entry.content);
    setBaseline({ title: entry.title, content: entry.content }); setView('edit'); setSaveHint(view === 'create' ? '已创建。' : '已保存。');
  });
  const handleCreate = save;
  const handleSave = save;
  const handleDelete = () => run('delete', async (isCurrent) => {
    if (!activeId || !(await confirmAction('确定删除这条叙事历史记录吗？此操作不可恢复。'))) return;
    if (!isCurrent()) return;
    await onDelete(activeId); if (isCurrent()) resetEditor();
  });
  const handleClearAll = () => run('clear', async (isCurrent) => {
    if (!entries.length || !(await confirmAction(`确定清空叙事历史（共 ${entries.length} 条）吗？此操作不可恢复。`))) return;
    if (!isCurrent()) return;
    await onClear(); if (isCurrent()) resetEditor();
  });
  const handleMove = (id: string, direction: NarrativeHistoryReorderDirection) => { if (!blocked) { onMove(id, direction); setSaveHint('已更新 AI 提示词顺序。'); } };
  const handleDropOnEntry = (targetId: string) => { if (!blocked && draggingId && draggingId !== targetId) { onReorder(draggingId, targetId); setSaveHint('已更新 AI 提示词顺序。'); } setDraggingId(null); };
  const finishImport = (result: NarrativeHistoryActionResult) => {
    if (result?.cancelled) return;
    setShowPasteImport(false); setPasteText(''); setIsReorderMode(false); setDraggingId(null); setSaveHint(result?.hint ?? '已导入。');
  };
  const importText = () => run('import', async (isCurrent) => { const result = await onImportText(pasteText, importMode); if (isCurrent()) finishImport(result); });
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    await run('import', async (isCurrent) => {
      if (pasteText && !(await requestDiscard('放弃未导入的粘贴内容，改为导入所选文件？'))) return;
      if (!isCurrent()) return;
      const result = await onImportFile(file, importMode); if (isCurrent()) finishImport(result);
    });
  };
  const handlePickFile = () => { if (!blocked) { setImportError(null); fileInputRef.current?.click(); } };
  const discardPaste = () => run('confirm', async (isCurrent) => { if (pasteText && !(await requestDiscard('放弃未导入的叙事历史 JSON？'))) return; if (isCurrent()) { setShowPasteImport(false); setPasteText(''); } });
  const togglePaste = () => showPasteImport ? discardPaste() : run('toggle', () => { setShowPasteImport(true); });
  if (!isOpen) return null;

  const modal = (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={() => void closeAndReset()}>
      <div
        className="bg-white rounded-lg shadow-xl p-0 w-full max-w-[90rem] h-[85dvh] max-h-[90dvh] overflow-hidden flex flex-col"
        ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b gap-3">
          <div>
            <div id={titleId} className="text-lg font-bold text-gray-800">叙事历史</div>
            <div className="text-xs text-gray-500 mt-1">
              共 {entries.length} 条{lastUpdatedAt ? `｜最近更新：${formatDateTime(lastUpdatedAt)}` : ''}
            </div>
          </div>
          <button ref={initialFocusRef} aria-label="关闭叙事历史" disabled={blocked || closeBlocked} className="text-gray-500 hover:text-gray-700 text-2xl leading-none" onClick={() => void closeAndReset()}>
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {view === 'list' ? (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm text-gray-700 font-semibold">历史列表</div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">排序</label>
                  <select
                    className="input-field text-sm"
                    value={sort}
                    onChange={(e) => onSortChange(e.target.value as NarrativeHistorySort)}
                    disabled={blocked || isReorderMode}
                  >
                    {Object.entries(narrativeHistorySortLabelMap).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={[
                      'px-3 py-1.5 text-xs rounded transition-colors',
                      isReorderMode
                        ? 'bg-pink-600 text-white hover:bg-pink-700'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
                    ].join(' ')}
                    onClick={() => {
                      setIsReorderMode((prev) => !prev);
                      setDraggingId(null);
                      setSaveHint(null);
                    }}
                    disabled={blocked || entries.length < 2}
                  >
                    {isReorderMode ? '完成排序' : '编辑 AI 顺序'}
                  </button>
                </div>
              </div>

              {isReorderMode && (
                <div className="mt-3 rounded-lg border border-pink-200 bg-pink-50/60 px-3 py-2 text-xs text-pink-700">
                  AI 提示词会按列表中的 1 → n 顺序注入；电脑端可拖动卡片，手机端可用“上移 / 下移 / 置顶 / 置底”按钮调整。
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs bg-pink-600 text-white rounded hover:bg-pink-700 disabled:opacity-60"
                  onClick={() => void handleStartCreate()}
                  disabled={blocked}
                >
                  新建条目
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
                  onClick={() => void run('export', async () => { await onExport(); })}
                  disabled={entries.length === 0 || blocked}
                >
                  导出 JSON
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
                  onClick={handlePickFile}
                  disabled={blocked}
                >
                  导入 JSON
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
                  onClick={() => {
                    void togglePaste();
                  }}
                  disabled={blocked}
                >
                  {showPasteImport ? '收起粘贴导入' : '粘贴导入'}
                </button>
                {onBrowse && <button
                  type="button"
                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
                  onClick={() => onBrowse?.(importMode)}
                  disabled={blocked}
                  title={browseTitle}
                >
                  {browseLabel}
                </button>}
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-60"
                  onClick={() => void handleClearAll()}
                  disabled={entries.length === 0 || blocked || isReorderMode}
                >
                  清空
                </button>
                <div className="flex items-center gap-2 ml-0 md:ml-2">
                  <label className="text-xs text-gray-500">导入方式</label>
                  <select
                    className="input-field text-sm"
                    value={importMode}
                    onChange={(e) => setImportMode(e.target.value as NarrativeHistoryImportMode)}
                    disabled={blocked}
                  >
                    {Object.entries(narrativeHistoryImportModeLabelMap).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ml-auto">
                  <fieldset disabled={blocked}>{typeof saveAction === 'function' ? saveAction(blocked) : saveAction}</fieldset>
                </div>
                <div className="w-full">{sizeIndicator}</div>
                <div className="w-full text-[11px] text-gray-500">
                  当前导入方式：{narrativeHistoryImportModeLabelMap[importMode]}。支持连续多次导入；若一次粘贴/上传的是“多张叙事历史数据卡数组”，也会自动拼接导入。
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
                    placeholder="粘贴叙事历史 JSON（支持单张 data card、entries 数组、多张 data card 数组）"
                    disabled={blocked}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
                      onClick={() => {
                        void discardPaste();
                      }}
                      disabled={blocked}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-60"
                      onClick={() => {
                        void importText();
                      }}
                      disabled={blocked || !pasteText.trim()}
                    >
                      {isImporting ? '导入中…' : importMode === 'append' ? '确认追加导入' : '确认覆盖导入'}
                    </button>
                  </div>
                </div>
              )}

              {(importError || externalError) && <div role="alert" className="mt-2 text-xs text-red-600">{importError || externalError}</div>}
              {(externalHint || saveHint) && <div className="mt-2 text-xs text-gray-600">{externalHint || saveHint}</div>}

              {sortedEntries.length === 0 ? (
                <div className="mt-4 text-sm text-gray-500">尚无叙事历史。开启“战报后写入叙事历史”后会自动累积。</div>
              ) : (
                <div className="mt-4 space-y-2">
                  {sortedEntries.map((entry, index) => (
                    <div
                      key={entry.id}
                      role="button"
                      tabIndex={0}
                      draggable={isReorderMode && !blocked}
                      onDragStart={() => setDraggingId(entry.id)}
                      onDragEnd={() => setDraggingId(null)}
                      onDragOver={(event) => {
                        if (!isReorderMode || blocked) return;
                        event.preventDefault();
                      }}
                      onDrop={() => {
                        if (!isReorderMode || blocked) return;
                        handleDropOnEntry(entry.id);
                      }}
                      className={[
                        'w-full text-left border rounded-lg p-3 transition-colors',
                        isReorderMode
                          ? draggingId === entry.id
                            ? 'border-pink-300 bg-pink-100/70 opacity-70'
                            : 'border-pink-200 bg-white hover:border-pink-300 hover:bg-pink-50/40'
                          : 'border-gray-200 hover:border-pink-300 hover:bg-pink-50/40',
                      ].join(' ')}
                      onClick={() => handlePick(entry)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handlePick(entry);
                        }
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          {isReorderMode ? (
                            <div
                              className="hidden md:flex mt-0.5 h-7 w-7 items-center justify-center rounded border border-pink-200 bg-pink-50 text-pink-500 cursor-grab"
                              title="拖动以调整 AI 提示词顺序"
                            >
                              ⋮⋮
                            </div>
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                                #{promptOrderedEntries.findIndex((item) => item.id === entry.id) + 1}
                              </span>
                              <div className="font-semibold text-gray-800 truncate">{entry.title || '未命名战报'}</div>
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-start gap-2">
                          <div className="text-[11px] text-gray-500 pt-1">{formatDateTime(entry.updatedAt)}</div>
                          {isReorderMode ? (
                            <div
                              className="flex flex-wrap items-center justify-end gap-1"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                onClick={() => handleMove(entry.id, 'top')}
                                disabled={blocked || index === 0}
                              >
                                置顶
                              </button>
                              <button
                                type="button"
                                className="rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                onClick={() => handleMove(entry.id, 'up')}
                                disabled={blocked || index === 0}
                              >
                                上移
                              </button>
                              <button
                                type="button"
                                className="rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                onClick={() => handleMove(entry.id, 'down')}
                                disabled={blocked || index === sortedEntries.length - 1}
                              >
                                下移
                              </button>
                              <button
                                type="button"
                                className="rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                onClick={() => handleMove(entry.id, 'bottom')}
                                disabled={blocked || index === sortedEntries.length - 1}
                              >
                                置底
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                  onClick={() => {
                    void returnToList();
                  }}
                  disabled={blocked}
                >
                  ← 返回列表
                </button>
                {view === 'edit' && activeEntry ? (
                  <div className="text-xs text-gray-500">
                    创建：{formatDateTime(activeEntry.createdAt)}｜更新：{formatDateTime(activeEntry.updatedAt)}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500">新建叙事历史条目</div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">标题</label>
                <input
                  className="input-field"
                  aria-label="历史标题"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  maxLength={120}
                  disabled={blocked}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">正文（Markdown）</label>
                <textarea
                  className="input-field font-mono text-xs"
                  aria-label="历史正文"
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  rows={14}
                  disabled={blocked}
                />
              </div>

              {(importError || externalError) && <div role="alert" className="text-xs text-red-600">{importError || externalError}</div>}
              {(externalHint || saveHint) && <div className="text-xs text-gray-600">{externalHint || saveHint}</div>}

              <div className="flex items-center justify-end gap-2">
                {view === 'edit' ? (
                  <>
                    <button
                      className="px-3 py-2 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                      onClick={() => void handleDelete()}
                      disabled={blocked}
                    >
                      删除
                    </button>
                    <button
                      className="px-3 py-2 text-xs bg-pink-600 text-white rounded hover:bg-pink-700 disabled:opacity-60"
                      onClick={() => void handleSave()}
                      disabled={blocked}
                    >
                      {isSaving ? '保存中…' : '保存修改'}
                    </button>
                  </>
                ) : (
                  <button
                    className="px-3 py-2 text-xs bg-pink-600 text-white rounded hover:bg-pink-700 disabled:opacity-60"
                    onClick={() => void handleCreate()}
                    disabled={blocked}
                  >
                    {isSaving ? '创建中…' : '创建条目'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : modal;
}
