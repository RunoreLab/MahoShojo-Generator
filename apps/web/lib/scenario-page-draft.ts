import { clearPageDraft, readPageDraft, type StoredPageDraft, writePageDraft } from '@/lib/page-draft-storage';

export const SCENARIO_PAGE_DRAFT_KEY = 'mahoshojo.scenario.page-draft.v1';
export const SCENARIO_PAGE_DRAFT_VERSION = 1;
export const SCENARIO_PAGE_DRAFT_TTL_MS = 1000 * 60 * 60 * 24 * 30;

type ScenarioGenerationMode = 'stream' | 'non-stream';

export type ScenarioPageDraftPayload = {
  answers: Record<string, string>;
  scenarioTitleHint: string;
  fieldsToKeepEmpty: string[];
  isAdvancedVisible: boolean;
  selectedLanguage: string;
  generationMode: ScenarioGenerationMode;
  generalScenarioDraft: Record<string, unknown> | null;
  generalScenarioDraftEdited: boolean;
};

type ScenarioPageDraftInput = {
  answers: Record<string, string>;
  scenarioTitleHint: string;
  fieldsToKeepEmpty: string[];
  isAdvancedVisible: boolean;
  selectedLanguage: string;
  generationMode: ScenarioGenerationMode;
  generalScenarioDraft: Record<string, unknown> | null;
  generalScenarioDraftEdited: boolean;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeAnswers = (value: unknown): Record<string, string> => {
  if (!isPlainObject(value)) return {};

  const answers: Record<string, string> = {};
  for (const [key, answer] of Object.entries(value)) {
    if (typeof key === 'string' && typeof answer === 'string' && answer.trim()) {
      answers[key] = answer;
    }
  }
  return answers;
};

const normalizeGeneralScenarioDraft = (value: unknown): Record<string, unknown> | null => {
  if (!isPlainObject(value)) return null;

  const nextDraft: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (typeof fieldValue === 'string' || Array.isArray(fieldValue) || isPlainObject(fieldValue) || typeof fieldValue === 'number' || typeof fieldValue === 'boolean' || fieldValue === null) {
      nextDraft[key] = fieldValue;
    }
  }

  return Object.keys(nextDraft).length > 0 ? nextDraft : null;
};

const normalizeScenarioPageDraftPayload = (input: unknown): ScenarioPageDraftPayload | null => {
  if (!isPlainObject(input)) return null;

  const answers = normalizeAnswers(input.answers);
  const scenarioTitleHint = typeof input.scenarioTitleHint === 'string' ? input.scenarioTitleHint.trim() : '';
  const fieldsToKeepEmpty = Array.isArray(input.fieldsToKeepEmpty)
    ? input.fieldsToKeepEmpty.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const isAdvancedVisible = input.isAdvancedVisible === true;
  const selectedLanguage = typeof input.selectedLanguage === 'string' && input.selectedLanguage.trim()
    ? input.selectedLanguage
    : 'zh-CN';
  const generationMode = input.generationMode === 'stream' ? 'stream' : 'non-stream';
  const generalScenarioDraft = normalizeGeneralScenarioDraft(input.generalScenarioDraft);
  const generalScenarioDraftEdited = input.generalScenarioDraftEdited === true;

  const hasMeaningfulContent =
    Object.keys(answers).length > 0 ||
    scenarioTitleHint.length > 0 ||
    fieldsToKeepEmpty.length > 0 ||
    isAdvancedVisible ||
    selectedLanguage !== 'zh-CN' ||
    generationMode !== 'non-stream' ||
    generalScenarioDraft !== null ||
    generalScenarioDraftEdited;

  if (!hasMeaningfulContent) return null;

  return {
    answers,
    scenarioTitleHint,
    fieldsToKeepEmpty,
    isAdvancedVisible,
    selectedLanguage,
    generationMode,
    generalScenarioDraft,
    generalScenarioDraftEdited,
  };
};

export const buildScenarioPageDraftPayload = (input: ScenarioPageDraftInput): ScenarioPageDraftPayload | null =>
  normalizeScenarioPageDraftPayload(input);

export const restoreScenarioPageDraft = (input: unknown): ScenarioPageDraftPayload | null =>
  normalizeScenarioPageDraftPayload(input);

export const clearScenarioPageDraft = () => {
  clearPageDraft(SCENARIO_PAGE_DRAFT_KEY);
};

export const readScenarioPageDraft = (): StoredPageDraft<ScenarioPageDraftPayload> | null => {
  const stored = readPageDraft<ScenarioPageDraftPayload>(SCENARIO_PAGE_DRAFT_KEY, {
    version: SCENARIO_PAGE_DRAFT_VERSION,
    ttlMs: SCENARIO_PAGE_DRAFT_TTL_MS,
  });

  if (!stored) return null;

  const payload = restoreScenarioPageDraft(stored.payload);
  if (!payload) {
    clearScenarioPageDraft();
    return null;
  }

  return {
    ...stored,
    payload,
  };
};

export const writeScenarioPageDraft = (input: ScenarioPageDraftInput): StoredPageDraft<ScenarioPageDraftPayload> | null => {
  const payload = buildScenarioPageDraftPayload(input);
  if (!payload) {
    clearScenarioPageDraft();
    return null;
  }

  return writePageDraft(SCENARIO_PAGE_DRAFT_KEY, payload, {
    version: SCENARIO_PAGE_DRAFT_VERSION,
  });
};
