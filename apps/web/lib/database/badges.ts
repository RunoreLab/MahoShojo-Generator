import type { UserBadge, BadgeDefinition, ColorConfig, IconConfig } from '@/types/badge';

type UserBadgeJoinedRow = {
  ub_id: number;
  user_id: number;
  badge_id: string;
  is_equipped: number;
  display_order: number;
  obtained_at: string | null;
  badge_name: string;
  badge_description: string | null;
  badge_icon: string;
  text_color: string;
  background_color: string;
  border_color: string | null;
  rarity: number;
  sort_order: number;
  is_active: number;
};

type BadgeDefinitionRow = {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  text_color: string;
  background_color: string;
  border_color: string | null;
  rarity: number;
  sort_order: number;
  is_active: number;
};

type BadgesRepoBundle = {
  db: unknown;
  listUserBadgesWithDefinitions: (db: unknown, userId: number) => Promise<UserBadgeJoinedRow[]>;
  listRecentUserBadgesExcludingEquipped: (db: unknown, userId: number, limit: number) => Promise<UserBadgeJoinedRow[]>;
  clearEquippedUserBadges: (db: unknown, userId: number) => Promise<void>;
  setUserBadgeEquippedOrder: (db: unknown, userId: number, badgeId: string, displayOrder: number) => Promise<number>;
  insertUserBadgeIgnore: (db: unknown, userId: number, badgeId: string) => Promise<void>;
  deleteUserBadge: (db: unknown, userId: number, badgeId: string) => Promise<number>;
  countUserBadgesByBadgeId: (db: unknown, userId: number, badgeId: string) => Promise<number>;
  listActiveBadgeDefinitions: (db: unknown) => Promise<BadgeDefinitionRow[]>;
};

type LegacyD1Payload = {
  success?: boolean;
  result?: Array<{
    success?: boolean;
    results?: unknown;
  }>;
};

const readBadgesRepoBundle = async (): Promise<BadgesRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/badges'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      listUserBadgesWithDefinitions: repo.listUserBadgesWithDefinitions as BadgesRepoBundle['listUserBadgesWithDefinitions'],
      listRecentUserBadgesExcludingEquipped:
        repo.listRecentUserBadgesExcludingEquipped as BadgesRepoBundle['listRecentUserBadgesExcludingEquipped'],
      clearEquippedUserBadges: repo.clearEquippedUserBadges as BadgesRepoBundle['clearEquippedUserBadges'],
      setUserBadgeEquippedOrder: repo.setUserBadgeEquippedOrder as BadgesRepoBundle['setUserBadgeEquippedOrder'],
      insertUserBadgeIgnore: repo.insertUserBadgeIgnore as BadgesRepoBundle['insertUserBadgeIgnore'],
      deleteUserBadge: repo.deleteUserBadge as BadgesRepoBundle['deleteUserBadge'],
      countUserBadgesByBadgeId: repo.countUserBadgesByBadgeId as BadgesRepoBundle['countUserBadgesByBadgeId'],
      listActiveBadgeDefinitions: repo.listActiveBadgeDefinitions as BadgesRepoBundle['listActiveBadgeDefinitions'],
    };
  } catch {
    return null;
  }
};

/**
 * 解析数据库中的 JSON 字段为类型化对象
 */
function parseJsonField<T>(jsonString: string | null): T | undefined {
  if (!jsonString) return undefined;
  try {
    return JSON.parse(jsonString) as T;
  } catch (e) {
    console.error('Failed to parse JSON field:', jsonString, e);
    return undefined;
  }
}

const toInt = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
};

const toNullableString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const readLegacyRows = (payload: unknown): Record<string, unknown>[] => {
  const envelope = asObject(payload) as LegacyD1Payload | null;
  if (!envelope || envelope.success !== true) return [];
  if (!Array.isArray(envelope.result) || envelope.result.length === 0) return [];

  const first = asObject(envelope.result[0]) as { success?: boolean; results?: unknown } | null;
  if (!first || first.success === false) return [];
  if (!Array.isArray(first.results)) return [];

  return first.results
    .map((item) => asObject(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
};

const executeLegacyQuery = async (sqlText: string, params: unknown[] = []): Promise<Record<string, unknown>[]> => {
  const { queryFromD1 } = await import('./core');
  const payload = await queryFromD1(sqlText, params);
  return readLegacyRows(payload);
};

const mapJoinedRowToUserBadge = (row: UserBadgeJoinedRow): UserBadge => ({
  id: toInt(row.ub_id, 0),
  userId: toInt(row.user_id, 0),
  badgeId: row.badge_id,
  isEquipped: Boolean(row.is_equipped),
  displayOrder: toInt(row.display_order, 0),
  obtainedAt: typeof row.obtained_at === 'string' ? row.obtained_at : '',
  badge: {
    id: row.badge_id,
    name: row.badge_name,
    description: typeof row.badge_description === 'string' ? row.badge_description : undefined,
    icon: parseJsonField<IconConfig>(row.badge_icon) || { type: 'null', value: null },
    textColor: parseJsonField<ColorConfig>(row.text_color) || { type: 'solid', value: '#000000' },
    backgroundColor: parseJsonField<ColorConfig>(row.background_color) || { type: 'solid', value: '#FFFFFF' },
    borderColor: parseJsonField<ColorConfig>(row.border_color),
    rarity: toInt(row.rarity, 0),
    sortOrder: toInt(row.sort_order, 0),
    isActive: Boolean(row.is_active),
  },
});

const mapBadgeDefinitionRow = (row: BadgeDefinitionRow): BadgeDefinition => ({
  id: row.id,
  name: row.name,
  description: typeof row.description === 'string' ? row.description : undefined,
  icon: parseJsonField<IconConfig>(row.icon) || { type: 'emoji', value: '🏅' },
  textColor: parseJsonField<ColorConfig>(row.text_color) || { type: 'solid', value: '#000000' },
  backgroundColor: parseJsonField<ColorConfig>(row.background_color) || { type: 'solid', value: '#FFFFFF' },
  borderColor: parseJsonField<ColorConfig>(row.border_color),
  rarity: toInt(row.rarity, 0),
  sortOrder: toInt(row.sort_order, 0),
  isActive: Boolean(row.is_active),
});

const mapLegacyJoinedRowToUserBadge = (row: Record<string, unknown>): UserBadge => {
  const badgeId = toNullableString(row.badge_id) ?? '';
  const badgeName = toNullableString(row.badge_name) ?? badgeId;

  return {
    id: toInt(row.ub_id, 0),
    userId: toInt(row.user_id, 0),
    badgeId,
    isEquipped: Boolean(toInt(row.is_equipped, 0)),
    displayOrder: toInt(row.display_order, 0),
    obtainedAt: toNullableString(row.obtained_at) ?? '',
    badge: {
      id: badgeId,
      name: badgeName,
      description: toNullableString(row.badge_description) ?? undefined,
      icon: parseJsonField<IconConfig>(toNullableString(row.badge_icon)) || { type: 'null', value: null },
      textColor: parseJsonField<ColorConfig>(toNullableString(row.text_color)) || { type: 'solid', value: '#000000' },
      backgroundColor:
        parseJsonField<ColorConfig>(toNullableString(row.background_color)) || { type: 'solid', value: '#FFFFFF' },
      borderColor: parseJsonField<ColorConfig>(toNullableString(row.border_color)),
      rarity: toInt(row.rarity, 0),
      sortOrder: toInt(row.sort_order, 0),
      isActive: Boolean(toInt(row.is_active, 0)),
    },
  };
};

const mapLegacyBadgeDefinitionRow = (row: Record<string, unknown>): BadgeDefinition => ({
  id: toNullableString(row.id) ?? '',
  name: toNullableString(row.name) ?? '',
  description: toNullableString(row.description) ?? undefined,
  icon: parseJsonField<IconConfig>(toNullableString(row.icon)) || { type: 'emoji', value: '🏅' },
  textColor: parseJsonField<ColorConfig>(toNullableString(row.text_color)) || { type: 'solid', value: '#000000' },
  backgroundColor:
    parseJsonField<ColorConfig>(toNullableString(row.background_color)) || { type: 'solid', value: '#FFFFFF' },
  borderColor: parseJsonField<ColorConfig>(toNullableString(row.border_color)),
  rarity: toInt(row.rarity, 0),
  sortOrder: toInt(row.sort_order, 0),
  isActive: Boolean(toInt(row.is_active, 0)),
});

const getUserBadgesLegacy = async (userId: number): Promise<UserBadge[]> => {
  const rows = await executeLegacyQuery(
    `
      SELECT
        ub.id as ub_id,
        ub.user_id,
        ub.badge_id,
        ub.is_equipped,
        ub.display_order,
        ub.obtained_at,
        b.id as badge_id,
        b.name as badge_name,
        b.description as badge_description,
        b.icon as badge_icon,
        b.text_color,
        b.background_color,
        b.border_color,
        b.rarity,
        b.sort_order,
        b.is_active
      FROM user_badges ub
      JOIN badges b ON ub.badge_id = b.id
      WHERE ub.user_id = ? AND b.is_active = 1
      ORDER BY ub.is_equipped DESC, b.rarity DESC, b.sort_order ASC
    `,
    [userId],
  );

  return rows.map(mapLegacyJoinedRowToUserBadge);
};

const getUserRecentBadgesExcludingEquippedLegacy = async (userId: number, limit = 5): Promise<UserBadge[]> => {
  const safeLimit = Math.max(1, Math.min(10, Math.floor(limit)));
  const rows = await executeLegacyQuery(
    `
      SELECT
        ub.id as ub_id,
        ub.user_id,
        ub.badge_id,
        ub.is_equipped,
        ub.display_order,
        ub.obtained_at,
        b.id as badge_id,
        b.name as badge_name,
        b.description as badge_description,
        b.icon as badge_icon,
        b.text_color,
        b.background_color,
        b.border_color,
        b.rarity,
        b.sort_order,
        b.is_active
      FROM user_badges ub
      JOIN badges b ON ub.badge_id = b.id
      WHERE ub.user_id = ? AND b.is_active = 1 AND ub.is_equipped = 0
      ORDER BY ub.obtained_at DESC
      LIMIT ?
    `,
    [userId, safeLimit],
  );

  return rows.map(mapLegacyJoinedRowToUserBadge);
};

const updateEquippedBadgesLegacy = async (userId: number, badgeIds: string[]): Promise<boolean> => {
  const { queryFromD1 } = await import('./core');
  const limitedBadgeIds = badgeIds.slice(0, 5);

  await queryFromD1('UPDATE user_badges SET is_equipped = 0, display_order = 0 WHERE user_id = ?', [userId]);
  for (let i = 0; i < limitedBadgeIds.length; i++) {
    await queryFromD1(
      `UPDATE user_badges
       SET is_equipped = 1, display_order = ?
       WHERE user_id = ? AND badge_id = ?`,
      [i + 1, userId, limitedBadgeIds[i]],
    );
  }
  return true;
};

const grantBadgeToUserLegacy = async (userId: number, badgeId: string): Promise<boolean> => {
  const { queryFromD1 } = await import('./core');
  await queryFromD1('INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)', [userId, badgeId]);
  return true;
};

const revokeBadgeFromUserLegacy = async (userId: number, badgeId: string): Promise<boolean> => {
  const { queryFromD1 } = await import('./core');
  await queryFromD1('DELETE FROM user_badges WHERE user_id = ? AND badge_id = ?', [userId, badgeId]);
  return true;
};

const userHasBadgeLegacy = async (userId: number, badgeId: string): Promise<boolean> => {
  const rows = await executeLegacyQuery('SELECT COUNT(*) as count FROM user_badges WHERE user_id = ? AND badge_id = ?', [
    userId,
    badgeId,
  ]);

  return toInt(rows[0]?.count, 0) > 0;
};

const getAllBadgesLegacy = async (): Promise<BadgeDefinition[]> => {
  const rows = await executeLegacyQuery(
    'SELECT * FROM badges WHERE is_active = 1 ORDER BY rarity DESC, sort_order ASC',
    [],
  );
  return rows.map(mapLegacyBadgeDefinitionRow);
};

/**
 * 获取用户所有徽章（包含徽章定义）
 * @param userId 用户ID
 * @returns 用户徽章列表
 */
export async function getUserBadges(userId: number): Promise<UserBadge[]> {
  try {
    const bundle = await readBadgesRepoBundle();
    if (!bundle) return await getUserBadgesLegacy(userId);

    const rows = await bundle.listUserBadgesWithDefinitions(bundle.db, userId);
    return rows.map(mapJoinedRowToUserBadge);
  } catch (error) {
    console.error('获取用户徽章失败:', error);
    try {
      return await getUserBadgesLegacy(userId);
    } catch {
      return [];
    }
  }
}

/**
 * 获取用户已佩戴的徽章
 * @param userId 用户ID
 * @returns 已佩戴的徽章列表（最多5个）
 */
export async function getUserEquippedBadges(userId: number): Promise<UserBadge[]> {
  const allBadges = await getUserBadges(userId);
  return allBadges
    .filter((badge) => badge.isEquipped)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .slice(0, 5);
}

/**
 * 获取用户最近获得但未佩戴的徽章
 * @param userId 用户ID
 * @param limit 返回数量（默认 5，最多 10）
 */
export async function getUserRecentBadgesExcludingEquipped(userId: number, limit = 5): Promise<UserBadge[]> {
  try {
    const bundle = await readBadgesRepoBundle();
    if (!bundle) return await getUserRecentBadgesExcludingEquippedLegacy(userId, limit);

    const rows = await bundle.listRecentUserBadgesExcludingEquipped(bundle.db, userId, limit);
    return rows.map(mapJoinedRowToUserBadge);
  } catch (error) {
    console.error('获取用户最近徽章失败:', error);
    try {
      return await getUserRecentBadgesExcludingEquippedLegacy(userId, limit);
    } catch {
      return [];
    }
  }
}

/**
 * 更新用户佩戴的徽章
 * @param userId 用户ID
 * @param badgeIds 徽章ID数组（按顺序）
 * @returns 是否成功
 */
export async function updateEquippedBadges(userId: number, badgeIds: string[]): Promise<boolean> {
  try {
    const bundle = await readBadgesRepoBundle();
    if (!bundle) return await updateEquippedBadgesLegacy(userId, badgeIds);

    // 限制最多5个徽章
    const limitedBadgeIds = badgeIds.slice(0, 5);

    // 1. 先取消所有佩戴
    await bundle.clearEquippedUserBadges(bundle.db, userId);

    // 2. 设置新的佩戴徽章
    for (let i = 0; i < limitedBadgeIds.length; i++) {
      await bundle.setUserBadgeEquippedOrder(bundle.db, userId, limitedBadgeIds[i], i + 1);
    }

    return true;
  } catch (error) {
    console.error('更新佩戴徽章失败:', error);
    try {
      return await updateEquippedBadgesLegacy(userId, badgeIds);
    } catch {
      return false;
    }
  }
}

/**
 * 授予用户徽章
 * @param userId 用户ID
 * @param badgeId 徽章ID
 * @returns 是否成功
 */
export async function grantBadgeToUser(userId: number, badgeId: string): Promise<boolean> {
  try {
    const bundle = await readBadgesRepoBundle();
    if (!bundle) return await grantBadgeToUserLegacy(userId, badgeId);

    await bundle.insertUserBadgeIgnore(bundle.db, userId, badgeId);
    return true;
  } catch (error) {
    console.error('授予徽章失败:', error);
    try {
      return await grantBadgeToUserLegacy(userId, badgeId);
    } catch {
      return false;
    }
  }
}

/**
 * 撤销用户徽章
 * @param userId 用户ID
 * @param badgeId 徽章ID
 * @returns 是否成功
 */
export async function revokeBadgeFromUser(userId: number, badgeId: string): Promise<boolean> {
  try {
    const bundle = await readBadgesRepoBundle();
    if (!bundle) return await revokeBadgeFromUserLegacy(userId, badgeId);

    await bundle.deleteUserBadge(bundle.db, userId, badgeId);
    return true;
  } catch (error) {
    console.error('撤销徽章失败:', error);
    try {
      return await revokeBadgeFromUserLegacy(userId, badgeId);
    } catch {
      return false;
    }
  }
}

/**
 * 检查用户是否拥有某个徽章
 * @param userId 用户ID
 * @param badgeId 徽章ID
 * @returns 是否拥有
 */
export async function userHasBadge(userId: number, badgeId: string): Promise<boolean> {
  try {
    const bundle = await readBadgesRepoBundle();
    if (!bundle) return await userHasBadgeLegacy(userId, badgeId);

    const count = await bundle.countUserBadgesByBadgeId(bundle.db, userId, badgeId);
    return count > 0;
  } catch (error) {
    console.error('检查徽章拥有状态失败:', error);
    try {
      return await userHasBadgeLegacy(userId, badgeId);
    } catch {
      return false;
    }
  }
}

/**
 * 获取所有可用的徽章定义
 * @returns 徽章定义列表
 */
export async function getAllBadges(): Promise<BadgeDefinition[]> {
  try {
    const bundle = await readBadgesRepoBundle();
    if (!bundle) return await getAllBadgesLegacy();

    const rows = await bundle.listActiveBadgeDefinitions(bundle.db);
    return rows.map(mapBadgeDefinitionRow);
  } catch (error) {
    console.error('获取徽章列表失败:', error);
    try {
      return await getAllBadgesLegacy();
    } catch {
      return [];
    }
  }
}
