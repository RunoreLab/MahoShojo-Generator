import { z } from 'zod/v3';
import { GENERAL_SCENARIO_TEMPLATE_ID } from './data-cards';

// Arena 消费已有情景正文：兼容旧格式并保留扩展、metadata 与签名字段。
// 这不是编辑/转换输出的完整数据卡 schema，也不证明来源或签名有效。
const StructuredScenarioSchema = z
  .object({
    title: z.string().min(1, '缺少 title'),
    elements: z.any(),
  })
  .passthrough();

const GeneralScenarioSchema = z
  .preprocess((input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
    const record = input as Record<string, unknown>;
    if (typeof record.title === 'string') return input;
    if (typeof record.name === 'string') {
      const { name: legacyName, ...rest } = record;
      return {
        ...rest,
        title: legacyName,
      };
    }
    return input;
  }, z
    .object({
      templateId: z.literal(GENERAL_SCENARIO_TEMPLATE_ID),
      title: z.string().min(1, '缺少 title'),
      content: z.string(),
    })
    .passthrough());

export const ArenaScenarioSchema = z.union([StructuredScenarioSchema, GeneralScenarioSchema]);

