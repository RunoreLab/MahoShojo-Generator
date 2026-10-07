import { and, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { OnlineDataCardTypeSchema, type OnlineDataCardType } from '@mahoshojo/contracts/data-cards';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { autoReviewDecisions, dataCards, dataCardUpdates } from '@/lib/db/schema';

/**
 * 自动审查仓库层。所有落地写入都带快照守卫：
 * 审核时的观测值被逐项塞进写语句的 WHERE（与管理端 snapshot() 同一不变量），
 * 审核期间内容若被用户改掉，守卫不命中——过期裁决不会落在更新后的内容上。
 */

export type PendingDataCardReviewRow = {
  id: string;
  name: string;
  description: string | null;
  data: string;
  type: OnlineDataCardType | null;
  /** 列表时观测的 updated_at；同秒写竞态由 name/description/data 全值比对兜底 */
  updatedAt: string | null;
};

export type PendingDataCardUpdateReviewRow = {
  updateId: string;
  dataCardId: string;
  /** 待审更新提议的值 */
  name: string;
  description: string | null;
  data: string;
  updatedAt: string | null;
  type: OnlineDataCardType | null;
  /** 待审更新落基时依附的卡片快照（当前线上版本） */
  cardName: string;
  cardDescription: string | null;
  cardData: string;
  cardUpdatedAt: string | null;
};

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const asOnlineDataCardType = (value: unknown): OnlineDataCardType | null => {
  const result = OnlineDataCardTypeSchema.safeParse(value);
  return result.success ? result.data : null;
};

/** NULL 安全等值：SQLite `col IS NULL` / `col = ?`。 */
const matchValue = (column: SQLiteColumn, value: string | number | boolean | null): SQL =>
  value === null ? isNull(column) : eq(column, value);

/** 卡片内容快照谓词：审核观测的 name/description/data/type/updated_at 任一变则整条不匹配。 */
const cardContentGuard = (snap: {
  name: string;
  description: string | null;
  data: string;
  type: OnlineDataCardType | null;
  updatedAt: string | null;
}): SQL =>
  and(
    matchValue(dataCards.name, snap.name),
    matchValue(dataCards.description, snap.description),
    matchValue(dataCards.data, snap.data),
    matchValue(dataCards.type, snap.type),
    matchValue(dataCards.updatedAt, snap.updatedAt),
  )!;

/** 待审更新行快照谓词（用于 EXISTS 子查询与 DELETE WHERE）。 */
const updateRowGuard = (snap: {
  updateId: string;
  dataCardId: string;
  name: string;
  description: string | null;
  data: string;
  updatedAt: string | null;
}): SQL =>
  and(
    eq(dataCardUpdates.id, snap.updateId),
    eq(dataCardUpdates.dataCardId, snap.dataCardId),
    matchValue(dataCardUpdates.name, snap.name),
    matchValue(dataCardUpdates.description, snap.description),
    matchValue(dataCardUpdates.data, snap.data),
    matchValue(dataCardUpdates.updatedAt, snap.updatedAt),
  )!;

export const countPendingPublicCardsByUserId = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<number> => {
  const rows = await db
    .select({
      count: count(),
    })
    .from(dataCards)
    .where(
      and(
        eq(dataCards.userId, userId),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'pending'),
        isNull(dataCards.deletedAt),
      ),
    );

  return Math.max(0, toInt(rows[0]?.count, 0));
};

export const listLatestPendingPublicCardsByUserId = async (
  db: AppDrizzleDb,
  userId: number,
  limit: number,
): Promise<PendingDataCardReviewRow[]> => {
  if (limit <= 0) return [];

  const rows = await db
    .select({
      id: dataCards.id,
      name: dataCards.name,
      description: dataCards.description,
      data: dataCards.data,
      type: dataCards.type,
      updatedAt: dataCards.updatedAt,
    })
    .from(dataCards)
    .where(
      and(
        eq(dataCards.userId, userId),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'pending'),
        isNull(dataCards.deletedAt),
      ),
    )
    .orderBy(desc(dataCards.updatedAt))
    .limit(Math.max(1, Math.min(200, Math.trunc(limit))));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: typeof row.description === 'string' ? row.description : null,
    data: row.data,
    type: asOnlineDataCardType(row.type),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
  }));
};

const reviewPendingPublicCard = async (
  db: AppDrizzleDb,
  userId: number,
  snap: PendingDataCardReviewRow,
  reviewStatus: 'approved' | 'rejected',
): Promise<boolean> => {
  const rows = await db
    .update(dataCards)
    .set({
      reviewStatus,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(
      and(
        eq(dataCards.userId, userId),
        eq(dataCards.id, snap.id),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'pending'),
        isNull(dataCards.deletedAt),
        cardContentGuard(snap),
      ),
    )
    .returning({ id: dataCards.id });
  return rows.length > 0;
};

/** 快照守卫的自动通过：审核期间卡内容没变才落 approved。 */
export const approvePendingPublicCardIfUnchanged = (
  db: AppDrizzleDb,
  userId: number,
  snap: PendingDataCardReviewRow,
): Promise<boolean> => reviewPendingPublicCard(db, userId, snap, 'approved');

/** 自动审查拒绝：只动 review_status，不动 is_public（与人工拒绝同语义），同样带快照守卫。 */
export const rejectPendingPublicCardIfUnchanged = (
  db: AppDrizzleDb,
  userId: number,
  snap: PendingDataCardReviewRow,
): Promise<boolean> => reviewPendingPublicCard(db, userId, snap, 'rejected');

export const countPendingPublicCardUpdatesByUserId = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<number> => {
  const rows = await db
    .select({
      count: count(),
    })
    .from(dataCardUpdates)
    .innerJoin(dataCards, eq(dataCards.id, dataCardUpdates.dataCardId))
    .where(
      and(
        eq(dataCardUpdates.userId, userId),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'approved'),
        isNull(dataCards.deletedAt),
      ),
    );

  return Math.max(0, toInt(rows[0]?.count, 0));
};

export const listLatestPendingPublicCardUpdatesByUserId = async (
  db: AppDrizzleDb,
  userId: number,
  limit: number,
): Promise<PendingDataCardUpdateReviewRow[]> => {
  if (limit <= 0) return [];

  const rows = await db
    .select({
      updateId: dataCardUpdates.id,
      dataCardId: dataCardUpdates.dataCardId,
      name: dataCardUpdates.name,
      description: dataCardUpdates.description,
      data: dataCardUpdates.data,
      updatedAt: dataCardUpdates.updatedAt,
      type: dataCards.type,
      // 两表 name/description/data/updated_at 同名：卡片侧显式 AS 别名，避免驱动结果对象里互相覆盖
      cardName: sql<string>`${dataCards.name} AS card_name`,
      cardDescription: sql<string | null>`${dataCards.description} AS card_description`,
      cardData: sql<string>`${dataCards.data} AS card_data`,
      cardUpdatedAt: sql<string | null>`${dataCards.updatedAt} AS card_updated_at`,
    })
    .from(dataCardUpdates)
    .innerJoin(dataCards, eq(dataCards.id, dataCardUpdates.dataCardId))
    .where(
      and(
        eq(dataCardUpdates.userId, userId),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'approved'),
        isNull(dataCards.deletedAt),
      ),
    )
    .orderBy(desc(dataCardUpdates.updatedAt))
    .limit(Math.max(1, Math.min(200, Math.trunc(limit))));

  return rows.map((row) => ({
    updateId: row.updateId,
    dataCardId: row.dataCardId,
    name: typeof row.name === 'string' ? row.name : '',
    description: typeof row.description === 'string' ? row.description : null,
    data: typeof row.data === 'string' ? row.data : '',
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
    type: asOnlineDataCardType(row.type),
    cardName: row.cardName,
    cardDescription: typeof row.cardDescription === 'string' ? row.cardDescription : null,
    cardData: row.cardData,
    cardUpdatedAt: typeof row.cardUpdatedAt === 'string' ? row.cardUpdatedAt : null,
  }));
};

/**
 * 快照守卫的更新落基，单语句判定两组快照：
 * - 卡片行仍是审核时观测的线上版本；
 * - 待审更新行仍是同一行同一内容（EXISTS 子查询，挡住 U1 审核期间被 U2 顶掉）。
 * 命中后删除待审行——删除走同一快照守卫，失败（更新已被替换）时 U2 存活继续等审。
 */
export const applyPendingCardUpdateIfUnchanged = async (
  db: AppDrizzleDb,
  userId: number,
  upd: PendingDataCardUpdateReviewRow,
): Promise<boolean> => {
  const updated = await db
    .update(dataCards)
    .set({
      name: upd.name,
      description: upd.description ?? '',
      data: upd.data,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(
      and(
        eq(dataCards.id, upd.dataCardId),
        eq(dataCards.userId, userId),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'approved'),
        isNull(dataCards.deletedAt),
        cardContentGuard({
          name: upd.cardName,
          description: upd.cardDescription,
          data: upd.cardData,
          type: upd.type,
          updatedAt: upd.cardUpdatedAt,
        }),
        sql`EXISTS (
          SELECT 1 FROM data_card_updates u
          WHERE u.id = ${upd.updateId}
            AND u.data_card_id = ${upd.dataCardId}
            AND u.user_id = ${userId}
            AND u.name IS ${upd.name}
            AND u.description IS ${upd.description}
            AND u.data IS ${upd.data}
            AND u.updated_at IS ${upd.updatedAt}
        )`,
      ),
    )
    .returning({ id: dataCards.id });

  if (updated.length === 0) return false;
  await deletePendingCardUpdateIfUnchanged(db, userId, upd);
  return true;
};

/** 快照守卫的待审更新删除：U1 的裁决不会误删顶替它的 U2。 */
export const deletePendingCardUpdateIfUnchanged = async (
  db: AppDrizzleDb,
  userId: number,
  upd: Pick<
    PendingDataCardUpdateReviewRow,
    'updateId' | 'dataCardId' | 'name' | 'description' | 'data' | 'updatedAt'
  >,
): Promise<boolean> => {
  const rows = await db
    .delete(dataCardUpdates)
    .where(and(eq(dataCardUpdates.userId, userId), updateRowGuard(upd)))
    .returning({ id: dataCardUpdates.id });
  return rows.length > 0;
};

/* ── 裁决审计 ────────────────────────────────────────────────────────────── */

export type AutoReviewDecisionInsert = {
  userId: number;
  targetKind: 'card' | 'update';
  dataCardId: string;
  updateId?: string | null;
  /** 审核时观测的 (name, description, data) SHA-256 */
  contentHash: string;
  reviewedUpdatedAt?: string | null;
  backendId: string;
  backendKind: string;
  model?: string | null;
  verdict: 'approve' | 'reject' | 'uncertain';
  action: 'approve' | 'reject' | 'pending';
  /** DB 写入是否实际生效（快照守卫未命中=false） */
  applied: boolean;
  score?: number | null;
  category?: string | null;
  reason?: string | null;
  inputTruncated: boolean;
  inputParseError: boolean;
  latencyMs?: number | null;
  attemptedBackends?: string[];
  details?: Record<string, unknown> | null;
};

const bound = (value: string | null | undefined, max: number): string | null =>
  typeof value === 'string' ? (value.length > max ? value.slice(0, max) : value) : null;

const boundJson = (value: unknown, max: number): string | null => {
  if (value === null || value === undefined) return null;
  try {
    return bound(JSON.stringify(value), max);
  } catch {
    return null;
  }
};

export const insertAutoReviewDecision = async (
  db: AppDrizzleDb,
  row: AutoReviewDecisionInsert,
): Promise<void> => {
  await db.insert(autoReviewDecisions).values({
    id: crypto.randomUUID(),
    userId: row.userId,
    targetKind: row.targetKind,
    dataCardId: row.dataCardId,
    updateId: row.updateId ?? null,
    contentHash: row.contentHash,
    reviewedUpdatedAt: row.reviewedUpdatedAt ?? null,
    backendId: row.backendId,
    backendKind: row.backendKind,
    model: row.model ?? null,
    verdict: row.verdict,
    action: row.action,
    applied: row.applied,
    score: typeof row.score === 'number' && Number.isFinite(row.score) ? row.score : null,
    category: row.category ?? null,
    reason: bound(row.reason, 500),
    inputTruncated: row.inputTruncated,
    inputParseError: row.inputParseError,
    latencyMs: row.latencyMs ?? null,
    attemptedBackends: boundJson(row.attemptedBackends ?? [], 1024),
    detailsJson: boundJson(row.details, 4096),
  });
};
