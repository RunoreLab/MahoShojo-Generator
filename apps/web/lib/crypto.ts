const getCrypto = (): Crypto | null => {
  if (typeof globalThis.crypto === 'undefined') {
    return null;
  }
  return globalThis.crypto;
};

const SHA256_INITIAL_STATE = [
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
] as const;

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

const rotateRight = (value: number, bits: number): number => (
  (value >>> bits) | (value << (32 - bits))
);

const manualUtf8Encode = (value: string): Uint8Array => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
};

export const encodeUtf8 = (value: string): Uint8Array => {
  try {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(value);
  } catch {
    // Some embedded runtimes expose TextEncoder but fail during construction.
  }
  return manualUtf8Encode(value);
};

const bytesToHex = (bytes: Uint8Array): string => {
  let hex = '';
  for (let index = 0; index < bytes.length; index += 1) {
    hex += bytes[index]!.toString(16).padStart(2, '0');
  }
  return hex;
};

const sha256Fallback = (bytes: Uint8Array): Uint8Array => {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const bitLengthHigh = Math.floor(bitLength / 0x100000000);
  const bitLengthLow = bitLength >>> 0;
  padded[paddedLength - 8] = (bitLengthHigh >>> 24) & 0xff;
  padded[paddedLength - 7] = (bitLengthHigh >>> 16) & 0xff;
  padded[paddedLength - 6] = (bitLengthHigh >>> 8) & 0xff;
  padded[paddedLength - 5] = bitLengthHigh & 0xff;
  padded[paddedLength - 4] = (bitLengthLow >>> 24) & 0xff;
  padded[paddedLength - 3] = (bitLengthLow >>> 16) & 0xff;
  padded[paddedLength - 2] = (bitLengthLow >>> 8) & 0xff;
  padded[paddedLength - 1] = bitLengthLow & 0xff;

  const state: number[] = [...SHA256_INITIAL_STATE];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      words[index] = (
        (padded[position]! << 24)
        | (padded[position + 1]! << 16)
        | (padded[position + 2]! << 8)
        | padded[position + 3]!
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15]!;
      const word2 = words[index - 2]!;
      const sigma0 = (
        rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3)
      ) >>> 0;
      const sigma1 = (
        rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10)
      ) >>> 0;
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) >>> 0;
      const choose = ((e & f) ^ (~e & g)) >>> 0;
      const temporary1 = (h + sum1 + choose + SHA256_ROUND_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0 = (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) >>> 0;
      const majority = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    state[0] = (state[0]! + a) >>> 0;
    state[1] = (state[1]! + b) >>> 0;
    state[2] = (state[2]! + c) >>> 0;
    state[3] = (state[3]! + d) >>> 0;
    state[4] = (state[4]! + e) >>> 0;
    state[5] = (state[5]! + f) >>> 0;
    state[6] = (state[6]! + g) >>> 0;
    state[7] = (state[7]! + h) >>> 0;
  }

  const result = new Uint8Array(32);
  for (let index = 0; index < state.length; index += 1) {
    const word = state[index]!;
    const position = index * 4;
    result[position] = (word >>> 24) & 0xff;
    result[position + 1] = (word >>> 16) & 0xff;
    result[position + 2] = (word >>> 8) & 0xff;
    result[position + 3] = word & 0xff;
  }
  return result;
};

const uuidFromBytes = (bytes: Uint8Array): string => {
  // RFC 4122 UUID v4
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const secureRandomUUIDOrNull = (): string | null => {
  const cryptoProvider = getCrypto();
  if (!cryptoProvider) return null;
  try {
    if (typeof cryptoProvider.randomUUID === 'function') return cryptoProvider.randomUUID();
    if (typeof cryptoProvider.getRandomValues !== 'function') return null;
    return uuidFromBytes(cryptoProvider.getRandomValues(new Uint8Array(16)));
  } catch {
    return null;
  }
};

export const getSecureRandomValues = (array: Uint8Array): Uint8Array => {
  const cryptoProvider = getCrypto();
  if (!cryptoProvider || typeof cryptoProvider.getRandomValues !== 'function') {
    throw new Error('当前运行环境不支持 Web Crypto API，无法生成安全随机数。');
  }
  return cryptoProvider.getRandomValues(array);
};

export const secureRandomUUID = (): string => {
  const uuid = secureRandomUUIDOrNull();
  if (uuid) return uuid;
  throw new Error('当前浏览器不支持竞技场所需的安全随机数，请使用 HTTPS 或更新浏览器后重试。');
};

export const randomUUID = (): string => {
  const secureUuid = secureRandomUUIDOrNull();
  if (secureUuid) return secureUuid;

  // 保留通用本地编辑器 ID 的历史降级语义；请求身份与 actor token 使用上面的 secureRandomUUID。
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return uuidFromBytes(bytes);
};

export const sha256Hex = async (value: string): Promise<string> => {
  const bytes = encodeUtf8(value);
  const cryptoProvider = getCrypto();
  try {
    const subtle = cryptoProvider?.subtle;
    if (subtle && typeof subtle.digest === 'function') {
      const digest = await subtle.digest('SHA-256', bytes as BufferSource);
      return bytesToHex(new Uint8Array(digest));
    }
  } catch {
    // insecure context/旧 WebView 可能暴露 subtle 但拒绝 digest，继续使用确定性本地实现。
  }
  return bytesToHex(sha256Fallback(bytes));
};
