import { buildStructuredJsonInstructionFromZodSchema } from '@mahoshojo/ai-core/structured-json';
import type {
  HostedGenerationRouteId,
  HostedJsonGenerationRouteId,
} from '@mahoshojo/contracts/desktop-cloud';
import {
  compactQuestionnaireAnswerItems,
  type QuestionnaireAnswerItem,
} from '@mahoshojo/domain/questionnaire';
import { buildGeneralCharacterCardFromMarkdown } from '@mahoshojo/domain/markdown-card';
import {
  buildQuestionnaireGenerationRequestBody,
  type QuestionnaireSelection,
} from '@mahoshojo/domain/questionnaire-selection';
import type { JsonValue } from '@mahoshojo/contracts/json-value';

import type { DesktopAiExecutionOptions } from '../../platform/desktop-ai-execution';
import {
  executeDesktopGeneration,
  GenerationTransportError,
  type DesktopDirectGenerationConfig,
  type DesktopDirectStreamGenerationConfig,
  type DesktopExecutionMode,
  type DesktopGenerationFamily,
  type DesktopGenerationIntent,
  type DesktopGenerationOutcome,
  type GenerationResultCardData,
} from '../generation/executor';

/** Desktop 双执行位置：本机直连（local/remote）与服务器托管（流式/非流式）。 */
export type QuestionnaireExecutionMode = DesktopExecutionMode;

export type QuestionnaireGenerationIntent = DesktopGenerationIntent;

/** hosted 生成请求所需的问卷语义输入；direct 通路忽略。 */
export interface QuestionnaireHostedRequestInput {
  /** 当前选择集；请求字段投影统一走 domain `buildQuestionnaireGenerationRequestBody`。 */
  selections: readonly QuestionnaireSelection[];
  allowNativeSignature: boolean;
}

export interface QuestionnaireGenerationInput {
  answers: QuestionnaireAnswerItem[];
  language: string;
  loreText: string;
  hosted?: QuestionnaireHostedRequestInput;
}

/**
 * 已校验结果卡数据：结构化 schema 字段 + 服务端透传字段
 * （templateId/userAnswers/signature/arena_history 等），或流式 Markdown
 * 构造的通用角色卡（cardKind === 'general'）。
 */
export type QuestionnaireResultCardData = GenerationResultCardData;

export type QuestionnaireCardKind<TStructuredKind extends string = string> = TStructuredKind | 'general';

export type QuestionnaireGenerationOutcome<TStructuredKind extends string = string> =
  DesktopGenerationOutcome<QuestionnaireCardKind<TStructuredKind>>;

/**
 * 生成通路/流协议的包装错误基类：保留已收到的正文供 UI 与草稿恢复使用。
 * 各家族可派生自有错误类（error.name 区分），instanceof 判定走本基类
 * （`GenerationTransportError` 的上游实现 D5.1-G2 起在通用执行器）。
 */
export class QuestionnaireGenerationError extends GenerationTransportError {
  constructor(rawText: string, cause: unknown) {
    super(rawText, cause);
    this.name = 'QuestionnaireGenerationError';
  }
}

type StructuredSchema = Parameters<typeof buildStructuredJsonInstructionFromZodSchema>[0];

/** direct 通路的结构化生成配置：与 ai-core 的 `<family>GenerationConfig` 同形。 */
export type QuestionnaireStructuredConfig = DesktopDirectGenerationConfig<QuestionnaireGenerationInput>;

export type QuestionnaireStreamConfig = DesktopDirectStreamGenerationConfig<QuestionnaireGenerationInput>;

/**
 * 问卷生成家族描述符（D5.1-G1）：通路编排、取消语义、错误投影与草稿
 * 契约对 `/details` 与 `/canshou` 完全一致，家族差异集中在结构化配置、
 * 结果卡构造/归一化、hosted 路由与默认名。执行实现 D5.1-G2 起在
 * `features/generation/executor.ts` 通用核。
 */
export interface QuestionnaireGenerationFamily<
  TIntent extends QuestionnaireGenerationIntent = QuestionnaireGenerationIntent,
  TStructuredKind extends string = string,
> {
  /** 结构化结果卡的 kind 标识（direct 非流式与 hosted-json 通路产出）。 */
  structuredCardKind: TStructuredKind;
  /** hosted 流式（SSE）与非流式（JSON）路由标识。 */
  streamRouteId: HostedGenerationRouteId;
  jsonRouteId: HostedJsonGenerationRouteId;
  /** 流式 Markdown → 通用角色卡的默认名；fallbackName 缺省则只用正文标题。 */
  streamCardDefaultName: string;
  streamCardFallbackName?(input: QuestionnaireGenerationInput): string | undefined;
  /** direct 通路的结构化生成配置（system prompt/schema/temperature/promptBuilder）。 */
  createStructuredConfig(intent: TIntent): QuestionnaireStructuredConfig;
  /** direct Markdown 流式配置：复用 Web 的问卷、设定与语言提示词。 */
  createDirectStreamConfig?(intent: TIntent, input: QuestionnaireGenerationInput): QuestionnaireStreamConfig;
  /** 结构化结果 → 未签名结果卡（direct 通路产出）。 */
  buildStructuredCard(data: unknown, answers: readonly QuestionnaireAnswerItem[]): QuestionnaireResultCardData;
  /** hosted JSON 响应 `data` → 结构化结果卡（schema 校验 + 透传字段）。 */
  normalizeStructuredCard(value: unknown): QuestionnaireResultCardData;
  /** 通路/协议错误包装：保留已收正文。 */
  createError(rawText: string, cause: unknown): QuestionnaireGenerationError;
}

/**
 * hosted JSON 响应 `data` → 结构化结果卡的归一化器工厂：
 * schema 校验核心字段，`passthroughKeys` 中的已知透传字段按原样保留。
 */
export const createStructuredCardNormalizer = (
  schema: StructuredSchema,
  passthroughKeys: readonly string[],
): ((value: unknown) => QuestionnaireResultCardData) =>
  (value: unknown): QuestionnaireResultCardData => {
    if (!isRecord(value)) throw new Error('生成结果不是角色卡对象。');
    const parsed = schema.parse(value) as Record<string, unknown>;
    const card: QuestionnaireResultCardData = { ...parsed };
    for (const key of passthroughKeys) {
      if (value[key] !== undefined) card[key] = value[key];
    }
    return card;
  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const buildHostedBody = (input: QuestionnaireGenerationInput): Record<string, JsonValue> => {
  if (!input.hosted) {
    throw new Error('服务器执行需要问卷请求字段。');
  }
  // 业务请求体与 Web 各问卷页共用同一组装器（D5.1a-r1 对拍基准）；
  // Desktop 宿主无 customProvider 等附加字段。
  return buildQuestionnaireGenerationRequestBody({
    answers: input.answers,
    selections: input.hosted.selections,
    allowNativeSignature: input.hosted.allowNativeSignature,
    language: input.language,
  }) as unknown as Record<string, JsonValue>;
};

/**
 * 问卷家族 → 通用执行家族适配（D5.1-G2）：输入校验（非空答案）、
 * hosted 请求体组装、流式 Markdown → 通用角色卡（附问卷回答记录）为
 * 问卷族共有语义；其余字段逐名映射。
 */
const adaptQuestionnaireFamily = <
  TIntent extends QuestionnaireGenerationIntent,
  TStructuredKind extends string,
>(
  family: QuestionnaireGenerationFamily<TIntent, TStructuredKind>,
): DesktopGenerationFamily<QuestionnaireGenerationInput, TIntent, QuestionnaireCardKind<TStructuredKind>> => ({
  validateInput: (input) => {
    if (input.answers.length === 0) throw new Error('请先填写问卷。');
  },
  streamRouteId: family.streamRouteId,
  jsonRouteId: family.jsonRouteId,
  buildHostedBody,
  createDirectConfig: (intent) => family.createStructuredConfig(intent),
  ...(family.createDirectStreamConfig
    ? { createDirectStreamConfig: (intent: TIntent, input: QuestionnaireGenerationInput) => family.createDirectStreamConfig!(intent, input) }
    : {}),
  buildStructuredCard: (data, input) => ({
    card: family.buildStructuredCard(data, input.answers),
    cardKind: family.structuredCardKind,
  }),
  buildStreamCard: (markdown, input) => {
    const { card } = buildGeneralCharacterCardFromMarkdown({
      markdown,
      fallbackName: family.streamCardFallbackName?.(input),
      defaultName: family.streamCardDefaultName,
    });
    return {
      card: { ...card, userAnswers: compactQuestionnaireAnswerItems(input.answers) },
      cardKind: 'general',
    };
  },
  normalizeHostedJsonCard: (data) => ({
    card: family.normalizeStructuredCard(data),
    cardKind: family.structuredCardKind,
  }),
  createError: family.createError,
  cardNoun: '角色卡',
});

/** 单次显式意图：冻结输入，只执行一次；解析修复仅在本地进行。 */
export const executeQuestionnaireGeneration = async <
  TIntent extends QuestionnaireGenerationIntent,
  TStructuredKind extends string,
>(
  family: QuestionnaireGenerationFamily<TIntent, TStructuredKind>,
  options: DesktopAiExecutionOptions,
  input: QuestionnaireGenerationInput,
  intent: TIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
): Promise<QuestionnaireGenerationOutcome<TStructuredKind>> =>
  executeDesktopGeneration(adaptQuestionnaireFamily(family), options, input, intent, signal, onPartialText);
