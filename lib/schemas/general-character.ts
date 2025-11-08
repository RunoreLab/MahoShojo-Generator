import { z } from 'zod';
import { CurrentStateSchema } from './current-state';

export const GENERAL_CHARACTER_TEMPLATE_ID = '通用角色' as const;

/**
 * 通用角色数据卡的 Zod Schema
 * - templateId 固定为 “通用角色”
 * - name 为角色名
 * - content 使用 Markdown 或其他自由文本，承载角色设定
 * 允许携带额外字段以兼容未来扩展（如签名、作者信息等）
 */
export const GeneralCharacterSchema = z.object({
  templateId: z.literal(GENERAL_CHARACTER_TEMPLATE_ID).default(GENERAL_CHARACTER_TEMPLATE_ID),
  name: z.string(),
  content: z.string(),
  current_state: CurrentStateSchema.optional(),
}).catchall(z.unknown());

export type GeneralCharacterData = z.infer<typeof GeneralCharacterSchema>;
