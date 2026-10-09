/** Desktop host budgets, not shared card-field limits. 10 MiB follows the Web image warning;
 * 16 MP bounds RGBA decode (~64 MiB), 8192 bounds either raster/canvas axis.
 * SVG, remote URLs, blob URLs from documents and animated media never enter an image element. */
export const FORGE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const FORGE_JSON_MAX_BYTES = 32 * 1024 * 1024;
export const FORGE_IMAGE_MAX_PIXELS = 16 * 1024 * 1024;
export const FORGE_IMAGE_MAX_EDGE = 8192;

export function assertForgeDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > FORGE_IMAGE_MAX_EDGE || height > FORGE_IMAGE_MAX_EDGE || width * height > FORGE_IMAGE_MAX_PIXELS) {
    throw new Error('图片或导出画布超过本地安全上限（单边 8192 像素、总计 16 MP）。请缩小图片；长卡面仍可导出 JSON。');
  }
}

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
export function inspectForgeRaster(bytes: Uint8Array): { mime: string; width: number; height: number } {
  if (bytes.length > FORGE_IMAGE_MAX_BYTES) throw new Error('插图超过 10 MiB，请先缩小本地图片。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let mime = ''; let width = 0; let height = 0;
  if (bytes.length >= 33 && bytes[0] === 137 && ascii(bytes, 1, 7) === 'PNG\r\n\x1a\n' && ascii(bytes, 12, 4) === 'IHDR') {
    mime = 'image/png'; width = view.getUint32(16); height = view.getUint32(20);
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (length > bytes.length - offset - 12) throw new Error('PNG 图片数据不完整。');
      if (ascii(bytes, offset + 4, 4) === 'acTL') throw new Error('暂不支持动画图片，请使用静态 PNG / JPEG / WebP。');
      offset += length + 12;
    }
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    mime = 'image/jpeg';
    for (let offset = 2; offset + 3 < bytes.length;) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  } else if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    mime = 'image/webp';
    const kind = ascii(bytes, 12, 4);
    if (kind === 'VP8X') {
      if (bytes[20] & 2) throw new Error('暂不支持动画图片，请使用静态 PNG / JPEG / WebP。');
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff;
    } else if (kind === 'VP8L' && bytes[20] === 0x2f) {
      width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
    }
  }
  if (!mime || !width || !height) throw new Error('请选择有效的静态 PNG / JPEG / WebP 图片（不支持 SVG）。');
  assertForgeDimensions(width, height);
  return { mime, width, height };
}

export function decodeForgeDataUrl(value: string): { bytes: Uint8Array; mime: string } | null {
  // Remote / local paths / blob: / SVG are deliberately not dereferenced.
  if (value.length > FORGE_JSON_MAX_BYTES) throw new Error('内嵌插图数据超过本地输入上限。');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) return null;
  const base64 = match[2].replace(/\s/g, '');
  if (base64.length > Math.ceil(FORGE_IMAGE_MAX_BYTES / 3) * 4 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new Error('内嵌图片 Base64 无效或超过 10 MiB。');
  }
  const binary = atob(base64); const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const raster = inspectForgeRaster(bytes);
  if (raster.mime !== match[1].toLowerCase()) throw new Error('图片声明类型与实际内容不一致。');
  return { bytes, mime: raster.mime };
}

export async function validateForgeImage(bytes: Uint8Array): Promise<string> {
  const { mime } = inspectForgeRaster(bytes);
  // Chunked encoding avoids a call-stack overflow on 10 MiB files.
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  const url = `data:${mime};base64,${btoa(binary)}`;
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    const cleanup = () => { clearTimeout(timer); image.onload = null; image.onerror = null; image.src = ''; };
    const timer = setTimeout(() => { cleanup(); reject(new Error('本地图片解码超时，请换用较小的图片。')); }, 15_000);
    image.onerror = () => { cleanup(); reject(new Error('本地图片无法解码，请选择有效图片。')); };
    image.onload = () => {
      try { assertForgeDimensions(image.naturalWidth, image.naturalHeight); cleanup(); resolve(); }
      catch (error) { cleanup(); reject(error); }
    };
    image.src = url;
  });
  return url;
}
