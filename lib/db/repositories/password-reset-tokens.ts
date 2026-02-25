import { and, eq, gt, isNull } from 'drizzle-orm';
import { randomUUID } from '@/lib/crypto';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { authPasswordResetTokens } from '@/lib/db/schema';

export type CreatePasswordResetTokenInput = {
  userId: number;
  tokenHash: string;
  expiresAt: number;
  requestedIp?: string | null;
  requestedUserAgent?: string | null;
  nowEpochSeconds?: number;
};

const normalizeOptionalText = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength);
};

export const invalidateActivePasswordResetTokensByUserId = async (
  db: AppDrizzleDb,
  userId: number,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): Promise<void> => {
  await db
    .update(authPasswordResetTokens)
    .set({
      consumedAt: nowEpochSeconds,
      updatedAt: nowEpochSeconds,
    })
    .where(
      and(
        eq(authPasswordResetTokens.userId, userId),
        isNull(authPasswordResetTokens.consumedAt),
        gt(authPasswordResetTokens.expiresAt, nowEpochSeconds),
      ),
    );
};

export const createPasswordResetToken = async (
  db: AppDrizzleDb,
  input: CreatePasswordResetTokenInput,
): Promise<{ id: string; userId: number; tokenHash: string; expiresAt: number } | null> => {
  const nowEpochSeconds =
    typeof input.nowEpochSeconds === 'number' && Number.isFinite(input.nowEpochSeconds)
      ? Math.floor(input.nowEpochSeconds)
      : Math.floor(Date.now() / 1000);

  const requestedIp = normalizeOptionalText(input.requestedIp, 128);
  const requestedUserAgent = normalizeOptionalText(input.requestedUserAgent, 512);

  await invalidateActivePasswordResetTokensByUserId(db, input.userId, nowEpochSeconds);

  const id = randomUUID();
  await db.insert(authPasswordResetTokens).values({
    id,
    userId: input.userId,
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt,
    requestedIp,
    requestedUserAgent,
    createdAt: nowEpochSeconds,
    updatedAt: nowEpochSeconds,
  });

  return {
    id,
    userId: input.userId,
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt,
  };
};

export const consumePasswordResetTokenByHash = async (
  db: AppDrizzleDb,
  tokenHash: string,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): Promise<{ userId: number } | null> => {
  const rows = await db
    .update(authPasswordResetTokens)
    .set({
      consumedAt: nowEpochSeconds,
      updatedAt: nowEpochSeconds,
    })
    .where(
      and(
        eq(authPasswordResetTokens.tokenHash, tokenHash),
        isNull(authPasswordResetTokens.consumedAt),
        gt(authPasswordResetTokens.expiresAt, nowEpochSeconds),
      ),
    )
    .returning({
      userId: authPasswordResetTokens.userId,
    });

  const row = rows[0];
  if (!row) return null;
  return { userId: row.userId };
};

export const consumePasswordResetTokenById = async (
  db: AppDrizzleDb,
  tokenId: string,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): Promise<void> => {
  await db
    .update(authPasswordResetTokens)
    .set({
      consumedAt: nowEpochSeconds,
      updatedAt: nowEpochSeconds,
    })
    .where(and(eq(authPasswordResetTokens.id, tokenId), isNull(authPasswordResetTokens.consumedAt)));
};
