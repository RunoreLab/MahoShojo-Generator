const IMAGE_DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i;

// 这是性能提示阈值，不是上传、导入或导出的硬拒绝上限。
export const IMAGE_SIZE_WARNING_BYTES = 10 * 1024 * 1024;

const formatImageSize = (byteLength: number): string => {
  if (byteLength >= 1024 * 1024) return `${(byteLength / (1024 * 1024)).toFixed(1)} MiB`;
  return `${Math.max(1, Math.round(byteLength / 1024))} KiB`;
};

export const getImageSizeWarning = (byteLength: number): string | null => {
  if (!Number.isFinite(byteLength) || byteLength <= IMAGE_SIZE_WARNING_BYTES) return null;
  return `图片较大（约 ${formatImageSize(byteLength)}），导出卡面 JSON 时可能占用更多内存，但不会阻止继续使用。`;
};

export const estimateImageDataUrlByteLength = (dataUrl: string): number | null => {
  if (!isImageDataUrl(dataUrl)) return null;
  const separatorIndex = dataUrl.indexOf(',');
  if (separatorIndex < 0) return null;
  const payload = dataUrl.slice(separatorIndex + 1).replace(/\s/g, '');
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
};

export const isImageDataUrl = (value: unknown): value is string =>
  typeof value === 'string' && IMAGE_DATA_URL_PATTERN.test(value);

export const blobToDataUrl = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)));
  }
  const base64 = btoa(chunks.join(''));
  const mimeType = blob.type || 'application/octet-stream';
  return `data:${mimeType};base64,${base64}`;
};

export const imageUrlToDataUrl = async (imageUrl: string): Promise<string> => {
  if (isImageDataUrl(imageUrl)) return imageUrl;

  let response: Response;
  try {
    response = await fetch(imageUrl);
  } catch {
    throw new Error('图片下载失败，无法将插图嵌入存档。');
  }
  if (!response.ok) {
    throw new Error(`图片下载失败（HTTP ${response.status}），无法将插图嵌入存档。`);
  }

  const blob = await response.blob();
  if (!blob.type.toLowerCase().startsWith('image/')) {
    throw new Error('下载内容不是有效的图片，无法将插图嵌入存档。');
  }
  return blobToDataUrl(blob);
};
