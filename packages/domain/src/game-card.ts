import { z } from 'zod/v3';
import { GameCardFaceDataSchema } from '@mahoshojo/contracts/game-card';

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
