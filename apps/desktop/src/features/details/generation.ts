import {
  buildUnsignedMagicalGirlDetailsCard,
  createMagicalGirlDetailsGenerationConfig,
  MAGICAL_GIRL_DETAILS_SCHEMA,
  type MagicalGirlDetailsGeneratedData,
} from '@mahoshojo/ai-core/magical-girl-details-generation';
import type { DesktopAiExecutionOptions } from '../../platform/desktop-ai-execution';
import {
  createStructuredCardNormalizer,
  executeQuestionnaireGeneration,
  QuestionnaireGenerationError,
  type QuestionnaireExecutionMode,
  type QuestionnaireGenerationFamily,
  type QuestionnaireGenerationInput,
  type QuestionnaireGenerationIntent,
  type QuestionnaireGenerationOutcome,
  type QuestionnaireHostedRequestInput,
  type QuestionnaireResultCardData,
} from '../questionnaire/generation';

/**
 * /details 生成绑定（D5.1-G1 泛化）：通路编排、取消与错误投影的通用实现
 * 在 `features/questionnaire/generation.ts`；本模块只保留 magical-girl 家族
 * 的 schema/卡片构造/路由绑定与既有导出面。
 */
export type DetailsExecutionMode = QuestionnaireExecutionMode;

export interface DetailsGenerationIntent extends QuestionnaireGenerationIntent {
  /** 每次生成随机抽取的花名/花语候选（注入 promptBuilder）。 */
  flowers: string;
}

/** hosted 生成请求所需的问卷语义输入；direct 通路忽略。 */
export type DetailsHostedRequestInput = QuestionnaireHostedRequestInput;

export type DetailsGenerationInput = QuestionnaireGenerationInput;

export type DetailsResultCardKind = 'magical-girl' | 'general';

/**
 * 已校验结果卡数据。
 * - `magical-girl`：`MAGICAL_GIRL_DETAILS_SCHEMA` 字段 + 服务端透传字段
 *   （templateId/userAnswers/signature/arena_history 等）；
 * - `general`：流式 Markdown 构造的通用角色卡。
 */
export type DetailsResultCardData = QuestionnaireResultCardData;

export type DetailsGenerationOutcome = QuestionnaireGenerationOutcome<'magical-girl'>;

export class DetailsGenerationError extends QuestionnaireGenerationError {
  constructor(rawText: string, cause: unknown) {
    super(rawText, cause);
    this.name = 'DetailsGenerationError';
  }
}

/** 服务端 `data` 中按原样保留的透传字段。 */
const HOSTED_CARD_PASSTHROUGH_KEYS = [
  'templateId',
  'userAnswers',
  'signature',
  'arena_history',
  'current_state',
  'creationInputs',
  'buildState',
] as const;

/** 服务端 `data` → 结构化卡：schema 校验核心字段，已知透传字段按原样保留。 */
export const normalizeMagicalGirlDetailsResultCard = createStructuredCardNormalizer(
  MAGICAL_GIRL_DETAILS_SCHEMA,
  HOSTED_CARD_PASSTHROUGH_KEYS,
);

const DETAILS_GENERATION_FAMILY: QuestionnaireGenerationFamily<DetailsGenerationIntent, 'magical-girl'> = {
  structuredCardKind: 'magical-girl',
  streamRouteId: 'generate-magical-girl-details-stream',
  jsonRouteId: 'generate-magical-girl-details',
  streamCardDefaultName: '魔法少女',
  streamCardFallbackName: (input) => input.answers[0]?.answer ?? '',
  createStructuredConfig: (intent) => createMagicalGirlDetailsGenerationConfig(() => intent.flowers),
  buildStructuredCard: (data, answers) =>
    buildUnsignedMagicalGirlDetailsCard(data as MagicalGirlDetailsGeneratedData, [...answers]),
  normalizeStructuredCard: normalizeMagicalGirlDetailsResultCard,
  createError: (rawText, cause) => new DetailsGenerationError(rawText, cause),
};

/** 单次显式意图：冻结输入，只执行一次；解析修复仅在本地进行。 */
export const executeDetailsGeneration = (
  options: DesktopAiExecutionOptions,
  input: DetailsGenerationInput,
  intent: DetailsGenerationIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
): Promise<DetailsGenerationOutcome> =>
  executeQuestionnaireGeneration(DETAILS_GENERATION_FAMILY, options, input, intent, signal, onPartialText);
