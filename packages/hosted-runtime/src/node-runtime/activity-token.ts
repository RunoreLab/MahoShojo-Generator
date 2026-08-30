import { generateSignature, verifySignature } from './env-signature';
import type { SignatureService } from '../signature';

export const ACTIVITY_TOKEN_HEADER = 'x-mahoshojo-activity-token';
export const ACTIVITY_USER_ID_HEADER = 'x-mahoshojo-user-id';

const ACTIVITY_TOKEN_VERSION = 1;
const DEFAULT_TOKEN_TTL_DAYS = 90;

type ActivityTokenPayload = {
  v: number;
  userId: number;
  issuedAt: string;
  expiresAt: string;
};

type ActivityToken = ActivityTokenPayload & {
  signature: string;
};

export type ActivityTokenServiceDependencies = Pick<
  SignatureService,
  'generateSignature' | 'verifySignature'
>;

export type ActivityTokenService = {
  issueActivityToken(
    _userId: number,
    _options?: { now?: Date; ttlDays?: number },
  ): Promise<string | null>;
  verifyActivityToken(
    _token: string,
    _options?: { now?: Date },
  ): Promise<{ userId: number; expiresAt: string } | null>;
  getUserIdFromActivityHeaders(_headers: Headers): Promise<number | null>;
};

const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const isValidIsoDate = (value: string): boolean => Number.isFinite(new Date(value).getTime());

const bytesToBinaryString = (bytes: Uint8Array): string => {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return binary;
};

const binaryStringToBytes = (binary: string): Uint8Array => {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const toBase64 = (value: string): string => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8').toString('base64');
  }

  const bytes = new TextEncoder().encode(value);
  return btoa(bytesToBinaryString(bytes));
};

const fromBase64 = (value: string): string => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'base64').toString('utf8');
  }

  const binary = atob(value);
  const bytes = binaryStringToBytes(binary);
  return new TextDecoder().decode(bytes);
};

const base64ToBase64Url = (value: string): string => value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const base64UrlToBase64 = (value: string): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  if (!padding) return normalized;
  return normalized + '='.repeat(4 - padding);
};

const issueActivityTokenUsing = async (
  dependencies: ActivityTokenServiceDependencies,
  userId: number,
  options?: { now?: Date; ttlDays?: number },
): Promise<string | null> => {
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;

  const now = options?.now ?? new Date();
  const ttlDays = options?.ttlDays ?? DEFAULT_TOKEN_TTL_DAYS;
  const expiresAt = addDays(now, ttlDays);

  const payload: ActivityTokenPayload = {
    v: ACTIVITY_TOKEN_VERSION,
    userId,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const signature = await dependencies.generateSignature(payload);
  if (!signature) return null;

  const token: ActivityToken = { ...payload, signature };
  return base64ToBase64Url(toBase64(JSON.stringify(token)));
};

const parseTokenJson = (token: string): ActivityToken | null => {
  try {
    const decoded = fromBase64(base64UrlToBase64(token.trim()));
    const parsed = JSON.parse(decoded) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;

    const candidate = parsed as Partial<ActivityToken>;
    if (candidate.v !== ACTIVITY_TOKEN_VERSION) return null;
    if (typeof candidate.userId !== 'number' || !Number.isSafeInteger(candidate.userId) || candidate.userId <= 0) return null;
    if (typeof candidate.issuedAt !== 'string' || !candidate.issuedAt.trim() || !isValidIsoDate(candidate.issuedAt)) return null;
    if (typeof candidate.expiresAt !== 'string' || !candidate.expiresAt.trim() || !isValidIsoDate(candidate.expiresAt)) return null;
    if (typeof candidate.signature !== 'string' || !candidate.signature.trim()) return null;

    return candidate as ActivityToken;
  } catch {
    return null;
  }
};

const verifyActivityTokenUsing = async (
  dependencies: ActivityTokenServiceDependencies,
  token: string,
  options?: { now?: Date },
): Promise<{ userId: number; expiresAt: string } | null> => {
  const parsed = parseTokenJson(token);
  if (!parsed) return null;

  const now = options?.now ?? new Date();
  const expiresAtMs = new Date(parsed.expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) return null;

  const ok = await dependencies.verifySignature(parsed);
  if (!ok) return null;

  return { userId: parsed.userId, expiresAt: parsed.expiresAt };
};

export const parseActivityUserIdHeader = (value: string | null): number | null => {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  const userId = Number(raw);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  return userId;
};

export const createActivityTokenService = (
  dependencies: ActivityTokenServiceDependencies,
): ActivityTokenService => {
  const service: ActivityTokenService = {
    issueActivityToken: (userId, options) =>
      issueActivityTokenUsing(dependencies, userId, options),
    verifyActivityToken: (token, options) =>
      verifyActivityTokenUsing(dependencies, token, options),
    getUserIdFromActivityHeaders: async (headers) => {
      const token = headers.get(ACTIVITY_TOKEN_HEADER);
      if (!token) return null;

      const verified = await service.verifyActivityToken(token);
      return verified?.userId ?? null;
    },
  };
  return Object.freeze(service);
};

const defaultActivityTokenService = createActivityTokenService({
  generateSignature,
  verifySignature,
});

export const issueActivityToken = defaultActivityTokenService.issueActivityToken;
export const verifyActivityToken = defaultActivityTokenService.verifyActivityToken;
export const getUserIdFromActivityHeaders =
  defaultActivityTokenService.getUserIdFromActivityHeaders;
