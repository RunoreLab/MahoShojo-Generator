import { z } from 'zod/v3';
import { ScenarioBattleStoryExtensionSchema } from '@/lib/scenario-battle-story';

export const GENERAL_SCENARIO_TEMPLATE_ID = '通用情景' as const;

/**
 * 通用情景数据卡的 Zod Schema
 * - templateId 固定为 “通用情景”
 * - title 为情景名（与问卷生成情景卡保持一致）
 * - content 使用 Markdown 或其他自由文本，承载情景设定
 * 兼容旧字段：允许使用 name 作为 title 的旧别名（解析时会归一化为 title）。
 * 允许携带额外字段以兼容未来扩展（如签名、作者信息等）
 */
const normalizeGeneralScenarioInput = (input: unknown) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;

  const name = typeof record.name === 'string' ? record.name : undefined;
  const title = typeof record.title === 'string' ? record.title : undefined;

  if (!name) return input;

  const rest = { ...record };
  delete rest.name;
  return {
    ...rest,
    title: title ?? name,
  };
};

export const GeneralScenarioSchema = z.preprocess(
  normalizeGeneralScenarioInput,
  z.object({
    templateId: z.literal(GENERAL_SCENARIO_TEMPLATE_ID).default(GENERAL_SCENARIO_TEMPLATE_ID),
    title: z.string(),
    content: z.string(),
    _battle_story: ScenarioBattleStoryExtensionSchema.optional(),
  }).catchall(z.unknown())
);

export type GeneralScenarioData = z.infer<typeof GeneralScenarioSchema>;
