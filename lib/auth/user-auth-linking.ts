import { getSecureRandomValues } from '@/lib/crypto';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import {
  createBusinessUser,
  getBusinessUserByEmail,
  getBusinessUserById,
  getBusinessUserByUsername,
  updateBusinessUserAuthKey,
  type BusinessUserRow,
} from '@/lib/db/repositories/business-users';
import { getUserAuthLinkByAuthUserId, upsertUserAuthLink } from '@/lib/db/repositories/user-auth-links';

const USERNAME_MIN_LENGTH = 2;
const USERNAME_MAX_LENGTH = 20;
const USERNAME_MAX_ATTEMPTS = 120;

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeEmail = (value: unknown): string | null => {
  const email = toNonEmptyString(value);
  if (!email) return null;
  return email.toLowerCase();
};

const trimToLength = (value: string, max: number): string => {
  if (value.length <= max) return value;
  return value.slice(0, max);
};

const normalizeUsernameSeed = (name: unknown, email: string): string => {
  const nameValue = toNonEmptyString(name)?.replace(/\s+/g, '') ?? '';
  const emailSeed = email.split('@')[0]?.trim() ?? '';
  const fallback = nameValue || emailSeed || 'user';

  if (fallback.length >= USERNAME_MIN_LENGTH) {
    return trimToLength(fallback, USERNAME_MAX_LENGTH);
  }

  const padded = `${fallback || 'u'}_user`;
  return trimToLength(padded, USERNAME_MAX_LENGTH);
};

const buildCandidateUsername = (seed: string, attempt: number): string => {
  if (attempt === 0) {
    return trimToLength(seed, USERNAME_MAX_LENGTH);
  }

  const suffix = `_${attempt.toString(36)}`;
  const prefixLength = Math.max(USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH - suffix.length);
  const prefix = trimToLength(seed, prefixLength);
  return trimToLength(`${prefix}${suffix}`, USERNAME_MAX_LENGTH);
};

const generateLegacyAuthKey = (): string => {
  const bytes = new Uint8Array(32);
  try {
    getSecureRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const findOrCreateBusinessUser = async (
  email: string,
  name: string | null,
): Promise<BusinessUserRow | null> => {
  const db = getDrizzleDbFromRuntime();
  if (!db) return null;

  const existingByEmail = await getBusinessUserByEmail(db, email);
  if (existingByEmail) return existingByEmail;

  const usernameSeed = normalizeUsernameSeed(name, email);

  for (let attempt = 0; attempt < USERNAME_MAX_ATTEMPTS; attempt += 1) {
    const username = buildCandidateUsername(usernameSeed, attempt);
    const existingByName = await getBusinessUserByUsername(db, username);
    if (existingByName) continue;

    const created = await createBusinessUser(db, {
      username,
      email,
      authKey: generateLegacyAuthKey(),
    });
    if (created) return created;

    const afterRace = await getBusinessUserByEmail(db, email);
    if (afterRace) return afterRace;
  }

  return null;
};

export type EnsureAuthUserLinkInput = {
  authUserId: string;
  email?: string | null;
  name?: string | null;
};

export const getLinkedBusinessUserByAuthUserId = async (authUserId: string): Promise<BusinessUserRow | null> => {
  const db = getDrizzleDbFromRuntime();
  if (!db) return null;

  const link = await getUserAuthLinkByAuthUserId(db, authUserId);
  if (!link) return null;
  return getBusinessUserById(db, link.businessUserId);
};

export const ensureAuthUserLink = async (input: EnsureAuthUserLinkInput): Promise<BusinessUserRow | null> => {
  const authUserId = toNonEmptyString(input.authUserId);
  if (!authUserId) return null;

  const db = getDrizzleDbFromRuntime();
  if (!db) return null;

  const linked = await getLinkedBusinessUserByAuthUserId(authUserId);
  if (linked) return linked;

  const email = normalizeEmail(input.email);
  if (!email) return null;

  const businessUser = await findOrCreateBusinessUser(email, toNonEmptyString(input.name));
  if (!businessUser) return null;

  await upsertUserAuthLink(db, {
    authUserId,
    businessUserId: businessUser.id,
  });

  return businessUser;
};

export const ensureBusinessUserLegacyAuthKey = async (
  businessUser: BusinessUserRow,
): Promise<BusinessUserRow | null> => {
  const existingAuthKey = toNonEmptyString(businessUser.authKey);
  if (existingAuthKey) return businessUser;

  const db = getDrizzleDbFromRuntime();
  if (!db) return null;

  const nextAuthKey = generateLegacyAuthKey();
  return updateBusinessUserAuthKey(db, businessUser.id, nextAuthKey);
};
