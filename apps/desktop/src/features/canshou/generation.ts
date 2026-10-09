import {
  buildCanshouStreamPrompt,
  buildUnsignedCanshouCard,
  CANSHOU_GENERATION_SCHEMA,
  createCanshouGenerationConfig,
  type CanshouGeneratedData,
} from '@mahoshojo/ai-core/canshou-generation';
import { CANSHOU_LORE } from '@mahoshojo/domain/canshou-lore';

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
 * /canshou 生成绑定（D5.1-G1）：通路编排、取消与错误投影与 /details 共用
 * `features/questionnaire/generation.ts`；本模块只保留残兽家族的 schema/
 * 卡片构造/hosted 路由绑定。
 */
export type CanshouExecutionMode = QuestionnaireExecutionMode;

/** 残兽意图无家族附加字段（lore 为内嵌常量，无需像 details 那样注入 flowers）。 */
export type CanshouGenerationIntent = QuestionnaireGenerationIntent;

/** hosted 生成请求所需的问卷语义输入；direct 通路忽略。 */
export type CanshouHostedRequestInput = QuestionnaireHostedRequestInput;

export type CanshouGenerationInput = QuestionnaireGenerationInput;

export type CanshouResultCardKind = 'canshou' | 'general';

/**
 * 已校验结果卡数据。
 * - `canshou`：`CANSHOU_GENERATION_SCHEMA` 字段 + 服务端透传字段
 *   （templateId/userAnswers/signature 等）；
 * - `general`：流式 Markdown 构造的通用角色卡。
 */
export type CanshouResultCardData = QuestionnaireResultCardData;

export type CanshouGenerationOutcome = QuestionnaireGenerationOutcome<'canshou'>;

export class CanshouGenerationError extends QuestionnaireGenerationError {
  constructor(rawText: string, cause: unknown) {
    super(rawText, cause);
    this.name = 'CanshouGenerationError';
  }
}

/** 服务端 `data` 中按原样保留的透传字段（hosted canshou 仅产出这三类）。 */
const CANSHOU_CARD_PASSTHROUGH_KEYS = [
  'templateId',
  'userAnswers',
  'signature',
] as const;

/** 服务端 `data` → 残兽结构化卡：schema 校验核心字段，已知透传字段按原样保留。 */
export const normalizeCanshouResultCard = createStructuredCardNormalizer(
  CANSHOU_GENERATION_SCHEMA,
  CANSHOU_CARD_PASSTHROUGH_KEYS,
);

const CANSHOU_GENERATION_FAMILY: QuestionnaireGenerationFamily<CanshouGenerationIntent, 'canshou'> = {
  structuredCardKind: 'canshou',
  streamRouteId: 'generate-canshou-stream',
  jsonRouteId: 'generate-canshou',
  streamCardDefaultName: '残兽',
  // 与 Web `CanshouPage` 一致：流式卡不提供 fallbackName，只用正文标题/默认名。
  createStructuredConfig: () => createCanshouGenerationConfig(CANSHOU_LORE),
  createDirectStreamConfig: () => ({
    systemPrompt: '',
    temperature: 0.8,
    promptBuilder: (input) => buildCanshouStreamPrompt({
      answers: input.answers,
      questionnairesLore: input.loreText,
      canshouLore: CANSHOU_LORE,
      language: input.language,
    }),
  }),
  buildStructuredCard: (data, answers) =>
    buildUnsignedCanshouCard(data as CanshouGeneratedData, [...answers]),
  normalizeStructuredCard: normalizeCanshouResultCard,
  createError: (rawText, cause) => new CanshouGenerationError(rawText, cause),
};

/** 单次显式意图：冻结输入，只执行一次；解析修复仅在本地进行。 */
export const executeCanshouGeneration = (
  options: DesktopAiExecutionOptions,
  input: CanshouGenerationInput,
  intent: CanshouGenerationIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
): Promise<CanshouGenerationOutcome> =>
  executeQuestionnaireGeneration(CANSHOU_GENERATION_FAMILY, options, input, intent, signal, onPartialText);
