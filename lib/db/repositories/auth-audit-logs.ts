import { randomUUID } from '@/lib/crypto';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { authAuditLogs } from '@/lib/db/schema';

export type CreateAuthAuditLogInput = {
  businessUserId?: number | null;
  authUserId?: string | null;
  eventType: string;
  authSource: string;
  identifierType?: string | null;
  ip?: string | null;
  ipAnonymized?: string | null;
  userAgent?: string | null;
  resultCode: string;
  resultMessage?: string | null;
  metadataJson?: string | null;
  createdAt?: number;
};

const normalizeOptionalText = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength);
};

const normalizeOptionalInteger = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
  if (value <= 0) return null;
  return value;
};

export const createAuthAuditLog = async (
  db: AppDrizzleDb,
  input: CreateAuthAuditLogInput,
): Promise<{ id: string } | null> => {
  const eventType = normalizeOptionalText(input.eventType, 64);
  const authSource = normalizeOptionalText(input.authSource, 32);
  const resultCode = normalizeOptionalText(input.resultCode, 64);
  if (!eventType || !authSource || !resultCode) return null;

  const createdAt =
    typeof input.createdAt === 'number' && Number.isFinite(input.createdAt) && input.createdAt > 0
      ? Math.floor(input.createdAt)
      : Math.floor(Date.now() / 1000);

  const id = randomUUID();
  await db.insert(authAuditLogs).values({
    id,
    businessUserId: normalizeOptionalInteger(input.businessUserId),
    authUserId: normalizeOptionalText(input.authUserId, 128),
    eventType,
    authSource,
    identifierType: normalizeOptionalText(input.identifierType, 32),
    ip: normalizeOptionalText(input.ip, 128),
    ipAnonymized: normalizeOptionalText(input.ipAnonymized, 128),
    userAgent: normalizeOptionalText(input.userAgent, 512),
    resultCode,
    resultMessage: normalizeOptionalText(input.resultMessage, 500),
    metadataJson: normalizeOptionalText(input.metadataJson, 4000),
    createdAt,
  });

  return { id };
};
