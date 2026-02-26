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

/**
 * 获取用户所有徽章（包含徽章定义）
 * @param userId 用户ID
 * @returns 用户徽章列表
 */
export async function getUserBadges(userId: number): Promise<UserBadge[]> {
  try {
    const bundle = await readBadgesRepoBundle();
    if (!bundle) return [];

    const rows = await bundle.listUserBadgesWithDefinitions(bundle.db, userId);
    return rows.map(mapJoinedRowToUserBadge);
  } catch (error) {
    console.error('获取用户徽章失败:', error);
    return [];
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
    if (!bundle) return [];

    const rows = await bundle.listRecentUserBadgesExcludingEquipped(bundle.db, userId, limit);
    return rows.map(mapJoinedRowToUserBadge);
  } catch (error) {
    console.error('获取用户最近徽章失败:', error);
    return [];
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
    if (!bundle) return false;

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
    return false;
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
    if (!bundle) return false;

    await bundle.insertUserBadgeIgnore(bundle.db, userId, badgeId);
    return true;
  } catch (error) {
    console.error('授予徽章失败:', error);
    return false;
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
    if (!bundle) return false;

    await bundle.deleteUserBadge(bundle.db, userId, badgeId);
    return true;
  } catch (error) {
    console.error('撤销徽章失败:', error);
    return false;
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
    if (!bundle) return false;

    const count = await bundle.countUserBadgesByBadgeId(bundle.db, userId, badgeId);
    return count > 0;
  } catch (error) {
    console.error('检查徽章拥有状态失败:', error);
    return false;
  }
}

/**
 * 获取所有可用的徽章定义
 * @returns 徽章定义列表
 */
export async function getAllBadges(): Promise<BadgeDefinition[]> {
  try {
    const bundle = await readBadgesRepoBundle();
    if (!bundle) return [];

    const rows = await bundle.listActiveBadgeDefinitions(bundle.db);
    return rows.map(mapBadgeDefinitionRow);
  } catch (error) {
    console.error('获取徽章列表失败:', error);
    return [];
  }
}
