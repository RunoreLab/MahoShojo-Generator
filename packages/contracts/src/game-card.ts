import { z } from 'zod/v3';

export const GameCardRaritySchema = z.enum([
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
]);
export type GameCardRarity = z.infer<typeof GameCardRaritySchema>;

export const GameCardTypeSchema = z.enum([
  'character',
  'creature',
  'spell',
  'scenario',
  'equipment',
  'support',
]);
export type GameCardType = z.infer<typeof GameCardTypeSchema>;

export const GameCardElementSchema = z.enum([
  'fire',
  'water',
  'earth',
  'wind',
  'light',
  'dark',
  'void',
  'neutral',
]);
export type GameCardElement = z.infer<typeof GameCardElementSchema>;

export const GameCardEffectSchema = z.object({
  type: z.string().describe('效果分类，如"入场"、"被动"、"战吼"、"亡语"、"觉醒"等'),
  description: z.string().describe('效果的具体描述文本'),
});

export const GameCardFaceDataSchema = z.object({
  cardName: z.string().describe('卡牌名称'),
  cardType: GameCardTypeSchema.describe('卡牌类型'),
  rarity: GameCardRaritySchema.describe('稀有度'),
  cost: z.number().int().min(0).max(20).describe('使用花费（法力/能量点数）'),
  element: GameCardElementSchema.describe('属性/元素'),
  // 卡面属性当前只承担展示与卡面协议校验，不设置上界；如后续出现布局或接口问题，再在此处恢复明确上限。
  attack: z.number().int().min(0).nullable().describe('攻击力，非战斗卡可为 null'),
  defense: z.number().int().min(0).nullable().describe('防御力，非战斗卡可为 null'),
  hp: z.number().int().min(1).nullable().describe('生命值，非战斗卡可为 null'),
  // 文本长度、效果数量和特性数量暂不设新的硬上限；若出现布局或模型失控问题，再按字段补充边界。
  effects: z.array(GameCardEffectSchema).describe('卡牌效果列表'),
  traits: z.array(z.string()).describe('关键词特性，如"飞行"、"先攻"、"嘲讽"'),
  flavorText: z.string().describe('风味文本/背景故事（一句简短的引言）'),
  powerLevel: z.string().describe('强度评级，如 "S+"、"A"、"B-"'),
  description: z.string().describe('卡牌的简要设定描述'),
  themeColor: z.string().describe('卡牌主题色，hex 格式如 "#ff6b9d"'),
}).catchall(z.unknown());

export type GameCardFaceData = z.infer<typeof GameCardFaceDataSchema>;
