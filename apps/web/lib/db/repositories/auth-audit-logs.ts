import { and, desc, eq, gte, sql } from 'drizzle-orm';
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

export type CountAuthAuditSuccessInput = {
  eventType: string;
  sinceEpochSeconds: number;
  businessUserId?: number | null;
  authUserId?: string | null;
  ipAnonymized?: string | null;
};

export type GetLatestAuthAuditSuccessEpochInput = {
  eventType: string;
  businessUserId?: number | null;
  authUserId?: string | null;
  ipAnonymized?: string | null;
};

export type CountRecentFailedLoginsByLoginIdentifierHashInput = {
  loginIdentifierHash: string;
  sinceEpochSeconds: number;
};

export type CountRecentFailedLoginsByIpAnonymizedInput = {
  ipAnonymized: string;
  sinceEpochSeconds: number;
};

const toSafeInteger = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return 0;
};

const toSafeEpochSeconds = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return null;
};

const normalizeOptionalPositiveInteger = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
  if (value <= 0) return null;
  return value;
};

const normalizeOptionalNonEmptyString = (value: unknown, maxLength = 128): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength);
};

const buildAuthAuditSuccessWhereClause = (input: {
  eventType: string;
  businessUserId?: number | null;
  authUserId?: string | null;
  ipAnonymized?: string | null;
  sinceEpochSeconds?: number | null;
}) => {
  const eventType = normalizeOptionalNonEmptyString(input.eventType, 64);
  if (!eventType) return null;

  const conditions = [
    eq(authAuditLogs.eventType, eventType),
    eq(authAuditLogs.resultCode, 'SUCCESS'),
  ] as Array<ReturnType<typeof eq> | ReturnType<typeof gte>>;

  const businessUserId = normalizeOptionalPositiveInteger(input.businessUserId);
  if (businessUserId !== null) {
    conditions.push(eq(authAuditLogs.businessUserId, businessUserId));
  }

  const authUserId = normalizeOptionalNonEmptyString(input.authUserId, 128);
  if (authUserId) {
    conditions.push(eq(authAuditLogs.authUserId, authUserId));
  }

  const ipAnonymized = normalizeOptionalNonEmptyString(input.ipAnonymized, 128);
  if (ipAnonymized) {
    conditions.push(eq(authAuditLogs.ipAnonymized, ipAnonymized));
  }

  const sinceEpochSeconds = toSafeEpochSeconds(input.sinceEpochSeconds);
  if (sinceEpochSeconds !== null) {
    conditions.push(gte(authAuditLogs.createdAt, sinceEpochSeconds));
  }

  return and(...conditions);
};

export const countAuthAuditSuccessSince = async (
  db: AppDrizzleDb,
  input: CountAuthAuditSuccessInput,
): Promise<number> => {
  const whereClause = buildAuthAuditSuccessWhereClause({
    eventType: input.eventType,
    businessUserId: input.businessUserId,
    authUserId: input.authUserId,
    ipAnonymized: input.ipAnonymized,
    sinceEpochSeconds: input.sinceEpochSeconds,
  });

  if (!whereClause) return 0;

  const rows = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(authAuditLogs)
    .where(whereClause)
    .limit(1);

  return toSafeInteger(rows[0]?.count);
};

export const getLatestAuthAuditSuccessEpoch = async (
  db: AppDrizzleDb,
  input: GetLatestAuthAuditSuccessEpochInput,
): Promise<number | null> => {
  const whereClause = buildAuthAuditSuccessWhereClause({
    eventType: input.eventType,
    businessUserId: input.businessUserId,
    authUserId: input.authUserId,
    ipAnonymized: input.ipAnonymized,
  });

  if (!whereClause) return null;

  const rows = await db
    .select({
      createdAt: authAuditLogs.createdAt,
    })
    .from(authAuditLogs)
    .where(whereClause)
    .orderBy(desc(authAuditLogs.createdAt))
    .limit(1);

  const latest = rows[0]?.createdAt;
  return toSafeEpochSeconds(latest);
};

export const countRecentFailedLoginsByLoginIdentifierHash = async (
  db: AppDrizzleDb,
  input: CountRecentFailedLoginsByLoginIdentifierHashInput,
): Promise<number> => {
  const loginIdentifierHash = normalizeOptionalNonEmptyString(input.loginIdentifierHash, 128);
  const sinceEpochSeconds = toSafeEpochSeconds(input.sinceEpochSeconds);
  if (!loginIdentifierHash || sinceEpochSeconds === null) return 0;

  const rows = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(authAuditLogs)
    .where(
      and(
        eq(authAuditLogs.eventType, 'login_failed'),
        eq(authAuditLogs.resultCode, 'INVALID_CREDENTIAL'),
        gte(authAuditLogs.createdAt, sinceEpochSeconds),
        sql`json_extract(${authAuditLogs.metadataJson}, '$.loginIdentifierHash') = ${loginIdentifierHash}`,
      ),
    )
    .limit(1);

  return toSafeInteger(rows[0]?.count);
};

export const countRecentFailedLoginsByIpAnonymized = async (
  db: AppDrizzleDb,
  input: CountRecentFailedLoginsByIpAnonymizedInput,
): Promise<number> => {
  const ipAnonymized = normalizeOptionalNonEmptyString(input.ipAnonymized, 128);
  const sinceEpochSeconds = toSafeEpochSeconds(input.sinceEpochSeconds);
  if (!ipAnonymized || sinceEpochSeconds === null) return 0;

  const rows = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(authAuditLogs)
    .where(
      and(
        eq(authAuditLogs.eventType, 'login_failed'),
        eq(authAuditLogs.resultCode, 'INVALID_CREDENTIAL'),
        eq(authAuditLogs.ipAnonymized, ipAnonymized),
        gte(authAuditLogs.createdAt, sinceEpochSeconds),
      ),
    )
    .limit(1);

  return toSafeInteger(rows[0]?.count);
};
