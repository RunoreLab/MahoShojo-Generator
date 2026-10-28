import { useEffect, useRef, useState } from 'react';
import { AdjudicatorSettingsPanel, QuestionnaireLorePanel } from '@mahoshojo/ui-web/arena';
import { CardLibraryModal, type BattleSelectionPayload, type CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';
import { BaseModal } from '@mahoshojo/ui-web/modal';
import type { AdjudicatorEvent } from '@mahoshojo/domain/arena-types';
import { removeQuestionnaireSelection, setQuestionnaireSelectionLore, type QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';
import type { QuestionnairePresetEntry } from '@mahoshojo/domain/questionnaire-definition';
import { ARENA_CANONICAL_CAPABILITIES } from '@mahoshojo/contracts/arena-capabilities';
import presetIndex from '../../../../../content/questionnaires/presets/index.json';
import { useDesktopCardLibraryHost } from '../../platform/card-library-host';
import { loadBuiltinQuestionnaire, parseQuestionnaireCardSelection, toQuestionnaireSelection } from '../questionnaire/flow';
import { importDesktopLore, retainDesktopLoreSource } from '../questionnaire/lore-source';
import { addAdvancedLore } from './advanced-input';
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
  const [library, setLibrary] = useState<{ scope: string } | null>(null);
  const [details, setDetails] = useState<QuestionnaireSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); setLibrary(null); }, [scope]);
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
  const choose = (payload: BattleSelectionPayload, context: CardLibrarySelectionContext) => {
    const selection = library;
    if (!selection || disabled || selection.scope !== currentScope.current) return;
    setError(null);
    const action = loadLore(async () => {
        const parsed = parseQuestionnaireCardSelection(family, payload, context);
        if ('error' in parsed) throw new Error(parsed.error);
        return retainDesktopLoreSource(toQuestionnaireSelection(parsed.source, parsed.questionnaire), context.rawSourceData ?? payload);
      });
    void action.then((result) => { if (selection.scope === currentScope.current && !(result && 'cancelled' in result && result.cancelled)) setLibrary(null); })
      .catch((cause: unknown) => { if (selection.scope === currentScope.current) setError(cause instanceof Error ? cause.message : '导入失败，原稿保留。'); });
  };
  return <>
    <QuestionnaireLorePanel selectedQuestionnaires={draft.selectedQuestionnaires ?? []} presets={presets} disabled={disabled}
      referenceItemCount={arenaReferenceCount(draft)} maxReferenceItems={ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity}
      sourceLabel={(selection) => selection.source === 'preset' ? '内置预设' : selection.source === 'database' ? '公开来源' : '本地 / 缓存副本'}
      browseLabel="选择本地 / 公开设定" onBrowse={() => setLibrary({ scope })}
      onAddPreset={async (id) => { const preset = presets.find((item) => item.id === id); if (!preset) throw new Error('未知问卷预设'); return loadLore(async (signal) => ({ source: 'preset', questionnaire: await loadBuiltinQuestionnaire({ fallbackKind: preset.kind, builtinQuestionnaireId: preset.id, builtinPresetPath: preset.path }, signal) })); }}
      onPaste={(text) => loadLore(async () => { parseArenaJson(text); return importDesktopLore(text); })}
      onUpload={(file) => loadLore(async (signal) => importDesktopLore(await readArenaFile(file, signal)))}
      onClear={() => loreUpdate([])} onRemove={(id) => loreUpdate(removeQuestionnaireSelection(draft.selectedQuestionnaires ?? [], id))}
      onToggleLore={(id, enabled) => loreUpdate(setQuestionnaireSelectionLore(draft.selectedQuestionnaires ?? [], id, enabled))}
      onMove={(id, direction) => { const selections = draft.selectedQuestionnaires ?? []; const index = selections.findIndex((item) => (item.selectionId ?? item.questionnaire.id) === id); loreUpdate(moveArenaItem(selections, index, index + (direction === 'up' ? -1 : 1))); }}
      onDetails={setDetails} requestDiscard={confirm} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} />
    <AdjudicatorSettingsPanel events={draft.adjudicationEvents as AdjudicatorEvent[]} disabled={disabled}
      onEventsChange={(events) => mutate((current) => ({ next: { ...current, adjudicationEvents: events }, value: undefined }))}
      onClearEvents={() => mutate((current) => ({ next: { ...current, adjudicationEvents: [] }, value: undefined }))} />
    <CardLibraryModal host={host} isOpen={library !== null} onClose={() => setLibrary(null)} onSelectCard={choose}
      selectedType="questionnaire" allowedTypes={['questionnaire']}
      initialTab="local" visibleTabs={['local', 'public']} allowDeckImport={false} titleOverride="选择本地或公开缓存副本" />
    <BaseModal isOpen={details !== null} onClose={() => setDetails(null)} title="设定来源详情"><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(details?.questionnaire, null, 2)}</pre></BaseModal>
    {error ? <p role="alert">{error}</p> : null}
  </>;
}
