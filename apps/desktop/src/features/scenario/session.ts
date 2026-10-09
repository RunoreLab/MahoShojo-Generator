import { parseDataCardByTemplate } from '@mahoshojo/domain/data-card-schemas';
import { deriveLocalDataCardIdV1, digestLocalCardPayloadV1 } from '@mahoshojo/local-library/digest';
import { LocalCardRecordV1Schema } from '@mahoshojo/local-library/record';
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
  /** 本机 Markdown 编辑稿独立于生成结果，旧 v1 缺省为空。 */
  generalScenarioDraft?: Record<string, unknown> | null;
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
    if (value.generalScenarioDraft === null) draft.generalScenarioDraft = null;
    else if (value.generalScenarioDraft !== undefined) {
      draft.generalScenarioDraft = parseDataCardByTemplate('general-scenario', value.generalScenarioDraft);
    }
    if (value.isAdvancedVisible === true) draft.isAdvancedVisible = true;
    return draft;
  },
  normalizeStoredCardKind: (value) => (isCardKind(value) ? value : 'scenario'),
  isResidueDraft: (draft) => {
    if (Object.values(draft.answers).some((item) => item.trim() !== '')) return false;
    if (draft.scenarioTitleHint.trim() !== '' || draft.generalScenarioDraft != null) return false;
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
  private readonly editorRepository: CardRepository;
  constructor(dependencies: {
    storage: ScenarioDraftStorage;
    repository: CardRepository;
    initialDraft: ScenarioDraft;
    execute?: ScenarioExecutor;
    requestId?: () => string;
  }) {
    super(SCENARIO_SESSION_FAMILY, dependencies);
    this.editorRepository = dependencies.repository;
  }
  /** 编辑产物与生成结果独立保存，始终未签名，不替换原始结果及其 provenance。 */
  async saveGeneralScenarioDraft(input: Record<string, unknown>): Promise<boolean> {
    const data = parseDataCardByTemplate('general-scenario', JSON.parse(JSON.stringify(input)));
    SCENARIO_SESSION_FAMILY.stripSignature(data);
    const digest = await digestLocalCardPayloadV1(data);
    const now = new Date().toISOString();
    const record = LocalCardRecordV1Schema.parse({
      id: deriveLocalDataCardIdV1(digest), schemaVersion: 1, storageLocation: 'local', cardType: 'scenario',
      title: trimmedOr(data.title, '未命名情景'), data, contentDigest: digest,
      provenance: { kind: 'unsigned', execution: 'edited' }, createdAt: now, updatedAt: now,
    });
    return 'written' in await this.editorRepository.putIfAbsent(record);
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
