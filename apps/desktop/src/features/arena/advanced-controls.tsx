import { useCallback, useEffect, useRef, useState } from 'react';
import { AdjudicatorSettingsPanel, QuestionnaireLorePanel } from '@mahoshojo/ui-web/arena';
import { NarrativeHistoryEditor } from '@mahoshojo/ui-web/narrative-history';
import { CardLibraryModal, type BattleSelectionPayload, type CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';
import { BaseModal } from '@mahoshojo/ui-web/modal';
import { appendNarrativeHistoryEntry, buildNarrativeHistoryCardPayload, moveNarrativeHistoryEntry, reorderNarrativeHistoryEntries, updateNarrativeHistoryEntry, type NarrativeHistoryImportMode } from '@mahoshojo/domain/narrative-history-operations';
import type { AdjudicatorEvent, NarrativeHistoryEntry } from '@mahoshojo/domain/arena-types';
import { removeQuestionnaireSelection, setQuestionnaireSelectionLore, type QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';
import type { QuestionnairePresetEntry } from '@mahoshojo/domain/questionnaire-definition';
import { ARENA_CANONICAL_CAPABILITIES } from '@mahoshojo/contracts/arena-capabilities';
import presetIndex from '../../../../../content/questionnaires/presets/index.json';
import { useDesktopCardLibraryHost } from '../../platform/card-library-host';
import { downloadTextFile } from '../../platform/download-text-file';
import { loadBuiltinQuestionnaire, parseQuestionnaireCardSelection, toQuestionnaireSelection } from '../questionnaire/flow';
import { importDesktopLore, retainDesktopLoreSource } from '../questionnaire/lore-source';
import { addAdvancedLore, importAdvancedHistory } from './advanced-input';
import { arenaReferenceCount, type ArenaDraft, type DesktopArenaSession } from './session';
import { moveArenaItem, parseArenaJson, readArenaFile } from './input';

const presets = presetIndex.presets as QuestionnairePresetEntry[];
const family = { fallbackKind: 'magical-girl' as const, builtinQuestionnaireId: '', builtinPresetPath: '' };
const confirm = (message: string) => window.confirm(message);

type Props = {
  session: DesktopArenaSession; draft: ArenaDraft; scope: string; disabled: boolean;
  importInput: DesktopArenaSession['importInput'];
  onDirtyChange: (value: boolean) => void; onBusyChange: (value: boolean) => void;
};
/** Host ports only. Editors, filtering-free local state, raw-source archives and library IO stay explicit. */
export function AdvancedArenaControls({ session, draft, scope, disabled, importInput, onDirtyChange, onBusyChange }: Props) {
  const host = useDesktopCardLibraryHost();
  const currentScope = useRef(scope); currentScope.current = scope;
  const [library, setLibrary] = useState<{ kind: 'lore' | 'history'; mode: NarrativeHistoryImportMode; scope: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [details, setDetails] = useState<QuestionnaireSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); setLibrary(null); }, [scope]);
  const dirty = useRef({ lore: false, history: false }), busy = useRef({ lore: false, history: false });
  const dirtyPort = useRef(onDirtyChange), busyPort = useRef(onBusyChange); dirtyPort.current = onDirtyChange; busyPort.current = onBusyChange;
  const onLoreDirty = useCallback((value: boolean) => { dirty.current.lore = value; dirtyPort.current(Object.values(dirty.current).some(Boolean)); }, []);
  const onHistoryDirty = useCallback((value: boolean) => { dirty.current.history = value; dirtyPort.current(Object.values(dirty.current).some(Boolean)); }, []);
  const onLoreBusy = useCallback((value: boolean) => { busy.current.lore = value; busyPort.current(Object.values(busy.current).some(Boolean)); }, []);
  const onHistoryBusy = useCallback((value: boolean) => { busy.current.history = value; busyPort.current(Object.values(busy.current).some(Boolean)); }, []);
  const mutate = <T,>(apply: (current: ArenaDraft) => { next: ArenaDraft; value: T }): T => {
    if (disabled || session.isBusy() || session.getSnapshot().pendingRestore) throw new Error('请先完成当前操作。');
    const result = apply(session.getSnapshot().draft); session.updateDraft(result.next); return result.value;
  };
  const loreUpdate = (selections: QuestionnaireSelection[]) => mutate((current) => ({ next: { ...current, selectedQuestionnaires: selections }, value: undefined }));
  const loadLore = async (loader: (signal: AbortSignal) => Promise<QuestionnaireSelection>) => {
    const owner = currentScope.current;
    try { await importInput(async (signal) => { const selection = await loader(signal); return (current) => addAdvancedLore(current, selection, () => crypto.randomUUID()); }); if (owner !== currentScope.current) return { cancelled: true }; }
    catch (cause) { if (owner !== currentScope.current) return { cancelled: true }; throw cause; }
  };
  const importHistory = async (loader: (signal: AbortSignal) => Promise<string>, mode: NarrativeHistoryImportMode, name: string) => {
    const owner = currentScope.current; let cancelled = false;
    try {
      await importInput(async (signal) => {
        const text = await loader(signal); parseArenaJson(text);
        return (current) => {
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
    const action = selection.kind === 'history'
      ? importHistory(async () => JSON.stringify(context.rawSourceData ?? payload), selection.mode, context.selectionId)
      : loadLore(async () => {
        const parsed = parseQuestionnaireCardSelection(family, payload, context);
        if ('error' in parsed) throw new Error(parsed.error);
        return retainDesktopLoreSource(toQuestionnaireSelection(parsed.source, parsed.questionnaire), context.rawSourceData ?? payload);
      });
    void action.then((result) => { if (selection.scope === currentScope.current && !(result && 'cancelled' in result && result.cancelled)) setLibrary(null); })
      .catch((cause: unknown) => { if (selection.scope === currentScope.current) setError(cause instanceof Error ? cause.message : '导入失败，原稿保留。'); });
  };
  const setHistory = (entries: readonly NarrativeHistoryEntry[]) => mutate((current) => ({ next: { ...current, narrativeHistoryEntries: [...entries], historyUpdatedAt: new Date().toISOString() }, value: undefined }));
  return <>
    <QuestionnaireLorePanel selectedQuestionnaires={draft.selectedQuestionnaires ?? []} presets={presets} disabled={disabled}
      referenceItemCount={arenaReferenceCount(draft)} maxReferenceItems={ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity}
      sourceLabel={(selection) => selection.source === 'preset' ? '内置预设' : selection.source === 'database' ? '公开来源' : '本地 / 缓存副本'}
      browseLabel="选择本地 / 公开设定" onBrowse={() => setLibrary({ kind: 'lore', mode: 'append', scope })}
      onAddPreset={async (id) => { const preset = presets.find((item) => item.id === id); if (!preset) throw new Error('未知问卷预设'); return loadLore(async (signal) => ({ source: 'preset', questionnaire: await loadBuiltinQuestionnaire({ fallbackKind: preset.kind, builtinQuestionnaireId: preset.id, builtinPresetPath: preset.path }, signal) })); }}
      onPaste={(text) => loadLore(async () => { parseArenaJson(text); return importDesktopLore(text); })}
      onUpload={(file) => loadLore(async (signal) => importDesktopLore(await readArenaFile(file, signal)))}
      onClear={() => loreUpdate([])} onRemove={(id) => loreUpdate(removeQuestionnaireSelection(draft.selectedQuestionnaires ?? [], id))}
      onToggleLore={(id, enabled) => loreUpdate(setQuestionnaireSelectionLore(draft.selectedQuestionnaires ?? [], id, enabled))}
      onMove={(id, direction) => { const selections = draft.selectedQuestionnaires ?? []; const index = selections.findIndex((item) => (item.selectionId ?? item.questionnaire.id) === id); loreUpdate(moveArenaItem(selections, index, index + (direction === 'up' ? -1 : 1))); }}
      onDetails={setDetails} requestDiscard={confirm} onDirtyChange={onLoreDirty} onBusyChange={onLoreBusy} />
    <AdjudicatorSettingsPanel events={draft.adjudicationEvents as AdjudicatorEvent[]} disabled={disabled}
      onEventsChange={(events) => mutate((current) => ({ next: { ...current, adjudicationEvents: events }, value: undefined }))}
      onClearEvents={() => mutate((current) => ({ next: { ...current, adjudicationEvents: [] }, value: undefined }))} />
    <button type="button" className="random-button mt-3" disabled={disabled} onClick={() => setHistoryOpen(true)}>查看 / 编辑活动叙事历史</button>
    <NarrativeHistoryEditor isOpen={historyOpen} onClose={() => setHistoryOpen(false)} entries={[...draft.narrativeHistoryEntries]}
      lastUpdatedAt={draft.historyUpdatedAt ?? draft.narrativeHistoryEntries.at(-1)?.updatedAt ?? null} sort={draft.historySort ?? 'updated_desc'}
      onSortChange={(historySort) => mutate((current) => ({ next: { ...current, historySort }, value: undefined }))} formatDateTime={(value) => value}
      disabled={disabled} requestDiscard={confirm} confirmAction={confirm} onDirtyChange={onHistoryDirty} onBusyChange={onHistoryBusy}
      onCreate={(input) => mutate((current) => { const result = appendNarrativeHistoryEntry([...current.narrativeHistoryEntries], input, { fallbackId: crypto.randomUUID(), createdAt: new Date().toISOString() }); if (!result.entry) throw new Error('正文不能为空'); return { next: { ...current, narrativeHistoryEntries: result.entries, historyUpdatedAt: result.entry.updatedAt }, value: result.entry }; })}
      onUpdate={(id, input) => mutate((current) => { const entries = updateNarrativeHistoryEntry([...current.narrativeHistoryEntries], id, input, { now: () => new Date().toISOString() }); const entry = entries.find((item) => item.id === id); if (!entry) throw new Error('记录已失效'); return { next: { ...current, narrativeHistoryEntries: entries, historyUpdatedAt: entry.updatedAt }, value: entry }; })}
      onDelete={(id) => setHistory(session.getSnapshot().draft.narrativeHistoryEntries.filter((item) => item.id !== id))} onClear={() => setHistory([])}
      onMove={(id, direction) => setHistory(moveNarrativeHistoryEntry([...session.getSnapshot().draft.narrativeHistoryEntries], id, direction))}
      onReorder={(from, to) => setHistory(reorderNarrativeHistoryEntries([...session.getSnapshot().draft.narrativeHistoryEntries], from, to))}
      onImportText={(text, mode) => importHistory(async () => text, mode, '粘贴历史')}
      onImportFile={(file, mode) => importHistory((signal) => readArenaFile(file, signal), mode, file.name)}
      onBrowse={(mode) => setLibrary({ kind: 'history', mode, scope })} browseLabel="从本地 / 公开库导入" browseTitle="原始历史卡另建活动副本，不覆盖源库记录"
      onExport={() => { const current = session.getSnapshot().draft; downloadTextFile('arena-history.json', JSON.stringify(buildNarrativeHistoryCardPayload(current.narrativeHistoryEntries, current.historyUpdatedAt ?? null, { now: () => new Date().toISOString() }), null, 2), 'application/json'); }}
      saveAction={(blocked) => <button type="button" disabled={blocked || !draft.narrativeHistoryEntries.length} className="random-button" onClick={() => { void session.save('history'); }}>另存完整历史到本地库</button>}
      externalError={session.getSnapshot().saveError} externalHint={session.getSnapshot().saveStatus === 'saved' ? '已另存本地库，源卡未覆盖。' : '这里编辑本机活动草稿。显示排序不改变提示词顺序；原始导入文本保存在完整会话导出中。'} />
    <CardLibraryModal host={host} isOpen={library !== null} onClose={() => setLibrary(null)} onSelectCard={choose}
      selectedType={library?.kind === 'history' ? 'history' : 'questionnaire'} allowedTypes={[library?.kind === 'history' ? 'history' : 'questionnaire']}
      initialTab="local" visibleTabs={['local', 'public']} allowDeckImport={false} titleOverride="选择本地或公开缓存副本" />
    <BaseModal isOpen={details !== null} onClose={() => setDetails(null)} title="设定来源详情"><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(details?.questionnaire, null, 2)}</pre></BaseModal>
    {error ? <p role="alert">{error}</p> : null}
  </>;
}
