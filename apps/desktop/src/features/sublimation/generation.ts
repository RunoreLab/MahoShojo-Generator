import { buildQuestionnaireGenerationRequestFields, type QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';
import { parseSublimationLoreSelections, sublimationLoreSelections, sublimationLoreText, sublimationLoreMetadata } from './lore-selection';
import {
  buildSublimationStreamCore,
  createSublimationGenerationCore,
  getSublimationSchemaKeys,
  normalizeGeneratedSublimationAnswers,
  SUBLIMATION_FIELDS_TO_PRESERVE_MAX,
  SUBLIMATION_NARRATIVE_HISTORY_MAX_CHARS,
  SUBLIMATION_USER_GUIDANCE_MAX_CHARS,
  type SublimationAiResult,
} from '@mahoshojo/ai-core/sublimation-generation';
import { looksLikeTrivialEmptyOutput } from '@mahoshojo/ai-core/stream-events';
import { SafeJsonValueSchema, type JsonValue } from '@mahoshojo/contracts/json-value';
import { parseDataCardByTemplate } from '@mahoshojo/domain/data-card-schemas';
import {
  assertSublimationHistoryRetentionSupported,
  assertSublimationCurrentStateWriteSupported,
  buildFinalSublimationData,
  convertSublimationCharacterCard,
  inferSublimationSourceTemplate,
  type ArenaHistoryRetentionStrategy,
  type SublimationCharacterTemplate,
  type SublimationSourceTemplate,
} from '@mahoshojo/domain/sublimation';
import { buildStreamedSublimationResultCard } from '@mahoshojo/domain/sublimation-stream-result';
import magicalQuestionnaire from '../../../../../content/questionnaires/presets/magical-girl-default.json';
import canshouQuestionnaire from '../../../../../content/questionnaires/presets/canshou-default.json';
import type { DesktopAiExecutionOptions } from '../../platform/desktop-ai-execution';
import {
  executeDesktopGeneration,
  GenerationTransportError,
  type DesktopExecutionMode,
  type DesktopGenerationFamily,
  type DesktopGenerationIntent,
  type DesktopGenerationOutcome,
  type GenerationResultCardData,
} from '../generation/executor';

export type SublimationExecutionMode = DesktopExecutionMode;
export type SublimationGenerationIntent = DesktopGenerationIntent;
export type SublimationCardKind = SublimationCharacterTemplate;
export type SublimationResultCardData = GenerationResultCardData;
export type SublimationGenerationOutcome = DesktopGenerationOutcome<SublimationCardKind>;
export interface SublimationGenerationInput {
  originalData: Record<string, unknown>;
  targetTemplate: SublimationCharacterTemplate;
  sourceTemplate?: SublimationSourceTemplate;
  language: string;
  fieldsToPreserve: string[];
  userGuidance: string;
  narrativeHistory: string;
  loreText: string;
  selectedQuestionnaires?: QuestionnaireSelection[];
  allowReshapeNames: boolean;
  isDowngrade?: boolean;
  readArenaHistory: boolean;
  writeArenaHistory: boolean;
  readCurrentState: boolean;
  writeCurrentState: boolean;
  arenaHistoryRetentionStrategy: ArenaHistoryRetentionStrategy;
  /** 可注入默认题干；缺省使用与 Web 同一 content 权威资产，完全离线。 */
  defaultQuestions?: { magicalGirl: string[]; canshou: string[] };
}

export class SublimationGenerationError extends GenerationTransportError {
  constructor(rawText: string, cause: unknown) {
    super(rawText, cause);
    this.name = 'SublimationGenerationError';
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const isSublimationCardKind = (value: unknown): value is SublimationCardKind =>
  value === 'magical-girl' || value === 'canshou' || value === 'general';
const sourceKind = (value: unknown): value is SublimationSourceTemplate =>
  isSublimationCardKind(value) || value === 'scenario' || value === 'general-scenario' || value === 'unknown';
const DEFAULT_QUESTIONS = {
  magicalGirl: magicalQuestionnaire.questions.map((question) => question.question),
  canshou: canshouQuestionnaire.questions.map((question) => question.question),
};

/** 只做领域转换，不使用空白卡兜底吞掉原文；警告由页面原样展示。 */
export const prepareSublimationInput = (input: SublimationGenerationInput) => {
  const sourceTemplate = input.sourceTemplate ?? inferSublimationSourceTemplate(input.originalData);
  const converted = convertSublimationCharacterCard(input.originalData, input.targetTemplate, sourceTemplate);
  return { sourceTemplate, baseOutputData: converted.data, conversionWarnings: converted.warnings };
};

const stateOptions = (input: SublimationGenerationInput) => ({
  readArenaHistory: input.readArenaHistory,
  writeArenaHistory: input.writeArenaHistory,
  readCurrentState: input.readCurrentState,
  writeCurrentState: input.writeCurrentState,
});
const coreConfig = (input: SublimationGenerationInput) => createSublimationGenerationCore({
  ...prepareSublimationInput(input),
  originalData: input.originalData,
  targetTemplate: input.targetTemplate,
  language: input.language,
  userGuidance: input.userGuidance || null,
  narrativeHistory: input.narrativeHistory || null,
  loreText: sublimationLoreText(input) || null,
  fieldsToPreserve: input.fieldsToPreserve,
  allowReshapeNames: input.allowReshapeNames,
  defaultQuestions: input.defaultQuestions ?? DEFAULT_QUESTIONS,
  stateOptions: stateOptions(input),
});

export const stripSublimationSignature = (card: Record<string, unknown>): void => {
  delete card.signature;
  if (record(card.metadata)) delete card.metadata.signature;
};

/** 校验与返回分开：schema 的默认值/裁剪不能改动服务器签名正文或既有扩展。 */
export const validateSublimationCard = (kind: SublimationCardKind, value: unknown): SublimationResultCardData => {
  if (!isSublimationCardKind(kind) || !record(value) || !SafeJsonValueSchema.safeParse(value).success) {
    throw new Error('升华结果数据卡损坏');
  }
  const expectedTemplate = kind === 'general' ? '通用角色'
    : kind === 'canshou' ? '魔法少女/心之花/残兽（问卷生成）' : '魔法少女/心之花/魔法少女（问卷生成）';
  if (value.templateId !== expectedTemplate) throw new Error('升华结果模板不一致');
  // 只校验目标模板的设定字段。原卡历史、扩展及旧版状态保持原样，不能读即迁移。
  const keys = [...getSublimationSchemaKeys(kind, true), 'templateId'];
  const projection = Object.fromEntries(Object.entries(value).filter(([key]) => keys.includes(key) && key !== 'current_state'));
  parseDataCardByTemplate(kind, projection);
  if ('signature' in value && typeof value.signature !== 'string') throw new Error('升华结果签名字段损坏');
  return clone(value);
};

const CONTROL_FIELDS = [
  'language', 'userGuidance', 'narrativeHistory', 'fieldsToPreserve', 'isDowngrade',
  'allowReshapeNames', 'customProvider', 'targetTemplate', 'sourceTemplate',
  'readArenaHistory', 'writeArenaHistory', 'readCurrentState', 'writeCurrentState',
  'arenaHistoryRetentionStrategy', 'questionnaireSelections', 'questionnaires',
];

const validateInput = (input: SublimationGenerationInput, intent: SublimationGenerationIntent): void => {
  if (!record(input.originalData) || !Object.keys(input.originalData).length
    || !SafeJsonValueSchema.safeParse(input.originalData).success) throw new Error('请先选择有效的原始数据卡。');
  if (!isSublimationCardKind(input.targetTemplate)
    || (input.sourceTemplate !== undefined && !sourceKind(input.sourceTemplate))) throw new Error('不支持的升华模板。');
  if (typeof input.language !== 'string' || !input.language.trim()
    || !['userGuidance', 'narrativeHistory', 'loreText'].every((key) => typeof input[key as keyof SublimationGenerationInput] === 'string')
    || !['readArenaHistory', 'writeArenaHistory', 'readCurrentState', 'writeCurrentState', 'allowReshapeNames'].every((key) => typeof input[key as keyof SublimationGenerationInput] === 'boolean')
    || !['keep-all', 'keep-sublimation-only', 'reset-all'].includes(input.arenaHistoryRetentionStrategy)
    || (input.isDowngrade !== undefined && typeof input.isDowngrade !== 'boolean')) throw new Error('升华输入选项损坏。');
  if (!Array.isArray(input.fieldsToPreserve)
    || input.fieldsToPreserve.length > SUBLIMATION_FIELDS_TO_PRESERVE_MAX
    || !input.fieldsToPreserve.every((key) => typeof key === 'string' && getSublimationSchemaKeys(input.targetTemplate, input.allowReshapeNames).includes(key))) {
    throw new Error('保留字段与目标模板不一致，请重新选择。');
  }
  if (input.defaultQuestions !== undefined && (!record(input.defaultQuestions)
    || ![input.defaultQuestions.magicalGirl, input.defaultQuestions.canshou].every((questions) => Array.isArray(questions) && questions.every((question) => typeof question === 'string')))) {
    throw new Error('默认问卷题干损坏。');
  }
  const streaming = intent.mode === 'hosted-stream' || (intent.mode !== 'hosted-json' && intent.generationMode === 'stream');
  // 服务器现有输入上限：明确拒绝，不截断用户原文后派发。
  if (input.userGuidance.length > SUBLIMATION_USER_GUIDANCE_MAX_CHARS) throw new Error(`成长引导超过 ${SUBLIMATION_USER_GUIDANCE_MAX_CHARS} 字，请精简后重试。`);
  if (streaming && input.narrativeHistory.length > SUBLIMATION_NARRATIVE_HISTORY_MAX_CHARS) throw new Error(`流式叙事历史超过 ${SUBLIMATION_NARRATIVE_HISTORY_MAX_CHARS} 字，请精简或使用非流式生成。`);
  if (intent.mode.startsWith('hosted-')) {
    const collision = CONTROL_FIELDS.find((key) => Object.hasOwn(input.originalData, key));
    if (collision) throw new Error(`原卡字段 ${collision} 与服务器请求控制字段冲突；请使用客户端执行以完整保留原卡。`);
  }
  if (!streaming && input.writeCurrentState) assertSublimationCurrentStateWriteSupported(input.originalData.current_state);
  if (input.writeArenaHistory) assertSublimationHistoryRetentionSupported(input.originalData.arena_history, input.arenaHistoryRetentionStrategy);
  parseSublimationLoreSelections(input.selectedQuestionnaires);
  prepareSublimationInput(input);
};

const buildHostedBody = (input: SublimationGenerationInput): Record<string, JsonValue> => ({
  ...clone(input.originalData) as Record<string, JsonValue>,
  language: input.language,
  userGuidance: input.userGuidance,
  narrativeHistory: input.narrativeHistory,
  fieldsToPreserve: input.fieldsToPreserve,
  targetTemplate: input.targetTemplate,
  sourceTemplate: input.sourceTemplate ?? inferSublimationSourceTemplate(input.originalData),
  allowReshapeNames: input.allowReshapeNames,
  isDowngrade: input.isDowngrade ?? false,
  ...stateOptions(input),
  arenaHistoryRetentionStrategy: input.arenaHistoryRetentionStrategy,
  ...buildQuestionnaireGenerationRequestFields(sublimationLoreSelections(input)) as unknown as Record<string, JsonValue>,
});

const SUBLIMATION_FAMILY: DesktopGenerationFamily<SublimationGenerationInput, SublimationGenerationIntent, SublimationCardKind> = {
  validateInput,
  streamRouteId: 'generate-sublimation-stream',
  jsonRouteId: 'generate-sublimation',
  buildHostedBody,
  createDirectConfig: (_intent, input) => coreConfig(input),
  createDirectStreamConfig: (_intent, input) => {
    const config = buildSublimationStreamCore({
      ...input, loreText: sublimationLoreText(input), stateOptions: stateOptions(input), sourceTemplate: input.sourceTemplate ?? inferSublimationSourceTemplate(input.originalData),
      isDowngrade: input.isDowngrade ?? false,
    });
    return { systemPrompt: '', temperature: config.temperature, promptBuilder: () => config.prompt };
  },
  buildStructuredCard: (data, input) => {
    const result = data as SublimationAiResult;
    const updated = { ...result.updatedCharacterData };
    if (updated.userAnswers !== undefined) {
      updated.userAnswers = normalizeGeneratedSublimationAnswers(updated.userAnswers, input.originalData.userAnswers, input.targetTemplate, input.defaultQuestions ?? DEFAULT_QUESTIONS);
    }
    const prepared = prepareSublimationInput(input);
    const card = buildFinalSublimationData({
      sourceTemplate: prepared.sourceTemplate,
      originalCharacterData: input.originalData,
      baseOutputData: prepared.baseOutputData,
      updatedDataFromAI: updated,
      targetTemplate: input.targetTemplate,
      allowReshapeNames: input.allowReshapeNames,
      writeArenaHistory: input.writeArenaHistory,
      writeCurrentState: input.writeCurrentState,
      arenaHistoryRetentionStrategy: input.arenaHistoryRetentionStrategy,
      sublimationEvent: result.sublimationEvent,
      finalUserGuidance: input.userGuidance || null,
      hasNarrativeHistory: Boolean(input.narrativeHistory),
      ...sublimationLoreMetadata(input),
      isNative: false,
    });
    stripSublimationSignature(card);
    return { card: validateSublimationCard(input.targetTemplate, card), cardKind: input.targetTemplate };
  },
  buildStreamCard: (markdown, input) => {
    if (looksLikeTrivialEmptyOutput(markdown)) throw new SublimationGenerationError(markdown, new Error('未收到有效升华正文'));
    const card = buildStreamedSublimationResultCard({
      markdown, originalCharacterData: input.originalData, defaultName: '升华角色',
      writeArenaHistory: input.writeArenaHistory,
      retentionStrategy: input.arenaHistoryRetentionStrategy,
      finalUserGuidance: input.userGuidance,
      hasNarrativeHistory: Boolean(input.narrativeHistory),
      ...sublimationLoreMetadata(input),
      isNative: false,
    });
    stripSublimationSignature(card);
    return { card: validateSublimationCard('general', card), cardKind: 'general' };
  },
  normalizeHostedJsonCard: (data, input) => {
    if (!record(data) || data.targetTemplate !== input.targetTemplate
      || !Array.isArray(data.unchangedFields) || !data.unchangedFields.every((field) => typeof field === 'string')) throw new Error('服务器升华响应损坏');
    return { card: validateSublimationCard(input.targetTemplate, data.sublimatedData), cardKind: input.targetTemplate };
  },
  createError: (rawText, cause) => new SublimationGenerationError(rawText, cause),
  cardNoun: '升华角色卡',
};

export const executeSublimationGeneration = (
  options: DesktopAiExecutionOptions,
  input: SublimationGenerationInput,
  intent: SublimationGenerationIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
): Promise<SublimationGenerationOutcome> =>
  executeDesktopGeneration(SUBLIMATION_FAMILY, options, input, intent, signal, onPartialText);
