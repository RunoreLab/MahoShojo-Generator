import type { CardRepository } from '@mahoshojo/local-library/repository';
import {
  DesktopGenerationSession,
  type GenerationDraftStorage,
  type GenerationSessionFamily,
  type GenerationSessionState,
  type StoredGenerationDraft,
} from '../generation/session';
import type { GenerationExecutor } from '../generation/session';
import {
  executeScenarioGeneration,
  validateScenarioCard,
  type ScenarioCardKind,
  type ScenarioGenerationInput,
  type ScenarioGenerationIntent,
  type ScenarioGenerationOutcome,
  type ScenarioResultCardData,
} from './generation';

export const SCENARIO_DRAFT_KEY = 'mahoshojo.desktop.scenario.draft.v1';

/**
 * /scenario 草稿（D5.1-G2）：字段名与 Web `SCENARIO_PREFERENCE_KEY` +
 * `scenario-page-draft` 持久化面一致（answers/fieldsToKeepEmpty/
 * scenarioTitleHint/generationMode/selectedLanguage/isAdvancedVisible）。
 */
export interface ScenarioDraft {
  answers: Record<string, string>;
  fieldsToKeepEmpty: string[];
  scenarioTitleHint: string;
  generationMode: 'stream' | 'non-stream';
  selectedLanguage: string;
  isAdvancedVisible?: boolean;
}

export type ScenarioDraftStorage = GenerationDraftStorage;

export type ScenarioSessionState = GenerationSessionState<ScenarioDraft, ScenarioCardKind>;

export type ScenarioExecutor = GenerationExecutor<ScenarioGenerationInput, ScenarioGenerationIntent, ScenarioCardKind>;

export const SCENARIO_DRAFT_DEFAULT_LANGUAGE = 'zh-CN';

type StoredScenarioDraft = StoredGenerationDraft<ScenarioDraft, ScenarioCardKind>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isCardKind = (value: unknown): value is ScenarioCardKind =>
  value === 'scenario' || value === 'general-scenario';

const trimmedOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const SCENARIO_SESSION_FAMILY: GenerationSessionFamily<
  ScenarioDraft,
  ScenarioGenerationInput,
  ScenarioGenerationIntent,
  ScenarioCardKind
> = {
  draftKey: SCENARIO_DRAFT_KEY,
  defaultCardKind: 'scenario',
  parseDraftFields: (value) => {
    if (!isRecord(value.answers)
      || !Object.values(value.answers).every((item) => typeof item === 'string')
      || !Array.isArray(value.fieldsToKeepEmpty)
      || !value.fieldsToKeepEmpty.every((item) => typeof item === 'string')
      || typeof value.scenarioTitleHint !== 'string'
      || (value.generationMode !== 'stream' && value.generationMode !== 'non-stream')
      || typeof value.selectedLanguage !== 'string') {
      throw new Error('草稿版本不受支持或内容损坏');
    }
    const draft: ScenarioDraft = {
      answers: { ...(value.answers as Record<string, string>) },
      fieldsToKeepEmpty: [...(value.fieldsToKeepEmpty as string[])],
      scenarioTitleHint: value.scenarioTitleHint,
      generationMode: value.generationMode,
      selectedLanguage: value.selectedLanguage,
    };
    if (value.isAdvancedVisible === true) draft.isAdvancedVisible = true;
    return draft;
  },
  normalizeStoredCardKind: (value) => (isCardKind(value) ? value : 'scenario'),
  isResidueDraft: (draft) => {
    if (Object.values(draft.answers).some((item) => item.trim() !== '')) return false;
    if (draft.scenarioTitleHint.trim() !== '') return false;
    const output = draft.output;
    return output === undefined
      || (output.phase === 'idle' && output.card === null && output.rawText === '');
  },
  validateCard: validateScenarioCard,
  cardTypeOf: () => 'scenario',
  titleOf: (_kind, card) => trimmedOr(card.title, trimmedOr(card.name, '未命名情景')),
  // hosted-json 结构化卡由服务器签名：如实记录原始签名串（trim 只用于判空）。
  // 其余通路（direct/hosted-stream/general-scenario）永不签名。
  signatureFrom: (kind, card) =>
    kind === 'scenario' && isRecord(card.metadata)
      && typeof card.metadata.signature === 'string' && card.metadata.signature.trim()
      ? card.metadata.signature
      : undefined,
  stripSignature: (card) => {
    delete card.signature;
    if (isRecord(card.metadata)) delete (card.metadata as Record<string, unknown>).signature;
  },
  executeGeneration: executeScenarioGeneration,
};

/**
 * /scenario 会话：草稿闸门、取消/uncertain 投影与保存 provenance 走
 * `DesktopGenerationSession` 通用核；本类只注入情景生成家族参数。
 */
export class ScenarioSession extends DesktopGenerationSession<
  ScenarioDraft,
  ScenarioGenerationInput,
  ScenarioGenerationIntent,
  ScenarioCardKind
> {
  constructor(dependencies: {
    storage: ScenarioDraftStorage;
    repository: CardRepository;
    initialDraft: ScenarioDraft;
    execute?: ScenarioExecutor;
    requestId?: () => string;
  }) {
    super(SCENARIO_SESSION_FAMILY, dependencies);
  }
}

export type {
  ScenarioCardKind,
  ScenarioGenerationInput,
  ScenarioGenerationIntent,
  ScenarioGenerationOutcome,
  ScenarioResultCardData,
  StoredScenarioDraft,
};
