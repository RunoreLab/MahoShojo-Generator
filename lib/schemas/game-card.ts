import { z } from 'zod/v3';

export const GAME_CARD_TEMPLATE_ID = '卡牌工坊/游戏卡面' as const;

export const GAME_CARD_IMAGE_ASPECT_RATIOS = ['4:3', '1:1', '3:4', '16:9'] as const;
export const GameCardImageAspectRatioSchema = z.enum(GAME_CARD_IMAGE_ASPECT_RATIOS);
export type GameCardImageAspectRatio = z.infer<typeof GameCardImageAspectRatioSchema>;

export const ImageTransformSchema = z.object({
  scale: z.number().min(1).max(3),
  x: z.number().min(-1).max(1),
  y: z.number().min(-1).max(1),
});
export type ImageTransform = z.infer<typeof ImageTransformSchema>;

export const GAME_CARD_FORGE_DOCUMENT_TYPE = 'maho-shojo-game-card-forge' as const;
export const GAME_CARD_FORGE_DOCUMENT_VERSION = 1 as const;

export const GameCardImageSourceSchema = z.enum(['uploaded', 'data-card', 'generated']);
export type GameCardImageSource = z.infer<typeof GameCardImageSourceSchema>;

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

const ImageDataUrlSchema = z.string().regex(
  // Data URL 只校验类型与格式，不限制字节数；大图由卡牌工坊前端给出软提示。
  /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i,
  '插图必须是图片 Base64 Data URL',
);

export const GameCardForgeIllustrationSchema = z.object({
  dataUrl: ImageDataUrlSchema,
  source: GameCardImageSourceSchema,
  aspectRatio: GameCardImageAspectRatioSchema,
  transform: ImageTransformSchema,
});

export const GameCardForgeDocumentSchema = z.object({
  documentType: z.literal(GAME_CARD_FORGE_DOCUMENT_TYPE),
  documentVersion: z.literal(GAME_CARD_FORGE_DOCUMENT_VERSION),
  faceData: GameCardFaceDataSchema,
  illustration: GameCardForgeIllustrationSchema.nullable(),
  createdAt: z.string().datetime().optional(),
}).strict();

export type GameCardForgeIllustration = z.infer<typeof GameCardForgeIllustrationSchema>;
export type GameCardForgeDocument = z.infer<typeof GameCardForgeDocumentSchema>;

export const GameCardMetadataSchema = z.object({
  templateId: z.literal(GAME_CARD_TEMPLATE_ID).default(GAME_CARD_TEMPLATE_ID),
  faceData: GameCardFaceDataSchema,
  imageUrl: z.string().nullable().default(null),
  imageSource: GameCardImageSourceSchema.nullable().default(null),
  imageAspectRatio: GameCardImageAspectRatioSchema.optional(),
  imageTransform: ImageTransformSchema.optional(),
  sourceCardData: z.unknown().optional(),
  sourceCardType: z.string().optional(),
  createdAt: z.string().optional(),
}).catchall(z.unknown());

export type GameCardMetadata = z.infer<typeof GameCardMetadataSchema>;

export const RARITY_LABELS: Record<GameCardRarity, string> = {
  common: '普通',
  uncommon: '优良',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
  mythic: '神话',
};

export const CARD_TYPE_LABELS: Record<GameCardType, string> = {
  character: '角色',
  creature: '生物',
  spell: '法术',
  scenario: '场景',
  equipment: '装备',
  support: '辅助',
};

export const ELEMENT_LABELS: Record<GameCardElement, string> = {
  fire: '火',
  water: '水',
  earth: '地',
  wind: '风',
  light: '光',
  dark: '暗',
  void: '虚',
  neutral: '无',
};

export const RARITY_COLORS: Record<GameCardRarity, { primary: string; secondary: string; glow: string }> = {
  common: { primary: '#9ca3af', secondary: '#6b7280', glow: 'rgba(156,163,175,0.4)' },
  uncommon: { primary: '#34d399', secondary: '#059669', glow: 'rgba(52,211,153,0.4)' },
  rare: { primary: '#60a5fa', secondary: '#2563eb', glow: 'rgba(96,165,250,0.4)' },
  epic: { primary: '#a78bfa', secondary: '#7c3aed', glow: 'rgba(167,139,250,0.4)' },
  legendary: { primary: '#fbbf24', secondary: '#d97706', glow: 'rgba(251,191,36,0.5)' },
  mythic: { primary: '#f87171', secondary: '#dc2626', glow: 'rgba(248,113,113,0.5)' },
};

export const ELEMENT_COLORS: Record<GameCardElement, string> = {
  fire: '#ef4444',
  water: '#3b82f6',
  earth: '#a16207',
  wind: '#10b981',
  light: '#fbbf24',
  dark: '#6366f1',
  void: '#7c3aed',
  neutral: '#9ca3af',
};
