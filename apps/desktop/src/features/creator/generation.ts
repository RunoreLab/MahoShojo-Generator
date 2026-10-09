import {
  buildUnsignedCanshouCard,
  CANSHOU_GENERATION_SCHEMA,
  createCanshouGenerationConfig,
  type CanshouGeneratedData,
} from '@mahoshojo/ai-core/canshou-generation';
import { createCreatorStructuredGeneralConfig } from '@mahoshojo/ai-core/creator-generation';
import {
  buildUnsignedMagicalGirlDetailsCard,
  createMagicalGirlDetailsGenerationConfig,
  MAGICAL_GIRL_DETAILS_SCHEMA,
  type MagicalGirlDetailsGeneratedData,
} from '@mahoshojo/ai-core/magical-girl-details-generation';
import type { JsonValue } from '@mahoshojo/contracts/json-value';
import { CANSHOU_LORE } from '@mahoshojo/domain/canshou-lore';
import {
  GENERAL_CHARACTER_TEMPLATE_ID,
  GENERAL_SCENARIO_TEMPLATE_ID,
} from '@mahoshojo/domain/data-cards';
import { buildPersistedCreationInputs } from '@mahoshojo/domain/creator/card-metadata';
import { buildCreatorPromptText } from '@mahoshojo/domain/creator/prompt';
import { buildCreatorGenerationRequestBody } from '@mahoshojo/domain/creator/request-body';
import { buildCreatorPromptInput, validateCreatorRequest } from '@mahoshojo/domain/creator/server';
import { buildCreatorStreamPrompt } from '@mahoshojo/domain/creator/stream-prompt';
import { finalizeCreatorStreamCard } from '@mahoshojo/domain/creator/stream-result';
import {
  isCreatorStreamTemplate,
  type CreatorTemplateId,
} from '@mahoshojo/domain/creator/templates';
import type {
  BuildRuleRequestInput,
  BuildRuleRuntimeResult,
  CreatorQuestionnaireRef,
  CreatorRequestInput,
} from '@mahoshojo/domain/creator/types';
import {
  compactQuestionnaireAnswerItems,
  formatQuestionnaireAnswers,
  type QuestionnaireAnswerItem,
} from '@mahoshojo/domain/questionnaire';
import type { QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';

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
import { createStructuredCardNormalizer } from '../questionnaire/generation';

/**
 * /creator 创作工房生成绑定（D5.1-G3）。
 *
 * 与 Web `CreatorPage.handleSubmit` 同一组领域语义：模板 × 生成模式、规则车卡
 * （构建规则 runtime 结果）、自由补充说明、多问卷答案共同构成一次创作请求。
 * - hosted 请求体走 `buildCreatorGenerationRequestBody` 共源组装（键序与 Web
 *   提交段逐键对拍；renderer 不注入 customProvider 等凭据字段——native 拒绝）；
 * - direct 非流式按模板分派结构化配置：magical-girl/canshou 复用问卷家族配置
 *   并注入 `creatorPromptText`（与 hosted `generate-creator-runtime` 同位序），
 *   general/general-scenario 走 `{name|title, content}` JSON schema（产出卡形
 *   与流式 Markdown 卡一致）；
 * - direct-stream 与 hosted-stream 共用 Markdown prompt 与通用卡构造，
 *   产物不签名（hosted 无 resign，DESK-ONLINE-009 延期项）；
 *   hosted-json 产出结构化卡并可携带官方签名。
 */
export type CreatorExecutionMode = DesktopExecutionMode;

export interface CreatorGenerationIntent extends DesktopGenerationIntent {
  /** 每次生成随机抽取的花名/花语候选（magical-girl 结构化 prompt 用）。 */
  flowers: string;
}

/** hosted 生成请求所需的问卷语义输入；direct 通路忽略。 */
export interface CreatorHostedRequestInput {
  /** 当前选择集；请求字段投影统一走 domain `buildCreatorGenerationRequestBody`。 */
  selections: readonly QuestionnaireSelection[];
  allowNativeSignature: boolean;
}

export interface CreatorGenerationInput {
  template: CreatorTemplateId;
  freeformBrief: string;
  answers: QuestionnaireAnswerItem[];
  language: string;
  /** 所选问卷的 Lore 投影（`buildQuestionnaireSelectionLoreText` 结果）。 */
  loreText: string;
  /** 所选问卷引用（prompt 问卷清单 + creationInputs 快照）。 */
  questionnaires: CreatorQuestionnaireRef[];
  /** 规则求值结果（prompt 投影/校验/结果卡 creationInputs·buildState 元数据）。 */
  buildRules: BuildRuleRuntimeResult[];
  /** 规则请求线形（hosted 请求体；与 Web `buildRuleRequestPayload` 同构）。 */
  buildRuleRequests: BuildRuleRequestInput[];
  primaryRuleId: string | null;
  /** 流式模板 Markdown 解析失败的兜底名/标题（与 Web `streamFallbackLabel` 同口径）。 */
  streamFallbackLabel?: string;
  /** hosted 通路请求字段投影所需的问卷语义输入；direct 通路忽略。 */
  hosted?: CreatorHostedRequestInput;
}

/** 结果卡 kind：结构化两族 + 流式两族（'scenario' 模板当前不接生成通路）。 */
export type CreatorCardKind = 'magical-girl' | 'canshou' | 'general' | 'general-scenario';

/** 已校验结果卡数据：schema 字段 + 服务端透传字段，或流式/结构化通用卡。 */
export type CreatorResultCardData = GenerationResultCardData;

export type CreatorGenerationOutcome = DesktopGenerationOutcome<CreatorCardKind>;

export class CreatorGenerationError extends GenerationTransportError {
  constructor(rawText: string, cause: unknown) {
    super(rawText, cause);
    this.name = 'CreatorGenerationError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** 领域校验错误码 → 面向用户的文案（与 Web `CreatorPage` 提示口径一致）。 */
const describeCreatorValidationError = (error: unknown): string => {
  const code = error instanceof Error ? error.message.split(':')[0] : '';
  switch (code) {
    case 'FREEFORM_BRIEF_REQUIRED':
      return '请至少填写一题，或补充自由说明，或提供规则车卡后再生成。';
    case 'PRIMARY_RULE_REQUIRED':
      return '已选择构建规则但未指定主规则，请先选择一条主规则。';
    case 'PRIMARY_RULE_NOT_SELECTED':
      return '主规则不在已选构建规则中，请重新选择。';
    case 'PRIMARY_RULE_INELIGIBLE':
      return '所选规则不支持作为主规则。';
    case 'RULE_VALIDATION_FAILED':
      return '当前规则车卡存在未解决的配点或必填项问题，请先修正后再生成。';
    case 'RULE_TEMPLATE_UNSUPPORTED':
      return '所选构建规则不支持当前创作模板。';
    case 'QUESTIONNAIRE_REQUIRED_FOR_RULE':
      return '当前构建规则需要搭配至少一份问卷。';
    case 'BUILD_RULE_PRESET_NOT_FOUND':
      return '构建规则预设不存在或已下架。';
    default:
      return error instanceof Error ? error.message : '创作请求校验失败。';
  }
};

/** 输入 → 领域请求语义（Web `creatorRequestPayload` 同构）。 */
const buildCreatorRequestInput = (input: CreatorGenerationInput): CreatorRequestInput => ({
  template: input.template,
  freeformBrief: input.freeformBrief || null,
  questionnaires: input.questionnaires,
  questionnaireAnswers: compactQuestionnaireAnswerItems(input.answers),
  buildRules: input.buildRules,
  primaryRuleId: input.primaryRuleId,
});

/** 规则约束的 prompt 投影（【创作约束】正文；无约束时为空串）。 */
const buildCreatorPromptTextFor = (input: CreatorGenerationInput): string =>
  buildCreatorPromptText(buildCreatorPromptInput(buildCreatorRequestInput(input)));

/**
 * 结果卡元数据（与 hosted `generate-creator-runtime` 的 `dataToSign` 同口径）：
 * `creationInputs` 恒在；`buildState` 仅当存在规则时出现。
 */
const buildCreatorCardMetadata = (input: CreatorGenerationInput): Record<string, unknown> => ({
  creationInputs: buildPersistedCreationInputs({
    template: input.template,
    freeformBrief: input.freeformBrief || null,
    buildRules: input.buildRules,
    primaryRuleId: input.primaryRuleId,
  }),
  ...(input.buildRules.length > 0
    ? {
      buildState: {
        ...(input.primaryRuleId ? { primaryRuleId: input.primaryRuleId } : {}),
        rules: input.buildRules,
      },
    }
    : {}),
});

const buildHostedBody = (input: CreatorGenerationInput): Record<string, JsonValue> => {
  if (!input.hosted) {
    throw new Error('服务器执行需要问卷请求字段。');
  }
  // 业务请求体与 Web `CreatorPage` 提交段共用同一组装器；
  // Desktop 宿主无 customProvider 等附加字段。
  return buildCreatorGenerationRequestBody({
    template: input.template,
    freeformBrief: input.freeformBrief,
    answers: input.answers,
    selections: input.hosted.selections,
    allowNativeSignature: input.hosted.allowNativeSignature,
    language: input.language,
    buildRules: input.buildRuleRequests,
    primaryRuleId: input.primaryRuleId,
  }) as unknown as Record<string, JsonValue>;
};

/** 服务端 `data` 中按原样保留的透传字段（创作元数据 + 签名 + 问卷记录）。 */
const CREATOR_CARD_PASSTHROUGH_KEYS = [
  'templateId',
  'userAnswers',
  'signature',
  'creationInputs',
  'buildState',
] as const;

/** hosted JSON `data` → 魔法少女结构化卡：schema 校验 + 已知透传字段。 */
export const normalizeCreatorMagicalGirlResultCard = createStructuredCardNormalizer(
  MAGICAL_GIRL_DETAILS_SCHEMA,
  CREATOR_CARD_PASSTHROUGH_KEYS,
);

/** hosted JSON `data` → 残兽结构化卡：schema 校验 + 已知透传字段。 */
export const normalizeCreatorCanshouResultCard = createStructuredCardNormalizer(
  CANSHOU_GENERATION_SCHEMA,
  CREATOR_CARD_PASSTHROUGH_KEYS,
);

const CREATOR_GENERATION_FAMILY: DesktopGenerationFamily<
  CreatorGenerationInput,
  CreatorGenerationIntent,
  CreatorCardKind
> = {
  validateInput: (input, intent) => {
    // 'scenario' 模板当前不接任何生成通路（hosted 两路由白名单不含、direct 无
    // 对应结构化配置）——显式拒绝，防止静默落到 magical-girl 分派分支。
    if (input.template === 'scenario') {
      throw new Error('「情景（结构化）」模板暂未接入生成通路，请选择其他创作模板。');
    }
    if ((intent.mode === 'hosted-stream' || (intent.mode.startsWith('direct-') && intent.generationMode === 'stream'))
      && !isCreatorStreamTemplate(input.template)) {
      throw new Error('流式生成仅支持通用角色卡与通用情景卡，请切换模板或使用非流式生成。');
    }
    try {
      validateCreatorRequest(buildCreatorRequestInput(input));
    } catch (error) {
      throw new Error(describeCreatorValidationError(error));
    }
  },
  streamRouteId: 'generate-creator-stream',
  jsonRouteId: 'generate-creator',
  buildHostedBody,
  createDirectConfig: (intent, input) => {
    const creatorPromptText = buildCreatorPromptTextFor(input);
    if (input.template === 'canshou') {
      const config = createCanshouGenerationConfig(CANSHOU_LORE);
      return {
        ...config,
        promptBuilder: () => config.promptBuilder({
          answers: input.answers,
          language: input.language,
          loreText: input.loreText,
          creatorPromptText,
        }),
      };
    }
    if (isCreatorStreamTemplate(input.template)) {
      const config = createCreatorStructuredGeneralConfig(input.template);
      return {
        ...config,
        promptBuilder: () => config.promptBuilder({
          answers: input.answers,
          language: input.language,
          loreText: input.loreText,
          creatorPromptText,
        }),
      };
    }
    const config = createMagicalGirlDetailsGenerationConfig(() => intent.flowers);
    return {
      ...config,
      promptBuilder: () => config.promptBuilder({
        answers: input.answers,
        language: input.language,
        loreText: input.loreText,
        creatorPromptText,
      }),
    };
  },
  createDirectStreamConfig: (_intent, input) => {
    const template = input.template;
    if (!isCreatorStreamTemplate(template)) throw new Error('当前创作模板不支持流式生成。');
    return {
      systemPrompt: '',
      temperature: 0.75,
      promptBuilder: (snapshot) => buildCreatorStreamPrompt({
        template,
        language: snapshot.language,
        creatorPromptText: buildCreatorPromptTextFor(snapshot),
        questionnaireAnswerText: formatQuestionnaireAnswers(snapshot.answers),
        loreText: snapshot.loreText,
      }),
    };
  },
  buildStructuredCard: (data, input) => {
    const metadata = buildCreatorCardMetadata(input);
    const userAnswers = compactQuestionnaireAnswerItems(input.answers);
    if (input.template === 'canshou') {
      return {
        card: {
          ...buildUnsignedCanshouCard(data as CanshouGeneratedData, [...input.answers]),
          ...metadata,
        },
        cardKind: 'canshou',
      };
    }
    if (input.template === 'general-scenario') {
      if (!isRecord(data) || typeof data.title !== 'string' || typeof data.content !== 'string') {
        throw new Error('通用情景卡字段缺失。');
      }
      return {
        card: {
          templateId: GENERAL_SCENARIO_TEMPLATE_ID,
          title: data.title,
          content: data.content,
          userAnswers,
          ...metadata,
        },
        cardKind: 'general-scenario',
      };
    }
    if (input.template === 'general') {
      if (!isRecord(data) || typeof data.name !== 'string' || typeof data.content !== 'string') {
        throw new Error('通用角色卡字段缺失。');
      }
      return {
        card: {
          templateId: GENERAL_CHARACTER_TEMPLATE_ID,
          name: data.name,
          content: data.content,
          ...(typeof data.codename === 'string' ? { codename: data.codename } : {}),
          userAnswers,
          ...metadata,
        },
        cardKind: 'general',
      };
    }
    return {
      card: {
        ...buildUnsignedMagicalGirlDetailsCard(data as MagicalGirlDetailsGeneratedData, [...input.answers]),
        ...metadata,
      },
      cardKind: 'magical-girl',
    };
  },
  buildStreamCard: (markdown, input) => {
    const template = isCreatorStreamTemplate(input.template) ? input.template : 'general';
    const card = finalizeCreatorStreamCard({
      template,
      markdown,
      fallbackLabel: input.streamFallbackLabel,
      userAnswers: compactQuestionnaireAnswerItems(input.answers),
      creationInputs: { ...buildCreatorRequestInput(input) },
      ...(input.buildRules.length > 0
        ? {
          buildState: {
            ...(input.primaryRuleId ? { primaryRuleId: input.primaryRuleId } : {}),
            rules: input.buildRules,
          },
        }
        : {}),
    });
    return { card, cardKind: template };
  },
  normalizeHostedJsonCard: (data, input) => {
    if (input.template === 'canshou') {
      return { card: normalizeCreatorCanshouResultCard(data), cardKind: 'canshou' };
    }
    if (isCreatorStreamTemplate(input.template)) {
      // 非流式路由不会产出流式模板卡；收到不可信响应如实判 invalid。
      throw new Error('服务器返回的数据卡与创作模板不匹配。');
    }
    return { card: normalizeCreatorMagicalGirlResultCard(data), cardKind: 'magical-girl' };
  },
  createError: (rawText, cause) => new CreatorGenerationError(rawText, cause),
  cardNoun: '数据卡',
};

/** 单次显式意图：冻结输入，只执行一次；解析修复仅在本地进行。 */
export const executeCreatorGeneration = (
  options: DesktopAiExecutionOptions,
  input: CreatorGenerationInput,
  intent: CreatorGenerationIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
): Promise<CreatorGenerationOutcome> =>
  executeDesktopGeneration(CREATOR_GENERATION_FAMILY, options, input, intent, signal, onPartialText);

/**
 * 草稿恢复/保存前的卡校验：按 kind 分派——结构化两族走 schema + 透传键
 * 归一化（与 hosted-json 同一管线），流式两族按宽松形状校验（保留
 * creationInputs/buildState/userAnswers 等流式附加字段）。
 */
export const validateCreatorResultCard = (
  kind: CreatorCardKind,
  value: unknown,
): CreatorResultCardData => {
  if (!isRecord(value)) throw new Error('数据卡损坏');
  switch (kind) {
    case 'magical-girl':
      return normalizeCreatorMagicalGirlResultCard(value);
    case 'canshou':
      return normalizeCreatorCanshouResultCard(value);
    case 'general': {
      if (typeof value.name !== 'string' || typeof value.content !== 'string') {
        throw new Error('通用角色卡损坏');
      }
      return { ...value };
    }
    case 'general-scenario': {
      if (typeof value.title !== 'string' || typeof value.content !== 'string') {
        throw new Error('通用情景卡损坏');
      }
      return { ...value };
    }
  }
};
