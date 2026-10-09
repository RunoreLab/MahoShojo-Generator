import {
  buildScenarioStreamPrompt,
  createScenarioGenerationConfig,
  SCENARIO_GENERATION_SCHEMA,
  SCENARIO_STREAM_TEMPERATURE,
} from '@mahoshojo/ai-core/scenario-generation';
import { buildGeneralScenarioCardFromMarkdown } from '@mahoshojo/domain/markdown-card';
import { GENERAL_SCENARIO_TEMPLATE_ID } from '@mahoshojo/domain/data-cards';
import type { JsonValue } from '@mahoshojo/contracts/json-value';

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

/**
 * /scenario 情景生成绑定（D5.1-G2）：prompt 构造与 schema 走
 * `@mahoshojo/ai-core/scenario-generation` 共源核；通路编排/取消/uncertain
 * 走通用执行器。
 * 卡型两种：'scenario'（结构化，hosted-json 可由服务器签名）与
 * 'general-scenario'（direct/hosted 流式 Markdown 卡，永不签名）。
 */
export type ScenarioExecutionMode = DesktopExecutionMode;

export type ScenarioGenerationIntent = DesktopGenerationIntent;

/**
 * 情景生成输入：引导式回答 + 语言 + 留空字段 + 期望标题（direct/hosted
 * 两通路共用；`titleHint` 仅流式语义，非流式时传空串）。
 */
export interface ScenarioGenerationInput {
  answers: Record<string, string>;
  language: string;
  fieldsToKeepEmpty: string[];
  titleHint: string;
}

export type ScenarioCardKind = 'scenario' | 'general-scenario';

export type ScenarioResultCardData = GenerationResultCardData;

export type ScenarioGenerationOutcome = DesktopGenerationOutcome<ScenarioCardKind>;

export class ScenarioGenerationError extends GenerationTransportError {
  constructor(rawText: string, cause: unknown) {
    super(rawText, cause);
    this.name = 'ScenarioGenerationError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * 结构化情景卡归一化（direct/hosted-json 共用）：schema 校验核心字段，
 * metadata 只保留 `created_at`/`signature` 白名单键——服务器签名串原样
 * 保留（由会话层按通路归属 provenance），伪造的其余 metadata 字段被丢弃。
 * `createdAt` 仅当数据未带 `metadata.created_at` 时兜底（与 hosted 补
 * `created_at` 的口径一致）。
 */
export const normalizeScenarioResultCard = (
  data: unknown,
  createdAt: string,
): ScenarioResultCardData => {
  if (!isRecord(data)) throw new Error('情景数据损坏');
  const parsed = SCENARIO_GENERATION_SCHEMA.safeParse(data);
  if (!parsed.success) throw new Error('情景数据未通过结构化校验');
  const metadata = isRecord(data.metadata) ? data.metadata : {};
  const normalized: ScenarioResultCardData = {
    ...parsed.data,
    metadata: {
      created_at:
        typeof metadata.created_at === 'string' && metadata.created_at.trim()
          ? metadata.created_at
          : createdAt,
    },
  };
  if (typeof metadata.signature === 'string' && metadata.signature.trim()) {
    (normalized.metadata as Record<string, unknown>).signature = metadata.signature;
  }
  return normalized;
};

const buildHostedBody = (input: ScenarioGenerationInput): Record<string, JsonValue> => {
  const body: Record<string, JsonValue> = {
    answers: input.answers,
    language: input.language,
    fieldsToKeepEmpty: input.fieldsToKeepEmpty,
  };
  // titleHint 仅流式语义；非流式传空串时不下发（与 Web 请求面一致）。
  if (input.titleHint.trim()) body.titleHint = input.titleHint.trim();
  // customProvider 等凭据字段由 native 拒绝（renderer 不得注入）——不在这里出现。
  return body;
};

const SCENARIO_GENERATION_FAMILY: DesktopGenerationFamily<
  ScenarioGenerationInput,
  ScenarioGenerationIntent,
  ScenarioCardKind
> = {
  validateInput: (input) => {
    if (!Object.values(input.answers).some((value) => value.trim() !== '')) {
      throw new Error('请至少填写一个问题的回答。');
    }
  },
  streamRouteId: 'generate-scenario-stream',
  jsonRouteId: 'generate-scenario',
  buildHostedBody,
  createDirectConfig: (_intent, input) =>
    createScenarioGenerationConfig({
      answers: input.answers,
      language: input.language,
      fieldsToKeepEmpty: input.fieldsToKeepEmpty,
    }),
  createDirectStreamConfig: () => ({
    systemPrompt: '',
    temperature: SCENARIO_STREAM_TEMPERATURE,
    promptBuilder: buildScenarioStreamPrompt,
  }),
  buildStructuredCard: (data) => {
    // direct 通路输出是模型生成的——metadata.signature 属于伪造声明，剥除
    //（签名串只在 hosted-json 通路上可信归一化；见 normalizeHostedJsonCard）。
    const card = normalizeScenarioResultCard(data, new Date().toISOString());
    delete (card.metadata as Record<string, unknown>).signature;
    return { card, cardKind: 'scenario' };
  },
  buildStreamCard: (markdown, input) => ({
    card: buildGeneralScenarioCardFromMarkdown({
      markdown,
      fallbackTitle: input.titleHint,
      defaultTitle: '情景',
    }).card,
    cardKind: 'general-scenario',
  }),
  normalizeHostedJsonCard: (data) => ({
    // hosted-json 返回 NativeScenarioData（服务器签名）；对不可信响应跑
    // 同一白名单归一化做防御性复核，签名串由会话层如实归属。
    card: normalizeScenarioResultCard(data, new Date().toISOString()),
    cardKind: 'scenario',
  }),
  createError: (rawText, cause) => new ScenarioGenerationError(rawText, cause),
  cardNoun: '情景卡',
};

/** 单次显式意图：冻结输入，只执行一次；解析修复仅在本地进行。 */
export const executeScenarioGeneration = (
  options: DesktopAiExecutionOptions,
  input: ScenarioGenerationInput,
  intent: ScenarioGenerationIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
): Promise<ScenarioGenerationOutcome> =>
  executeDesktopGeneration(SCENARIO_GENERATION_FAMILY, options, input, intent, signal, onPartialText);

/**
 * draft 恢复/保存前的卡校验：'scenario' 走同一白名单归一化（保留
 * metadata.signature 供恢复 provenance 判定）；'general-scenario' 只保留
 * title/content 并归一 templateId，剥除 signature/metadata 不可信字段
 * （Markdown 情景卡永不签名）。
 */
export const validateScenarioCard = (
  kind: ScenarioCardKind,
  value: unknown,
): ScenarioResultCardData => {
  if (!isRecord(value)) throw new Error('数据卡损坏');
  if (kind === 'general-scenario') {
    if (typeof value.title !== 'string' || typeof value.content !== 'string') {
      throw new Error('通用情景卡损坏');
    }
    return {
      templateId: GENERAL_SCENARIO_TEMPLATE_ID,
      title: value.title,
      content: value.content,
    };
  }
  return normalizeScenarioResultCard(value, new Date().toISOString());
};
