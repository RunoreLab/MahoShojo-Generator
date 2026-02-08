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
                label: 'Gemini 3.0 Flash (预览版)',
                description: 'Google 旗下最新一代的先进模型，现已提供尝鲜使用。'
            },
            {
                value: 'gemini-2.5-flash',
                label: 'Gemini 2.5 Flash',
                description: 'Google 旗下上一代的最先进模型系列，在性能和价格上十分均衡，也是魔法少女生成器默认使用的模型。'
            },
            {
                value: 'gemini-2.5-flash-lite',
                label: 'Gemini 2.5 Flash Lite',
                description: 'Google 旗下上一代的最先进模型系列，性能略差但是速度很快，是魔法少女生成器默认使用的轻量模型。'
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
                value: 'gemini-3-pro-preview',
                label: 'Gemini 3.0 Pro (预览版)',
                description: 'Google 迄今为止最智能的模型系列，以先进的推理和联网搜索能力为基础。'
            },
            {
                value: 'gemini-3-flash-preview',
                label: 'Gemini 3.0 Flash',
                description: 'Google 迄今为止最智能的模型系列的略轻量的模型，推荐流式使用。'
            },
            {
                value: 'gemini-2.5-pro',
                label: 'Gemini 2.5 Pro',
                description: 'Google 旗下上一代的最先进模型系列，性能很棒棒。'
            },
            {
                value: 'gemini-2.5-pro-payg',
                label: 'Gemini 2.5 Pro (按次计费)',
                description: '按次计费，场景和人数或生成字数多的时候选用此模型性价比更高哦！'
            },
            {
                value: 'gemini-2.5-flash',
                label: 'Gemini 2.5 Flash',
                description: 'Google 旗下上一代的最先进模型系列，在性能和价格上十分均衡，也是魔法少女生成器默认使用的模型。'
            },
            {
                value: 'gemini-2.5-flash-lite',
                label: 'Gemini 2.5 Flash Lite',
                description: 'Google 旗下上一代的最先进模型系列，性能略差但是速度很快，是魔法少女生成器默认使用的轻量模型。'
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
        id: 'yiye',
        name: '一叶知秋 API',
        description: '一叶知秋 API 为用户提供了国内外广泛的模型库，性价比高但不太稳定。',
        docsUrl: 'https://88996.cloud/register?aff=ITPX',
        baseUrl: 'https://88996.cloud/v1',
        type: 'openai',
        mode: 'json',
        models: [
            {
                value: 'gemini-3-pro-preview',
                label: 'Gemini 3.0 Pro (测试)',
                description: 'Google 迄今为止最智能的模型系列，以先进的推理和联网搜索能力为基础。'
            },
            {
                value: 'gemini-3-flash-preview',
                label: 'Gemini 3.0 Flash',
                description: 'Google 迄今为止最智能的模型系列的略轻量的模型，推荐流式使用。'
            },
            {
                value: 'gemini-2.5-pro',
                label: 'Gemini 2.5 Pro',
                description: 'Google 旗下上一代的最先进模型系列，性能很棒棒。'
            },
            // {
            //     value: 'gemini-2.5-pro-payg',
            //     label: 'Gemini 2.5 Pro (按次计费)',
            //     description: '按次计费，场景和人数或生成字数多的时候选用此模型性价比更高哦！'
            // },
            {
                value: 'gemini-2.5-flash',
                label: 'Gemini 2.5 Flash',
                description: 'Google 旗下上一代的最先进模型系列，在性能和价格上十分均衡，也是魔法少女生成器默认使用的模型。'
            },
            {
                value: 'gemini-2.5-flash-lite',
                label: 'Gemini 2.5 Flash Lite',
                description: 'Google 旗下上一代的最先进模型系列，性能略差但是速度很快，是魔法少女生成器默认使用的轻量模型。'
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
                value: 'glm-4.6',
                label: 'GLM-4.6',
                description: '通用指令模型，适合中文对话、总结与结构化输出。'
            },
            {
                value: 'deepseek-ai/DeepSeek-V3.2',
                label: 'DeepSeek V3.2',
                description: '通用对话与推理模型，适合分析、总结与多轮交互。'
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
                value: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
                label: '通义千问 3 235B',
                description: '旗舰级指令模型，擅长中文对话、写作与复杂指令，适合长文本与结构化任务。'
            },
            {
                value: 'ZhipuAI/GLM-4.6',
                label: 'GLM-4.6',
                description: '面向中文场景的通用模型，适合对话、改写与信息整理。'
            },
            {
                value: 'deepseek-ai/DeepSeek-V3.2',
                label: 'DeepSeek V3.2',
                description: '通用对话与推理模型，适合分析、总结与多轮交互。'
            },
            {
                value: 'MiniMax/MiniMax-M2',
                label: 'MiniMax-M2',
                description: 'DeepSeek 最新版本。'
            },
            {
                value: 'moonshotai/Kimi-K2-Thinking',
                label: 'Kimi K2 Thinking',
                description: 'Moonshot 旗下的大模型，可以看出我懒得写描述了。'
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
                value: 'gemini-3-pro-preview',
                label: 'Gemini 3.0 Pro (预览版)',
                description: 'Google 迄今为止最智能的模型系列，以先进的推理和联网搜索能力为基础。'
            },
            {
                value: 'gemini-3-flash-preview',
                label: 'Gemini 3.0 Flash (预览版)',
                description: 'Google 旗下最新一代的先进模型，现已提供尝鲜使用。'
            },
            {
                value: 'gemini-2.5-pro',
                label: 'Gemini 2.5 Pro',
                description: 'Google 旗下上一代的最先进模型系列，性能很棒棒。'
            },
            {
                value: 'gemini-2.5-flash',
                label: 'Gemini 2.5 Flash',
                description: 'Google 旗下上一代的最先进模型系列，在性能和价格上十分均衡，也是魔法少女生成器默认使用的模型。'
            },
            {
                value: 'gemini-2.5-flash-lite',
                label: 'Gemini 2.5 Flash Lite',
                description: 'Google 旗下上一代的最先进模型系列，性能略差但是速度很快，是魔法少女生成器默认使用的轻量模型。'
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
                value: 'zai-org/GLM-4.6',
                label: 'GLM-4.6',
                description: '中文场景表现稳定，适合结构化输出、改写与多轮对话。'
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
            { value: 'google/gemini-3-pro-preview', label: 'Gemini 3.0 Pro (预览版)', description: 'Google 迄今为止最智能的模型系列，以先进的推理和联网搜索能力为基础。' },
            { value: 'google/gemini-3-flash-preview', label: 'Gemini 3.0 Flash (预览版)', description: 'Google 旗下最新一代的先进模型，现已提供尝鲜使用。' },
            { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Google 旗下上一代的最先进模型系列，性能很棒棒。' },
            { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Google 旗下上一代的最先进模型系列，在性能和价格上十分均衡，也是魔法少女生成器默认使用的模型。' },
            { value: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', description: 'Google 旗下上一代的最先进模型系列，性能略差但是速度很快，是魔法少女生成器默认使用的轻量模型。' },
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
                description: 'Google 旗下上一代的最先进模型系列，性能很棒棒。'
            },
            {
                value: 'gemini-2.5-flash',
                label: 'Gemini 2.5 Flash',
                description: 'Google 旗下上一代的最先进模型系列，在性能和价格上十分均衡，也是魔法少女生成器默认使用的模型。'
            },
            {
                value: 'gemini-2.5-flash-lite',
                label: 'Gemini 2.5 Flash Lite',
                description: 'Google 旗下上一代的最先进模型系列，性能略差但是速度很快，是魔法少女生成器默认使用的轻量模型。'
            },
            {
                value: 'gemini-3-pro',
                label: 'Gemini 3.0 Pro (预览版)',
                description: 'Google 迄今为止最智能的模型系列，以先进的推理和联网搜索能力为基础。'
            },
            {
                value: 'gemini-3-flash',
                label: 'Gemini 3.0 Flash (预览版)',
                description: 'Google 旗下最新一代的先进模型，现已提供尝鲜使用。'
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
                value: 'DeepSeek-R1',
                label: 'DeepSeek R1',
                description: '推理强项模型，适合需要多步思考的分析、规划与推导场景。'
            },
            {
                value: 'Grok-4',
                label: 'Grok 4',
                description: 'xAI 旗下通用模型，适合头脑风暴、创意发散与快速问答。'
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
