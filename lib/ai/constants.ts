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
    type: 'openai' | 'google';
    // 待实现
    mode?: 'auto' | 'json' | 'tool';
    models: AIModelOption[];
}

/**
 * 可选 AI 供应商目录。
 * - description 用于向用户解释供应商特色。
 * - docsUrl 用于跳转至官方文档，帮助用户快速查看接入方式。
 * - baseUrl 为默认的 API 访问地址，用户仍可在 UI 中覆盖。
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
                value: 'gemini-2.5-flash',
                label: 'Gemini 2.5 Flash',
                description: 'Google 旗下的最先进模型系列，在性能和价格上十分均衡，也是魔法少女生成器默认使用的模型。'
            },
            {
                value: 'gemini-2.5-flash-lite',
                label: 'Gemini 2.5 Flash Lite',
                description: 'Google 旗下的最先进模型系列，性能略差但是速度很快，是魔法少女生成器默认使用的轻量模型。'
            },
            {
                value: 'gemini-2.0-flash-exp',
                label: 'Gemini 2.0 Flash Exp',
                description: 'Google 旗下的上一代模型，但是真的好快！'
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
        models: [
            {
                value: 'gemini-2.5-pro',
                label: 'Gemini 2.5 Pro',
                description: 'Google 旗下的最先进模型系列，性能很棒棒。'
            },
            {
                value: 'gemini-2.5-pro-payg',
                label: 'Gemini 2.5 Pro (按次计费)',
                description: '按次计费，场景和人数或生成字数多的时候选用此模型性价比更高哦！'
            },
            {
                value: 'gemini-2.5-auto',
                label: 'Gemini 2.5 Auto',
                description: '智能路由模型，将根据提示词难度与供需关系等多种因素在 Gemini-2.5 系列模型内路由。性价比较高，推荐使用。'
            },
            {
                value: 'gemini-2.5-flash',
                label: 'Gemini 2.5 Flash',
                description: 'Google 旗下的最先进模型系列，在性能和价格上十分均衡，也是魔法少女生成器默认使用的模型。'
            },
            {
                value: 'gemini-2.5-flash-lite',
                label: 'Gemini 2.5 Flash Lite',
                description: 'Google 旗下的最先进模型系列，性能略差但是速度很快，是魔法少女生成器默认使用的轻量模型。'
            },
            {
                value: 'glm-4.6',
                label: 'GLM-4.6',
                description: '智谱旗下的大模型。'
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
            {
                value: 'doubao-seed-1-6',
                label: 'Doubao Seed 1.6',
                description: '怎么还有豆包（暂不稳定，不推荐使用）'
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
                description: '阿里旗下的通义千问大模型。'
            },
            {
                value: 'ZhipuAI/GLM-4.6',
                label: 'GLM-4.6',
                description: '智谱旗下的大模型，更多模型正在添加中。'
            }
            // {
            //     value: 'MiniMax/MiniMax-M2',
            //     label: 'MiniMax-M2',
            //     description: 'DeepSeek 最新版本。'
            // },
            // {
            //     value: 'deepseek-ai/DeepSeek-R1-0528',
            //     label: 'DeepSeek R1',
            //     description: 'DeepSeek 思考版本。'
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
                value: 'gemini-2.5-pro',
                label: 'Gemini 2.5 Pro',
                description: 'Google 旗下的最先进模型系列，性能很棒棒。'
            },
            {
                value: 'gemini-2.5-flash',
                label: 'Gemini 2.5 Flash',
                description: 'Google 旗下的最先进模型系列，在性能和价格上十分均衡，也是魔法少女生成器默认使用的模型。'
            },
            {
                value: 'gemini-2.5-flash-lite',
                label: 'Gemini 2.5 Flash Lite',
                description: 'Google 旗下的最先进模型系列，性能略差但是速度很快，是魔法少女生成器默认使用的轻量模型。'
            },
        ]
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        description: 'DeepSeek 官方 API 直连。',
        docsUrl: 'https://platform.deepseek.com',
        baseUrl: 'https://api.deepseek.com/v1',
        type: 'openai',
        mode: 'json',
        models: [
            { value: 'deepseek-chat', label: 'DeepSeek-V3.2-Exp', description: 'DeepSeek 最新版本。' },
            { value: 'deepseek-reasoner', label: 'DeepSeek-V3.2-Exp 思考模式', description: 'DeepSeek 最新版本思考模式。' },
        ]
    },
];

