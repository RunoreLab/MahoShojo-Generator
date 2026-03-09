import type { AppDrizzleDb } from '@/lib/db/drizzle';

export type BadgeGrantingBadgeDefinitionInput = {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  textColor: string;
  backgroundColor: string;
  borderColor: string | null;
  rarity: number;
  sortOrder: number;
  isActive: boolean;
};

export type BadgeGrantingReporterTotalsRow = {
  userId: number;
  username: string;
  publicCards: number;
  totalLikes: number;
  totalFavorites: number;
  totalUsage: number;
};

export type BadgeGrantingSponsorSlotCandidateRow = {
  userId: number;
  username: string;
  slotCount: number;
};

export type BadgeGrantingSponsorExcellentCandidateRow = {
  userId: number;
  username: string;
  slotCount: number;
  publicCards: number;
};

export type BadgeGrantingRatedCharacterRow = {
  userId: number;
  username: string;
  dataCardId: string;
  cardName: string;
  isPublic: number | boolean | null;
  reviewStatus: string | null;
  deletedAt: string | null;
  rating: number;
  games: number;
};

export type BadgeGrantingBatchGrantResult = {
  inserted: number;
  errors: number;
};

type D1PreparedStatementLike = {
  bind: (...params: unknown[]) => D1PreparedStatementLike;
  all: () => Promise<unknown>;
  run: () => Promise<unknown>;
};

type D1ClientLike = {
  prepare: (sql: string) => D1PreparedStatementLike;
};

type D1LikeStatementResult = {
  success?: boolean;
  results?: unknown;
  meta?: unknown;
  error?: unknown;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toInteger = (value: unknown, fallback = 0): number => {
  const num = toFiniteNumber(value);
  if (num == null) return fallback;
  return Math.trunc(num);
};

const toNullableString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const toStringOrEmpty = (value: unknown): string => (typeof value === 'string' ? value : '');

const toNullableBooleanOrNumber = (value: unknown): number | boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return Math.trunc(value);
    return null;
  }
  if (typeof value === 'string') {
    if (value === '1') return 1;
    if (value === '0') return 0;
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return null;
};

const getD1Client = (db: AppDrizzleDb): D1ClientLike => {
  const client = (db as unknown as { $client?: unknown }).$client;
  const prepare = asObject(client)?.prepare;
  if (typeof prepare !== 'function') {
    throw new Error('Drizzle D1 client 不可用：未检测到 prepare 方法');
  }
  return client as D1ClientLike;
};

const parseStatementResult = (value: unknown): {
  rows: Record<string, unknown>[];
  meta: Record<string, unknown>;
  success: boolean;
  error: string | null;
} => {
  const result = (asObject(value) ?? {}) as D1LikeStatementResult;
  const rows = asArray(result.results)
    .map((row) => asObject(row))
    .filter((row): row is Record<string, unknown> => Boolean(row));
  const meta = asObject(result.meta) ?? {};
  const success = result.success !== false;
  const error = typeof result.error === 'string' ? result.error : null;
  return { rows, meta, success, error };
};

const executeAll = async (
  db: AppDrizzleDb,
  sqlText: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> => {
  const client = getD1Client(db);
  const statement = client.prepare(sqlText).bind(...params);
  const raw = await statement.all();
  const parsed = parseStatementResult(raw);
  if (!parsed.success) {
    throw new Error(parsed.error || 'D1 查询失败');
  }
  return parsed.rows;
};

const executeRun = async (
  db: AppDrizzleDb,
  sqlText: string,
  params: unknown[] = [],
): Promise<number> => {
  const client = getD1Client(db);
  const statement = client.prepare(sqlText).bind(...params);
  const raw = await statement.run();
  const parsed = parseStatementResult(raw);
  if (!parsed.success) {
    throw new Error(parsed.error || 'D1 执行失败');
  }
  const changes = toFiniteNumber(parsed.meta.changes);
  return changes == null ? 0 : Math.max(0, Math.floor(changes));
};

const normalizePositiveUserIds = (userIds: number[]): number[] => {
  const set = new Set<number>();
  userIds.forEach((value) => {
    const id = toInteger(value, 0);
    if (id > 0) set.add(id);
  });
  return Array.from(set.values());
};

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const safe = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += safe) out.push(arr.slice(i, i + safe));
  return out;
};

export const countBadgesById = async (
  db: AppDrizzleDb,
  badgeId: string,
): Promise<number> => {
  const rows = await executeAll(db, 'SELECT COUNT(*) as count FROM badges WHERE id = ?', [badgeId]);
  return Math.max(0, toInteger(rows[0]?.count, 0));
};

export const insertBadgeDefinition = async (
  db: AppDrizzleDb,
  input: BadgeGrantingBadgeDefinitionInput,
): Promise<boolean> => {
  await executeRun(
    db,
    `INSERT INTO badges (
      id,
      name,
      description,
      icon,
      text_color,
      background_color,
      border_color,
      rarity,
      sort_order,
      is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.name,
      input.description,
      input.icon,
      input.textColor,
      input.backgroundColor,
      input.borderColor,
      input.rarity,
      input.sortOrder,
      input.isActive ? 1 : 0,
    ],
  );
  return true;
};

export const updateBadgeDefinition = async (
  db: AppDrizzleDb,
  input: BadgeGrantingBadgeDefinitionInput,
): Promise<boolean> => {
  await executeRun(
    db,
    `UPDATE badges SET
      name = ?,
      description = ?,
      icon = ?,
      text_color = ?,
      background_color = ?,
      border_color = ?,
      rarity = ?,
      sort_order = ?,
      is_active = ?
    WHERE id = ?`,
    [
      input.name,
      input.description,
      input.icon,
      input.textColor,
      input.backgroundColor,
      input.borderColor,
      input.rarity,
      input.sortOrder,
      input.isActive ? 1 : 0,
      input.id,
    ],
  );
  return true;
};

export const updateBadgeBasicStatus = async (
  db: AppDrizzleDb,
  input: {
    id: string;
    name: string;
    description: string | null;
    isActive: boolean;
  },
): Promise<boolean> => {
  await executeRun(
    db,
    'UPDATE badges SET name = ?, description = ?, is_active = ? WHERE id = ?',
    [input.name, input.description, input.isActive ? 1 : 0, input.id],
  );
  return true;
};

export const countUsersWithPublicApprovedCards = async (
  db: AppDrizzleDb,
): Promise<number> => {
  const rows = await executeAll(
    db,
    `SELECT COUNT(DISTINCT user_id) AS count
     FROM data_cards
     WHERE is_public = 1
       AND review_status = 'approved'`,
  );
  return Math.max(0, toInteger(rows[0]?.count, 0));
};

export const listUsersWithPublicApprovedCardTotals = async (
  db: AppDrizzleDb,
): Promise<BadgeGrantingReporterTotalsRow[]> => {
  const rows = await executeAll(
    db,
    `SELECT
      dc.user_id AS userId,
      u.username AS username,
      COUNT(dc.id) AS publicCards,
      COALESCE(SUM(dc.like_count), 0) AS totalLikes,
      COALESCE(SUM(dc.favorite_count), 0) AS totalFavorites,
      COALESCE(SUM(dc.usage_count), 0) AS totalUsage
    FROM data_cards dc
    JOIN users u ON u.id = dc.user_id
    WHERE dc.is_public = 1
      AND dc.review_status = 'approved'
    GROUP BY dc.user_id, u.username`,
  );

  return rows.map((row) => ({
    userId: Math.max(0, toInteger(row.userId, 0)),
    username: toStringOrEmpty(row.username),
    publicCards: Math.max(0, toInteger(row.publicCards, 0)),
    totalLikes: Math.max(0, toInteger(row.totalLikes, 0)),
    totalFavorites: Math.max(0, toInteger(row.totalFavorites, 0)),
    totalUsage: Math.max(0, toInteger(row.totalUsage, 0)),
  }));
};

export const listEligibleReporterUsers = async (
  db: AppDrizzleDb,
  input: {
    minTotalLikes: number;
    minTotalFavorites: number;
    minTotalUsage: number;
  },
): Promise<BadgeGrantingReporterTotalsRow[]> => {
  const rows = await executeAll(
    db,
    `SELECT
      dc.user_id AS userId,
      u.username AS username,
      COUNT(dc.id) AS publicCards,
      COALESCE(SUM(dc.like_count), 0) AS totalLikes,
      COALESCE(SUM(dc.favorite_count), 0) AS totalFavorites,
      COALESCE(SUM(dc.usage_count), 0) AS totalUsage
    FROM data_cards dc
    JOIN users u ON u.id = dc.user_id
    WHERE dc.is_public = 1
      AND dc.review_status = 'approved'
    GROUP BY dc.user_id, u.username
    HAVING COALESCE(SUM(dc.like_count), 0) >= ?
      AND COALESCE(SUM(dc.favorite_count), 0) >= ?
      AND COALESCE(SUM(dc.usage_count), 0) >= ?`,
    [input.minTotalLikes, input.minTotalFavorites, input.minTotalUsage],
  );

  return rows.map((row) => ({
    userId: Math.max(0, toInteger(row.userId, 0)),
    username: toStringOrEmpty(row.username),
    publicCards: Math.max(0, toInteger(row.publicCards, 0)),
    totalLikes: Math.max(0, toInteger(row.totalLikes, 0)),
    totalFavorites: Math.max(0, toInteger(row.totalFavorites, 0)),
    totalUsage: Math.max(0, toInteger(row.totalUsage, 0)),
  }));
};

export const getUserSlotCountById = async (
  db: AppDrizzleDb,
  userId: number,
): Promise<number> => {
  const rows = await executeAll(
    db,
    'SELECT slot_count AS slotCount FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  return Math.max(0, toInteger(rows[0]?.slotCount, 0));
};

export const listSponsorSlotCandidates = async (
  db: AppDrizzleDb,
  input: {
    excellentBadgeId: string;
    maxSlotCountWithExcellent: number;
  },
): Promise<BadgeGrantingSponsorSlotCandidateRow[]> => {
  const rows = await executeAll(
    db,
    `SELECT
      u.id AS userId,
      u.username AS username,
      COALESCE(u.slot_count, 0) AS slotCount
    FROM users u
    WHERE COALESCE(u.slot_count, 0) > 0
      AND NOT (
        COALESCE(u.slot_count, 0) <= ?
        AND EXISTS (
          SELECT 1
          FROM user_badges ub
          WHERE ub.user_id = u.id
            AND ub.badge_id = ?
        )
      )`,
    [input.maxSlotCountWithExcellent, input.excellentBadgeId],
  );

  return rows.map((row) => ({
    userId: Math.max(0, toInteger(row.userId, 0)),
    username: toStringOrEmpty(row.username),
    slotCount: Math.max(0, toInteger(row.slotCount, 0)),
  }));
};

export const listSponsorExcellentCandidates = async (
  db: AppDrizzleDb,
  input: {
    minTotalLikes: number;
    minTotalFavorites: number;
    minTotalUsage: number;
    minSlotCountExclusive: number;
  },
): Promise<BadgeGrantingSponsorExcellentCandidateRow[]> => {
  const rows = await executeAll(
    db,
    `SELECT
      u.id AS userId,
      u.username AS username,
      COALESCE(u.slot_count, 0) AS slotCount,
      COUNT(dc.id) AS publicCards
    FROM users u
    JOIN data_cards dc ON dc.user_id = u.id
    WHERE dc.is_public = 1
      AND dc.review_status = 'approved'
    GROUP BY u.id, u.username, u.slot_count
    HAVING COALESCE(SUM(dc.like_count), 0) >= ?
      AND COALESCE(SUM(dc.favorite_count), 0) >= ?
      AND COALESCE(SUM(dc.usage_count), 0) >= ?
      AND COALESCE(u.slot_count, 0) > ?`,
    [input.minTotalLikes, input.minTotalFavorites, input.minTotalUsage, input.minSlotCountExclusive],
  );

  return rows.map((row) => ({
    userId: Math.max(0, toInteger(row.userId, 0)),
    username: toStringOrEmpty(row.username),
    slotCount: Math.max(0, toInteger(row.slotCount, 0)),
    publicCards: Math.max(0, toInteger(row.publicCards, 0)),
  }));
};

export const listRatedCharactersByQueue = async (
  db: AppDrizzleDb,
  queue: 'strict' | 'free',
): Promise<BadgeGrantingRatedCharacterRow[]> => {
  const rows = await executeAll(
    db,
    `SELECT
      dc.user_id AS userId,
      u.username AS username,
      dc.id AS dataCardId,
      dc.name AS cardName,
      dc.is_public AS isPublic,
      dc.review_status AS reviewStatus,
      dc.deleted_at AS deletedAt,
      ar.rating AS rating,
      ar.games AS games
    FROM arena_ratings ar
    JOIN data_cards dc ON dc.id = ar.entity_id
    JOIN users u ON u.id = dc.user_id
    WHERE ar.queue = ?
      AND ar.entity_type = 'data_card'
      AND dc.type = 'character'`,
    [queue],
  );

  return rows.map((row) => ({
    userId: Math.max(0, toInteger(row.userId, 0)),
    username: toStringOrEmpty(row.username),
    dataCardId: toStringOrEmpty(row.dataCardId),
    cardName: toStringOrEmpty(row.cardName),
    isPublic: toNullableBooleanOrNumber(row.isPublic),
    reviewStatus: toNullableString(row.reviewStatus),
    deletedAt: toNullableString(row.deletedAt),
    rating: toInteger(row.rating, 0),
    games: Math.max(0, toInteger(row.games, 0)),
  }));
};

export const listUserIdsHavingBadge = async (
  db: AppDrizzleDb,
  badgeId: string,
): Promise<number[]> => {
  const rows = await executeAll(
    db,
    'SELECT user_id AS userId FROM user_badges WHERE badge_id = ?',
    [badgeId],
  );
  return rows
    .map((row) => toInteger(row.userId, 0))
    .filter((id) => id > 0);
};

export const grantBadgeToUsersInChunks = async (
  db: AppDrizzleDb,
  input: {
    badgeId: string;
    userIds: number[];
    chunkSize?: number;
  },
): Promise<BadgeGrantingBatchGrantResult> => {
  const safeChunkSize = Number.isFinite(input.chunkSize)
    ? Math.max(1, Math.floor(input.chunkSize as number))
    : 40;
  const safeUserIds = normalizePositiveUserIds(input.userIds);
  if (safeUserIds.length === 0) {
    return { inserted: 0, errors: 0 };
  }

  let inserted = 0;
  let errors = 0;

  for (const ids of chunk(safeUserIds, safeChunkSize)) {
    const placeholders = ids.map(() => '(?, ?)').join(', ');
    const params: unknown[] = [];
    ids.forEach((id) => {
      params.push(id, input.badgeId);
    });

    try {
      inserted += await executeRun(
        db,
        `INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES ${placeholders}`,
        params,
      );
    } catch {
      errors += ids.length;
    }
  }

  return { inserted, errors };
};
