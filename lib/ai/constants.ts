// constants.ts
// 定义前端可选的 AI 供应商与模型映射，供配置组件展示使用。

export interface AIModelOption {
    value: string;
    label: string;
    description: string;
}

export interface AIProviderOption {
    id: string;
    name: string;
    description: string;
    docsUrl: string;
    baseUrl: string;
    type: 'openai' | 'google' | 'deepseek';
    // 待实现
    mode?: 'auto' | 'json' | 'tool';
    models: AIModelOption[];
}

export const CUSTOM_AI_MODEL_OPTION_VALUE = '__custom_model_id__';
export const MAX_CUSTOM_AI_MODEL_ID_LENGTH = 200;

export const CUSTOM_AI_MODEL_OPTION: AIModelOption = {
    value: CUSTOM_AI_MODEL_OPTION_VALUE,
    label: '自定义模型',
    description: '手动填写该供应商支持的 modelId，仍使用当前预置供应商端点。'
};

export type ResolvedAIProviderModel = {
    modelId: string;
    isCustom: boolean;
};

export const canUseCustomModelId = (provider: AIProviderOption | null | undefined): boolean => {
    if (!provider) return false;
    return provider.id !== 'system' && provider.baseUrl.trim().length > 0;
};

const normalizeCustomModelId = (modelId: string): string | null => {
    const normalized = modelId.trim();
    if (!normalized) return null;
    if (normalized === CUSTOM_AI_MODEL_OPTION_VALUE) return null;
    if (normalized.length > MAX_CUSTOM_AI_MODEL_ID_LENGTH) return null;
    if (/[\u0000-\u001f\u007f]/.test(normalized)) return null;
    return normalized;
};

export const resolveAIProviderModel = (
    provider: AIProviderOption,
    rawModelId: string
): ResolvedAIProviderModel | null => {
    const modelId = rawModelId.trim();
    const preset = provider.models.find((model) => model.value === modelId);
    if (preset) {
        return { modelId: preset.value, isCustom: false };
    }

    const customModelId = normalizeCustomModelId(rawModelId);
    if (!customModelId || !canUseCustomModelId(provider)) {
        return null;
    }

    return { modelId: customModelId, isCustom: true };
};

const XIAOMI_MIMO_MODELS: AIModelOption[] = [
    {
        value: 'mimo-v2.5-pro',
        label: 'MiMo V2.5 Pro',
        description: '小米 MiMo V2.5 Pro，适合复杂指令、长文本创作与高质量生成。'
    },
    {
        value: 'mimo-v2.5',
        label: 'MiMo V2.5',
        description: '小米 MiMo V2.5 通用模型，适合日常对话、剧情推进与结构化文本生成。'
    },
    {
        value: 'mimo-v2.5-flash',
        label: 'MiMo V2.5 Flash',
        description: '小米 MiMo V2.5 高性价比轻量模型，适合成本敏感、高频生成与快速草稿。'
    },
    {
        value: 'mimo-v2-pro',
        label: 'MiMo V2 Pro',
        description: '小米 MiMo V2 Pro 旗舰推理模型，适合复杂指令、深度思考与工具调用。'
    },
    {
        value: 'mimo-v2-omni',
        label: 'MiMo V2 Omni',
        description: '小米 MiMo V2 Omni 全模态理解模型，文本场景可作为 V2.5 的兼容备用。'
    },
    {
        value: 'mimo-v2-flash',
        label: 'MiMo V2 Flash',
        description: '小米 MiMo V2 Flash 高效推理模型，适合速度优先与较低成本的文本生成。'
    }
];

const buildXiaomiMimoTokenPlanProvider = (
    id: string,
    nameSuffix: string,
    baseUrl: string
): AIProviderOption => ({
    id,
    name: `小米 MiMo Token Plan（${nameSuffix}）`,
    description: '小米 MiMo Token Plan OpenAI 兼容端点。仅使用 tp- 开头的 Token Plan API Key，不要与普通 sk- Key 混用。',
    docsUrl: 'https://platform.xiaomimimo.com',
    baseUrl,
    type: 'openai',
    mode: 'auto',
    models: XIAOMI_MIMO_MODELS.map(model => ({ ...model })),
});

/**
 * 可选 AI 供应商目录。
 * - description 用于向用户解释供应商特色。
 * - docsUrl 用于跳转至官方文档，帮助用户快速查看接入方式。
 * - baseUrl 为默认的 API 访问地址(当前版本由目录固定，未在 UI 中开放覆盖)。
 * - models 按常见用途给出推荐模型，方便快速选择。
 */
export const AI_PROVIDER_CATALOG: AIProviderOption[] = [
    {
        id: 'system',
        name: '使用系统默认配置',
        description: '依照服务器轮询策略自动选择供应商与模型。',
        docsUrl: '',
        baseUrl: '',
        type: 'openai',
        models: [
            {
                value: 'default',
                label: '默认策略',
                description: '常规场景保持原有调用顺序，默认倾向使用 Gemini 2.5 Flash；排位优先使用轻量模型。'
            },
            {
                value: 'gemini-3-flash-preview',
                label: 'Gemini 3.0 Flash',
                description: 'Google 旗下最新一代的先进模型，现已提供尝鲜使用。'
            },
            {
                value: 'gemini-3.1-flash-lite-preview',
                label: 'Gemini 3.1 Flash Lite',
                description: 'Google 最新一代高速轻量模型，适合预算敏感与高并发生成场景。'
            },
            {
                value: 'gemini-2.5-flash',
                label: 'Gemini 2.5 Flash',
                description: 'Google 旗下前代的最先进模型系列，在性能和价格上十分均衡，也是魔法少女生成器默认使用的模型。'
            },
            {
                value: 'gemini-2.5-flash-lite',
                label: 'Gemini 2.5 Flash Lite',
                description: 'Google 旗下前代的最先进模型系列，性能略差但是速度很快，是魔法少女生成器默认使用的轻量模型。'
            },
            {
                value: 'glm-5',
                label: 'GLM-5',
                description: '智谱旗下新一代通用模型，综合能力更强，适合复杂指令、多轮对话与高质量创作。'
            },
            {
                value: 'glm-4.7',
                label: 'GLM-4.7',
                description: '智谱旗下通用模型的更新版本，适合复杂指令、多轮对话与综合写作场景。'
            },
            {
                value: 'gemini-2.0-flash-exp',
                label: 'Gemini 2.0 Flash Exp',
                description: 'Google 旗下的上两代模型，但是真的好快！'
            },
            {
                value: 'gemma-4-31b-it',
                label: 'Gemma 4 31B IT',
                description: '较新的 Gemma 4 指令模型（31B），适合作为高优先级的 Gemma 备用选择。'
            },
            {
                value: 'gemma-4-26b-a4b-it',
                label: 'Gemma 4 26B A4B IT',
                description: '较新的 Gemma 4 指令模型（26B A4B），建议先作为可选备用通道使用。'
            },
            {
                value: 'gemma-3-27b-it',
                label: 'Gemma 3 27B IT',
                description: '更便宜但也更弱的 Gemma 3 指令模型（27B），建议仅作为流式输出的备用选择。'
            },
            {
                value: 'gemma-3-12b-it',
                label: 'Gemma 3 12B IT',
                description: '更便宜但也更弱的 Gemma 3 指令模型（12B），建议仅作为流式输出的备用选择。'
            },
            {
                value: 'gemma-3-4b-it',
                label: 'Gemma 3 4B IT',
                description: '更便宜但也更弱的 Gemma 3 指令模型（4B），这已经有点挑战极限了。'
            },
            {
                value: 'gemma-3-1b-it',
                label: 'Gemma 3 1B IT',
                description: '更便宜但也更弱的 Gemma 3 指令模型（1B），这真的会有人用吗？！'
            },
            {
                value: 'gemma-3-270m-it',
                label: 'Gemma 3 270M IT',
                description: '更便宜但也更弱的 Gemma 3 指令模型（270M），这真的会有人用吗？！'
            }
        ]
    },
    {
        id: 'kourichat',
        name: 'KouriChat',
        description: 'KouriChat 为用户提供了国内外广泛的模型库。',
        docsUrl: 'https://api.kourichat.com/register?aff=mahoshojo',
        baseUrl: 'https://api.kourichat.com/v1',
        type: 'openai',
        mode: 'json',
        models: [
            {
                value: 'gemini-3.1-pro-preview',
                label: 'Gemini 3.1 Pro',
                description: 'Google 最新一代的 Gemini 3.1 Pro 预览模型。'
            },
            {
                value: 'gemini-3-pro-preview',
                label: 'Gemini 3.0 Pro',
                description: 'Google 迄今为止最智能的模型系列，以先进的推理和联网搜索能力为基础。'
            },
            {
                value: 'gemini-3-flash-preview',
                label: 'Gemini 3.0 Flash',
                description: 'Google 迄今为止最智能的模型系列的略轻量的模型，推荐流式使用。'
            },
            {
                value: 'gemini-3.1-flash-lite-preview',
                label: 'Gemini 3.1 Flash Lite',
                description: 'Google 最新一代高速轻量模型，适合预算敏感与高并发生成场景。'
            },
            {
                value: 'gemini-2.5-pro',
                label: 'Gemini 2.5 Pro',
                description: 'Google 旗下前代的最先进模型系列，性能很棒棒。'
            },
            {
                value: 'gemini-2.5-pro-payg',
                label: 'Gemini 2.5 Pro (按次计费)',
                description: '按次计费，场景和人数或生成字数多的时候选用此模型性价比更高哦！'
            },
            {
                value: 'gemini-2.5-flash',
                label: 'Gemini 2.5 Flash',
                description: 'Google 旗下前代的最先进模型系列，在性能和价格上十分均衡，也是魔法少女生成器默认使用的模型。'
            },
            {
                value: 'gemini-2.5-flash-lite',
                label: 'Gemini 2.5 Flash Lite',
                description: 'Google 旗下前代的最先进模型系列，性能略差但是速度很快，是魔法少女生成器默认使用的轻量模型。'
            },
            {
                value: 'gpt-5.2',
                label: 'GPT-5.2',
                description: 'OpenAI 的新一代通用旗舰模型，适合高质量内容生成与复杂任务。'
            },
            {
                value: 'claude-haiku-4-5-20251001',
                label: 'Claude Haiku 4.5',
                description: 'Anthropic 旗下最快且最聪慧的 Haiku 模型，具有接近前沿的性能。第一个支持扩展思考的 Haiku 模型。'
            },
            {
                value: 'claude-sonnet-4-5-20250929',
                label: 'Claude Sonnet 4.5',
                description: 'Anthropic 旗下主力模型之一，写作、推理与长文本表现稳定。'
            },
            {
                value: 'claude-opus-4-6',
                label: 'Claude Opus 4.6',
                description: 'Anthropic 旗下旗舰模型，非常适合复杂的专业任务和高级代理。'
            },
            {
                value: 'grok-4',
                label: 'Grok 4',
                description: 'xAI 旗下通用模型，适合头脑风暴、创意发散与快速问答。'
            },
            {
                value: 'glm-5',
                label: 'GLM-5',
                description: '智谱旗下新一代通用模型，综合能力更强，适合复杂指令、多轮对话与高质量创作。'
            },
            {
                value: 'glm-5.1',
                label: 'GLM-5.1',
                description: '智谱旗下新一代通用模型，综合能力更强，适合复杂指令、多轮对话与高质量创作。'
            },
            {
                value: 'glm-4.5',
                label: 'GLM-4.5',
                description: '智谱旗下的通用对话与内容创作模型，适合轻量日常任务。'
            },
            {
                value: 'glm-4.6',
                label: 'GLM-4.6',
                description: '智谱旗下的通用指令模型，指令跟随与结构化输出更稳，适合中长文本任务。'
            },
            {
                value: 'glm-4.7',
                label: 'GLM-4.7',
                description: '智谱旗下通用模型的更新版本，适合复杂指令、多轮对话与综合写作场景。'
            },
            {
                value: 'deepseek-chat',
                label: 'DeepSeek Chat',
                description: '通用对话与分析模型，中文写作稳定；非流式可能不稳定，建议优先流式使用。'
            },
            {
                value: 'doubao-seed-1-6',
                label: 'Doubao Seed 1.6',
                description: '字节跳动旗下的通用对话模型，响应较快；非流式可能不稳定，建议优先流式使用。'
            },
            {
                value: 'doubao-seed-1-6-flash',
                label: 'Doubao Seed 1.6 Flash',
                description: '更轻量的快速版本豆包，适合高频对话或草稿生成，质量略低于标准版；非流式可能不稳定，建议流式使用。'
            },
            {
                value: 'deepseek-v3.2-exp',
                label: 'DeepSeek V3.2 Exp',
                description: 'DeepSeek 最新版本。'
            },
            {
                value: 'deepseek-r1',
                label: 'DeepSeek R1',
                description: 'DeepSeek 思考版本。'
            },
            //{
            //    value: 'qwen3.5-plus',
            //    label: 'Qwen 3.5 Plus',
            //    description: '通义千问 3.5 Plus，先进多模态开源旗舰模型，采用混合架构，能力强大。'
            //},
            {
                value: 'qwen3',
                label: 'Qwen 3',
                description: '阿里旗下的通义千问 3，先进开源模型，能力强大。'
            },
            {
                value: 'kimi-k2',
                label: 'Kimi K2',
                description: 'Moonshot 旗下的大模型，可以看出我懒得写描述了。'
            },
        ]
    },
    {
        id: 'chatbox',
        name: 'Chatbox AI',
        description: 'Chatbox AI 官方 OpenAI 兼容 API，按订阅计划可选不同模型梯度。',
        docsUrl: 'https://chatboxai.app/zh/#pricing',
        baseUrl: 'https://ai.chatboxai.app/v1',
        type: 'openai',
        mode: 'auto',
        models: [
            {
                value: 'gpt-5',
                label: 'GPT 5（高级）',
                description: '高级模型（Pro/Pro+）。适合高质量生成与复杂任务。'
            },
            {
                value: 'claude-4.5-sonnet',
                label: 'Claude 4.5 Sonnet（高级）',
                description: '高级模型（Pro/Pro+）。擅长长文本写作与稳健推理。'
            },
            {
                value: 'gemini-3.1-pro-preview',
                label: 'Gemini 3.1 Pro（高级）',
                description: '高级模型（Pro/Pro+）。在复杂指令与高难度创作上相较 3.0 Pro 更强。'
            },
            {
                value: 'gemini-3-pro',
                label: 'Gemini 3 Pro（高级）',
                description: '高级模型（Pro/Pro+）。适合复杂指令与高难度创作。'
            },
            {
                value: 'gemini-3-flash',
                label: 'Gemini 3 Flash（标准）',
                description: '标准模型（所有付费方案）。适合各类任务。'
            },
            {
                value: 'gemini-3.1-flash-lite-preview',
                label: 'Gemini 3.1 Flash Lite（标准）',
                description: '标准模型（所有付费方案）。极高速、低成本，适合高频交互与批量生成。'
            },
            {
                value: 'gemini-2.5-flash',
                label: 'Gemini 2.5 Flash（标准）',
                description: '标准模型（所有付费方案）。速度与质量均衡。'
            },
            {
                value: 'deepseek-chat',
                label: 'DeepSeek V3（标准）',
                description: '标准模型（所有付费方案）。适合日常对话与内容生成。'
            },
            {
                value: 'deepseek-reasoner',
                label: 'DeepSeek R1（标准）',
                description: '标准模型（所有付费方案）。适合多步推理与规划。'
            },
            {
                value: 'deepseek-v3.2',
                label: 'DeepSeek V3.2（标准）',
                description: '标准模型（所有付费方案）。作为 DeepSeek 新版本可选项。'
            },
            {
                value: 'kimi-k2',
                label: 'Kimi K2（标准）',
                description: '标准模型（所有付费方案）。中文内容生成与角色创作表现稳定。'
            },
            {
                value: 'gpt-5-mini',
                label: 'GPT 5-mini（标准）',
                description: '标准模型（所有付费方案）。更快更省，适合高频交互。'
            },
        ]
    },
    {
        id: 'tokendance',
        name: '词元跳动 TokenDance',
        description: '词元跳动是统一的 AI API 网关，支持 OpenAI 兼容协议、模型路由与自动容错。',
        docsUrl: 'https://tokendance.space/docs/quickstart',
        baseUrl: 'https://tokendance.space/gateway/v1',
        type: 'openai',
        mode: 'auto',
        models: [
            {
                value: 'minimax-m2.7',
                label: 'MiniMax M2.7',
                description: 'MiniMax 面向自主执行与真实工作流的新一代模型，适合复杂规划、长链路任务与高质量文本生成。'
            },
            {
                value: 'minimax-m2.5',
                label: 'MiniMax M2.5',
                description: 'MiniMax 面向真实工作场景的模型，适合办公文档、结构化输出与多步骤创作任务。'
            },
            {
                value: 'glm-5.1',
                label: 'GLM-5.1',
                description: '智谱新一代长链路模型，代码与复杂任务执行能力更强，适合高约束内容生成。'
            },
            {
                value: 'glm-5',
                label: 'GLM-5',
                description: '智谱旗舰级通用模型，适合复杂系统设计、多轮对话与高质量中文创作。'
            },
            {
                value: 'glm-4.7',
                label: 'GLM-4.7',
                description: '智谱通用模型更新版本，强化编程与多步推理，适合稳定的中文写作和结构化任务。'
            },
            {
                value: 'deepseek-v4-flash',
                label: 'DeepSeek V4 Flash',
                description: 'DeepSeek V4 的高速轻量版本，拥有长上下文能力，适合兼顾质量与成本的生成场景。'
            },
            {
                value: 'deepseek-v4-pro',
                label: 'DeepSeek V4 Pro',
                description: 'DeepSeek V4 完全体，适合复杂分析、长文本写作、Agent 任务与更高要求的生成。'
            },
            {
                value: 'deepseek-v3.2',
                label: 'DeepSeek V3.2',
                description: 'DeepSeek 通用对话与推理模型，适合剧情推进、总结、分析与多轮交互。'
            },
            {
                value: 'kimi-k2.6',
                label: 'Kimi K2.6',
                description: 'Moonshot 新一代多模态模型，适合长链路编程、复杂创作和多智能体式任务。'
            },
            {
                value: 'kimi-k2.5',
                label: 'Kimi K2.5',
                description: 'Moonshot Kimi 系列模型，适合中文创作、摘要、视觉编程与多轮指令跟随。'
            },
            {
                value: 'seed-2.0-pro',
                label: 'Seed 2.0 Pro',
                description: '字节 Seed 旗舰通用模型，面向复杂推理、长上下文、多模态理解与工具增强执行。'
            },
            {
                value: 'seed-2.0-lite',
                label: 'Seed 2.0 Lite',
                description: '字节 Seed 均衡型模型，适合高频企业场景、内容创作、信息处理与数据分析。'
            },
            {
                value: 'seed-2.0-mini',
                label: 'Seed 2.0 Mini',
                description: '字节 Seed 低时延轻量模型，适合成本敏感、高并发和草稿生成场景。'
            },
            {
                value: 'qwen3.5-plus',
                label: 'Qwen 3.5 Plus',
                description: '通义千问 3.5 Plus，百万上下文模型，适合长文本、多模态与复杂中文任务。'
            },
            {
                value: 'qwen3.5-flash',
                label: 'Qwen 3.5 Flash',
                description: '通义千问 3.5 Flash，响应速度快，适合高频交互、推理速度优先与批量生成。'
            },
            {
                value: 'qwen3-max',
                label: 'Qwen3 Max',
                description: '通义千问 Qwen3 Max，适合复杂指令、数学编码、知识问答与多语种生成。'
            },
            {
                value: 'qwen3-vl-plus',
                label: 'Qwen3 VL Plus',
                description: '通义千问视觉理解模型，适合多模态输入、视觉智能体和长视频理解场景。'
            },
            {
                value: 'step-3.5-flash',
                label: 'Step 3.5 Flash',
                description: '阶跃星辰开源基础模型，侧重推理速度与效率，适合长上下文下的快速生成。'
            },
        ]
    },
    {
        id: 'xiaomi-mimo',
        name: '小米 MiMo',
        description: '小米 MiMo 普通 API OpenAI 兼容端点。仅使用 sk- 开头的按量付费 API Key，不要与 Token Plan 的 tp- Key 混用。',
        docsUrl: 'https://platform.xiaomimimo.com',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        type: 'openai',
        mode: 'auto',
        models: XIAOMI_MIMO_MODELS,
    },
    buildXiaomiMimoTokenPlanProvider(
        'xiaomi-mimo-token-plan-cn',
        '中国大陆',
        'https://token-plan-cn.xiaomimimo.com/v1'
    ),
    buildXiaomiMimoTokenPlanProvider(
        'xiaomi-mimo-token-plan-ams',
        '欧洲',
        'https://token-plan-ams.xiaomimimo.com/v1'
    ),
    buildXiaomiMimoTokenPlanProvider(
        'xiaomi-mimo-token-plan-sgp',
        '新加坡',
        'https://token-plan-sgp.xiaomimimo.com/v1'
    ),
    {
        id: 'yiye',
        name: '一叶知秋 API',
        description: '一叶知秋 API 为用户提供了国内外广泛的模型库，性价比高但不太稳定。',
        docsUrl: 'https://88996.cloud/register?aff=ITPX',
        baseUrl: 'https://88996.cloud/v1',
        type: 'openai',
        mode: 'json',
        models: [
            {
                value: 'gemini-3.1-pro-preview',
                label: 'Gemini 3.1 Pro',
                description: 'Google 最新一代的 Gemini 3.1 Pro 预览模型。'
            },
            {
                value: 'gemini-3-pro-preview',
                label: 'Gemini 3.0 Pro',
                description: 'Google 迄今为止最智能的模型系列，以先进的推理和联网搜索能力为基础。'
            },
            {
                value: 'gemini-3-flash-preview',
                label: 'Gemini 3.0 Flash',
                description: 'Google 迄今为止最智能的模型系列的略轻量的模型，推荐流式使用。'
            },
            {
                value: 'gemini-3.1-flash-lite-preview',
                label: 'Gemini 3.1 Flash Lite',
                description: 'Google 最新一代高速轻量模型，适合预算敏感与高并发生成场景。'
            },
            {
                value: 'gemini-2.5-pro',
                label: 'Gemini 2.5 Pro',
                description: 'Google 旗下前代的最先进模型系列，性能很棒棒。'
            },
            // {
            //     value: 'gemini-2.5-pro-payg',
            //     label: 'Gemini 2.5 Pro (按次计费)',
            //     description: '按次计费，场景和人数或生成字数多的时候选用此模型性价比更高哦！'
            // },
            {
                value: 'gemini-2.5-flash',
                label: 'Gemini 2.5 Flash',
                description: 'Google 旗下前代的最先进模型系列，在性能和价格上十分均衡，也是魔法少女生成器默认使用的模型。'
            },
            {
                value: 'gemini-2.5-flash-lite-preview-09-2025',
                label: 'Gemini 2.5 Flash Lite',
                description: 'Google 旗下前代的最先进模型系列，性能略差但是速度很快，是魔法少女生成器默认使用的轻量模型。'
            },
            {
                value: 'gpt-5.2',
                label: 'GPT-5.2',
                description: 'OpenAI 的新一代通用旗舰模型，适合高质量内容生成与复杂任务。'
            },
            {
                value: 'claude-sonnet-4-5',
                label: 'Claude Sonnet 4.5',
                description: 'Anthropic 旗下主力模型之一，写作、推理与长文本表现稳定。'
            },
            {
                value: 'grok-4',
                label: 'Grok 4',
                description: 'xAI 旗下通用模型，适合头脑风暴、创意发散与快速问答。'
            },
            {
                value: 'glm-5',
                label: 'GLM-5',
                description: '智谱新一代通用模型，适合中文对话、总结与结构化输出。'
            },
            {
                value: 'glm-5.1',
                label: 'GLM-5.1',
                description: '智谱旗下新一代通用模型，综合能力更强，适合复杂指令、多轮对话与高质量创作。'
            },
            {
                value: 'glm-4.6',
                label: 'GLM-4.6',
                description: '通用指令模型，适合中文对话、总结与结构化输出。'
            },
            {
                value: 'qwen3.5-397b-a17b',
                label: 'Qwen 3.5 397b',
                description: '通义千问 3.5 397B，先进多模态开源旗舰模型，采用混合架构，能力强大。'
            },
            {
                value: 'deepseek-ai/DeepSeek-V3.2',
                label: 'DeepSeek V3.2',
                description: '通用对话与推理模型，适合分析、总结与多轮交互。'
            },
        ]
    },
    {
        id: 'nova-cervus',
        name: '鹿鹿 API',
        description: '鹿鹿 API 为用户提供了国内外广泛的模型库，主要是按次计费，适合按可用性挑选单模型通道。',
        docsUrl: 'https://nova.cervus.top/register?aff=i0uQ',
        baseUrl: 'https://nova.cervus.top/v1',
        type: 'openai',
        mode: 'json',
        models: [
            {
                value: '[鹿鹿10]gemini-3.1-pro-preview',
                label: 'Gemini 3.1 Pro（按次）',
                description: '鹿鹿当前可选的 Gemini 3.1 Pro 按次档之一，适合复杂指令、高质量创作与长文本任务。'
            },
            {
                value: '[鹿鹿10]gemini-3-pro-preview',
                label: 'Gemini 3.0 Pro（按次）',
                description: '较稳定的 Gemini 3.0 Pro 按次通道，适合综合写作、推理与结构化生成。'
            },
            {
                value: '[鹿鹿2]gemini-3-flash-preview',
                label: 'Gemini 3.0 Flash（按次）',
                description: '鹿鹿的 Gemini 3.0 Flash 档位，适合高频交互与流式生成。'
            },
            {
                value: '[鹿鹿10]gemini-2.5-pro',
                label: 'Gemini 2.5 Pro（按次）',
                description: '鹿鹿的 Gemini 2.5 Pro 按次通道，适合质量优先的文本生成场景。'
            },
            {
                value: '[鹿鹿5]gemini-2.5-pro-preview-06-05',
                label: 'Gemini 2.5 Pro（按量）',
                description: '鹿鹿的 Gemini 2.5 Pro 按量通道，适合质量优先的文本生成场景。'
            },
            {
                value: '[鹿鹿2]gemini-2.5-flash',
                label: 'Gemini 2.5 Flash（按次）',
                description: 'Gemini 2.5 Flash 的按次通道，适合作为均衡速度与成本的常用选择。'
            },
            {
                value: '[鹿鹿14]claude-sonnet-4-6',
                label: 'Claude Sonnet 4.6（按次）',
                description: '鹿鹿的 Claude Sonnet 4.6 档位，适合稳健写作与长文本整理。'
            },
            {
                value: '[鹿鹿14]claude-sonnet-4-5-20250929',
                label: 'Claude Sonnet 4.5（按次）',
                description: '鹿鹿的 Claude Sonnet 4.5 按次档，状态波动较大，建议作为备用通道。'
            },
            {
                value: '[鹿鹿14]claude-opus-4-6',
                label: 'Claude Opus 4.6（按次）',
                description: 'Claude Opus 4.6 的按次通道，适合复杂创作与高要求任务。'
            },
            {
                value: '[鹿鹿1]deepseek/deepseek-r1-0528:free',
                label: 'DeepSeek R1（免费）',
                description: '鹿鹿提供的 DeepSeek 免费试用档，实时状态通常不稳定，适合作为低成本备用入口。'
            },
            {
                value: '[鹿鹿1]qwen/qwen3-next-80b-a3b-instruct:free',
                label: 'Qwen3 Next 80B（免费）',
                description: '鹿鹿提供的 Qwen3 免费试用档，适合低成本尝试，但实时可用性较弱。'
            },
        ]
    },
    {
        id: 'modelscope',
        name: '魔搭 Modelscope',
        description: '阿里云旗下专注于人工智能领域的开源模型平台，提供针对国内大模型的免费推理服务。',
        docsUrl: 'https://www.modelscope.cn/my/myaccesstoken',
        baseUrl: 'https://api-inference.modelscope.cn/v1',
        type: 'openai',
        mode: 'json',
        models: [
            {
                value: 'deepseek-ai/DeepSeek-V4-Flash',
                label: 'DeepSeek V4 Flash',
                description:
                    'DeepSeek V4 的高速轻量版本，但是体验也很强大，据称文本生成体验堪比 gemini-3.1-pro。'
            },
            {
                value: 'deepseek-ai/DeepSeek-V4-Pro',
                label: 'DeepSeek V4 Pro',
                description: 'DeepSeek V4 的完全体，适合复杂分析、长文本写作与更高要求的生成任务。'
            },
            {
                value: 'Qwen/Qwen3.5-397B-A17B',
                label: '通义千问 3.5 397B',
                description: '通义千问 3.5 的高规格版本，适合复杂中文写作、长文本与高约束结构化任务。'
            },
            {
                value: 'Qwen/Qwen3.5-122B-A10B',
                label: '通义千问 3.5 122B',
                description: '通义千问 3.5 的 122B 参数版本。'
            },
            {
                value: 'Qwen/Qwen3.5-35B-A3B',
                label: '通义千问 3.5 35B',
                description: '通义千问 3.5 的 35B 参数版本。'
            },
            {
                value: 'Qwen/Qwen3.5-27B',
                label: '通义千问 3.5 27B',
                description: '通义千问 3.5 的 27B 参数版本。'
            },
            {
                value: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
                label: '通义千问 3 235B（指令）',
                description: '旗舰级指令模型，擅长中文对话、写作与复杂指令，适合长文本与结构化任务。'
            },
            {
                value: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
                label: '通义千问 3 235B（思考）',
                description: '通义千问 3 的思考版本，更擅长推理。'
            },
            {
                value: 'ZhipuAI/GLM-5',
                label: 'GLM-5',
                description: '面向中文场景的新一代通用模型，适合复杂对话、改写与信息整理。'
            },
            {
                value: 'ZhipuAI/GLM-5.1',
                label: 'GLM-5.1',
                description: '智谱旗下新一代通用模型，综合能力更强，适合复杂指令、多轮对话与高质量创作。'
            },
            {
                value: 'ZhipuAI/GLM-4.7-Flash',
                label: 'GLM-4.7 Flash',
                description: '智谱旗下 GLM 4.7 快速版，适合复杂指令、多轮对话与较快响应场景。'
            },
            {
                value: 'deepseek-ai/DeepSeek-V3.2',
                label: 'DeepSeek V3.2',
                description: '通用对话与推理模型，适合分析、总结与多轮交互。'
            },
            {
                value: 'deepseek-ai/DeepSeek-R1-0528',
                label: 'DeepSeek R1',
                description: '推理强项模型，适合需要多步思考的分析、规划与推导场景。'
            },
            {
                value: 'LLM-Research/Llama-4-Maverick-17B-128E-Instruct',
                label: 'Llama 4 Maverick 17B（指令）',
                description: 'Meta 在 2025 年 4 月发布的开源多模态人工智能模型。'
            },
            {
                value: 'MiniMax/MiniMax-M2.5',
                label: 'MiniMax-M2.5',
                description: '稀宇科技 MiniMax 旗下开源模型，专为编码与智能体任务进行优化。'
            },
            {
                value: 'moonshotai/Kimi-K2.5',
                label: 'Kimi K2.5',
                description: 'Moonshot 当前在魔搭可用的 Kimi 系列模型，适合中文创作、摘要与多轮指令跟随。'
            },
        ]
    },
    {
        id: 'google-cloudflare',
        name: 'Google',
        description: '咕咕噜噜原生渠道直连，使用 Cloudflare 代理。',
        docsUrl: 'https://aistudio.google.com/',
        baseUrl: 'https://gateway.ai.cloudflare.com/v1/5e2c3572782d87ae449e050ac15d6c5d/mhsj-custom/google-ai-studio/v1beta',
        type: 'google',
        models: [
            {
                value: 'gemini-3.1-pro-preview',
                label: 'Gemini 3.1 Pro',
                description: 'Google 最新一代的 Gemini 3.1 Pro 预览模型。'
            },
            {
                value: 'gemini-3-pro-preview',
                label: 'Gemini 3.0 Pro',
                description: 'Google 迄今为止最智能的模型系列，以先进的推理和联网搜索能力为基础。'
            },
            {
                value: 'gemini-3-flash-preview',
                label: 'Gemini 3.0 Flash',
                description: 'Google 旗下最新一代的先进模型，现已提供尝鲜使用。'
            },
            {
                value: 'gemini-3.1-flash-lite-preview',
                label: 'Gemini 3.1 Flash Lite',
                description: 'Google 最新一代高速轻量模型，适合预算敏感与高并发生成场景。'
            },
            {
                value: 'gemini-2.5-pro',
                label: 'Gemini 2.5 Pro',
                description: 'Google 旗下前代的最先进模型系列，性能很棒棒。'
            },
            {
                value: 'gemini-2.5-flash',
                label: 'Gemini 2.5 Flash',
                description: 'Google 旗下前代的最先进模型系列，在性能和价格上十分均衡，也是魔法少女生成器默认使用的模型。'
            },
            {
                value: 'gemini-2.5-flash-lite',
                label: 'Gemini 2.5 Flash Lite',
                description: 'Google 旗下前代的最先进模型系列，性能略差但是速度很快，是魔法少女生成器默认使用的轻量模型。'
            },
            {
                value: 'gemini-2.0-flash',
                label: 'Gemini 2.0 Flash',
                description: 'Google 早前的旗舰快模型，成本低且兼具多模态能力，适合作为备用通道。'
            },
            {
                value: 'gemini-2.0-flash-lite',
                label: 'Gemini 2.0 Flash Lite',
                description: 'Google 早前的轻量版快速模型，速度极快，适合预算敏感或高并发场景。'
            },
            {
                value: 'gemma-4-31b-it',
                label: 'Gemma 4 31B IT',
                description: '较新的 Gemma 4 指令模型（31B），适合作为高优先级的 Gemma 备用选择。'
            },
            {
                value: 'gemma-4-26b-a4b-it',
                label: 'Gemma 4 26B A4B IT',
                description: '较新的 Gemma 4 指令模型（26B A4B），建议先作为可选备用通道使用。'
            },
            {
                value: 'gemma-3-27b-it',
                label: 'Gemma 3 27B IT',
                description: '更便宜但也更弱的 Gemma 3 指令模型（27B），建议仅用于流式生成的备用通道。'
            },
            {
                value: 'gemma-3-12b-it',
                label: 'Gemma 3 12B IT',
                description: '更便宜但也更弱的 Gemma 3 指令模型（12B），建议仅用于流式生成的备用通道。'
            },
            {
                value: 'gemma-3-4b-it',
                label: 'Gemma 3 4B IT',
                description: '更便宜但也更弱的 Gemma 3 指令模型（4B），这已经有点挑战极限了。'
            },
            {
                value: 'gemma-3-1b-it',
                label: 'Gemma 3 1B IT',
                description: '更便宜但也更弱的 Gemma 3 指令模型（1B），这真的会有人用吗？！'
            },
            {
                value: 'gemma-3-270m-it',
                label: 'Gemma 3 270M IT',
                description: '更便宜但也更弱的 Gemma 3 指令模型（270M），这真的会有人用吗？！'
            },
        ]
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        description: 'DeepSeek 官方 API 直连。',
        docsUrl: 'https://platform.deepseek.com',
        baseUrl: 'https://api.deepseek.com',
        type: 'deepseek',
        mode: 'auto',
        models: [
            { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', description: 'DeepSeek V4 的高速轻量版本，但是体验也很强大，据称文本生成体验堪比 gemini-3.1-pro。' },
            { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: 'DeepSeek V4 的完全体，适合复杂分析、长文本写作与更高要求的生成任务。' },
            { value: 'deepseek-chat', label: 'DeepSeek-V3.2', description: '通用对话与分析模型，适合日常问答、写作与总结。' },
            { value: 'deepseek-reasoner', label: 'DeepSeek-V3.2 思考模式', description: '思考模式会拉长推理链路，适合复杂问题与多步分析。' },
        ]
    },
    {
        id: 'siliconflow',
        name: '硅基流动 SiliconFlow',
        description: '硅基流动官方 OpenAI 兼容通道，覆盖 DeepSeek/GLM/Qwen/Kimi 等主流模型。',
        docsUrl: 'https://cloud.siliconflow.cn/i/1FLkYGHc',
        baseUrl: 'https://api.siliconflow.cn/v1',
        type: 'openai',
        mode: 'auto',
        models: [
            {
                value: 'deepseek-ai/DeepSeek-V3.2',
                label: 'DeepSeek V3.2',
                description: '通用对话与推理兼顾，适合剧情推进、设定整理与中文写作。'
            },
            {
                value: 'deepseek-ai/DeepSeek-R1',
                label: 'DeepSeek R1',
                description: '偏推理的思考模型，适合复杂规划、多步分析与高约束任务。'
            },
            {
                value: 'Pro/zai-org/GLM-5',
                label: 'GLM-5',
                description: '中文场景综合能力更强，适合复杂指令、结构化输出与多轮对话。'
            },
            {
                value: 'Pro/zai-org/GLM-5.1',
                label: 'GLM-5.1',
                description: '智谱旗下新一代通用模型，综合能力更强，适合复杂指令、多轮对话与高质量创作。'
            },
            {
                value: 'Pro/zai-org/GLM-4.7',
                label: 'GLM-4.7',
                description: '中文场景表现稳定，适合结构化输出、改写与多轮对话。'
            },
            {
                value: 'zai-org/GLM-4.6',
                label: 'GLM-4.6',
                description: '中文场景表现稳定，适合结构化输出、改写与多轮对话。'
            },
            {
                value: 'Qwen/Qwen3.5-plus',
                label: 'Qwen 3.5 Plus',
                description: '通义千问 3.5 Plus，先进多模态开源旗舰模型，采用混合架构，能力强大。'
            },
            {
                value: 'Qwen/Qwen3-32B',
                label: 'Qwen3-32B',
                description: '响应速度与质量较均衡，适合高频交互与草稿生成。'
            },
            {
                value: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
                label: 'Qwen3-235B',
                description: '旗舰级长文本与复杂指令能力，适合高质量内容生成。'
            },
            {
                value: 'moonshotai/Kimi-K2-Instruct-0905',
                label: 'Kimi K2 Instruct',
                description: '擅长中文创作与多轮指令跟随，适合角色设定与风格化文案。'
            },
            {
                value: 'moonshotai/Kimi-K2-Thinking',
                label: 'Kimi K2 Thinking',
                description: 'Kimi K2 的思考版本，适合需要更强推理链路的任务。'
            },
        ]
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        description: '海外主流模型聚合平台，贵，但是最稳定。如果它炸了谷歌也就炸了。',
        docsUrl: 'https://openrouter.ai',
        baseUrl: 'https://openrouter.ai/api/v1',
        type: 'openai',
        mode: 'auto',
        models: [
            { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', description: 'Google 最新一代的 Gemini 3.1 Pro 预览模型。' },
            { value: 'google/gemini-3-pro-preview', label: 'Gemini 3.0 Pro', description: 'Google 迄今为止最智能的模型系列，以先进的推理和联网搜索能力为基础。' },
            { value: 'google/gemini-3-flash-preview', label: 'Gemini 3.0 Flash', description: 'Google 旗下最新一代的先进模型，现已提供尝鲜使用。' },
            { value: 'google/gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite', description: 'Google 最新一代高速轻量模型，适合预算敏感与高并发生成场景。' },
            { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Google 旗下前代的最先进模型系列，性能很棒棒。' },
            { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Google 旗下前代的最先进模型系列，在性能和价格上十分均衡，也是魔法少女生成器默认使用的模型。' },
            { value: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', description: 'Google 旗下前代的最先进模型系列，性能略差但是速度很快，是魔法少女生成器默认使用的轻量模型。' },
        ]
    },
    {
        id: 'poe',
        name: 'Poe',
        description: 'Quora 旗下的模型聚合平台，支持订阅制的多种顶尖模型接入。',
        docsUrl: 'https://poe.com/api/keys',
        baseUrl: 'https://api.poe.com/v1', // 视实际接入的桥接服务地址而定
        type: 'openai',
        mode: 'auto',
        models: [
            {
                value: 'gemini-2.5-pro',
                label: 'Gemini 2.5 Pro',
                description: 'Google 旗下前代的最先进模型系列，性能很棒棒。'
            },
            {
                value: 'gemini-2.5-flash',
                label: 'Gemini 2.5 Flash',
                description: 'Google 旗下前代的最先进模型系列，在性能和价格上十分均衡，也是魔法少女生成器默认使用的模型。'
            },
            {
                value: 'gemini-2.5-flash-lite',
                label: 'Gemini 2.5 Flash Lite',
                description: 'Google 旗下前代的最先进模型系列，性能略差但是速度很快，是魔法少女生成器默认使用的轻量模型。'
            },
            {
                value: 'gemini-3.1-pro',
                label: 'Gemini 3.1 Pro',
                description: 'Google 的 Gemini 3.1 Pro 预览模型。'
            },
            {
                value: 'gemini-3-pro',
                label: 'Gemini 3.0 Pro',
                description: 'Google 迄今为止最智能的模型系列，以先进的推理和联网搜索能力为基础。'
            },
            {
                value: 'gemini-3-flash',
                label: 'Gemini 3.0 Flash',
                description: 'Google 旗下的先进模型，现已提供尝鲜使用。'
            },
            {
                value: 'gemini-3.1-flash-lite',
                label: 'Gemini 3.1 Flash Lite',
                description: 'Google 最新一代高速轻量模型，适合预算敏感与高并发生成场景。'
            },
            {
                value: 'GPT-5.2',
                label: 'GPT-5.2',
                description: 'OpenAI 最新模型，综合能力更强，适合高质量生成与复杂任务。'
            },
            {
                value: 'Claude-Sonnet-4.5',
                label: 'Claude Sonnet 4.5',
                description: 'Anthropic 旗下主力模型之一，写作与推理很稳，适合角色设定与剧情推进。'
            },
            {
                value: 'Claude-Haiku-4.5',
                label: 'Claude Haiku 4.5',
                description: '更快更省的 Claude，适合高频对话、草稿生成与轻量改写。'
            },
            {
                value: 'Claude-Opus-4.1',
                label: 'Claude Opus 4.1',
                description: 'Claude 系列旗舰，质量上限更高，适合长文本与复杂创作。'
            },
            {
                value: 'Grok-4',
                label: 'Grok 4',
                description: 'xAI 旗下通用模型，适合头脑风暴、创意发散与快速问答。'
            },
            {
                value: 'deepseek-r1',
                label: 'DeepSeek R1',
                description: '推理强项模型，适合需要多步思考的分析、规划与推导场景。'
            },
            {
                value: 'deepseek-v3.2',
                label: 'DeepSeek V3.2',
                description: '深度求索旗下模型，旨在将高计算效率与最先进的推理和智能体性能相结合。'
            },
            {
                value: 'qwen-3.5-plus',
                label: 'Qwen 3.5 Plus',
                description: '通义千问 3.5 Plus，先进多模态开源旗舰模型，采用混合架构，能力强大。'
            },
            {
                value: 'kimi-k2.5',
                label: 'Kimi K2.5',
                description: 'Moonshot AI 旗下模型，在多模态和智能体能力方面实现了显著飞跃。'
            },
        ]
    },
    {
        id: 'nvidia',
        name: '英伟达 NVIDIA',
        description: 'NVIDIA Build 官方 OpenAI 兼容通道，老黄特供开源模型。优先收录可免费试用、口碑较好的文本与推理模型。',
        docsUrl: 'https://build.nvidia.com/',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        type: 'openai',
        mode: 'auto',

        models: [
            {
                value: 'google/gemma-4-31b-it',
                label: 'Gemma 4 31B IT',
                description: 'Gemma 4 主力档位，在 NVIDIA 通道下可作为高质量开源创作模型。'
            },
            {
                value: 'google/gemma-3-27b-it',
                label: 'Gemma 3 27B IT',
                description: '中高配 Gemma 3，适合兼顾速度、成本与结构化输出稳定性。'
            },
            {
                value: 'deepseek-ai/deepseek-v3.2',
                label: 'DeepSeek V3.2',
                description: 'DeepSeek 主力模型，适合中文写作、整理与通用分析。'
            },
            {
                value: 'deepseek-ai/deepseek-v3.1-terminus',
                label: 'DeepSeek V3.1 Terminus',
                description: '通用能力均衡，适合中文写作、整理、总结与结构化任务。'
            },
            {
                value: 'qwen/qwen3.5-397b-a17b',
                label: 'Qwen 3.5 397B',
                description: 'Qwen 3.5 大档位，适合高质量内容生成与复杂指令。'
            },
            {
                value: 'qwen/qwen3.5-122b-a10b',
                label: 'Qwen 3.5 122B',
                description: 'Qwen 3.5 中高档位，适合作为更均衡的中文创作选择。'
            },
            {
                value: 'moonshotai/kimi-k2.5',
                label: 'Kimi K2.5',
                description: 'Kimi 模型，适合创意发散、设定撰写与长文本续写。'
            },
            {
                value: 'moonshotai/kimi-k2-instruct',
                label: 'Kimi K2 Instruct',
                description: '长文本、创意写作和中文表达都很强，适合人设与剧情生成。'
            },
            {
                value: 'mistralai/mistral-large-3-675b-instruct-2512',
                label: 'Mistral Large 3 675B',
                description: '高质量通用旗舰，适合复杂指令、长文本和高要求创作。'
            },
            {
                value: 'qwen/qwq-32b',
                label: 'QwQ 32B',
                description: '偏推理与思考，适合复杂约束、分析和多步生成。'
            },
            {
                value: 'z-ai/glm4.7',
                label: 'GLM 4.7',
                description: '中文场景表现稳定，适合角色设定、续写与问答。'
            },
            {
                value: 'bytedance/seed-oss-36b-instruct',
                label: 'Seed OSS 36B Instruct',
                description: '字节系开源指令模型，适合通用写作和多轮对话。'
            },
            {
                value: 'mistralai/magistral-small-2506',
                label: 'Magistral Small',
                description: '较轻量的推理模型，适合需要思考链但不想太慢的任务。'
            },
            {
                value: 'mistralai/mistral-nemotron',
                label: 'Mistral Nemotron',
                description: '通用性与稳定性不错，适合作为均衡备用选项。'
            },
            {
                value: 'microsoft/phi-4-mini-flash-reasoning',
                label: 'Phi 4 Mini Flash Reasoning',
                description: '小而快的 reasoning 模型，适合预算敏感和高频调用。'
            },
            {
                value: 'tiiuae/falcon3-7b-instruct',
                label: 'Falcon 3 7B Instruct',
                description: '轻量通用模型，适合草稿、改写和低成本尝试。'
            },
            {
                value: 'mistralai/mistral-7b-instruct-v0.2',
                label: 'Mistral 7B Instruct',
                description: '经典轻量指令模型，适合基础聊天、润色和短文本生成。'
            },
            {
                value: 'nvidia/nemotron-mini-4b-instruct',
                label: 'Nemotron Mini 4B Instruct',
                description: '超轻量模型，适合低门槛试用与简短结构化输出。'
            },
        ]
    },
    {
        id: 'mystery',
        name: '魔法国度',
        description: '神秘渠道，不定时放送。',
        docsUrl: '',
        baseUrl: 'https://fmxalteyoxwi.jp-members-1.clawcloudrun.com/proxy/gemini-suda/v1beta',
        type: 'google',
        mode: 'auto',
        models: [
            {
                value: 'gemini-2.5-flash',
                label: 'Gemini 2.5 Flash',
                description: '神秘渠道的 Gemini 2.5 Flash 模型，随机出现，仅供娱乐。'
            },
        ]
    },
];
