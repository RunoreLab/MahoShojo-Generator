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
        id: 'kourichat',
        name: 'KouriChat',
        description: 'KouriChat 为用户提供了国内外广泛的模型库（优惠）。',
        docsUrl: 'https://platform.openai.com/docs/overview',
        baseUrl: 'https://api.kourichat.com/v1',
        type: 'openai',
        models: [
            {
                value: 'Qwen/Qwen3-235B-A22B',
                label: '通义千问 3 235B',
                description: '阿里旗下的通义千问大模型。'
            },
            {
                value: 'ZhipuAI/GLM-4.6',
                label: 'GLM-4.6',
                description: '智谱旗下的大模型。'
            },
            {
                value: 'deepseek-ai/DeepSeek-V3.2-Exp',
                label: 'DeepSeek V3.2 Exp',
                description: 'DeepSeek 最新版本。'
            },
            {
                value: 'deepseek-ai/DeepSeek-R1-0528',
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
        id: 'modelscope',
        name: '魔搭 Modelscope',
        description: '阿里云旗下专注于人工智能领域的开源模型平台，提供针对国内大模型的免费推理服务。',
        docsUrl: 'https://ai.google.dev/gemini-api/docs',
        baseUrl: 'https://api-inference.modelscope.cn/v1',
        type: 'openai',
        models: [
            {
                value: 'Qwen/Qwen3-235B-A22B',
                label: '通义千问 3 235B',
                description: '阿里旗下的通义千问大模型。'
            },
            {
                value: 'ZhipuAI/GLM-4.6',
                label: 'GLM-4.6',
                description: '智谱旗下的大模型。'
            },
            {
                value: 'deepseek-ai/DeepSeek-V3.2-Exp',
                label: 'DeepSeek V3.2 Exp',
                description: 'DeepSeek 最新版本。'
            },
            {
                value: 'deepseek-ai/DeepSeek-R1-0528',
                label: 'DeepSeek R1',
                description: 'DeepSeek 思考版本。'
            },
            {
                value: 'moonshotai/Kimi-K2-Instruct',
                label: 'Kimi K2 Instruct',
                description: 'Moonshot 旗下的大模型，可以看出我懒得写描述了。'
            },
        ]
    }
];

