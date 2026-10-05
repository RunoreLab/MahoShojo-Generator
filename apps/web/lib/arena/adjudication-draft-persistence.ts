import type { AdjudicatorEvent, CustomOutcome } from '@/types/arena';

export const ARENA_ADJUDICATION_DRAFT_VERSION = 1 as const;

const MAX_DRAFT_NODES = 200;
const MAX_DRAFT_DEPTH = 8;
const MAX_ID_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 4_000;
const MAX_OUTCOME_NAME_LENGTH = 1_000;

export interface ArenaAdjudicationDraftV1 {
  version: typeof ARENA_ADJUDICATION_DRAFT_VERSION;
  updatedAt: number;
  events: AdjudicatorEvent[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const boundedString = (value: unknown, maxLength: number): string | null =>
  typeof value === 'string' && value.length <= maxLength ? value : null;

const normalizedId = (value: unknown): string | null => {
  const id = boundedString(value, MAX_ID_LENGTH)?.trim() ?? '';
  return id || null;
};

const probability = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;

const sanitizeEvents = (input: unknown): AdjudicatorEvent[] => {
  if (!Array.isArray(input)) return [];

  let remainingNodes = MAX_DRAFT_NODES;

  const sanitizeEvent = (value: unknown, depth: number): AdjudicatorEvent | null => {
    if (!isRecord(value) || depth > MAX_DRAFT_DEPTH || remainingNodes <= 0) return null;

    const id = normalizedId(value.id);
    const description = boundedString(value.description, MAX_DESCRIPTION_LENGTH);
    const type = value.type === 'binary' || value.type === 'custom' ? value.type : null;
    if (!id || description === null || !type) return null;
    remainingNodes -= 1;

    const sanitizeChain = (chain: unknown): { event: AdjudicatorEvent } | undefined => {
      if (!isRecord(chain) || depth >= MAX_DRAFT_DEPTH) return undefined;
      const event = sanitizeEvent(chain.event, depth + 1);
      return event ? { event } : undefined;
    };

    if (type === 'binary') {
      const eventProbability = value.probability === undefined ? undefined : probability(value.probability);
      if (value.probability !== undefined && eventProbability === null) return null;
      const onSuccess = sanitizeChain(value.onSuccess);
      const onFailure = sanitizeChain(value.onFailure);
      return {
        id,
        description,
        type,
        ...(eventProbability !== undefined && eventProbability !== null
          ? { probability: eventProbability }
          : {}),
        ...(onSuccess ? { onSuccess } : {}),
        ...(onFailure ? { onFailure } : {}),
      };
    }

    const outcomes = Array.isArray(value.outcomes)
      ? value.outcomes
          .map((rawOutcome): CustomOutcome | null => {
            if (!isRecord(rawOutcome) || remainingNodes <= 0) return null;
            const outcomeId = normalizedId(rawOutcome.id);
            const name = boundedString(rawOutcome.name, MAX_OUTCOME_NAME_LENGTH);
            const outcomeProbability = probability(rawOutcome.probability);
            if (!outcomeId || name === null || outcomeProbability === null) return null;
            remainingNodes -= 1;
            const chainedEvent = sanitizeChain(rawOutcome.chainedEvent);
            return {
              id: outcomeId,
              name,
              probability: outcomeProbability,
              ...(chainedEvent ? { chainedEvent } : {}),
            };
          })
          .filter((outcome): outcome is CustomOutcome => outcome !== null)
      : undefined;

    return {
      id,
      description,
      type,
      ...(outcomes ? { outcomes } : {}),
    };
  };

  return input
    .filter((value) => !isRecord(value) || typeof value.sourceKey !== 'string' || !value.sourceKey.trim())
    .map((value) => sanitizeEvent(value, 0))
    .filter((event): event is AdjudicatorEvent => event !== null);
};

export const createArenaAdjudicationDraft = (
  events: unknown,
  updatedAt = Date.now(),
): ArenaAdjudicationDraftV1 => ({
  version: ARENA_ADJUDICATION_DRAFT_VERSION,
  updatedAt,
  events: sanitizeEvents(events),
});

export const parseArenaAdjudicationDraft = (value: unknown): AdjudicatorEvent[] => {
  if (!isRecord(value)) return [];
  if (value.version !== ARENA_ADJUDICATION_DRAFT_VERSION) return [];
  if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || value.updatedAt < 0) return [];
  return sanitizeEvents(value.events);
};

export const restoreArenaAdjudicationDraft = (persistedState: unknown): AdjudicatorEvent[] => {
  if (!isRecord(persistedState)) return [];
  if (Object.prototype.hasOwnProperty.call(persistedState, 'adjudicationDraftV1')) {
    return parseArenaAdjudicationDraft(persistedState.adjudicationDraftV1);
  }
  return sanitizeEvents(persistedState.adjudicationEvents);
};
