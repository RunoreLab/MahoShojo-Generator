// pages/api/generate-canshou.ts
import { z } from 'zod/v3';
import { generateWithAI, GenerationConfig, LoadBalanceStrategy } from '../../lib/ai';
import { getLogger } from '../../lib/logger';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { NextRequest } from 'next/server';
import { generateSignature } from '../../lib/signature'; // 导入签名工具
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { type AIProvider } from '@/lib/config';

const log = getLogger('api-gen-canshou');

export const config = {
  runtime: 'edge',
};

// 残兽设定，硬编码以兼容Edge Runtime
const canshouLore = `
# 残兽设定整理

## 概述
残兽是突然出现在人类城市，进行无差别破坏与杀戮的神秘怪物。普通的物理攻击，即使是高威力的热武器，也无法对其造成有效伤害。因此，魔法少女是讨伐残兽的主力。

## 进化阶段
残兽拥有类似于昆虫的进化阶段，每一次进化都会带来断崖式的实力增强。已知的阶段包括：

* **卵 (Egg)**
    * 最初级的阶段，也是最弱小的形态。
    * 通常表现为巨大的肉块状，行动迟缓，凭本能进行破坏。

* **蠖 (Caterpillar/Larva)**
    * 比“卵”更高级的阶段，实力和速度都有显著提升。

* **蛹 (Pupa)**
    * **筑巢**：此阶段的残兽会以某片区域为据点，扭曲时空间形成自己的“巢穴”（也就是它的“蛹”），以便储备充足的魔力和营养，为下一阶段的进化做准备。
    * **智慧提升**：不再像“卵”阶段那样无脑，而是拥有近似野兽的智慧，会更隐秘地行动，躲避魔法少女和异策局的追踪来满足进食需求。
    * **吸引低级残兽**：“蛹”级残兽的巢穴会吸引许多低级的残兽前来寄居，通常会迫使前来讨伐的魔法少女不得不与众多低级残兽战斗。
    * **同类相食**：残兽的食谱也包括其他残兽。

* **蜕 (Molt)**
    * “蛹”之后的更高阶进化形态，实力远超之前的阶段。与“蕾”级的魔法少女类似，“蜕”级的残兽可以形成自己的“规则”，在特定区域内（巢穴）改写物理法则，创造对自己绝对有利的战斗环境。
    * **半蜕 (Half-Molt)**：介于“蛹”和“蜕”之间的过渡阶段。已经开始拥有形成“规则”的雏形，但尚不完善，是“蜕”级残兽最虚弱的形态。
    * **蜕 (Molt)**：完全体，能够构建并维持成熟的“规则”，实力极为强大。通常需要复数的“蕾”级魔法少女联手才能讨伐。
    * **王蜕 (King-Molt)**：在“蜕”级中也属于顶点的存在，是能够与花级魔法少女正面对抗的恐怖对手。

* **羽 (Wing)**
    * “蜕”之上的最终进化形态，强度远超花级魔法少女，基本上无人能敌。

## 残兽的来源

* **野生**: 野生残兽会毫无征兆地出现在城市中，其出现频率和地点似乎没有明确的规律，被认为是通过某些未知的途径来到这个世界。首领为“兽主”。
* **黑烬黎明**: 由堕落的魔法使组成的反魔法国度、反魔法少女组织，掌握了人为制造和转化残兽的技术，可以将一些人类转化为残兽。
* **爪痕**: 由叛逃魔法少女组成的结社，同样拥有制造残兽的能力。她们接纳那些国度叛逃的魔法少女和妖精，将其转化为半兽形态，使其拥有远超常人的力量。首领为“白狼”。
`;


// 定义残兽设定的Zod Schema
const CanshouSchema = z.object({
  name: z.string().describe('残兽的名称，应体现其核心概念和特征'),
  coreConcept: z.string().describe('对残兽核心概念的概括'),
  coreEmotion: z.string().describe('对残兽核心情感/欲望的概括'),
  evolutionStage: z.string().describe('残兽所处的进化阶段'),
  appearance: z.string().describe('外貌形态的详细描述，整合用户输入并进行扩展'),
  materialAndSkin: z.string().describe('材质与表皮的详细描述，整合用户输入并进行扩展'),
  featuresAndAppendages: z.string().describe('特征与附属物的详细描述，整合用户输入并进行扩展'),
  attackMethod: z.string().describe('主要攻击方式的详细描述'),
  specialAbility: z.string().describe('特殊能力的详细描述和运作机制'),
  origin: z.string().describe('起源故事的详细阐述'),
  birthEnvironment: z.string().describe('诞生环境的详细描述'),
  researcherNotes: z.string().describe('作为魔法国度残兽研究学者的分析、预测和警告'),
});

const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
});

type CanshouDetails = z.infer<typeof CanshouSchema>;

// AI生成配置
const canshouGenerationConfig: GenerationConfig<CanshouDetails, { answers: Record<string, string>, language: string }> = {
  systemPrompt: `你是一名魔法国度的研究学者，你的任务是根据一线调查员提交的问卷报告，分析并生成一份详细的档案。
  首先，这是关于残兽的基础设定，你必须严格遵守：
  ${canshouLore}

  请根据用户提供的问卷答案，以结构化的JSON格式返回详细设定，包括对其各项特征的详细描述和你作为研究学者的专业分析笔记。`,
  temperature: 0.8,
  promptBuilder: ({ answers, language }: { answers: Record<string, string>, language: string }) => {
    const answerText = Object.entries(answers)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join('\n');
    return `以下是调查员提交的问卷报告，请基于此进行分析：\n${answerText}\n\n【重要指令】请你必须使用【${language}】进行内容创作。`;
  },
  schema: CanshouSchema,
  taskName: "生成残兽档案",
  maxOutputTokens: 8192,
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
    const { answers, language = 'zh-CN', customProvider: customProviderPayload } = parsedBody;

    if (!answers || typeof answers !== 'object' || Object.keys(answers).length === 0) {
      return new Response(JSON.stringify({ error: 'Answers object is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 安全检查：检查用户输入是否包含敏感词
    const answersString = Object.values(answers).join(' ');
    const checkResult = await quickCheck(answersString);
    if (checkResult.hasSensitiveWords) {
      // 在服务器端记录日志，然后返回一个通用错误给前端，前端将处理跳转
      log.warn('检测到敏感词，请求被拒绝', { detected: checkResult.detectedWords });
      return new Response(JSON.stringify({ error: '输入内容不合规', shouldRedirect: true }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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
    const canshouDetails = await generateWithAI({ answers, language }, {
      ...canshouGenerationConfig,
      ...(customModelOverride ? { modelOverride: customModelOverride } : {}),
    }, providerOptions);

    // 将用户答案和生成结果合并，并添加模板ID，为签名做准备
    const dataToSign = {
        ...canshouDetails,
        templateId: "魔法少女/心之花/残兽（问卷生成）", // 添加模板ID
        userAnswers: answers
    };

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
