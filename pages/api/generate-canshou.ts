// pages/api/generate-canshou.ts
import { z } from 'zod/v3';
import { generateWithAI, GenerationConfig, LoadBalanceStrategy } from '../../lib/ai';
import { getLogger } from '../../lib/logger';
import { NextRequest } from 'next/server';
import { generateSignature } from '../../lib/signature'; // 导入签名工具
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { type AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { CANSHOU_LORE } from '@/lib/canshou-lore';
import { formatQuestionnaireAnswers, normalizeUserAnswers, type QuestionnaireAnswerItem } from '@/lib/questionnaires';
import { getAnswerLimitInfo, isAnswerOverLimit } from '@/lib/questionnaire-limits';

const log = getLogger('api-gen-canshou');

export const config = {
  runtime: 'edge',
};


// 定义残兽设定的Zod Schema
const CanshouSchema = z.object({
  name: z.string().describe('残兽的名称，应体现其核心概念和特征'),
  coreConcept: z.string().describe('对残兽核心概念的概括'),
  coreEmotion: z.string().describe('对残兽核心情感/欲望的概括'),
  evolutionStage: z.string().describe('残兽所处的进化阶段（卵/蠖/蛹/半蜕/蜕/王蜕/羽）'),
  appearance: z.string().describe('外貌形态的详细描述，整合用户输入并进行扩展'),
  materialAndSkin: z.string().describe('材质与表皮的详细描述，整合用户输入并进行扩展'),
  featuresAndAppendages: z.string().describe('特征与附属物的详细描述，整合用户输入并进行扩展'),
  attackMethod: z.string().describe('主要攻击方式的详细描述'),
  specialAbility: z.string().describe('特殊能力的详细描述和运作机制'),
  origin: z.string().describe('起源故事的详细阐述'),
  birthEnvironment: z.string().describe('诞生环境的详细描述'),
  researcherNotes: z.string().describe('作为研究员的分析、预测和警告'),
});

const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
});

type CanshouDetails = z.infer<typeof CanshouSchema>;

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

const findOverLimitAnswer = (
  items: QuestionnaireAnswerItem[],
  questionnaires: RequestQuestionnaire[]
) => {
  if (items.length === 0) return null;
  const lookup = buildQuestionLookup(questionnaires);
  for (const [index, item] of items.entries()) {
    if (!item.answer) continue;
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
    if (!isAnswerOverLimit(item.answer, resolved?.maxLength ?? null)) continue;
    const limitInfo = getAnswerLimitInfo(resolved?.maxLength ?? null);
    const questionLabel = resolved?.question || item.question || `问题 ${index + 1}`;
    return {
      questionLabel,
      limit: limitInfo.limit ?? 0,
      length: item.answer.length,
      source: limitInfo.source,
    };
  }
  return null;
};

// AI生成配置
const canshouGenerationConfig: GenerationConfig<CanshouDetails, { answers: QuestionnaireAnswerItem[], language: string }> = {
  systemPrompt: `你是一名魔法国度的研究学者，你的任务是根据一线调查员提交的问卷报告，分析并生成一份详细的档案。
  首先，这是关于残兽的基础设定，你必须严格遵守：
  ${CANSHOU_LORE}

  请根据用户提供的问卷答案，以结构化的JSON格式返回详细设定，包括对其各项特征的详细描述和你作为研究学者的专业分析笔记。`,
  temperature: 0.8,
  promptBuilder: ({ answers, language }: { answers: QuestionnaireAnswerItem[], language: string }) => {
    const answerText = formatQuestionnaireAnswers(answers);
    return `以下是调查员提交的问卷报告，请基于此进行分析：\n${answerText}\n\n【重要指令】请你必须使用【${language}】进行内容创作。`;
  },
  schema: CanshouSchema,
  taskName: "生成残兽档案",
};

// API Handler
async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const parsedBody = await req.json();
    const { answers: rawAnswers, questionnaires: rawQuestionnaires, allowNativeSignature: requestedNativeSignature, language = 'zh-CN', customProvider: customProviderPayload } = parsedBody;

    const questionnaires = normalizeQuestionnaires(rawQuestionnaires);
    const normalizedAnswers = resolveAnswerItems(rawAnswers, questionnaires);

    if (normalizedAnswers.length === 0) {
      return new Response(JSON.stringify({ error: 'Answers array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const overLimitAnswer = findOverLimitAnswer(normalizedAnswers, questionnaires);
    const allowNativeSignature = requestedNativeSignature === true && !overLimitAnswer;
    if (overLimitAnswer) {
      log.info('问卷答案超过字数上限，已取消原生签名', overLimitAnswer);
    }

	    // 安全检查：检查用户输入是否包含敏感词
	    const answersString = normalizedAnswers.map((item) => item.answer).join(' ');
	    const safetyResponse = await enforceTextSafety({
	      text: answersString,
	      log,
	      enableAiSafetyCheck: false,
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
      const providerConfig = AI_PROVIDER_CATALOG.find(item => item.id === parsed.providerId);
      if (!providerConfig) {
        return new Response(JSON.stringify({ error: '未知的模型供应商 ID' }), { status: 400 });
      }

      const modelConfig = providerConfig.models.find(model => model.value === parsed.modelId);
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

    const shouldDisablePolling = customProviderId !== null && customProviderId !== 'system';
    const providerOptions = (customProviderOverride || shouldDisablePolling)
      ? {
        ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
        ...(shouldDisablePolling ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM } : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
      }
      : undefined;

    // 调用通用AI生成函数
    const canshouDetails = await generateWithAI({ answers: normalizedAnswers, language }, {
      ...canshouGenerationConfig,
      ...(customModelOverride ? { modelOverride: customModelOverride } : {}),
    }, providerOptions);

    // 将用户答案和生成结果合并，并添加模板ID，为签名做准备
    const dataToSign = {
        ...canshouDetails,
        templateId: "魔法少女/心之花/残兽（问卷生成）", // 添加模板ID
        userAnswers: normalizedAnswers
    };

    if (allowNativeSignature !== true) {
      return new Response(JSON.stringify(dataToSign), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 为合并后的数据生成签名
    const signature = await generateSignature(dataToSign);

    // 将签名附加到最终结果中
    const finalResult = {
        ...dataToSign,
        signature: signature
    };

    return new Response(JSON.stringify(finalResult), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    log.error('生成残兽档案失败', { error });
    const errorMessage = error instanceof Error ? error.message : '服务器内部错误';
    return new Response(JSON.stringify({ error: '生成失败，当前服务器可能正忙，请稍后重试', message: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default handler;
