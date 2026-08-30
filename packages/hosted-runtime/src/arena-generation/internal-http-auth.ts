const TIMESTAMP_HEADER = 'X-Mahoshojo-Internal-Timestamp';
const NONCE_HEADER = 'X-Mahoshojo-Internal-Nonce';
const SIGNATURE_HEADER = 'X-Mahoshojo-Internal-Signature';

export const ARENA_INTERNAL_AUTH_HEADERS = Object.freeze({
  timestamp: TIMESTAMP_HEADER,
  nonce: NONCE_HEADER,
  signature: SIGNATURE_HEADER,
});

const bytesToHex = (value: ArrayBuffer): string => Array.from(
  new Uint8Array(value),
  (byte) => byte.toString(16).padStart(2, '0'),
).join('');

const sha256Hex = async (value: string): Promise<string> => bytesToHex(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
);

const importSigningKey = (secret: string) => (
  crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
);

const importVerifyKey = (secret: string) => (
  crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
);

const canonical = async (input: {
  method: string;
  pathname: string;
  timestamp: string;
  nonce: string;
  body: string;
}): Promise<string> => [
  input.method.toUpperCase(),
  input.pathname,
  input.timestamp,
  input.nonce,
  await sha256Hex(input.body),
].join('\n');

export const createArenaInternalAuthHeaders = async (input: {
  secret: string;
  method: string;
  pathname: string;
  body: string;
  now?: Date;
  nonce?: string;
}): Promise<Record<string, string>> => {
  if (input.secret.trim().length < 32) throw new Error('ARENA_INTERNAL_SECRET_INVALID');
  const timestamp = (input.now ?? new Date()).toISOString();
  const nonce = input.nonce ?? crypto.randomUUID();
  const value = await canonical({ ...input, timestamp, nonce });
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importSigningKey(input.secret),
    new TextEncoder().encode(value),
  );
  return {
    [TIMESTAMP_HEADER]: timestamp,
    [NONCE_HEADER]: nonce,
    [SIGNATURE_HEADER]: bytesToHex(signature),
  };
};

export const verifyArenaInternalRequest = async (input: {
  secret: string;
  request: Request;
  body: string;
  now?: Date;
  maxClockSkewMs?: number;
}): Promise<boolean> => {
  if (input.secret.trim().length < 32) return false;
  const timestamp = input.request.headers.get(TIMESTAMP_HEADER)?.trim() ?? '';
  const nonce = input.request.headers.get(NONCE_HEADER)?.trim() ?? '';
  const signature = input.request.headers.get(SIGNATURE_HEADER)?.trim().toLowerCase() ?? '';
  const timestampMs = Date.parse(timestamp);
  if (
    !Number.isFinite(timestampMs)
    || Math.abs((input.now ?? new Date()).getTime() - timestampMs) > (input.maxClockSkewMs ?? 60_000)
    || !/^[0-9a-f-]{16,128}$/iu.test(nonce)
    || !/^[0-9a-f]{64}$/u.test(signature)
  ) return false;
  const value = await canonical({
    method: input.request.method,
    pathname: new URL(input.request.url).pathname,
    timestamp,
    nonce,
    body: input.body,
  });
  return crypto.subtle.verify(
    'HMAC',
    await importVerifyKey(input.secret),
    Uint8Array.from(signature.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16)),
    new TextEncoder().encode(value),
  );
};
