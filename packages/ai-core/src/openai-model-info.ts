// 共用展示文案。可选范围与实际请求的模型 ID 由各渠道提供。
export const OPENAI_MODEL_INFO = {
  'gpt-6.2-astra': { label: 'GPT-6.2 Astra', description: '高能力旗舰模型，适合需要严密推理、长篇创作或多步规划的任务。' },
  'gpt-6.2-astra-pro': { label: 'GPT-6.2 Astra Pro', description: 'Astra 的高推理投入版本，适合质量优先的高难度任务。' },
  'gpt-6.2-sol': { label: 'GPT-6.2 Sol', description: '兼顾质量与效率，适合多步推理、长文本写作和日常创作。' },
  'gpt-6.2-sol-pro': { label: 'GPT-6.2 Sol Pro', description: 'Sol 的高推理投入版本，适合需要深入分析的复杂任务。' },
  'gpt-6.1-sol': { label: 'GPT-6.1 Sol', description: '适合复杂指令、多步推理与长文本生成。' },
  'gpt-6.1-sol-pro': { label: 'GPT-6.1 Sol Pro', description: 'Sol 的高推理投入版本，适合质量优先的复杂任务。' },
  'gpt-6.1-terra': { label: 'GPT-6.1 Terra', description: '兼顾响应速度和推理质量，适合日常创作、内容改写与结构化生成。' },
  'gpt-6.1-terra-pro': { label: 'GPT-6.1 Terra Pro', description: 'Terra 的高推理投入版本，适合需要更深入推敲的生成任务。' },
  'gpt-6-astra': { label: 'GPT-6 Astra', description: 'GPT-6 系列旗舰模型，适合复杂推理、长篇创作与多步任务。' },
  'gpt-6-astra-pro': { label: 'GPT-6 Astra Pro', description: 'Astra 的高推理投入版本，适合质量优先的高难度任务。' },
  'gpt-6-sol': { label: 'GPT-6 Sol', description: '通用推理模型，适合复杂创作、长文本与多步指令。' },
  'gpt-6-sol-pro': { label: 'GPT-6 Sol Pro', description: 'Sol 的高推理投入版本，适合需要深入分析的复杂任务。' },
  'gpt-6-luna': { label: 'GPT-6 Luna', description: '快速、轻量，适合短篇生成、改写与高频交互。' },
  'gpt-6-luna-pro': { label: 'GPT-6 Luna Pro', description: 'Luna 的增强推理版本，适合需要兼顾响应速度和推理的任务。' },
  'gpt-5.6-sol': { label: 'GPT-5.6 Sol', description: 'GPT-5.6 系列高能力档，适合复杂指令、多步推理与长文本。' },
  'gpt-5.6-terra': { label: 'GPT-5.6 Terra', description: 'GPT-5.6 系列均衡档，适合日常写作、改写与生成。' },
  'gpt-5.6-luna': { label: 'GPT-5.6 Luna', description: 'GPT-5.6 系列轻量档，适合短篇生成与高频交互。' },
  'gpt-5.5': { label: 'GPT-5.5', description: '适合复杂推理、专业写作与长文本生成。' },
  'gpt-5.4': { label: 'GPT-5.4', description: '通用推理模型，适合复杂指令和高质量内容生成。' },
  'gpt-5.4-mini': { label: 'GPT-5.4 Mini', description: '轻量推理模型，适合高频交互与快速生成。' },
  'gpt-5.4-nano': { label: 'GPT-5.4 Nano', description: '轻量模型，适合简单分类、提取与短文本生成。' },
} as const;

export type OpenAiModelId = keyof typeof OPENAI_MODEL_INFO;

export function getOpenAiModelInfo(modelId: string): { readonly label: string; readonly description: string } | undefined {
  const id = modelId.toLowerCase();
  return Object.hasOwn(OPENAI_MODEL_INFO, id) ? OPENAI_MODEL_INFO[id as OpenAiModelId] : undefined;
}
