import { resolveProxyImageUrl } from '@/lib/client/visualAsset';

export type DataCardVisualAssetKind = 'portrait' | 'illustration' | 'avatar' | 'image';
export type DataCardVisualAssetSourceType = 'remote' | 'dataUrl' | 'local';

export type DataCardVisualAsset = {
  id: string;
  keyPath: string;
  keyName: string;
  kind: DataCardVisualAssetKind;
  sourceUrl: string;
  previewUrl: string;
  sourceType: DataCardVisualAssetSourceType;
  mimeType: string | null;
  approxBytes: number | null;
};

const IMAGE_KEYWORDS = ['portrait', 'illustration', 'avatar', 'image', 'cover', 'thumbnail', 'poster', 'hero'];
const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|webp|gif|svg|avif|bmp)(?:[?#].*)?$/i;

const normalizeKeyName = (value: string): string => value.trim().toLowerCase();

const isLikelyImageKey = (value: string): boolean => {
  const normalized = normalizeKeyName(value);
  return IMAGE_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

const isLikelyImageValue = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^data:image\//i.test(trimmed)) return true;
  if (/^blob:/i.test(trimmed)) return true;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('//')) {
    return IMAGE_EXTENSION_PATTERN.test(trimmed) || /\/image\//i.test(trimmed);
  }
  return IMAGE_EXTENSION_PATTERN.test(trimmed);
};

const detectAssetKind = (keyName: string): DataCardVisualAssetKind => {
  const normalized = normalizeKeyName(keyName);
  if (normalized.includes('portrait')) return 'portrait';
  if (normalized.includes('illustration')) return 'illustration';
  if (normalized.includes('avatar')) return 'avatar';
  return 'image';
};

const detectSourceType = (value: string): DataCardVisualAssetSourceType => {
  if (/^data:image\//i.test(value)) return 'dataUrl';
  if (/^https?:\/\//i.test(value) || value.startsWith('//')) return 'remote';
  return 'local';
};

const detectMimeType = (value: string): string | null => {
  const trimmed = value.trim();
  const dataUrlMatch = trimmed.match(/^data:(image\/[a-z0-9.+-]+);/i);
  if (dataUrlMatch?.[1]) return dataUrlMatch[1].toLowerCase();

  const clean = trimmed.split('#')[0]?.split('?')[0] ?? trimmed;
  const extension = clean.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!extension) return null;
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'avif') return 'image/avif';
  if (extension === 'bmp') return 'image/bmp';
  return null;
};

const estimateDataUrlBytes = (value: string): number | null => {
  const match = value.match(/^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i);
  if (!match?.[1]) return null;
  const base64 = match[1].replace(/\s+/g, '');
  if (!base64) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
};

const buildAssetId = (keyPath: string, sourceUrl: string): string => `${keyPath}::${sourceUrl}`;

const walkVisualAssets = (
  value: unknown,
  context: { keyName: string; keyPath: string },
  output: DataCardVisualAsset[],
  seen: Set<string>,
  depth = 0,
): void => {
  if (depth > 10) return;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!isLikelyImageKey(context.keyName) && !isLikelyImageValue(trimmed)) return;

    const assetId = buildAssetId(context.keyPath, trimmed);
    if (seen.has(assetId)) return;
    seen.add(assetId);

    output.push({
      id: assetId,
      keyPath: context.keyPath,
      keyName: context.keyName,
      kind: detectAssetKind(context.keyName),
      sourceUrl: trimmed,
      previewUrl: resolveProxyImageUrl(trimmed),
      sourceType: detectSourceType(trimmed),
      mimeType: detectMimeType(trimmed),
      approxBytes: estimateDataUrlBytes(trimmed),
    });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkVisualAssets(
        item,
        {
          keyName: context.keyName,
          keyPath: `${context.keyPath}[${index}]`,
        },
        output,
        seen,
        depth + 1,
      );
    });
    return;
  }

  if (!value || typeof value !== 'object') return;

  Object.entries(value).forEach(([childKey, childValue]) => {
    const childPath = context.keyPath ? `${context.keyPath}.${childKey}` : childKey;
    walkVisualAssets(
      childValue,
      {
        keyName: childKey,
        keyPath: childPath,
      },
      output,
      seen,
      depth + 1,
    );
  });
};

export const extractDataCardVisualAssets = (value: unknown): DataCardVisualAsset[] => {
  const output: DataCardVisualAsset[] = [];
  walkVisualAssets(value, { keyName: 'root', keyPath: '' }, output, new Set());
  return output;
};

export const hasDataCardVisualAssets = (value: unknown): boolean => extractDataCardVisualAssets(value).length > 0;
