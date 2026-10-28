import { useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { NarrativeHistoryEditor } from '@mahoshojo/ui-web/narrative-history';
import { CardLibraryModal, type BattleSelectionPayload, type CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';
import { appendNarrativeHistoryEntry, buildNarrativeHistoryCardPayload, moveNarrativeHistoryEntry, reorderNarrativeHistoryEntries, updateNarrativeHistoryEntry, type NarrativeHistoryImportMode } from '@mahoshojo/domain/narrative-history-operations';
import type { NarrativeHistoryEntry } from '@mahoshojo/domain/arena-types';
import { useDesktopCardLibraryHost } from '../../platform/card-library-host';
import { downloadTextFile } from '../../platform/download-text-file';
import { importAdvancedHistory } from './advanced-input';
import type { ArenaDraft, DesktopArenaSession } from './session';
import { parseArenaJson, readArenaFile } from './input';

const confirm = (message: string) => window.confirm(message);
const historyTypes: Array<'history'> = ['history'];
type Props = {
  session: DesktopArenaSession; draft: ArenaDraft; scope: string; disabled: boolean;
  importInput: DesktopArenaSession['importInput'];
  onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void;
};
/** Both Desktop Arena routes use the Web-shared editor with explicit local storage ports. */
export function DesktopArenaHistoryControls({ session, draft, scope, disabled, importInput, onDirtyChange, onBusyChange }: Props) {
  const host = useDesktopCardLibraryHost();
  const currentScope = useRef(scope); currentScope.current = scope;
  const [library, setLibrary] = useState<{ mode: NarrativeHistoryImportMode; scope: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // AI target changes invalidate pending imports, but retain unsubmitted editor text.
  useEffect(() => { setError(null); setLibrary(null); }, [scope]);
  const mutate = <T,>(apply: (current: ArenaDraft) => { next: ArenaDraft; value: T }): T => {
    if (disabled || session.isBusy() || session.getSnapshot().pendingRestore) throw new Error('请先完成当前操作。');
    const result = apply(session.getSnapshot().draft); session.updateDraft(result.next); return result.value;
  };
  const importHistory = async (loader: (signal: AbortSignal) => Promise<string>, mode: NarrativeHistoryImportMode, name: string) => {
    const owner = currentScope.current; let cancelled = false;
    try {
      await importInput(async (signal) => {
        const text = await loader(signal); parseArenaJson(text);
        return (current) => {
          if (owner !== currentScope.current) throw new Error('历史导入已失效，请重试。');
          if (mode === 'replace' && current.narrativeHistoryEntries.length && !confirm(`覆盖当前 ${current.narrativeHistoryEntries.length} 条活动历史？原卡库记录不变。`)) { cancelled = true; return current; }
          return importAdvancedHistory(current, text, mode, { name, now: new Date().toISOString(), createId: () => crypto.randomUUID() });
        };
      });
      return owner !== currentScope.current || cancelled ? { cancelled: true } : { hint: '已导入活动草稿。规范投影可能有字段损耗；完整会话导出保留导入原文。' };
    } catch (cause) { if (owner !== currentScope.current) return { cancelled: true }; throw cause; }
  };
  const choose = (payload: BattleSelectionPayload, context: CardLibrarySelectionContext) => {
    const selection = library;
    if (!selection || disabled || selection.scope !== currentScope.current) return;
    setError(null);
    void importHistory(async () => JSON.stringify(context.rawSourceData ?? payload), selection.mode, context.selectionId)
      .then((result) => { if (selection.scope === currentScope.current && !result.cancelled) setLibrary(null); })
      .catch((cause: unknown) => { if (selection.scope === currentScope.current) setError(cause instanceof Error ? cause.message : '导入失败，原稿保留。'); });
  };
  const setHistory = (entries: readonly NarrativeHistoryEntry[]) => mutate((current) => ({ next: { ...current, narrativeHistoryEntries: [...entries], historyUpdatedAt: new Date().toISOString() }, value: undefined }));
  return <>
    <button type="button" className="random-button mt-3" disabled={disabled} onClick={() => setHistoryOpen(true)}><History className="inline h-4 w-4" aria-hidden="true" /> 查看 / 编辑活动叙事历史</button>
    <NarrativeHistoryEditor isOpen={historyOpen} onClose={() => setHistoryOpen(false)} entries={[...draft.narrativeHistoryEntries]}
      lastUpdatedAt={draft.historyUpdatedAt ?? draft.narrativeHistoryEntries.at(-1)?.updatedAt ?? null} sort={draft.historySort ?? 'updated_desc'}
      onSortChange={(historySort) => mutate((current) => ({ next: { ...current, historySort }, value: undefined }))} formatDateTime={(value) => value}
      disabled={disabled} requestDiscard={confirm} confirmAction={confirm} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange}
      onCreate={(input) => mutate((current) => { const result = appendNarrativeHistoryEntry([...current.narrativeHistoryEntries], input, { fallbackId: crypto.randomUUID(), createdAt: new Date().toISOString() }); if (!result.entry) throw new Error('正文不能为空'); return { next: { ...current, narrativeHistoryEntries: result.entries, historyUpdatedAt: result.entry.updatedAt }, value: result.entry }; })}
      onUpdate={(id, input) => mutate((current) => { const entries = updateNarrativeHistoryEntry([...current.narrativeHistoryEntries], id, input, { now: () => new Date().toISOString() }); const entry = entries.find((item) => item.id === id); if (!entry) throw new Error('记录已失效'); return { next: { ...current, narrativeHistoryEntries: entries, historyUpdatedAt: entry.updatedAt }, value: entry }; })}
      onDelete={(id) => setHistory(session.getSnapshot().draft.narrativeHistoryEntries.filter((item) => item.id !== id))} onClear={() => setHistory([])}
      onMove={(id, direction) => setHistory(moveNarrativeHistoryEntry([...session.getSnapshot().draft.narrativeHistoryEntries], id, direction))}
      onReorder={(from, to) => setHistory(reorderNarrativeHistoryEntries([...session.getSnapshot().draft.narrativeHistoryEntries], from, to))}
      onImportText={(text, mode) => importHistory(async () => text, mode, '粘贴历史')}
      onImportFile={(file, mode) => importHistory((signal) => readArenaFile(file, signal), mode, file.name)}
      onBrowse={(mode) => setLibrary({ mode, scope })} browseLabel="从本地 / 公开库导入" browseTitle="原始历史卡另建活动副本，不覆盖源库记录"
      onExport={() => { const current = session.getSnapshot().draft; downloadTextFile('arena-history.json', JSON.stringify(buildNarrativeHistoryCardPayload(current.narrativeHistoryEntries, current.historyUpdatedAt ?? null, { now: () => new Date().toISOString() }), null, 2), 'application/json'); }}
      saveAction={(blocked) => <button type="button" disabled={blocked || !draft.narrativeHistoryEntries.length} className="random-button" onClick={() => { void session.save('history'); }}>另存完整历史到本地库</button>}
      externalError={session.getSnapshot().saveError} externalHint={session.getSnapshot().saveStatus === 'saved' ? '已另存本地库，源卡未覆盖。' : '这里编辑本机活动草稿。显示排序不改变提示词顺序；原始导入文本保存在完整会话导出中。'} />
    <CardLibraryModal host={host} isOpen={library !== null} onClose={() => setLibrary(null)} onSelectCard={choose}
      selectedType="history" allowedTypes={historyTypes}
      initialTab="local" visibleTabs={['local', 'public']} allowDeckImport={false} titleOverride="选择本地或公开历史副本" />
    {error ? <p role="alert">{error}</p> : null}
  </>;
}
