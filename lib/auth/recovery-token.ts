import { getSecureRandomValues } from '@/lib/crypto';
import { sha256Hex } from '@/lib/pvp/crypto';

export const RECOVERY_TOKEN_TTL_SECONDS = 15 * 60;
const FALLBACK_RECOVERY_TOKEN_PEPPER = 'mahoshojo-recovery-token-v1';

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readRecoveryTokenPepper = (): string => {
  return (
    toNonEmptyString(process.env.AUTH_RECOVERY_TOKEN_PEPPER) ??
    toNonEmptyString(process.env.BETTER_AUTH_SECRET) ??
    toNonEmptyString(process.env.SIGNATURE_SECRET_KEY) ??
    FALLBACK_RECOVERY_TOKEN_PEPPER
  );
};

export const generateRecoveryToken = (): string => {
  const bytes = new Uint8Array(32);
  getSecureRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const hashRecoveryToken = async (token: string): Promise<string> => {
  const pepper = readRecoveryTokenPepper();
  return sha256Hex(`${pepper}:${token}`);
};

export const normalizeLegacyAuthKey = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length < 16 || normalized.length > 128) return null;
  if (/\s/.test(normalized)) return null;
  return normalized;
};
