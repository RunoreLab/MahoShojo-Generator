// b2-A 提取前 f772781a4 的冻结对拍参照。来源：Web NarrativeHistoryModal、
// useNarrativeHistoryStore、lib/arena/adjudication-events、useBattleStore、questionnaireRequest。
// 仅将宿主 ID/时钟替换为参数并导出函数；不跟随新纯核实现更新。
import type { AdjudicatorEvent } from '../../src/arena-types';
import type { QuestionnaireSelection } from '../../src/questionnaire-selection';

export const appendEvents = (currentEvents: AdjudicatorEvent[], events: unknown, sourceKey?: string | null) => {
  const normalizedSourceKey = normalizeText(sourceKey);
  const nextEvents = Array.isArray(events) ? events : [];
  if (nextEvents.length === 0) return currentEvents;
  const withoutSameSource = normalizedSourceKey
    ? filterAdjudicationEventsBySources(currentEvents, [normalizedSourceKey])
    : currentEvents;
  const markedEvents = normalizedSourceKey
    ? nextEvents.map((event) => ({ ...event, sourceKey: normalizedSourceKey }))
    : nextEvents;
  return [...withoutSameSource, ...markedEvents];
};


const normalizeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const buildAdjudicationSourceKey = (input: {
  sourceDataCardId?: string | null;
  sourceFileName?: string | null;
  sourceLabel?: string | null;
}): string | null => {
  const cardId = normalizeText(input.sourceDataCardId);
  if (cardId) return `data_card:${cardId}`;

  const fileName = normalizeText(input.sourceFileName);
  if (fileName) return `file:${fileName}`;

  const label = normalizeText(input.sourceLabel);
  if (label) return `label:${label}`;

  return null;
};

export const markAdjudicationEventsWithSource = (
  events: unknown,
  sourceKey: string | null
): AdjudicatorEvent[] => {
  if (!Array.isArray(events) || events.length === 0) return [];
  if (!sourceKey) return events as AdjudicatorEvent[];
  return (events as AdjudicatorEvent[]).map((event) => ({ ...event, sourceKey }));
};

export const filterAdjudicationEventsBySource = (
  events: unknown,
  sourceKey: string
): AdjudicatorEvent[] => {
  if (!Array.isArray(events) || events.length === 0) return [];
  const trimmedKey = normalizeText(sourceKey);
  if (!trimmedKey) return events as AdjudicatorEvent[];
  return (events as AdjudicatorEvent[]).filter((event) => normalizeText(event?.sourceKey) !== trimmedKey);
};

export const filterAdjudicationEventsBySources = (
  events: unknown,
  sourceKeys: string[]
): AdjudicatorEvent[] => {
  if (!Array.isArray(events) || events.length === 0) return [];
  const trimmedKeys = new Set(sourceKeys.map((key) => normalizeText(key)).filter(Boolean));
  if (trimmedKeys.size === 0) return events as AdjudicatorEvent[];
  return (events as AdjudicatorEvent[]).filter((event) => !trimmedKeys.has(normalizeText(event?.sourceKey)));
};

export const getCombatantSourceKey = (combatant: unknown): string => {
  if (!combatant || typeof combatant !== 'object') return '';
  const record = combatant as Record<string, unknown>;
  return (
    normalizeText(record.adjudicationSourceKey) ||
    buildAdjudicationSourceKey({
      sourceDataCardId: normalizeText(record.sourceDataCardId),
      sourceFileName: normalizeText(record.filename),
      sourceLabel: normalizeText(record.sourceDataCardName) || normalizeText(record.filename) || normalizeText(record.id),
    }) ||
    ''
  );
};

export const matchesCombatantIdentifier = (combatant: unknown, identifier: unknown): boolean => {
  const normalizedIdentifier = normalizeText(identifier);
  if (!normalizedIdentifier || !combatant || typeof combatant !== 'object') return false;

  const record = combatant as Record<string, unknown>;
  const directMatches = [record.id, record.filename, record.sourceDataCardId, record.adjudicationSourceKey]
    .map(normalizeText)
    .some((value) => value === normalizedIdentifier);
  if (directMatches) return true;

  return getCombatantSourceKey(combatant) === normalizedIdentifier;
};

export const getScenarioSourceKey = (scenario: unknown): string => {
  if (!scenario || typeof scenario !== 'object') return '';
  const record = scenario as Record<string, unknown>;
  return (
    normalizeText(record.adjudicationSourceKey) ||
    buildAdjudicationSourceKey({
      sourceDataCardId: normalizeText(record.sourceDataCardId),
      sourceFileName: normalizeText(record.fileName),
      sourceLabel: normalizeText(record.sourceDataCardName) || normalizeText(record.fileName),
    }) ||
    ''
  );
};

export const applyAdjudicationEventSourceRemoval = (events: unknown, sourceKey: string): AdjudicatorEvent[] => {
  if (!Array.isArray(events) || !normalizeText(sourceKey)) return Array.isArray(events) ? (events as AdjudicatorEvent[]) : [];
  return filterAdjudicationEventsBySources(events, [sourceKey]);
};

export const removeAdjudicationEventsForKeys = (events: unknown, sourceKeys: string[]): AdjudicatorEvent[] => {
  if (!Array.isArray(events) || events.length === 0) return Array.isArray(events) ? (events as AdjudicatorEvent[]) : [];
  return filterAdjudicationEventsBySources(events, sourceKeys);
};



/** 单人和多人共用的请求投影：缺省字段不写入对象，兼容严格 JSON 校验。 */
export const buildArenaQuestionnaireRequest = (selections: readonly QuestionnaireSelection[]) => ({
  questionnaireSelections: selections.length > 0 ? selections.map((selection) => ({
    source: selection.source,
    kind: selection.questionnaire.kind,
    ...(selection.source === 'preset' ? { presetId: selection.questionnaire.id } : {}),
    ...(selection.source === 'database' && selection.dataCardId !== undefined
      ? { dataCardId: selection.dataCardId } : {}),
    ...(selection.useLore === false ? { useLore: false } : {}),
  })) : undefined,
  questionnaires: selections.length > 0 ? selections.map((selection) => ({
    id: selection.questionnaire.id,
    title: selection.questionnaire.title,
    kind: selection.questionnaire.kind,
    ...(selection.useLore === false ? { useLore: false } : {}),
    ...(selection.questionnaire.loreMarkdown != null
      ? { loreMarkdown: selection.questionnaire.loreMarkdown } : {}),
  })) : undefined,
});
