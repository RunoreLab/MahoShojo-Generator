// pages/api/generate-magical-girl-details-stream.ts

import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import questionnaire from '@/public/questionnaire.json';
import { getLogger } from '@/lib/logger';
import { buildMagicalQuestionMeta } from '@/lib/questionnaires';
import { type AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { generateWithStreamAI, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/stream/raw-ai';

const log = getLogger('api-gen-details-stream');

export const config = {
  runtime: 'edge',
};

const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
});

async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const parsedBody = await req.json();
    const { answers: rawAnswers, language = 'zh-CN', customProvider: customProviderPayload } = parsedBody ?? {};

    if (!Array.isArray(rawAnswers) || rawAnswers.length === 0) {
      return new Response(JSON.stringify({ error: 'Answers array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const questionMeta = buildMagicalQuestionMeta(rawAnswers.length);
    const normalizedAnswers: string[] = [];

    for (const [index, answer] of rawAnswers.entries()) {
      if (typeof answer !== 'string') {
        return new Response(JSON.stringify({ error: 'All answers must be non-empty strings' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const trimmedAnswer = answer.trim();
      if (!trimmedAnswer) {
        return new Response(JSON.stringify({ error: 'All answers must be non-empty strings' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const meta = questionMeta[index];
      const maxAllowedLength = Math.max(meta?.maxLength ?? 200, 150);
      if (trimmedAnswer.length > maxAllowedLength) {
        return new Response(JSON.stringify({ error: `第 ${index + 1} 题的答案字数超过限制（最多 ${maxAllowedLength} 字）` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      normalizedAnswers.push(trimmedAnswer);
    }

    const safetyResponse = await enforceTextSafety({
      text: normalizedAnswers.join(' '),
      log,
      enableAiSafetyCheck: false,
      sensitiveWordReason: '在问卷中使用了危险符文',
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

    const questionList = Array.isArray((questionnaire as any)?.questions) ? ((questionnaire as any).questions as string[]) : [];
    const qaText = normalizedAnswers
      .map((answer, index) => {
        const question = questionList[index] ? String(questionList[index]).trim() : `问题 ${index + 1}`;
        return `Q${index + 1}. ${question}\nA: ${answer}`;
      })
      .join('\n\n');

    const prompt = `
你是魔法国度的妖精，你准备通过问卷调查的形式，事先通过问卷结果分析某人成为魔法少女后的能力等各项素质。魔法少女的性格倾向、经历背景、行事准则等等都会影响到她们在魔法少女道路上的潜力和表现。

【重要】输出要求：
1) 必须使用【${language}】创作。
2) 必须直接输出 Markdown 正文，不要输出“我将要/我不能”之类的解释。
3) 第 1 行必须是一级标题（以 "# " 开头），写一个适合作为角色档案标题的名字（优先写代号/称号，不超过 30 字）。
4) 在开头 20 行内，尽量给出明确字段（若无法推断可写“未指定”）：
   - 代号：...
   - 名字：...
5) 正文建议包含：外观、性格与信念、羁绊、能力与限制、战斗风格、魔装、奇境规则、繁开形态、关键经历、成长方向。

你需要根据下列内容说明提供你的分析和预测，预测结果中的具体内容解释如下。
1.魔力构装（简称魔装）：魔法少女的本相魔力所孕育的能力具现，是魔法少女能力体系的基础。一般呈现为魔法少女在现实生活中接触过，在冥冥之中与其命运关联或映射的物体，并且与魔法少女特色能力相关。例如，泡泡机形态的魔装可以使魔法少女制造魔法泡泡，而这些泡泡可以拥有产生幻象、缓冲防护、束缚困敌等能力。这部分的内容需包含魔装的名字（通常为2字词），魔装的形态，魔装的基本能力。
2.奇境规则：魔法少女的本相灵魂所孕育的能力，是魔装能力的一体两面。奇境是魔装能力在规则层面上的升华，体现为与魔装相关的规则领域，而规则的倾向则会根据魔法少女的倾向而有不同的发展。例如，泡泡机形态的魔装升华而来的奇境规则可以是倾向于守护的“戳破泡泡的东西将会立即无效化”，也可以是倾向于进攻的“沾到身上的泡泡被戳破会立即遭受伤害”。
3.繁开：是魔法少女魔装能力的二段进化与解放，无论是作为魔法少女的魔力衣装还是魔装的武器外形都会发生改变。需包含繁开状态魔装名（需要包含原魔装名的每个字），繁开后的进化能力，繁开后的魔装形态，繁开后的魔法少女衣装样式（在通常变身外观上的升级与改变）。
4.角色背景：请深入挖掘并创作能够体现角色立体形象与人物弧光的背景故事。
- **信念 (belief)**：根据问卷回答，提炼出角色的核心价值观和战斗理由。角色是为何而战？她的行动准则是什么？
- **羁绊 (bonds)**：根据问卷中涉及他人的回答（如前辈、搭档、家人等），描绘出角色的羁绊关系。关系可以是正面的，也可以是负面的，但应是塑造她性格和能力的关键。
5.评价和建议：请你给出你对角色的看法和建议。

以下是一位潜在魔法少女对问卷所给出的回答（对方可以不回答某些问题），请你据此预测她成为魔法少女后的情况。
【问卷回答】
${qaText}
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
        temperature: 0.75,
        maxOutputTokens: 4096,
        ...(customModelOverride ? { modelOverride: customModelOverride } : {}),
      },
      providerOptions
    );

    return streamResult.response;
  } catch (error) {
    log.error('流式生成通用角色卡失败', { error });
    const errorMessage = error instanceof Error ? error.message : '服务器内部错误';
    return new Response(JSON.stringify({ error: '生成失败', message: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default handler;

