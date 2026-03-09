export type LargeObjectAssetFamily = 'text' | 'image' | 'other';

const readTrimmedLower = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

export const getLargeObjectAssetFamily = (
  kind: unknown,
  contentType: unknown,
): LargeObjectAssetFamily => {
  const normalizedKind = readTrimmedLower(kind);
  const normalizedContentType = readTrimmedLower(contentType);

  if (
    normalizedContentType.startsWith('image/') ||
    normalizedKind === 'portrait' ||
    normalizedKind === 'illustration' ||
    normalizedKind.endsWith('_image') ||
    normalizedKind.endsWith('_illustration') ||
    normalizedKind.endsWith('_portrait')
  ) {
    return 'image';
  }

  if (
    normalizedKind === 'battle_report_generation_output' ||
    normalizedContentType.startsWith('text/') ||
    normalizedContentType.includes('json') ||
    normalizedContentType.includes('markdown') ||
    normalizedContentType.includes('xml')
  ) {
    return 'text';
  }

  return 'other';
};

export const isLargeObjectPreviewableImage = (kind: unknown, contentType: unknown): boolean => {
  return getLargeObjectAssetFamily(kind, contentType) === 'image';
};

export const formatLargeObjectAssetFamily = (family: LargeObjectAssetFamily): string => {
  if (family === 'image') return '图片资产';
  if (family === 'text') return '文本对象';
  return '其他对象';
};

export const formatLargeObjectKindLabel = (kind: unknown): string => {
  const normalizedKind = readTrimmedLower(kind);
  if (normalizedKind === 'battle_report_generation_output') return '战报正文';
  if (normalizedKind === 'portrait') return '角色立绘';
  if (normalizedKind === 'illustration') return '插图';
  return typeof kind === 'string' && kind.trim() ? kind.trim() : '未分类';
};
