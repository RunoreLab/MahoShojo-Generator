import type { AdjudicatorEvent } from '@/types/arena';

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
