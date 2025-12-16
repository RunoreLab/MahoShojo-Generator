const getCrypto = (): Crypto | null => {
  if (typeof globalThis.crypto === 'undefined') {
    return null;
  }
  return globalThis.crypto;
};

export const getSecureRandomValues = (array: Uint8Array): Uint8Array => {
  const cryptoProvider = getCrypto();
  if (!cryptoProvider || typeof cryptoProvider.getRandomValues !== 'function') {
    throw new Error('当前运行环境不支持 Web Crypto API，无法生成安全随机数。');
  }
  return cryptoProvider.getRandomValues(array);
};

export const randomUUID = (): string => {
  const cryptoProvider = getCrypto();
  if (cryptoProvider && typeof cryptoProvider.randomUUID === 'function') {
    return cryptoProvider.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (cryptoProvider && typeof cryptoProvider.getRandomValues === 'function') {
    cryptoProvider.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 UUID v4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

