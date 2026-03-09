import { isAllowedExternalMediaUrl } from '@/lib/markdown/externalMedia';

const isSpecialImageUrl = (value: string): boolean => /^data:|^blob:|^about:blank$/i.test(value);

export const resolveProxyImageUrl = (value: string): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || isSpecialImageUrl(raw)) return raw;

  if (!/^https?:\/\//i.test(raw) && !raw.startsWith('//')) {
    return raw;
  }

  const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
  if (!isAllowedExternalMediaUrl(normalized, 'image')) {
    return raw;
  }

  return `/api/media-proxy?url=${encodeURIComponent(normalized)}`;
};

export const readImageFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        reject(new Error('读取图片失败，请重试。'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => {
      reject(new Error('读取图片失败，请重试。'));
    };
    reader.readAsDataURL(file);
  });
