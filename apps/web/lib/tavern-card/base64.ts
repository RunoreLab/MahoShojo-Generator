const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const buildDecodeTable = () => {
  const table = new Int16Array(256);
  table.fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  table['='.charCodeAt(0)] = 0;
  return table;
};

const BASE64_DECODE_TABLE = buildDecodeTable();

const stripBase64Whitespace = (input: string): string => {
  let hasWhitespace = false;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13 || code === 32) {
      hasWhitespace = true;
      break;
    }
  }
  if (!hasWhitespace) return input;
  return input.replace(/[ \t\r\n]+/g, '');
};

export function decodeBase64ToBytes(input: string): Uint8Array {
  const normalized = stripBase64Whitespace(input.trim());
  if (!normalized) return new Uint8Array();
  if (normalized.length % 4 !== 0) {
    throw new Error('Base64 长度不是 4 的倍数');
  }

  let padding = 0;
  if (normalized.endsWith('==')) padding = 2;
  else if (normalized.endsWith('=')) padding = 1;

  const outLen = (normalized.length / 4) * 3 - padding;
  const out = new Uint8Array(outLen);

  let outIndex = 0;
  for (let i = 0; i < normalized.length; i += 4) {
    const c0 = normalized.charCodeAt(i);
    const c1 = normalized.charCodeAt(i + 1);
    const c2 = normalized.charCodeAt(i + 2);
    const c3 = normalized.charCodeAt(i + 3);

    const v0 = BASE64_DECODE_TABLE[c0];
    const v1 = BASE64_DECODE_TABLE[c1];
    const v2 = BASE64_DECODE_TABLE[c2];
    const v3 = BASE64_DECODE_TABLE[c3];

    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) {
      throw new Error('Base64 包含非法字符');
    }

    const triple = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;
    if (outIndex < outLen) out[outIndex++] = (triple >> 16) & 0xff;
    if (outIndex < outLen) out[outIndex++] = (triple >> 8) & 0xff;
    if (outIndex < outLen) out[outIndex++] = triple & 0xff;
  }

  return out;
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  if (!bytes || bytes.length === 0) return '';

  const parts: string[] = [];
  let chunk = '';

  const flush = () => {
    if (chunk) parts.push(chunk);
    chunk = '';
  };

  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;

    const c0 = BASE64_ALPHABET[(triple >> 18) & 63];
    const c1 = BASE64_ALPHABET[(triple >> 12) & 63];
    const c2 = i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 63] : '=';
    const c3 = i + 2 < bytes.length ? BASE64_ALPHABET[triple & 63] : '=';

    chunk += c0 + c1 + c2 + c3;
    if (chunk.length >= 8192) flush();
  }

  flush();
  return parts.join('');
}

