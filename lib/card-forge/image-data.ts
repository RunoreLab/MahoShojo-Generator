const IMAGE_DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i;

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
  } catch (error) {
    throw new Error('图片下载失败，无法将插图嵌入存档。', { cause: error });
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
