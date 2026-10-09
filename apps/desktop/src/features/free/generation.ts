import {
  buildFreeStreamPrompt,
  createFreeGenerationConfig,
  FREE_GENERATION_SCHEMA_IDS,
  isFreeStreamSchemaId,
  sanitizeFreeCard,
  validateFreeOutput,
  type FreeSchemaId,
} from '@mahoshojo/ai-core/free-generation';
import type { AITextAttachment } from '@mahoshojo/ai-core/reference-attachments';
import {
  buildGeneralCharacterCardFromMarkdown,
  buildGeneralScenarioCardFromMarkdown,
} from '@mahoshojo/domain/markdown-card';
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
 * /free 自由生成绑定（D5.1-G2）：prompt 构造、schema、附件格式化与卡清洗
 * 走 `@mahoshojo/ai-core` 共源核；通路编排/取消/uncertain 走通用执行器。
 * 自由生成产物永远不携带签名（与 Web 同口径：非原生卡）。
 */
export type FreeExecutionMode = DesktopExecutionMode;

export type FreeGenerationIntent = DesktopGenerationIntent;

/** 自由生成输入：提示词 + schema + 语言 + 参考附件（direct/hosted 两通路共用）。 */
export interface FreeGenerationInput {
  prompt: string;
  schema: FreeSchemaId;
  language: string;
  attachments: AITextAttachment[];
}

/** 结果卡 kind 即 schema id（流式只产 'general'/'general-scenario'）。 */
export type FreeCardKind = FreeSchemaId;

export type FreeResultCardData = GenerationResultCardData;

export type FreeGenerationOutcome = DesktopGenerationOutcome<FreeCardKind>;

export class FreeGenerationError extends GenerationTransportError {
  constructor(rawText: string, cause: unknown) {
    super(rawText, cause);
    this.name = 'FreeGenerationError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * hosted/直接两通路共用的卡归一化：与服务器 `normalizeOutput` 同一管线
 * （`sanitizeFreeCard` 先剥签名/伪造字段并补 templateId、scenario 补
 * metadata.created_at，`validateFreeOutput` 再按 schema 校验）。
 * `createdAt` 仅当服务端未给 metadata.created_at 时才生效。
 */
export const normalizeFreeResultCard = (
  schemaId: FreeSchemaId,
  data: unknown,
  createdAt: string,
): FreeResultCardData =>
  validateFreeOutput({
    schemaId,
    data: sanitizeFreeCard(schemaId, data, createdAt),
  }) as FreeResultCardData;

const buildHostedBody = (input: FreeGenerationInput): Record<string, JsonValue> => {
  const body: Record<string, JsonValue> = {
    schema: input.schema,
    prompt: input.prompt,
    language: input.language,
  };
  if (input.attachments.length > 0) {
    body.attachments = input.attachments.map((item) => ({
      name: item.name,
      type: item.type ?? 'application/octet-stream',
      size: item.size ?? item.content.length,
      content: item.content,
      ...(item.truncated ? { truncated: true } : {}),
    }));
  }
  // customProvider 等凭据字段由 native 拒绝（renderer 不得注入）——不在这里出现。
  return body;
};

const FREE_GENERATION_FAMILY: DesktopGenerationFamily<
  FreeGenerationInput,
  FreeGenerationIntent,
  FreeCardKind
> = {
  validateInput: (input, intent) => {
    if (!input.prompt.trim()) throw new Error('请先输入提示词。');
    if (!FREE_GENERATION_SCHEMA_IDS.includes(input.schema)) {
      throw new Error('不支持的数据卡结构，请选择受支持的模板。');
    }
    if ((intent.mode === 'hosted-stream' || (intent.mode.startsWith('direct-') && intent.generationMode === 'stream'))
      && !isFreeStreamSchemaId(input.schema)) {
      throw new Error('流式生成仅支持通用角色卡与通用情景卡，请切换模板或使用非流式生成。');
    }
  },
  streamRouteId: 'generate-free-stream',
  jsonRouteId: 'generate-free',
  buildHostedBody,
  createDirectConfig: (_intent, input) => createFreeGenerationConfig(input.schema),
  createDirectStreamConfig: (_intent, input) => {
    const schema = input.schema;
    if (!isFreeStreamSchemaId(schema)) throw new Error('当前数据卡结构不支持流式生成。');
    return {
      systemPrompt: '',
      temperature: 0.75,
      promptBuilder: (snapshot) => buildFreeStreamPrompt({ ...snapshot, schema }),
    };
  },
  buildStructuredCard: (data, input) => ({
    card: normalizeFreeResultCard(input.schema, data, new Date().toISOString()),
    cardKind: input.schema,
  }),
  buildStreamCard: (markdown, input) =>
    input.schema === 'general-scenario'
      ? { card: buildGeneralScenarioCardFromMarkdown({ markdown, defaultTitle: '情景' }).card, cardKind: 'general-scenario' }
      : { card: buildGeneralCharacterCardFromMarkdown({ markdown, defaultName: '角色' }).card, cardKind: 'general' },
  normalizeHostedJsonCard: (data, input) => ({
    // 服务端已 sanitize+validate；这里对不可信响应再跑同一管线做防御性复核，
    // metadata.created_at 缺省时按收到时刻补（与服务端 sanitize 口径一致）。
    card: normalizeFreeResultCard(input.schema, data, new Date().toISOString()),
    cardKind: input.schema,
  }),
  createError: (rawText, cause) => new FreeGenerationError(rawText, cause),
  cardNoun: '数据卡',
};

/** 单次显式意图：冻结输入，只执行一次；解析修复仅在本地进行。 */
export const executeFreeGeneration = (
  options: DesktopAiExecutionOptions,
  input: FreeGenerationInput,
  intent: FreeGenerationIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
): Promise<FreeGenerationOutcome> =>
  executeDesktopGeneration(FREE_GENERATION_FAMILY, options, input, intent, signal, onPartialText);

/**
 * draft 恢复/保存前的卡校验：先过 `sanitizeFreeCard`（剥除 signature/
 * isPreset/userAnswers 等不可信字段、归一 templateId 与 metadata），
 * 'general'/'general-scenario' 再按宽松形状校验（保留 codename 等流式
 * 附加字段），结构化 kind 走与服务端同一 `validateFreeOutput` 管线。
 */
export const validateFreeCard = (kind: FreeCardKind, value: unknown): FreeResultCardData => {
  if (!isRecord(value)) throw new Error('数据卡损坏');
  const sanitized = sanitizeFreeCard(kind, value, new Date().toISOString());
  if (kind === 'general') {
    const card = sanitized as Record<string, unknown>;
    if (typeof card.name !== 'string' || typeof card.content !== 'string') throw new Error('通用角色卡损坏');
    return card;
  }
  if (kind === 'general-scenario') {
    const card = sanitized as Record<string, unknown>;
    if (typeof card.title !== 'string' || typeof card.content !== 'string') throw new Error('通用情景卡损坏');
    return card;
  }
  return validateFreeOutput({ schemaId: kind, data: sanitized }) as FreeResultCardData;
};
