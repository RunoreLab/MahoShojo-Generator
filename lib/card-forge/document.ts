import {
  GAME_CARD_FORGE_DOCUMENT_TYPE,
  GAME_CARD_FORGE_DOCUMENT_VERSION,
  GameCardFaceDataSchema,
  GameCardForgeDocumentSchema,
  GameCardMetadataSchema,
  type GameCardFaceData,
  type GameCardForgeDocument,
  type GameCardImageAspectRatio,
  type GameCardImageSource,
  type ImageTransform,
} from '@/lib/schemas/game-card';
import {
  DEFAULT_GAME_CARD_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_TRANSFORM,
  isGameCardImageAspectRatio,
  normalizeImageTransform,
} from '@/lib/game-card/image-crop';

export type GameCardForgeRuntimeState = {
  faceData: GameCardFaceData;
  imageUrl: string | null;
  imageSource: GameCardImageSource | null;
  imageAspectRatio: GameCardImageAspectRatio;
  imageTransform: ImageTransform;
};

export type GameCardForgeDocumentInput = {
  faceData: GameCardFaceData;
  imageDataUrl: string | null;
  imageSource: GameCardImageSource | null;
  imageAspectRatio: GameCardImageAspectRatio;
  imageTransform: ImageTransform;
  createdAt?: string;
};

export const buildGameCardForgeDocument = (
  input: GameCardForgeDocumentInput,
): GameCardForgeDocument => GameCardForgeDocumentSchema.parse({
  documentType: GAME_CARD_FORGE_DOCUMENT_TYPE,
  documentVersion: GAME_CARD_FORGE_DOCUMENT_VERSION,
  faceData: input.faceData,
  illustration: input.imageDataUrl
    ? {
        dataUrl: input.imageDataUrl,
        source: input.imageSource ?? 'uploaded',
        aspectRatio: input.imageAspectRatio,
        transform: input.imageTransform,
      }
    : null,
  ...(input.createdAt ? { createdAt: input.createdAt } : {}),
});

export const serializeGameCardForgeDocument = (input: GameCardForgeDocumentInput): string =>
  JSON.stringify(buildGameCardForgeDocument(input), null, 2);

const toRuntimeState = (document: GameCardForgeDocument): GameCardForgeRuntimeState => ({
  faceData: document.faceData,
  imageUrl: document.illustration?.dataUrl ?? null,
  imageSource: document.illustration?.source ?? null,
  imageAspectRatio: document.illustration?.aspectRatio ?? DEFAULT_GAME_CARD_IMAGE_ASPECT_RATIO,
  imageTransform: document.illustration?.transform ?? DEFAULT_IMAGE_TRANSFORM,
});

export const parseGameCardForgeImport = (value: unknown): GameCardForgeRuntimeState => {
  const documentResult = GameCardForgeDocumentSchema.safeParse(value);
  if (documentResult.success) return toRuntimeState(documentResult.data);

  if (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (value as Record<string, unknown>).documentType === GAME_CARD_FORGE_DOCUMENT_TYPE
  ) {
    throw new Error('卡牌工坊存档 JSON 校验失败，请确认版本、卡面字段和插图数据完整。');
  }

  const legacyMetadata = GameCardMetadataSchema.safeParse(value);
  if (legacyMetadata.success) {
    return {
      faceData: legacyMetadata.data.faceData,
      imageUrl: legacyMetadata.data.imageUrl,
      imageSource: legacyMetadata.data.imageSource,
      imageAspectRatio: isGameCardImageAspectRatio(legacyMetadata.data.imageAspectRatio)
        ? legacyMetadata.data.imageAspectRatio
        : DEFAULT_GAME_CARD_IMAGE_ASPECT_RATIO,
      imageTransform: normalizeImageTransform(legacyMetadata.data.imageTransform),
    };
  }

  const directFace = GameCardFaceDataSchema.safeParse(value);
  if (directFace.success) {
    return {
      faceData: directFace.data,
      imageUrl: null,
      imageSource: null,
      imageAspectRatio: DEFAULT_GAME_CARD_IMAGE_ASPECT_RATIO,
      imageTransform: DEFAULT_IMAGE_TRANSFORM,
    };
  }

  throw new Error('导入的 JSON 不是有效的卡牌工坊存档、卡面 JSON 或旧版元数据。');
};
