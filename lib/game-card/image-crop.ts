import {
  GAME_CARD_IMAGE_ASPECT_RATIOS,
  type GameCardImageAspectRatio,
  type ImageTransform,
} from '@/lib/schemas/game-card';

export type ImageSize = {
  width: number;
  height: number;
};

export type CropViewport = ImageSize;

export type CoverLayout = {
  width: number;
  height: number;
  maxPanX: number;
  maxPanY: number;
};

export const DEFAULT_GAME_CARD_IMAGE_ASPECT_RATIO: GameCardImageAspectRatio = '4:3';
export const DEFAULT_IMAGE_TRANSFORM: ImageTransform = { scale: 1, x: 0, y: 0 };

export const GAME_CARD_IMAGE_ASPECT_RATIO_OPTIONS = [
  { value: '4:3', label: '4:3（标准）' },
  { value: '1:1', label: '1:1（方形）' },
  { value: '3:4', label: '3:4（竖向）' },
  { value: '16:9', label: '16:9（宽屏）' },
] as const satisfies ReadonlyArray<{ value: GameCardImageAspectRatio; label: string }>;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const finitePositive = (value: number, fallback: number): number => (
  Number.isFinite(value) && value > 0 ? value : fallback
);

export const getAspectRatioValue = (value: GameCardImageAspectRatio): number => {
  const [width, height] = value.split(':').map(Number);
  return width / height;
};

export const isGameCardImageAspectRatio = (value: unknown): value is GameCardImageAspectRatio => (
  typeof value === 'string' && GAME_CARD_IMAGE_ASPECT_RATIOS.includes(value as GameCardImageAspectRatio)
);

export const normalizeGameCardImageAspectRatio = (value: unknown): GameCardImageAspectRatio => (
  isGameCardImageAspectRatio(value) ? value : DEFAULT_GAME_CARD_IMAGE_ASPECT_RATIO
);

export const getCoverLayout = (
  image: ImageSize,
  viewport: CropViewport,
  scale: number,
): CoverLayout => {
  const imageWidth = finitePositive(image.width, 1);
  const imageHeight = finitePositive(image.height, 1);
  const viewportWidth = finitePositive(viewport.width, 1);
  const viewportHeight = finitePositive(viewport.height, 1);
  const safeScale = clamp(Number.isFinite(scale) ? scale : 1, 1, 3);
  const baseScale = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const width = imageWidth * baseScale * safeScale;
  const height = imageHeight * baseScale * safeScale;

  return {
    width,
    height,
    maxPanX: Math.max(0, (width - viewportWidth) / 2),
    maxPanY: Math.max(0, (height - viewportHeight) / 2),
  };
};

export const clampImageTransform = (transform: ImageTransform, layout: CoverLayout): ImageTransform => ({
  scale: clamp(transform.scale, 1, 3),
  x: layout.maxPanX > 0 ? clamp(transform.x, -1, 1) : 0,
  y: layout.maxPanY > 0 ? clamp(transform.y, -1, 1) : 0,
});

export const normalizeImageTransform = (value: unknown): ImageTransform => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_IMAGE_TRANSFORM;

  const source = value as Record<string, unknown>;
  const scale = typeof source.scale === 'number'
    && Number.isFinite(source.scale)
    && source.scale >= 1
    && source.scale <= 3
    ? source.scale
    : 1;
  const x = typeof source.x === 'number' && Number.isFinite(source.x) ? source.x : 0;
  const y = typeof source.y === 'number' && Number.isFinite(source.y) ? source.y : 0;

  return {
    scale,
    x: clamp(x, -1, 1),
    y: clamp(y, -1, 1),
  };
};
