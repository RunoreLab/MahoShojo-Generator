import { z } from 'zod/v3';

export const GENERAL_SCENARIO_TEMPLATE_ID = '通用情景' as const;

/**
 * 通用情景数据卡的 Zod Schema
 * - templateId 固定为 “通用情景”
 * - name 为情景名
 * - content 使用 Markdown 或其他自由文本，承载情景设定
 * 允许携带额外字段以兼容未来扩展（如签名、作者信息等）
 */
export const GeneralScenarioSchema = z.object({
  templateId: z.literal(GENERAL_SCENARIO_TEMPLATE_ID).default(GENERAL_SCENARIO_TEMPLATE_ID),
  name: z.string(),
  content: z.string(),
}).catchall(z.unknown());

export type GeneralScenarioData = z.infer<typeof GeneralScenarioSchema>;

