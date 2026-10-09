import { readPageDraftState } from '@mahoshojo/ui-web/client';
import { clearPageDraft, type StoredPageDraft, writePageDraft } from '@/lib/page-draft-storage';

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

export const clearScenarioPageDraft = (): boolean => clearPageDraft(SCENARIO_PAGE_DRAFT_KEY);

export type ScenarioPageDraftReadResult =
  | { status: 'empty'; stored: null }
  | { status: 'restored'; stored: StoredPageDraft<ScenarioPageDraftPayload> }
  | { status: 'unreadable'; stored: null };

/** 本页保留旧草稿原文，损坏、未来版本及过期记录均不静默删除或覆盖。 */
export const readScenarioPageDraftState = (): ScenarioPageDraftReadResult => {
  const result = readPageDraftState<unknown>(SCENARIO_PAGE_DRAFT_KEY, { version: SCENARIO_PAGE_DRAFT_VERSION, ttlMs: SCENARIO_PAGE_DRAFT_TTL_MS });
  if (result.kind === 'missing') return { status: 'empty', stored: null };
  if (result.kind === 'blocked') return { status: 'unreadable', stored: null };
  try {
    const parsed = result.stored;
    if (!isPlainObject(parsed.payload)) return { status: 'unreadable', stored: null };
    const source = parsed.payload;
    if (!isPlainObject(source.answers) || !Object.values(source.answers).every((value) => typeof value === 'string') ||
      typeof source.scenarioTitleHint !== 'string' || !Array.isArray(source.fieldsToKeepEmpty) || !source.fieldsToKeepEmpty.every((value) => typeof value === 'string') ||
      typeof source.selectedLanguage !== 'string' || !['stream', 'non-stream'].includes(String(source.generationMode)) ||
      (source.isAdvancedVisible !== undefined && typeof source.isAdvancedVisible !== 'boolean') ||
      (source.generalScenarioDraftEdited !== undefined && typeof source.generalScenarioDraftEdited !== 'boolean') ||
      (source.generalScenarioDraft != null && (!isPlainObject(source.generalScenarioDraft) || typeof source.generalScenarioDraft.title !== 'string' || typeof source.generalScenarioDraft.content !== 'string'))) return { status: 'unreadable', stored: null };
    const payload = restoreScenarioPageDraft(source);
    if (!payload) return { status: 'empty', stored: null };
    return { status: 'restored', stored: { version: SCENARIO_PAGE_DRAFT_VERSION, updatedAt: parsed.updatedAt, payload } };
  } catch {
    return { status: 'unreadable', stored: null };
  }
};

export const readScenarioPageDraft = (): StoredPageDraft<ScenarioPageDraftPayload> | null => readScenarioPageDraftState().stored;

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
