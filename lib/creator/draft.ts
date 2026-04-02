import {
  CREATOR_TEMPLATE_IDS,
  isCreatorStreamTemplate,
  type CreatorTemplateId,
} from './templates';

export type CreatorGenerationMode = 'stream' | 'non-stream';

export interface CreatorDraftPayload {
  version: 1;
  template: CreatorTemplateId;
  generationMode: CreatorGenerationMode;
  freeformBrief: string;
  selectedRuleIds: string[];
  primaryRuleId: string | null;
  ruleInputs: Record<string, Record<string, unknown>>;
  questionnairePresetIds?: string[];
  questionnaireAnswersByKey?: Record<string, string>;
  currentQuestionIndex?: number;
}

export const CREATOR_DRAFT_STORAGE_KEY = 'mahoshojo.creator-page.draft.v1';

interface CreatorDraftPayloadInput {
  template: CreatorTemplateId;
  generationMode: unknown;
  freeformBrief: unknown;
  selectedRuleIds: unknown;
  primaryRuleId: unknown;
  ruleInputs: unknown;
  questionnairePresetIds?: unknown;
  questionnaireAnswersByKey?: unknown;
  currentQuestionIndex?: unknown;
}

const readRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const isCreatorTemplateId = (value: unknown): value is CreatorTemplateId =>
  typeof value === 'string' &&
  (CREATOR_TEMPLATE_IDS as readonly string[]).includes(value);

const normalizeGenerationMode = (
  template: CreatorTemplateId,
  generationMode: unknown
): CreatorGenerationMode =>
  generationMode === 'stream' && isCreatorStreamTemplate(template)
    ? 'stream'
    : 'non-stream';

const normalizeSelectedRuleIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item, index, items) => item.length > 0 && items.indexOf(item) === index);
};

const normalizeRuleInputs = (
  value: unknown
): Record<string, Record<string, unknown>> => {
  const record = readRecord(value);

  return Object.entries(record).reduce<Record<string, Record<string, unknown>>>(
    (acc, [key, entryValue]) => {
      const normalizedKey = key.trim();
      if (!normalizedKey) {
        return acc;
      }

      if (
        typeof entryValue === 'object' &&
        entryValue !== null &&
        !Array.isArray(entryValue)
      ) {
        acc[normalizedKey] = entryValue as Record<string, unknown>;
      }

      return acc;
    },
    {}
  );
};

const normalizeAnswersByKey = (
  value: unknown
): Record<string, string> => {
  const record = readRecord(value);

  return Object.entries(record).reduce<Record<string, string>>((acc, [key, entryValue]) => {
    const normalizedKey = key.trim();
    if (!normalizedKey || typeof entryValue !== 'string') {
      return acc;
    }
    acc[normalizedKey] = entryValue;
    return acc;
  }, {});
};

export function buildCreatorDraftPayload(
  input: CreatorDraftPayloadInput
): CreatorDraftPayload {
  const selectedRuleIds = normalizeSelectedRuleIds(input.selectedRuleIds);
  const ruleInputs = normalizeRuleInputs(input.ruleInputs);
  const questionnairePresetIds = normalizeSelectedRuleIds(
    input.questionnairePresetIds
  );
  const questionnaireAnswersByKey = normalizeAnswersByKey(
    input.questionnaireAnswersByKey
  );
  const currentQuestionIndex =
    typeof input.currentQuestionIndex === 'number' &&
    Number.isInteger(input.currentQuestionIndex) &&
    input.currentQuestionIndex > 0
      ? input.currentQuestionIndex
      : 0;
  const primaryRuleId =
    typeof input.primaryRuleId === 'string' &&
    selectedRuleIds.includes(input.primaryRuleId)
      ? input.primaryRuleId
      : null;

  const payload: CreatorDraftPayload = {
    version: 1,
    template: input.template,
    generationMode: normalizeGenerationMode(input.template, input.generationMode),
    freeformBrief:
      typeof input.freeformBrief === 'string' ? input.freeformBrief : '',
    selectedRuleIds,
    primaryRuleId,
    ruleInputs,
  };

  if (questionnairePresetIds.length > 0) {
    payload.questionnairePresetIds = questionnairePresetIds;
  }
  if (Object.keys(questionnaireAnswersByKey).length > 0) {
    payload.questionnaireAnswersByKey = questionnaireAnswersByKey;
  }
  if (currentQuestionIndex > 0) {
    payload.currentQuestionIndex = currentQuestionIndex;
  }

  return payload;
}

export function parseCreatorDraftPayload(
  raw: string
): CreatorDraftPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const record = readRecord(parsed);
    if (!isCreatorTemplateId(record.template)) {
      return null;
    }

    return buildCreatorDraftPayload({
      template: record.template,
      generationMode: record.generationMode,
      freeformBrief: record.freeformBrief,
      selectedRuleIds: record.selectedRuleIds,
      primaryRuleId:
        typeof record.primaryRuleId === 'string' ? record.primaryRuleId : null,
      ruleInputs: record.ruleInputs,
      questionnairePresetIds: record.questionnairePresetIds,
      questionnaireAnswersByKey: record.questionnaireAnswersByKey,
      currentQuestionIndex: record.currentQuestionIndex,
    });
  } catch {
    return null;
  }
}
