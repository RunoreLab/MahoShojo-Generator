import { randomUUID } from '@/lib/crypto';

export type ArenaHistoryRetentionStrategy =
  | 'keep-all'
  | 'keep-sublimation-only'
  | 'reset-all';

export const DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY: ArenaHistoryRetentionStrategy =
  'keep-sublimation-only';

export const ARENA_HISTORY_RETENTION_LABELS: Record<ArenaHistoryRetentionStrategy, string> = {
  'keep-all': '保留全部历史',
  'keep-sublimation-only': '只保留升华记录',
  'reset-all': '清空全部历史',
};

export const ARENA_HISTORY_RETENTION_DESCRIPTIONS: Record<ArenaHistoryRetentionStrategy, string> = {
  'keep-all': '保留全部既有历战，并追加本次升华记录',
  'keep-sublimation-only': '仅保留历次升华记录，并追加本次升华记录',
  'reset-all': '清空既有历战，仅保留本次升华记录，并重置世界线',
};

type SublimationHistoryEntryInput = {
  title: string;
  impact: string;
  participantsName: string | null;
  finalUserGuidance: string | null;
  hasQuestionnaireLore: boolean;
  questionnaireSelectionCount: number;
  nonNativeDataInvolved: boolean;
};

type ApplySublimationArenaHistoryStrategyInput = {
  sourceArenaHistory: unknown;
  strategy: unknown;
  newEntry: Record<string, unknown>;
  nowISO: string;
  createWorldLineId?: () => string;
};

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const readEntries = (value: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Array<
    Record<string, unknown>
  >;
};

const getNextEntryId = (entries: Array<Record<string, unknown>>): number => {
  return entries.reduce((max, entry) => {
    const raw = entry.id;
    const numeric = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0) + 1;
};

export const normalizeArenaHistoryRetentionStrategy = (value: unknown): ArenaHistoryRetentionStrategy => {
  if (value === 'keep-all' || value === 'keep-sublimation-only' || value === 'reset-all') return value;
  return DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY;
};

export const buildSublimationHistoryEntry = (input: SublimationHistoryEntryInput) => ({
  type: 'sublimation',
  title: input.title,
  participants: input.participantsName ? [input.participantsName] : [],
  winner: input.participantsName ?? '未知角色',
  impact: input.impact,
  metadata: {
    user_guidance: input.finalUserGuidance,
    scenario_title: null,
    non_native_data_involved: input.nonNativeDataInvolved,
    questionnaire_lore_used: input.hasQuestionnaireLore,
    questionnaire_selection_count: input.questionnaireSelectionCount,
  },
});

export const applySublimationArenaHistoryStrategy = (
  input: ApplySublimationArenaHistoryStrategyInput,
) => {
  const createWorldLineId = input.createWorldLineId ?? randomUUID;
  const history = toRecord(input.sourceArenaHistory);
  const attributes = toRecord(history.attributes);
  const sourceEntries = readEntries(history.entries);
  const normalizedStrategy = normalizeArenaHistoryRetentionStrategy(input.strategy);

  const retainedEntries =
    normalizedStrategy === 'keep-all'
      ? cloneJson(sourceEntries)
      : normalizedStrategy === 'keep-sublimation-only'
        ? cloneJson(sourceEntries.filter((entry) => entry.type === 'sublimation'))
        : [];

  const nextEntry = {
    ...cloneJson(input.newEntry),
    id: getNextEntryId(retainedEntries),
  };

  const nextAttributes =
    normalizedStrategy === 'reset-all'
      ? {
          world_line_id: createWorldLineId(),
          created_at: input.nowISO,
          updated_at: input.nowISO,
          sublimation_count: 1,
          last_sublimation_at: input.nowISO,
        }
      : {
          world_line_id:
            typeof attributes.world_line_id === 'string' && attributes.world_line_id
              ? attributes.world_line_id
              : createWorldLineId(),
          created_at:
            typeof attributes.created_at === 'string' && attributes.created_at
              ? attributes.created_at
              : input.nowISO,
          updated_at: input.nowISO,
          sublimation_count:
            typeof attributes.sublimation_count === 'number'
              ? attributes.sublimation_count + 1
              : Number(attributes.sublimation_count ?? 0) + 1 || 1,
          last_sublimation_at: input.nowISO,
        };

  return {
    attributes: nextAttributes,
    entries: [...retainedEntries, nextEntry],
  };
};
