import type { PngTextChunk, TavernChunkType } from './types';
import { crc32Concat } from './crc32';
import { unzlibSync } from 'fflate';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface PngChunkRange {
  type: string;
  start: number;
  end: number;
  dataStart: number;
  dataEnd: number;
}

const asciiFromBytes = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
};

const isPngSignature = (bytes: Uint8Array): boolean => {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
};

export function assertPngSignature(bytes: Uint8Array): void {
  if (!bytes || bytes.length < PNG_SIGNATURE.length) {
    throw new Error('NOT_PNG');
  }
  if (!isPngSignature(bytes)) {
    throw new Error('PNG_SIGNATURE_MISMATCH');
  }
}

export function parsePngChunkRanges(bytes: Uint8Array): PngChunkRange[] {
  assertPngSignature(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ranges: PngChunkRange[] = [];

  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = asciiFromBytes(typeBytes);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const end = dataEnd + 4;
    if (end > bytes.length) {
      throw new Error('PNG_TRUNCATED');
    }
    ranges.push({ type, start: offset, end, dataStart, dataEnd });
    offset = end;
    if (type === 'IEND') break;
  }

  return ranges;
}

const parseTextKeywordAndPayload = (data: Uint8Array): { keyword: string; payload: Uint8Array } | null => {
  const nullIndex = data.indexOf(0);
  if (nullIndex <= 0) return null;
  const keyword = asciiFromBytes(data.subarray(0, nullIndex));
  const payload = data.subarray(nullIndex + 1);
  return { keyword, payload };
};

const decodeUtf8 = (bytes: Uint8Array): string => {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
};

const inflateZlibOrNull = (bytes: Uint8Array): Uint8Array | null => {
  try {
    return unzlibSync(bytes);
  } catch {
    return null;
  }
};

export function extractPngTextChunks(bytes: Uint8Array): PngTextChunk[] {
  const ranges = parsePngChunkRanges(bytes);
  const chunks: PngTextChunk[] = [];

  for (const range of ranges) {
    const chunkType = range.type as TavernChunkType;
    const data = bytes.subarray(range.dataStart, range.dataEnd);

    if (range.type === 'tEXt') {
      const parsed = parseTextKeywordAndPayload(data);
      if (!parsed) continue;
      chunks.push({ chunkType, keyword: parsed.keyword, text: decodeUtf8(parsed.payload) });
      continue;
    }

    if (range.type === 'iTXt') {
      const nullIndex = data.indexOf(0);
      if (nullIndex <= 0) continue;
      const keyword = asciiFromBytes(data.subarray(0, nullIndex));
      const compressionFlag = data[nullIndex + 1];
      const compressionMethod = data[nullIndex + 2];
      if (compressionMethod !== 0) continue;

      let cursor = nullIndex + 3;
      const langEnd = data.indexOf(0, cursor);
      if (langEnd === -1) continue;
      cursor = langEnd + 1;
      const translatedEnd = data.indexOf(0, cursor);
      if (translatedEnd === -1) continue;
      cursor = translatedEnd + 1;
      const payload = data.subarray(cursor);
      if (compressionFlag === 1) {
        const inflated = inflateZlibOrNull(payload);
        if (!inflated) continue;
        chunks.push({ chunkType, keyword, text: decodeUtf8(inflated) });
      } else {
        chunks.push({ chunkType, keyword, text: decodeUtf8(payload) });
      }
      continue;
    }

    if (range.type === 'zTXt') {
      const nullIndex = data.indexOf(0);
      if (nullIndex <= 0) continue;
      const keyword = asciiFromBytes(data.subarray(0, nullIndex));
      const compressionMethod = data[nullIndex + 1];
      if (compressionMethod !== 0) continue;
      const payload = data.subarray(nullIndex + 2);
      const inflated = inflateZlibOrNull(payload);
      if (!inflated) continue;
      chunks.push({ chunkType, keyword, text: decodeUtf8(inflated) });
      continue;
    }
  }

  return chunks;
}

const encodeAscii = (value: string): Uint8Array => {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    out[i] = value.charCodeAt(i) & 0xff;
  }
  return out;
};

const encodeUtf8 = (value: string): Uint8Array => {
  return new TextEncoder().encode(value);
};

const buildPngChunkBytes = (type: string, data: Uint8Array): Uint8Array => {
  const typeBytes = encodeAscii(type);
  const length = data.length;
  const out = new Uint8Array(8 + length + 4);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(0, length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crc = crc32Concat([typeBytes, data]);
  view.setUint32(8 + length, crc, false);
  return out;
};

export function buildTextChunk(keyword: string, text: string, chunkType: 'tEXt' = 'tEXt'): Uint8Array {
  if (chunkType !== 'tEXt') {
    throw new Error('仅支持写入 tEXt');
  }
  const keywordBytes = encodeAscii(keyword);
  const payloadBytes = encodeUtf8(text);
  const data = new Uint8Array(keywordBytes.length + 1 + payloadBytes.length);
  data.set(keywordBytes, 0);
  data[keywordBytes.length] = 0;
  data.set(payloadBytes, keywordBytes.length + 1);
  return buildPngChunkBytes('tEXt', data);
}

export function replacePngTextChunks(
  bytes: Uint8Array,
  replacements: Array<{ keyword: string; text: string }>,
  options?: { overwriteExisting?: boolean }
): Uint8Array {
  const overwriteExisting = options?.overwriteExisting !== false;
  const ranges = parsePngChunkRanges(bytes);

  const keywordSet = new Set(replacements.map((item) => item.keyword));
  const replacementChunks = replacements.map((item) => buildTextChunk(item.keyword, item.text));
  const signature = bytes.subarray(0, PNG_SIGNATURE.length);

  const keptParts: Uint8Array[] = [signature];
  const iendParts: Uint8Array[] = [];

  for (const range of ranges) {
    const raw = bytes.subarray(range.start, range.end);
    if (range.type === 'IEND') {
      iendParts.push(raw);
      continue;
    }

    if (overwriteExisting && (range.type === 'tEXt' || range.type === 'iTXt' || range.type === 'zTXt')) {
      const data = bytes.subarray(range.dataStart, range.dataEnd);
      const parsed = parseTextKeywordAndPayload(data);
      if (parsed && keywordSet.has(parsed.keyword)) {
        continue;
      }
    }

    keptParts.push(raw);
  }

  const totalLength =
    keptParts.reduce((sum, part) => sum + part.length, 0) +
    replacementChunks.reduce((sum, part) => sum + part.length, 0) +
    iendParts.reduce((sum, part) => sum + part.length, 0);

  const out = new Uint8Array(totalLength);
  let cursor = 0;
  for (const part of keptParts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  for (const part of replacementChunks) {
    out.set(part, cursor);
    cursor += part.length;
  }
  for (const part of iendParts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
