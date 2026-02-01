// pages/api/generate-canshou-stream.ts

import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import { getLogger } from '@/lib/logger';
import { type AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { CANSHOU_LORE } from '@/lib/canshou-lore';
import { generateWithStreamAI, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/stream/raw-ai';
import { formatQuestionnaireAnswers, normalizeUserAnswers, type QuestionnaireAnswerItem } from '@/lib/questionnaires';

const log = getLogger('api-gen-canshou-stream');

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
      const rawQuestions = Array.isArray(record.questions) ? record.questions : [];
      const questions = rawQuestions.map((q, index) => {
        if (!q || typeof q !== 'object') {
          return {
            id: `Q-${index + 1}`,
            question: `问题 ${index + 1}`,
            required: true,
            maxLength: null,
          };
        }
        const qRecord = q as Record<string, unknown>;
        const qid = typeof qRecord.id === 'string' && qRecord.id.trim() ? qRecord.id.trim() : `Q-${index + 1}`;
        const qText = typeof qRecord.question === 'string' && qRecord.question.trim() ? qRecord.question.trim() : `问题 ${index + 1}`;
        const required = typeof qRecord.required === 'boolean' ? qRecord.required : true;
        const maxLengthRaw = qRecord.maxLength;
        const maxLength = typeof maxLengthRaw === 'number' && Number.isFinite(maxLengthRaw)
          ? Math.max(0, Math.floor(maxLengthRaw))
          : maxLengthRaw === null
            ? null
            : null;
        return { id: qid, question: qText, required, maxLength };
      });
      return { id, title, kind, questions } satisfies RequestQuestionnaire;
    })
    .filter((item): item is RequestQuestionnaire => Boolean(item));
};

type QuestionLookup = {
  byId: Map<string, RequestQuestion & { questionnaireId: string; questionnaireTitle: string }>;
  byCompositeId: Map<string, RequestQuestion & { questionnaireId: string; questionnaireTitle: string }>;
  byQuestion: Map<string, RequestQuestion & { questionnaireId: string; questionnaireTitle: string }>;
  ordered: Array<RequestQuestion & { questionnaireId: string; questionnaireTitle: string }>;
};

const buildQuestionLookup = (questionnaires: RequestQuestionnaire[]): QuestionLookup => {
  const byId = new Map<string, RequestQuestion & { questionnaireId: string; questionnaireTitle: string }>();
  const byCompositeId = new Map<string, RequestQuestion & { questionnaireId: string; questionnaireTitle: string }>();
  const byQuestion = new Map<string, RequestQuestion & { questionnaireId: string; questionnaireTitle: string }>();
  const ordered: Array<RequestQuestion & { questionnaireId: string; questionnaireTitle: string }> = [];

  questionnaires.forEach((questionnaire) => {
    questionnaire.questions.forEach((question) => {
      const payload = {
        ...question,
        questionnaireId: questionnaire.id,
        questionnaireTitle: questionnaire.title,
      };
      ordered.push(payload);
      byCompositeId.set(`${questionnaire.id}::${question.id}`, payload);
      if (!byId.has(question.id)) {
        byId.set(question.id, payload);
      }
      const textKey = question.question.trim();
      if (textKey && !byQuestion.has(textKey)) {
        byQuestion.set(textKey, payload);
      }
    });
  });

  return { byId, byCompositeId, byQuestion, ordered };
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
    let resolved = null as (RequestQuestion & { questionnaireId: string; questionnaireTitle: string }) | null;
    if (item.questionnaireId && item.questionId) {
      resolved = lookup.byCompositeId.get(`${item.questionnaireId}::${item.questionId}`) ?? null;
    }
    if (!resolved && item.questionId) {
      resolved = lookup.byId.get(item.questionId) ?? null;
    }
    if (!resolved && item.question) {
      resolved = lookup.byQuestion.get(item.question.trim()) ?? null;
    }
    if (!resolved && lookup.ordered[index]) {
      resolved = lookup.ordered[index];
    }
    const question = item.question?.trim() || resolved?.question || `问题 ${index + 1}`;
    resolvedItems.push({
      question,
      answer,
      questionId: item.questionId ?? resolved?.id,
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

  try {
    const parsedBody = await req.json();
    const { answers: rawAnswers, questionnaires: rawQuestionnaires, language = 'zh-CN', customProvider: customProviderPayload } = parsedBody ?? {};

    const questionnaires = normalizeQuestionnaires(rawQuestionnaires);
    const normalizedAnswers = resolveAnswerItems(rawAnswers, questionnaires);

    if (normalizedAnswers.length === 0) {
      return new Response(JSON.stringify({ error: 'Answers array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const answersString = normalizedAnswers.map((item) => item.answer).join(' ');
    const safetyResponse = await enforceTextSafety({
      text: answersString,
      log,
      enableAiSafetyCheck: false,
      sensitiveWordReason: '在残兽问卷中使用了危险符文',
    });
    if (safetyResponse) return safetyResponse;

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

    const answerText = formatQuestionnaireAnswers(normalizedAnswers);

    const prompt = `
你是一名魔法国度的研究学者，你的任务是根据一线调查员提交的问卷报告，分析并生成一份详细的档案。

【重要】输出要求：
1) 必须使用【${language}】创作。
2) 必须直接输出 Markdown 正文，不要输出“我将要/我不能”之类的解释。
3) 第 1 行必须是一级标题（以 "# " 开头），写残兽的名称/称号，不超过 30 字。
4) 在开头 20 行内，尽量给出明确字段（若无法推断可写“未指定”）：
   - 名字：...
5) 正文建议使用小标题，至少包含：核心概念、核心情感、进化阶段、外貌形态、材质与表皮、特征与附属物、攻击方式、特殊能力、起源、诞生环境、研究员笔记。

【残兽设定（必须遵守）】
${CANSHOU_LORE}

【调查问卷】
${answerText}
`.trim();

    const shouldDisablePolling = customProviderId !== null && customProviderId !== 'system';
    const providerOptions: GenerateWithAIOptions | undefined = (customProviderOverride || shouldDisablePolling)
      ? {
        ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
        ...(shouldDisablePolling ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM } : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
      }
      : undefined;

    const streamResult = await generateWithStreamAI(
      {
        prompt,
        temperature: 0.8,
        ...(customModelOverride ? { modelOverride: customModelOverride } : {}),
      },
      providerOptions
    );

    return streamResult.response;
  } catch (error) {
    log.error('流式生成残兽通用角色卡失败', { error });
    const errorMessage = error instanceof Error ? error.message : '服务器内部错误';
    return new Response(JSON.stringify({ error: '生成失败', message: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default handler;

