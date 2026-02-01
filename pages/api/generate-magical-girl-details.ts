// pages/api/generate-magical-girl-details.ts
import { generateWithAI, GenerationConfig, LoadBalanceStrategy } from '../../lib/ai';
import { z } from 'zod/v3';
import { getRandomFlowers } from '../../lib/random-choose-hana-name';
// import { saveToD1 } from '../../lib/d1';
import { getLogger } from '../../lib/logger';
import { generateSignature } from '../../lib/signature'; // 导入签名工具
import { formatQuestionnaireAnswers, normalizeUserAnswers, type QuestionnaireAnswerItem } from '../../lib/questionnaires';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { type AIProvider } from '@/lib/config';

const log = getLogger('api-gen-details');

export const config = {
  runtime: 'edge',
};

// 定义基于问卷的魔法少女详细信息生成 schema
const MagicalGirlDetailsSchema = z.object({
  codename: z.string().describe(`代号：魔法少女对应的一种花的名字，根据性格、理念匹配合适的花语对应的花名。可以从我提供的花名中选取最合适的一个，也可以生成一个其他的更合适的花名。`),
  appearance: z.object({
    outfit: z.string().describe("魔法少女变身后的服装和饰品的详细描述，50字左右"),
    accessories: z.string().describe("变身后的饰品细节描述，50字左右"),
    colorScheme: z.string().describe("参考问卷生成主要色调和配色方案"),
    overallLook: z.string().describe("整体外观风格，包括发色、瞳色、发型、体型、服饰和神态表情，60字左右")
  }),
  magicConstruct: z.object({
    name: z.string().describe("魔装的名字"),
    form: z.string().describe("魔装的具体形态和外观"),
    basicAbilities: z.array(z.string()).describe("魔装的基本能力列表，2-3个核心能力"),
    description: z.string().describe("魔装的详细描述和特色")
  }),
  wonderlandRule: z.object({
    name: z.string().describe("奇境规则的名称"),
    description: z.string().describe("奇境规则的具体内容和效果"),
    tendency: z.string().describe("规则的倾向类型"),
    activation: z.string().describe("规则激活的条件或方式")
  }),
  blooming: z.object({
    name: z.string().describe("繁开状态魔装名"),
    evolvedAbilities: z.array(z.string()).describe("繁开后的进化能力，2-3个强化能力"),
    evolvedForm: z.string().describe("繁开后的魔装形态变化"),
    evolvedOutfit: z.string().describe("繁开后的魔法少女衣装样式"),
    powerLevel: z.string().describe("繁开状态的力量等级描述")
  }),
  analysis: z.object({
    personalityAnalysis: z.string().describe("基于问卷回答的性格分析"),
    abilityReasoning: z.string().describe("能力设定的推理过程和依据"),
    coreTraits: z.array(z.string()).describe("核心性格特征，3-4个关键词"),
    predictionBasis: z.string().describe("预测的主要依据和逻辑"),
    // 角色背景故事
    background: z.object({
        belief: z.string().describe("角色的核心理念、信条或愿望，描述角色为何而战，支撑角色行动的内在动力。"),
        bonds: z.string().describe("角色的情感、羁绊，描述角色与他人（特别是在问卷中出现的人）之间的关系，以及这段关系如何影响了角色，羁绊会如何影响其成长的旅途。")
    }).describe("角色的背景故事，用以丰富角色的立体形象与人物弧光，体现角色的信念与感情。")
  })
})

type MagicalGirlDetails = z.infer<typeof MagicalGirlDetailsSchema>;


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

const validateAnswerLengths = (items: QuestionnaireAnswerItem[], questionnaires: RequestQuestionnaire[]): string | null => {
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
    const maxLength = resolved?.maxLength;
    if (typeof maxLength === 'number' && maxLength > 0 && item.answer.length > maxLength) {
      const questionLabel = resolved?.question || item.question || `问题 ${index + 1}`;
      return `答案字数超过限制（${questionLabel} 最多 ${maxLength} 字）`;
    }
  }
  return null;
};

// 配置详细信息生成
const magicalGirlDetailsConfig: GenerationConfig<MagicalGirlDetails, { answers: QuestionnaireAnswerItem[]; language: string }> = {
  systemPrompt: `你是魔法国度的妖精，你准备通过问卷调查的形式，事先通过问卷结果分析某人成为魔法少女后的能力等各项素质。魔法少女的性格倾向、经历背景、行事准则等等都会影响到她们在魔法少女道路上的潜力和表现。
以下是一位潜在魔法少女对问卷所给出的回答（对方可以不回答某些问题），请你据此预测她成为魔法少女后的情况。

你需要严格按照提供的 JSON schema 格式返回你的预测结果和相应的解释内容，结果中的内容解释如下。
1.魔力构装（简称魔装）：魔法少女的本相魔力所孕育的能力具现，是魔法少女能力体系的基础。一般呈现为魔法少女在现实生活中接触过，在冥冥之中与其命运关联或映射的物体，并且与魔法少女特色能力相关。例如，泡泡机形态的魔装可以使魔法少女制造魔法泡泡，而这些泡泡可以拥有产生幻象、缓冲防护、束缚困敌等能力。这部分的内容需包含魔装的名字（通常为2字词），魔装的形态，魔装的基本能力。
2.奇境规则：魔法少女的本相灵魂所孕育的能力，是魔装能力的一体两面。奇境是魔装能力在规则层面上的升华，体现为与魔装相关的规则领域，而规则的倾向则会根据魔法少女的倾向而有不同的发展。例如，泡泡机形态的魔装升华而来的奇境规则可以是倾向于守护的“戳破泡泡的东西将会立即无效化”，也可以是倾向于进攻的“沾到身上的泡泡被戳破会立即遭受伤害”。
3.繁开：是魔法少女魔装能力的二段进化与解放，无论是作为魔法少女的魔力衣装还是魔装的武器外形都会发生改变。需包含繁开状态魔装名（需要包含原魔装名的每个字），繁开后的进化能力，繁开后的魔装形态，繁开后的魔法少女衣装样式（在通常变身外观上的升级与改变）。
4.角色背景：请在 "analysis" -> "background" 字段中，深入挖掘并创作能够体现角色立体形象与人物弧光的背景故事。
- **信念 (belief)**：根据问卷回答，提炼出角色的核心价值观和战斗理由。角色是为何而战？她的行动准则是什么？
- **羁绊 (bonds)**：根据问卷中涉及他人的回答（如前辈、搭档、家人等），描绘出角色的羁绊关系。关系可以是正面的，也可以是负面的，但应是塑造她性格和能力的关键。
`,
  temperature: 0.8,
  promptBuilder: ({ answers, language }) => {
    const questionAnswerPairs = formatQuestionnaireAnswers(answers);
    const flowers = getRandomFlowers();
    return `请基于以下问卷回答开始分析和预测：\n${questionAnswerPairs}\n\n可选的花名和对应的花语：${flowers}\n\n【重要指令】请你必须使用【${language}】进行内容创作。`;
  },
  schema: MagicalGirlDetailsSchema,
  taskName: "生成魔法少女详细信息",
}

// 处理器重构：
// 移除了队列和速率限制系统。该系统基于内存，在Serverless/Edge环境中无法正确共享状态，
// 导致功能失效并错误地拦截了前端的轮询请求。
// 现在，请求将直接、异步地调用AI生成函数。
async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const body = await req.json();
  const rawAnswers = body?.answers;
  const rawQuestionnaires = body?.questionnaires;
  const allowNativeSignature = body?.allowNativeSignature === true;
  const language = body?.language ?? 'zh-CN';
  const customProviderPayload = body?.customProvider;

  const questionnaires = normalizeQuestionnaires(rawQuestionnaires);
  const normalizedAnswers = resolveAnswerItems(rawAnswers, questionnaires);

  if (normalizedAnswers.length === 0) {
    return new Response(JSON.stringify({ error: 'Answers array is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const lengthError = validateAnswerLengths(normalizedAnswers, questionnaires);
  if (lengthError) {
    return new Response(JSON.stringify({ error: lengthError }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
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
    // 直接调用AI生成，不再入队
    const providerOptions = (customProviderOverride || shouldDisablePolling)
      ? {
        ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
        ...(shouldDisablePolling ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM } : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
      }
      : undefined;

    const magicalGirlDetails = await generateWithAI({ answers: normalizedAnswers, language }, {
      ...magicalGirlDetailsConfig,
      ...(customModelOverride ? { modelOverride: customModelOverride } : {}),
    }, providerOptions);

    // 异步保存到D1数据库，不阻塞对用户的响应
    // const saveData = {
    //   ...magicalGirlDetails,
    //   answers: answers
    // };

    // // 在Edge环境中，可以使用executionContext.waitUntil来确保异步任务完成
    // const executionContext = (req as any).context;
    // if (executionContext && typeof executionContext.waitUntil === 'function') {
    //   executionContext.waitUntil(saveToD1(saveData));
    // } else {
    //   // 在非Edge环境中，直接调用（不等待完成）
    //   saveToD1(saveData).catch(err => log.error('保存到D1失败（非阻塞）', err));
    // }

    // 将用户答案和生成结果合并，并添加模板ID，为签名做准备
    const dataToSign = {
        ...magicalGirlDetails,
        templateId: "魔法少女/心之花/魔法少女（问卷生成）", // 添加模板ID
        userAnswers: normalizedAnswers
    };

    if (!allowNativeSignature) {
      return new Response(JSON.stringify(dataToSign), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
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
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    log.error('生成魔法少女详细信息失败', { error, answersLength: normalizedAnswers.length });
    const errorMessage = error instanceof Error ? error.message : '服务器内部错误';
    return new Response(JSON.stringify({ error: '生成失败，当前服务器可能正忙，请稍后重试', message: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export default handler;
const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
});
