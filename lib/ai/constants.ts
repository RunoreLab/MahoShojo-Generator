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
                description: '与之前一样的没有变化的调用顺序，默认使用 Gemini 2.5 Pro 模型。'
            },
            {
                value: 'gemini-2.5-pro',
                label: 'Gemini 2.5 Pro',
                description: 'Google 旗下的最先进模型系列，性能很棒棒。'
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
                value: 'gemini-2.0-flash-exp',
                label: 'Gemini 2.0 Flash Exp',
                description: 'Google 旗下的上两代模型，但是真的好快！'
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
                label: '【大概已修复】Gemini 3.0 Pro (预览版)',
                description: 'Google 迄今为止最智能的模型系列，以先进的推理能力为基础，可将任何想法变为现实。'
            },
            {
                value: 'gemini-3-flash-preview',
                label: 'Gemini 3.0 Flash (推荐流式使用)',
                description: 'Google 迄今为止最智能的模型系列的略轻量的模型。'
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
                value: 'doubao-seed-1-6',
                label: 'Doubao Seed 1.6 (非流式可能存在问题)',
                description: '字节跳动旗下的大模型。'
            },
            {
                value: 'doubao-seed-1-6-flash',
                label: 'Doubao Seed 1.6 Flash (非流式可能存在问题)',
                description: '字节跳动旗下的大模型。'
            },
            // {
            //     value: 'deepseek-v3.2-exp',
            //     label: 'DeepSeek V3.2 Exp',
            //     description: 'DeepSeek 最新版本。'
            // },
            // {
            //     value: 'deepseek-r1',
            //     label: 'DeepSeek R1',
            //     description: 'DeepSeek 思考版本。'
            // },
            // {
            //     value: 'kimi-k2',
            //     label: 'Kimi K2',
            //     description: 'Moonshot 旗下的大模型，可以看出我懒得写描述了。'
            // },
            // {
            //     value: 'doubao-seed-1-6',
            //     label: 'Doubao Seed 1.6',
            //     description: '怎么还有豆包(暂不稳定，不推荐使用)'
            // },
        ]
    },
    {
        id: 'yiye',
        name: '一叶知秋 API (测试)',
        description: '一叶知秋 API 也为用户提供了国内外广泛的模型库。',
        docsUrl: 'https://88996.cloud/register?aff=ITPX',
        baseUrl: 'https://88996.cloud/v1',
        type: 'openai',
        mode: 'json',
        models: [
            {
                value: 'gemini-3-pro-preview',
                label: 'Gemini 3.0 Pro (测试)',
                description: 'Google 迄今为止最智能的模型系列，以先进的推理能力为基础，可将任何想法变为现实。'
            },
            {
                value: 'gemini-3-flash-preview',
                label: 'Gemini 3.0 Flash (推荐流式使用)',
                description: 'Google 迄今为止最智能的模型系列的略轻量的模型。'
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
            // {
            //     value: 'glm-4.6',
            //     label: 'GLM-4.6',
            //     description: '智谱旗下的大模型。'
            // },
            // {
            //     value: 'deepseek-v3.2-exp',
            //     label: 'DeepSeek V3.2 Exp',
            //     description: 'DeepSeek 最新版本。'
            // },
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
                description: '阿里旗下的通义千问大模型。'
            },
            {
                value: 'ZhipuAI/GLM-4.6',
                label: 'GLM-4.6',
                description: '智谱旗下的大模型。'
            },
            {
                value: 'deepseek-ai/DeepSeek-V3.2',
                label: 'DeepSeek V3.2 (非流式可能存在问题)',
                description: 'DeepSeek 最新版本。'
            }
            // {
            //     value: 'MiniMax/MiniMax-M2',
            //     label: 'MiniMax-M2',
            //     description: 'DeepSeek 最新版本。'
            // },
            // {
            //     value: 'deepseek-ai/DeepSeek-V3.2',
            //     label: 'DeepSeek V3.2',
            //     description: 'DeepSeek 最新版本。'
            // },
            // {
            //     value: 'moonshotai/Kimi-K2-Thinking',
            //     label: 'Kimi K2 Thinking',
            //     description: 'Moonshot 旗下的大模型，可以看出我懒得写描述了。'
            // },
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
                description: 'Google 迄今为止最智能的模型系列，以先进的推理能力为基础，可将任何想法变为现实。'
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
            { value: 'deepseek-chat', label: 'DeepSeek-V3.2', description: 'DeepSeek 最新版本。' },
            { value: 'deepseek-reasoner', label: 'DeepSeek-V3.2 思考模式', description: 'DeepSeek 最新版本思考模式。' },
        ]
    },
    {
        id: 'mystery',
        name: '魔法国度',
        description: '神秘渠道，不定时放送。',
        docsUrl: '',
        baseUrl: 'https://www.right.codes/codex/v1',
        type: 'openai',
        mode: 'auto',
        models: [
            {
                value: 'gpt-5.2',
                label: 'GPT 5.2 (仅流式)',
                description: '神秘渠道的 GPT 5.2 模型，随机出现，仅供娱乐。'
            },
        ]
    },
];

