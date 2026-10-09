import { getPlaceholderPngBytes } from '@mahoshojo/domain/tavern-card';
export { createTavernV3Card, encodeTavernCardAsBase64Json, writeTavernCardToPngBytes, getPlaceholderPngBytes } from '@mahoshojo/domain/tavern-card';
const DEFAULT_TAVERN_LOGO_SVG_PATH = '/logo.svg';
const DEFAULT_TAVERN_LOGO_WIDTH = 768;
const DEFAULT_TAVERN_LOGO_BG = '#ffffff';

let defaultBasePngPromise: Promise<Uint8Array> | null = null;

const parseViewBoxRatio = (svgText: string): number => {
  const match = svgText.match(/viewBox\\s*=\\s*\"([^\"]+)\"/i);
  if (!match) return 1;
  const parts = match[1]
    .trim()
    .split(/[\\s,]+/)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));
  if (parts.length < 4) return 1;
  const width = parts[2];
  const height = parts[3];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;
  return height / width;
};

const loadImageFromBlobUrl = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法加载默认 Logo'));
    image.src = url;
  });

const canvasToPngBytes = async (canvas: HTMLCanvasElement): Promise<Uint8Array> => {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('默认底图导出失败'))), 'image/png');
  });
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
};

export async function getDefaultTavernBasePngBytes(): Promise<Uint8Array> {
  if (defaultBasePngPromise) return defaultBasePngPromise;
  defaultBasePngPromise = (async () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return getPlaceholderPngBytes();
    }

    try {
      const response = await fetch(DEFAULT_TAVERN_LOGO_SVG_PATH, { cache: 'force-cache' });
      if (!response.ok) throw new Error('默认 Logo 获取失败');
      const svgText = await response.text();
      const ratio = parseViewBoxRatio(svgText);
      const width = DEFAULT_TAVERN_LOGO_WIDTH;
      const height = Math.max(1, Math.round(width * ratio));

      const svgBlob = new Blob([svgText], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(svgBlob);
      try {
        const image = await loadImageFromBlobUrl(url);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('默认底图渲染失败');
        ctx.fillStyle = DEFAULT_TAVERN_LOGO_BG;
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);
        return await canvasToPngBytes(canvas);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      return getPlaceholderPngBytes();
    }
  })();
  return defaultBasePngPromise;
}
