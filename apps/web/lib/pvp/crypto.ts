const encoder = new TextEncoder();

const bufferToHex = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const stringToBytes = (value: string): Uint8Array => encoder.encode(value);

export const generateSaltHex = (byteLength: number = 16): string => {
  const len = Math.max(8, Math.floor(byteLength));
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

export const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', stringToBytes(value) as BufferSource);
  return bufferToHex(digest);
};

export const hashJoinCode = async (password: string, saltHex: string): Promise<string> => {
  const normalized = typeof password === 'string' ? password.trim() : '';
  const salt = typeof saltHex === 'string' ? saltHex : '';
  return sha256Hex(`${salt}:${normalized}`);
};

export const constantTimeEqual = (a: string, b: string): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
};
