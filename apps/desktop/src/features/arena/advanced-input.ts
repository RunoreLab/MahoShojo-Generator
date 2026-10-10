import { ARENA_CANONICAL_CAPABILITIES } from '@mahoshojo/contracts/arena-capabilities';
import { AdjudicatorEventSchema } from '@mahoshojo/domain/data-card-schemas';
import { appendAdjudicationEventsFromSource, applyAdjudicationEventSourceRemoval, buildAdjudicationSourceKey, getCombatantAdjudicationSourceKey, getScenarioAdjudicationSourceKey, prepareAdjudicationEventImport, removeAdjudicationEventsForKeys } from '@mahoshojo/domain/arena-adjudication-events';
import { extractNarrativeHistoryImportEntries, mergeNarrativeHistoryEntries, normalizeImportedNarrativeHistoryEntries, type NarrativeHistoryImportMode } from '@mahoshojo/domain/narrative-history-operations';
import type { AdjudicatorEvent } from '@mahoshojo/domain/arena-types';
import type { QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';
import { collectUsedQuestionnaireSelectionIds, ensureQuestionnaireSelectionId } from '@mahoshojo/domain/questionnaire-selection';
import { parseDesktopLoreSelections } from '../questionnaire/lore-source';
import { addArenaCombatants, arenaItemName, parseArenaJson } from './input';
import { arenaReferenceCount, type ArenaDraft, type ArenaAuxiliaryScenario } from './session';

export function appendAdvancedSourceEvents(draft: ArenaDraft, raw: unknown, label: string, sourceKey: string, onWarning?: (message: string) => void): ArenaDraft {
  const imported = prepareAdjudicationEventImport(raw, label, sourceKey);
  if (imported.status === 'legacy') { onWarning?.(`「${label}」的旧版随机事件已保留在原卡中，本次不执行。`); return draft; }
  if (imported.status !== 'ready') return draft;
  if (!imported.events.every((event) => AdjudicatorEventSchema.safeParse(event).success)) throw new Error('随机事件格式不受支持，未导入来源。');
  return { ...draft, adjudicationEvents: appendAdjudicationEventsFromSource(draft.adjudicationEvents as AdjudicatorEvent[], imported.events, imported.sourceKey) };
}
export function addAdvancedCombatants(draft: ArenaDraft, items: ArenaDraft['combatants'], onWarning?: (message: string) => void, skipExistingFilenames = false): ArenaDraft {
  // Text imports match Web: only filenames present before this batch are skipped.
  // Source events are still processed for skipped roles, including empty/legacy early-return.
  const filenames = new Set(draft.combatants.map((item) => item.filename));
  const accepted = skipExistingFilenames ? items.filter((item) => !filenames.has(item.filename)) : items;
  if (accepted.length !== items.length) onWarning?.(`已跳过 ${items.length - accepted.length} 位重复文件名角色；原角色正文未变。`);
  let next = addArenaCombatants(draft, accepted);
  for (const item of items) next = appendAdvancedSourceEvents(next, item.data.adjudicationEvents, arenaItemName(item.data), getCombatantAdjudicationSourceKey(item), onWarning);
  return next;
}
export function removeAdvancedCombatants(draft: ArenaDraft, indices: readonly number[]): ArenaDraft {
  const removing = new Set(indices);
  return { ...draft, combatants: draft.combatants.filter((_, index) => !removing.has(index)),
    adjudicationEvents: removeAdjudicationEventsForKeys(draft.adjudicationEvents, draft.combatants.filter((_, index) => removing.has(index)).map(getCombatantAdjudicationSourceKey)) };
}
export function setAdvancedMainScenario(draft: ArenaDraft, content: Record<string, unknown> | null, filename: string | null, onWarning?: (message: string) => void, sourceIdentity?: string): ArenaDraft {
  const sourceKey = content ? sourceIdentity ?? buildAdjudicationSourceKey({ sourceFileName: filename, sourceLabel: arenaItemName(content) }) : null;
  let next: ArenaDraft = { ...draft, scenario: { content, fileName: filename, ...(sourceKey ? { adjudicationSourceKey: sourceKey } : {}) }, scenarioDisplayName: content ? arenaItemName(content) : null,
    adjudicationEvents: applyAdjudicationEventSourceRemoval(draft.adjudicationEvents, getScenarioAdjudicationSourceKey(draft.scenario)) };
  if (content) next = appendAdvancedSourceEvents(next, content.adjudicationEvents, arenaItemName(content), sourceKey ?? '', onWarning);
  return next;
}
export function addAdvancedAuxScenario(draft: ArenaDraft, content: Record<string, unknown>, filename: string | null, id: string, onWarning?: (message: string) => void, sourceIdentity?: string): ArenaDraft {
  if (draft.battleMode !== 'scenario' || !draft.scenario.content) throw new Error('请先在情景模式选择主情景。');
  if (arenaReferenceCount(draft) >= ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity) throw new Error('参考项合计超过 256 项。');
  const sourceKey = sourceIdentity ?? buildAdjudicationSourceKey({ sourceFileName: filename, sourceLabel: arenaItemName(content) }) ?? '';
  const item: ArenaAuxiliaryScenario = { id, content, fileName: filename, adjudicationSourceKey: sourceKey };
  return appendAdvancedSourceEvents({ ...draft, auxScenarios: [...draft.auxScenarios, item] }, content.adjudicationEvents, arenaItemName(content), sourceKey, onWarning);
}
export function removeAdvancedAuxScenarios(draft: ArenaDraft, indices: readonly number[]): ArenaDraft {
  const removing = new Set(indices);
  return { ...draft, auxScenarios: draft.auxScenarios.filter((_, index) => !removing.has(index)),
    adjudicationEvents: removeAdjudicationEventsForKeys(draft.adjudicationEvents, draft.auxScenarios.filter((_, index) => removing.has(index)).map(getScenarioAdjudicationSourceKey)) };
}
export function addAdvancedLore(draft: ArenaDraft, selection: QuestionnaireSelection, createId: () => string): ArenaDraft {
  if (!selection.questionnaire.loreMarkdown?.trim()) throw new Error('问卷不包含 loreMarkdown，无法作为设定来源。');
  if (arenaReferenceCount(draft) >= ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity) throw new Error('参考项合计超过 256 项。');
  const existing = draft.selectedQuestionnaires ?? [];
  const key = (item: QuestionnaireSelection) => item.source === 'upload' ? null : `${item.source}:${item.dataCardId ?? item.questionnaire.id}`;
  if (key(selection) && existing.some((item) => key(item) === key(selection))) return draft;
  return { ...draft, selectedQuestionnaires: parseDesktopLoreSelections([...existing, ensureQuestionnaireSelectionId(selection, collectUsedQuestionnaireSelectionIds(existing), createId)]) };
}
export function importAdvancedHistory(draft: ArenaDraft, text: string, mode: NarrativeHistoryImportMode, context: { name: string; now: string; createId: () => string }): ArenaDraft {
  const extracted = extractNarrativeHistoryImportEntries(parseArenaJson(text));
  const entries = normalizeImportedNarrativeHistoryEntries(extracted.entries, context);
  if (!entries.length) throw new Error('未找到可用的叙事历史正文。');
  return { ...draft, narrativeHistoryEntries: mergeNarrativeHistoryEntries([...draft.narrativeHistoryEntries], entries, mode), historyUpdatedAt: context.now,
    historyOriginals: [...(draft.historyOriginals ?? []), { id: context.createId(), name: context.name, text, importedAt: context.now }] };
}
