// pages/api/generate-magical-girl-details-stream.ts

import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import { getLogger } from '@/lib/logger';
import {
  buildQuestionnaireAnswerLookup,
  formatQuestionnaireAnswers,
  normalizeUserAnswers,
  resolveQuestionnaireAnswerTarget,
  type QuestionnaireAnswerItem,
} from '@/lib/questionnaires';
import { type AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { acquirePublicAiRateLimit, buildPublicAiRateLimitResponse, inferPublicAiProviderMode } from '@/lib/ai/public-rate-limit';
import { generateWithStreamAI, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/stream/raw-ai';
import { createReasoningSseBridge, shouldUseClientSse } from '@/lib/stream/reasoning-sse';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';
import { resolveBuildRuleRuntimeResultsFromRequest } from '@/lib/creator/build-rule-request';
import { buildCreatorPromptInput, validateCreatorRequest } from '@/lib/creator/server';
import { CREATOR_TEMPLATE_IDS, type CreatorTemplateId } from '@/lib/creator/templates';
import { buildCreatorStreamPrompt } from '@/lib/creator/stream-prompt';
import type { CreatorPromptInput, CreatorRequestInput } from '@/lib/creator/types';

const log = getLogger('api-gen-details-stream');

export const config = {
  runtime: 'edge',
};

const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
});

type RequestQuestion = {
  id: string;
  question: string;
  required: boolean;
  maxLength: number | null;
};

type RequestQuestionnaire = {
  id: string;
  title: string;
  kind: 'magical-girl' | 'canshou';
  questions: RequestQuestion[];
  loreMarkdown?: string;
};

const normalizeCreatorTemplate = (raw: unknown): CreatorTemplateId => {
  const candidate = typeof raw === 'string' ? raw.trim() : '';
  return CREATOR_TEMPLATE_IDS.includes(candidate as CreatorTemplateId)
    ? (candidate as CreatorTemplateId)
    : 'general';
};

const buildCreatorPromptText = (creatorPromptInput: CreatorPromptInput): string => {
  const sections: string[] = [];
  if (creatorPromptInput.userIntent) {
    sections.push(`【创作补充要求】\n${creatorPromptInput.userIntent}`);
  }
  if (creatorPromptInput.buildRuleProjection.primary) {
    sections.push(`【主规则事实】\n${creatorPromptInput.buildRuleProjection.primary.summary}`);
  }
  if (creatorPromptInput.buildRuleProjection.references.length > 0) {
    sections.push(
      `【补充规则事实】\n${creatorPromptInput.buildRuleProjection.references
        .map((reference) => reference.summary)
        .join('\n\n')}`
    );
  }
  return sections.join('\n\n');
};

const normalizeQuestionnaires = (raw: unknown): RequestQuestionnaire[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const kind = record.kind === 'magical-girl' || record.kind === 'canshou' ? record.kind : null;
      if (!kind) return null;
      const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : '';
      const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : '';
      if (!id || !title) return null;
      const useLore = typeof record.useLore === 'boolean' ? record.useLore : true;
      const loreMarkdown = useLore && typeof record.loreMarkdown === 'string' && record.loreMarkdown.trim()
        ? record.loreMarkdown
        : undefined;
      const rawQuestions = Array.isArray(record.questions) ? record.questions : [];
      const questions = rawQuestions.map((q, index) => {
        if (!q || typeof q !== 'object') {
          return {
            id: `Q-${index + 1}`,
            question: `问题 ${index + 1}`,
            required: false,
            maxLength: null,
          };
        }
        const qRecord = q as Record<string, unknown>;
        const qid = typeof qRecord.id === 'string' && qRecord.id.trim() ? qRecord.id.trim() : `Q-${index + 1}`;
        const qText = typeof qRecord.question === 'string' && qRecord.question.trim() ? qRecord.question.trim() : `问题 ${index + 1}`;
        const required = typeof qRecord.required === 'boolean' ? qRecord.required : false;
        const maxLengthRaw = qRecord.maxLength;
        const maxLength = typeof maxLengthRaw === 'number' && Number.isFinite(maxLengthRaw)
          ? Math.max(0, Math.floor(maxLengthRaw))
          : maxLengthRaw === null
            ? null
            : null;
        return { id: qid, question: qText, required, maxLength };
      });
      const payload: RequestQuestionnaire = {
        id,
        title,
        kind,
        questions,
        ...(loreMarkdown ? { loreMarkdown } : {}),
      };
      return payload;
    })
    .filter((item): item is RequestQuestionnaire => Boolean(item));
};

const buildQuestionnaireLoreText = (questionnaires: RequestQuestionnaire[]): string => {
  const blocks = questionnaires
    .map((questionnaire) => ({
      title: questionnaire.title,
      lore: questionnaire.loreMarkdown?.trim() ?? '',
    }))
    .filter((item) => Boolean(item.lore))
    .map((item) => `【设定来源：${item.title}】\n${item.lore}`);
  return blocks.length > 0 ? blocks.join('\n\n') : '';
};

const buildQuestionLookup = (questionnaires: RequestQuestionnaire[]) => {
  const ordered: Array<RequestQuestion & {
    key: string;
    index: number;
    questionId: string;
    questionnaireId: string;
    questionnaireTitle: string;
  }> = [];

  questionnaires.forEach((questionnaire) => {
    questionnaire.questions.forEach((question) => {
      ordered.push({
        ...question,
        key: `${questionnaire.id}::${question.id}`,
        index: ordered.length,
        questionId: question.id,
        questionnaireId: questionnaire.id,
        questionnaireTitle: questionnaire.title,
      });
    });
  });

  return buildQuestionnaireAnswerLookup(ordered);
};

const resolveLookupQuestion = (
  lookup: ReturnType<typeof buildQuestionLookup>,
  item: QuestionnaireAnswerItem,
  index: number
) => {
  return resolveQuestionnaireAnswerTarget(
    lookup,
    {
      question: item.question,
      questionId: item.questionId,
      questionnaireId: item.questionnaireId,
      questionnaireTitle: item.questionnaireTitle,
      index,
    },
    { allowIndexFallback: true }
  );
};

const resolveAnswerItems = (
  rawAnswers: unknown,
  questionnaires: RequestQuestionnaire[]
): QuestionnaireAnswerItem[] => {
  const fallbackQuestions = questionnaires.flatMap((q) => q.questions.map((item) => item.question));
  const normalized = normalizeUserAnswers(rawAnswers, fallbackQuestions);
  if (normalized.length === 0) return [];
  const lookup = buildQuestionLookup(questionnaires);
  const resolvedItems: QuestionnaireAnswerItem[] = [];
  normalized.forEach((item, index) => {
    const answer = item.answer?.trim() ?? '';
    if (!answer) return;
    const resolved = resolveLookupQuestion(lookup, item, index);
    const question = item.question?.trim() || resolved?.question || `问题 ${index + 1}`;
    resolvedItems.push({
      question,
      answer,
      questionId: item.questionId ?? resolved?.questionId,
      questionnaireId: item.questionnaireId ?? resolved?.questionnaireId,
      questionnaireTitle: item.questionnaireTitle ?? resolved?.questionnaireTitle,
    });
  });
  return resolvedItems;
};


async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const wantsClientSse = shouldUseClientSse(req);

  try {
    const parsedBody = await req.json();
    const {
      answers: rawAnswers,
      questionnaires: rawQuestionnaires,
      language = 'zh-CN',
      customProvider: customProviderPayload,
      template: rawTemplate,
      freeformBrief,
      buildRules: rawBuildRules,
      primaryRuleId: rawPrimaryRuleId,
    } = parsedBody ?? {};

    const questionnaires = normalizeQuestionnaires(rawQuestionnaires);
    const normalizedAnswers = resolveAnswerItems(rawAnswers, questionnaires);
    const template = normalizeCreatorTemplate(rawTemplate);
    let creatorPromptInput: CreatorPromptInput;
    let creatorRequestInput: CreatorRequestInput;
    try {
      const buildRules = resolveBuildRuleRuntimeResultsFromRequest(rawBuildRules);
      const primaryRuleId = typeof rawPrimaryRuleId === 'string' && rawPrimaryRuleId.trim() ? rawPrimaryRuleId.trim() : null;
      creatorRequestInput = {
        template,
        freeformBrief: typeof freeformBrief === 'string' ? freeformBrief : null,
        questionnaires: questionnaires.map((questionnaire) => ({
          questionnaireId: questionnaire.id,
          title: questionnaire.title,
        })),
        questionnaireAnswers: normalizedAnswers,
        buildRules,
        primaryRuleId,
      };
      validateCreatorRequest(creatorRequestInput);
      creatorPromptInput = buildCreatorPromptInput(creatorRequestInput);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'CREATOR_REQUEST_INVALID';
      return new Response(JSON.stringify({ error: '创作请求无效', message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const rateLimit = await acquirePublicAiRateLimit({
      req,
      actionType: 'magical_girl_details_generate',
      providerMode: inferPublicAiProviderMode(customProviderPayload),
    });
    if (!rateLimit.allowed) return buildPublicAiRateLimitResponse(rateLimit);

    for (const answerItem of normalizedAnswers) {
      const safetyResponse = await enforceTextSafety({
        text: answerItem.answer,
        log,
        logMeta: {
          questionId: answerItem.questionId,
          questionnaireId: answerItem.questionnaireId,
        },
        enableAiSafetyCheck: false,
        sensitiveWordReason: '在问卷中使用了危险符文',
      });
      if (safetyResponse) return safetyResponse;
    }

    let customProviderOverride: AIProvider | null = null;
    let customProviderId: string | null = null;
    let customModelOverride: string | undefined;

    if (customProviderPayload) {
      const parsedResult = CustomProviderSchema.safeParse(customProviderPayload);
      if (!parsedResult.success) {
        log.warn('自定义 AI 供应商配置校验失败', { providerId: customProviderPayload?.providerId, issues: parsedResult.error.issues });
        return new Response(JSON.stringify({ error: '自定义 AI 供应商配置无效' }), { status: 400 });
      }

      const parsed = parsedResult.data;
      customProviderId = parsed.providerId;
      const providerConfig = AI_PROVIDER_CATALOG.find((item) => item.id === parsed.providerId);
      if (!providerConfig) {
        return new Response(JSON.stringify({ error: '未知的模型供应商 ID' }), { status: 400 });
      }

      const modelConfig = providerConfig.models.find((model) => model.value === parsed.modelId);
      if (!modelConfig) {
        return new Response(JSON.stringify({ error: '未知的模型 ID' }), { status: 400 });
      }

      const sanitizedApiKey = parsed.apiKey.trim();
      if (!sanitizedApiKey && providerConfig.id !== 'system') {
        return new Response(JSON.stringify({ error: 'API Key 不能为空' }), { status: 400 });
      }

      const sanitizedBaseUrl = providerConfig.baseUrl?.trim() ?? '';
      if (!sanitizedBaseUrl) {
        customModelOverride = modelConfig.value;
        log.info('检测到 baseUrl 为空的自定义供应商，改用系统默认通道，仅覆盖模型参数', {
          providerId: providerConfig.id,
          model: modelConfig.value,
        });
      } else {
        customProviderOverride = {
          name: providerConfig.name,
          apiKey: sanitizedApiKey,
          baseUrl: sanitizedBaseUrl,
          model: modelConfig.value,
          type: providerConfig.type,
          mode: providerConfig.mode || 'auto',
          retryCount: 1,
          skipProbability: 0,
        };
      }
    }

    const qaText = formatQuestionnaireAnswers(normalizedAnswers);
    const loreText = buildQuestionnaireLoreText(questionnaires);
    const creatorPromptText = buildCreatorPromptText(creatorPromptInput);
    const prompt = buildCreatorStreamPrompt({
      template: template === 'general-scenario' ? 'general-scenario' : 'general',
      language,
      creatorPromptText,
      questionnaireAnswerText: qaText,
      loreText,
    });

    const shouldDisablePolling = customProviderId !== null && customProviderId !== 'system';
    const providerOptions: GenerateWithAIOptions | undefined = (customProviderOverride || shouldDisablePolling)
      ? {
        ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
        ...(shouldDisablePolling ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM } : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
      }
      : undefined;
    const reasoningBridge = wantsClientSse ? createReasoningSseBridge('魔法少女档案（流式）') : null;
    const aiTelemetry: NonNullable<GenerateWithAIOptions['telemetry']> = {};

    const streamResult = await generateWithStreamAI(
      {
        prompt,
        temperature: 0.75,
        ...(customModelOverride ? { modelOverride: customModelOverride } : {}),
      },
      {
        ...(providerOptions ?? {}),
        telemetry: aiTelemetry,
        ...(reasoningBridge ? { onReasoningEvent: reasoningBridge.onReasoningEvent } : {}),
      }
    );
    recordUserActivityFromRequest(req);

    if (wantsClientSse && reasoningBridge) {
      return reasoningBridge.toResponse(streamResult.response, {
        usagePromise: streamResult.usagePromise,
        aiModel: aiTelemetry.model ?? customModelOverride ?? null,
      });
    }

    return streamResult.response;
  } catch (error) {
    log.error('流式生成创作结果失败', { error });
    const errorMessage = error instanceof Error ? error.message : '服务器内部错误';
    return new Response(JSON.stringify({ error: '生成失败', message: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default handler;
