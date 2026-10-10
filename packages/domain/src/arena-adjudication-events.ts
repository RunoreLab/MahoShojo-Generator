import type { AdjudicatorEvent } from './arena-types';
import { isLegacyAdjudicatorFormat } from './arena-character-validator';

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

// 来源身份沿 Web store 既有规则，显式 sourceKey 优先；不是新引用计数或实例身份。
export const getCombatantAdjudicationSourceKey = (combatant: unknown): string => {
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

export const matchesArenaCombatantIdentifier = (combatant: unknown, identifier: unknown): boolean => {
  const normalizedIdentifier = normalizeText(identifier);
  if (!normalizedIdentifier || !combatant || typeof combatant !== 'object') return false;

  const record = combatant as Record<string, unknown>;
  const directMatches = [record.id, record.filename, record.sourceDataCardId, record.adjudicationSourceKey]
    .map(normalizeText)
    .some((value) => value === normalizedIdentifier);
  if (directMatches) return true;

  return getCombatantAdjudicationSourceKey(combatant) === normalizedIdentifier;
};

export const getScenarioAdjudicationSourceKey = (scenario: unknown): string => {
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

/**
 * 非空来源事件替换已有同 key 事件；空输入维持旧 early-return。
 * 校验/旧版识别由导入 gate 承担，这里不新增隐式规范化或随机执行。
 */
export const appendAdjudicationEventsFromSource = (
  currentEvents: AdjudicatorEvent[],
  events: unknown,
  sourceKey?: string | null,
): AdjudicatorEvent[] => {
  const normalizedSourceKey = normalizeText(sourceKey);
  const nextEvents = Array.isArray(events) ? events as AdjudicatorEvent[] : [];
  if (nextEvents.length === 0) return currentEvents;
  const withoutSameSource = normalizedSourceKey
    ? filterAdjudicationEventsBySources(currentEvents, [normalizedSourceKey])
    : currentEvents;
  const markedEvents = normalizedSourceKey
    ? nextEvents.map((event) => ({ ...event, sourceKey: normalizedSourceKey }))
    : nextEvents;
  return [...withoutSameSource, ...markedEvents];
};

export type PreparedAdjudicationEventImport =
  | Readonly<{ status: 'empty' | 'legacy' }>
  | Readonly<{ status: 'ready'; events: AdjudicatorEvent[]; sourceKey: string | null }>;

/**
 * 角色与主/辅情景的既有导入 gate。素材与问卷 Lore 不调用此入口。
 * empty/legacy 不移除旧来源；warning/存储/来源内容校验仍由宿主完成。
 */
export const prepareAdjudicationEventImport = (
  events: unknown,
  label: string,
  sourceKey?: string | null,
): PreparedAdjudicationEventImport => {
  if (!Array.isArray(events) || events.length === 0) return { status: 'empty' };
  if (isLegacyAdjudicatorFormat(events)) return { status: 'legacy' };
  const effectiveSourceKey = sourceKey ?? buildAdjudicationSourceKey({ sourceLabel: label });
  const marked = markAdjudicationEventsWithSource(events, effectiveSourceKey);
  if (marked.length === 0) return { status: 'empty' };
  return { status: 'ready', events: marked, sourceKey: effectiveSourceKey };
};
