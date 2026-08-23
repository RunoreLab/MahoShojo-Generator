import { generateUUID } from './core';
import { inferCharacterKind } from '@mahoshojo/domain/data-cards';

type DataCardType = 'character' | 'scenario' | 'history' | 'questionnaire';
type DataCardSortBy = 'likes' | 'usage' | 'favorites' | 'created_at';

type DataCardsRepoBundle = {
  db: unknown;
  countPublicDataCardsByNameType: (db: unknown, name: string, type: DataCardType) => Promise<number>;
  insertDataCard: (
    db: unknown,
    input: {
      id: string;
      userId: number;
      type: DataCardType;
      name: string;
      description: string;
      data: string;
      isPublic: number;
      reviewStatus?: 'pending' | 'approved' | 'rejected';
    },
  ) => Promise<boolean>;
  listUserDataCards: (
    db: unknown,
    input: { userId: number; search?: string; sortBy?: DataCardSortBy },
  ) => Promise<any[]>;
  updateDataCardByIdAndUser: (
    db: unknown,
    input: {
      id: string;
      userId: number;
      name: string;
      description: string;
      isPublic?: number;
      reviewStatus?: 'pending' | 'approved' | 'rejected';
    },
  ) => Promise<number>;
  updateDataCardContentByIdAndUserWithChanges: (
    db: unknown,
    dataCardId: string,
    userId: number,
    dataJsonString: string,
  ) => Promise<number>;
  upsertDataCardUpdateByDataCardId: (
    db: unknown,
    input: {
      id: string;
      dataCardId: string;
      userId: number;
      payload: { name?: string; description?: string; data?: string };
    },
  ) => Promise<boolean>;
  countUserUsedDataCardSlots: (db: unknown, userId: number) => Promise<number>;
  getDataCardUpdateByDataCardId: (db: unknown, dataCardId: string) => Promise<any | null>;
  deleteDataCardUpdateByDataCardId: (db: unknown, dataCardId: string) => Promise<void>;
  softDeleteDataCardByIdAndUser: (db: unknown, cardId: string, userId: number) => Promise<number>;
  permanentlyDeleteDataCardsByUserAndIds: (db: unknown, userId: number, ids: string[]) => Promise<number>;
  listUserRecycleBinDataCards: (db: unknown, userId: number) => Promise<any[]>;
  listUserRecycleBinDataCardIds: (db: unknown, userId: number) => Promise<string[]>;
  restoreDataCardByIdAndUser: (db: unknown, cardId: string, userId: number) => Promise<number>;
  hasDataCardOwnership: (db: unknown, cardId: string, userId: number) => Promise<boolean>;
  getDataCardByIdWithAuthorAndTags: (
    db: unknown,
    input: { cardId: string; publicOnly: boolean },
  ) => Promise<any | null>;
  incrementPublicApprovedDataCardLikeCount: (db: unknown, cardId: string) => Promise<number>;
  incrementPublicApprovedDataCardUsageCount: (db: unknown, cardId: string) => Promise<number>;
  listPublicDataCardsWithFilters: (
    db: unknown,
    input: {
      limit: number;
      offset: number;
      type?: DataCardType;
      search?: string;
      sortBy?: DataCardSortBy;
      tagIds?: string[];
      tagMatch?: 'any' | 'all';
      author?: string;
      minLikes?: number;
      maxLikes?: number;
      minUsage?: number;
      maxUsage?: number;
      minFavorites?: number;
      maxFavorites?: number;
      recommendedOnly?: boolean;
      nativeOnly?: boolean;
      nativeAllowedOnly?: boolean;
    },
  ) => Promise<any[]>;
  getRandomPublicDataCardWithFilters: (
    db: unknown,
    input: {
      type: DataCardType;
      excludeIds?: string[];
      minLikeCount?: number | null;
      maxLikeCount?: number | null;
      minUsageCount?: number | null;
      maxUsageCount?: number | null;
      minFavoriteCount?: number | null;
      maxFavoriteCount?: number | null;
    },
  ) => Promise<any | null>;
  getDataCardStatsRowsByIds: (db: unknown, ids: string[]) => Promise<Array<{ id: string; is_public: number; usage_count: number; like_count: number; favorite_count: number }>>;
  listUserTopDataCardsByEngagement: (
    db: unknown,
    userId: number,
    type: 'character' | 'scenario',
    limit: number,
  ) => Promise<UserTopDataCardRow[]>;
  listUserProfileCardStatsRows: (
    db: unknown,
    userId: number,
  ) => Promise<Array<{ type: DataCardType; data: string; is_public: number; like_count: number; favorite_count: number; usage_count: number }>>;
};

const readDataCardsRepoBundle = async (): Promise<DataCardsRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/data-cards-core'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      countPublicDataCardsByNameType: repo.countPublicDataCardsByNameType as DataCardsRepoBundle['countPublicDataCardsByNameType'],
      insertDataCard: repo.insertDataCard as DataCardsRepoBundle['insertDataCard'],
      listUserDataCards: repo.listUserDataCards as DataCardsRepoBundle['listUserDataCards'],
      updateDataCardByIdAndUser: repo.updateDataCardByIdAndUser as DataCardsRepoBundle['updateDataCardByIdAndUser'],
      updateDataCardContentByIdAndUserWithChanges: repo.updateDataCardContentByIdAndUserWithChanges as DataCardsRepoBundle['updateDataCardContentByIdAndUserWithChanges'],
      upsertDataCardUpdateByDataCardId: repo.upsertDataCardUpdateByDataCardId as DataCardsRepoBundle['upsertDataCardUpdateByDataCardId'],
      countUserUsedDataCardSlots: repo.countUserUsedDataCardSlots as DataCardsRepoBundle['countUserUsedDataCardSlots'],
      getDataCardUpdateByDataCardId: repo.getDataCardUpdateByDataCardId as DataCardsRepoBundle['getDataCardUpdateByDataCardId'],
      deleteDataCardUpdateByDataCardId: repo.deleteDataCardUpdateByDataCardId as DataCardsRepoBundle['deleteDataCardUpdateByDataCardId'],
      softDeleteDataCardByIdAndUser: repo.softDeleteDataCardByIdAndUser as DataCardsRepoBundle['softDeleteDataCardByIdAndUser'],
      permanentlyDeleteDataCardsByUserAndIds: repo.permanentlyDeleteDataCardsByUserAndIds as DataCardsRepoBundle['permanentlyDeleteDataCardsByUserAndIds'],
      listUserRecycleBinDataCards: repo.listUserRecycleBinDataCards as DataCardsRepoBundle['listUserRecycleBinDataCards'],
      listUserRecycleBinDataCardIds: repo.listUserRecycleBinDataCardIds as DataCardsRepoBundle['listUserRecycleBinDataCardIds'],
      restoreDataCardByIdAndUser: repo.restoreDataCardByIdAndUser as DataCardsRepoBundle['restoreDataCardByIdAndUser'],
      hasDataCardOwnership: repo.hasDataCardOwnership as DataCardsRepoBundle['hasDataCardOwnership'],
      getDataCardByIdWithAuthorAndTags: repo.getDataCardByIdWithAuthorAndTags as DataCardsRepoBundle['getDataCardByIdWithAuthorAndTags'],
      incrementPublicApprovedDataCardLikeCount: repo.incrementPublicApprovedDataCardLikeCount as DataCardsRepoBundle['incrementPublicApprovedDataCardLikeCount'],
      incrementPublicApprovedDataCardUsageCount: repo.incrementPublicApprovedDataCardUsageCount as DataCardsRepoBundle['incrementPublicApprovedDataCardUsageCount'],
      listPublicDataCardsWithFilters: repo.listPublicDataCardsWithFilters as DataCardsRepoBundle['listPublicDataCardsWithFilters'],
      getRandomPublicDataCardWithFilters: repo.getRandomPublicDataCardWithFilters as DataCardsRepoBundle['getRandomPublicDataCardWithFilters'],
      getDataCardStatsRowsByIds: repo.getDataCardStatsRowsByIds as DataCardsRepoBundle['getDataCardStatsRowsByIds'],
      listUserTopDataCardsByEngagement: repo.listUserTopDataCardsByEngagement as DataCardsRepoBundle['listUserTopDataCardsByEngagement'],
      listUserProfileCardStatsRows: repo.listUserProfileCardStatsRows as DataCardsRepoBundle['listUserProfileCardStatsRows'],
    };
  } catch {
    return null;
  }
};

const normalizeIsPublicValue = (isPublic: boolean | number): number =>
  typeof isPublic === 'number' ? Math.floor(isPublic) : isPublic ? 1 : 0;

const withTagIds = (rows: any[]): any[] => {
  return rows.map((row) => {
    const raw = typeof row?.tag_ids === 'string' ? row.tag_ids : '';
    const tagIds = raw
      .split(',')
      .map((id: string) => id.trim())
      .filter(Boolean);
    return { ...row, tagIds };
  });
};

// 检查公开数据卡是否存在同名
export async function checkPublicCardNameExists(
  name: string,
  type: DataCardType,
): Promise<boolean> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return false;
    const count = await bundle.countPublicDataCardsByNameType(bundle.db, name, type);
    return count > 0;
  } catch (error) {
    console.error('检查同名数据卡失败:', error);
    return false;
  }
}

// 创建数据卡（增强版，带作者信息）
export async function createDataCardWithAuthor(
  userId: number,
  username: string,
  type: DataCardType,
  name: string,
  description: string,
  data: string,
  isPublic: boolean | number = false,
  reviewStatus: 'pending' | 'approved',
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return { success: false, error: '创建失败' };

    const dataWithAuthor = JSON.stringify({
      ...JSON.parse(data),
      _author: username,
      _authorId: userId,
    });

    const id = generateUUID();
    const normalizedPublic = normalizeIsPublicValue(isPublic);

    const ok = await bundle.insertDataCard(bundle.db, {
      id,
      userId,
      type,
      name,
      description,
      data: dataWithAuthor,
      isPublic: normalizedPublic,
      reviewStatus,
    });

    if (ok) {
      return { success: true, id };
    }
    return { success: false, error: '创建失败' };
  } catch (error) {
    console.error('创建数据卡失败:', error);
    return { success: false, error: '创建数据卡失败' };
  }
}

// 创建数据卡（基础版，向后兼容）
export async function createDataCard(
  userId: number,
  type: DataCardType,
  name: string,
  description: string,
  data: string,
  isPublic: boolean | number = false,
): Promise<string | null> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return null;

    const id = generateUUID();
    const normalizedPublic = normalizeIsPublicValue(isPublic);

    const ok = await bundle.insertDataCard(bundle.db, {
      id,
      userId,
      type,
      name,
      description,
      data,
      isPublic: normalizedPublic,
    });

    return ok ? id : null;
  } catch (error) {
    console.error('创建数据卡失败:', error);
    return null;
  }
}

// 获取用户的所有数据卡
export async function getUserDataCards(
  userId: number,
  search?: string,
  sortBy?: DataCardSortBy,
): Promise<any[]> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return [];

    const rows = await bundle.listUserDataCards(bundle.db, {
      userId,
      search,
      sortBy,
    });

    return withTagIds(rows);
  } catch (error) {
    console.error('获取数据卡失败:', error);
    return [];
  }
}

// 更新数据卡信息
export async function updateDataCard(
  id: string,
  userId: number,
  name: string,
  description: string,
  isPublic?: boolean | number,
  reviewStatus?: 'pending' | 'approved' | 'rejected',
): Promise<boolean> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return false;

    const changes = await bundle.updateDataCardByIdAndUser(bundle.db, {
      id,
      userId,
      name,
      description,
      isPublic: isPublic === undefined ? undefined : normalizeIsPublicValue(isPublic),
      reviewStatus,
    });

    return changes > 0;
  } catch (error) {
    console.error('更新数据卡失败:', error);
    return false;
  }
}

// 仅更新数据卡 data 字段（兼容路径）
export async function updateDataCardContentByIdAndUser(
  id: string,
  userId: number,
  dataJsonString: string,
): Promise<boolean> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return false;

    const changes = await bundle.updateDataCardContentByIdAndUserWithChanges(
      bundle.db,
      id,
      userId,
      dataJsonString,
    );

    return changes > 0;
  } catch (error) {
    console.error('更新数据卡内容失败:', error);
    return false;
  }
}

// 新增/更新暂存表中的卡片更新记录
export async function upsertDataCardUpdate(
  dataCardId: string,
  userId: number,
  payload: { name?: string; description?: string; data?: string },
): Promise<boolean> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return false;

    return await bundle.upsertDataCardUpdateByDataCardId(bundle.db, {
      id: generateUUID(),
      dataCardId,
      userId,
      payload,
    });
  } catch (error) {
    console.error('写入 data_card_updates 失败:', error);
    return false;
  }
}

// 计算用户已占用的槽位数量（热门卡片不计入）
export async function getUserUsedSlots(userId: number): Promise<number> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return 0;
    return await bundle.countUserUsedDataCardSlots(bundle.db, userId);
  } catch (error) {
    console.error('获取已用槽位失败:', error);
    return 0;
  }
}

// 读取待审核更新
export async function getDataCardUpdate(dataCardId: string): Promise<any | null> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return null;
    return await bundle.getDataCardUpdateByDataCardId(bundle.db, dataCardId);
  } catch (error) {
    console.error('获取 data_card_updates 失败:', error);
    return null;
  }
}

// 删除待审核更新
export async function deleteDataCardUpdate(dataCardId: string): Promise<boolean> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return false;
    await bundle.deleteDataCardUpdateByDataCardId(bundle.db, dataCardId);
    return true;
  } catch (error) {
    console.error('删除 data_card_updates 失败:', error);
    return false;
  }
}

// 删除数据卡
export async function deleteDataCard(id: string, userId: number): Promise<boolean> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return false;
    const changes = await bundle.softDeleteDataCardByIdAndUser(bundle.db, id, userId);
    return changes > 0;
  } catch (error) {
    console.error('删除数据卡失败:', error);
    return false;
  }
}

// 永久删除（物理删除）指定的数据卡
export async function permanentlyDeleteDataCards(ids: string[], userId: number): Promise<number> {
  if (!ids.length) {
    return 0;
  }

  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return 0;
    return await bundle.permanentlyDeleteDataCardsByUserAndIds(bundle.db, userId, ids);
  } catch (error) {
    console.error('永久删除数据卡失败:', error);
    return 0;
  }
}

// 获取用户回收站中的数据卡
export async function getUserRecycleBinCards(userId: number): Promise<any[]> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return [];
    return await bundle.listUserRecycleBinDataCards(bundle.db, userId);
  } catch (error) {
    console.error('获取回收站数据卡失败:', error);
    return [];
  }
}

// 从回收站恢复数据卡
export async function restoreDataCard(cardId: string, userId: number): Promise<boolean> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return false;
    const changes = await bundle.restoreDataCardByIdAndUser(bundle.db, cardId, userId);
    return changes > 0;
  } catch (error) {
    console.error('恢复数据卡失败:', error);
    return false;
  }
}

// 裁剪回收站，只保留最新的 keep 条目
export async function pruneUserRecycleBin(userId: number, keep: number): Promise<string[]> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return [];

    const ids = await bundle.listUserRecycleBinDataCardIds(bundle.db, userId);
    const safeKeep = Math.max(0, Math.floor(keep));
    if (ids.length <= safeKeep) {
      return [];
    }

    const idsToDelete = ids.slice(safeKeep);
    await bundle.permanentlyDeleteDataCardsByUserAndIds(bundle.db, userId, idsToDelete);
    return idsToDelete;
  } catch (error) {
    console.error('裁剪回收站失败:', error);
    return [];
  }
}

// 验证数据卡所有权
export async function verifyCardOwnership(cardId: string, userId: number): Promise<boolean> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return false;
    return await bundle.hasDataCardOwnership(bundle.db, cardId, userId);
  } catch (error) {
    console.error('验证数据卡所有权失败:', error);
    return false;
  }
}

// 通过ID获取单个数据卡（公开或私有）
export async function getDataCardById(cardId: string, isPublic: boolean = false): Promise<any | null> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return null;

    const row = await bundle.getDataCardByIdWithAuthorAndTags(bundle.db, {
      cardId,
      publicOnly: isPublic,
    });
    if (!row) return null;

    const raw = typeof row?.tag_ids === 'string' ? row.tag_ids : '';
    const tagIds = raw
      .split(',')
      .map((id: string) => id.trim())
      .filter(Boolean);

    return { ...row, tagIds };
  } catch (error) {
    console.error('通过ID获取数据卡失败:', error);
    return null;
  }
}

// 增加数据卡的点赞数
export async function incrementDataCardLike(cardId: string): Promise<boolean> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return false;
    const changes = await bundle.incrementPublicApprovedDataCardLikeCount(bundle.db, cardId);
    return changes > 0;
  } catch (error) {
    console.error('增加数据卡点赞数失败:', error);
    return false;
  }
}

// 增加数据卡的使用次数
export async function incrementDataCardUsage(cardId: string): Promise<boolean> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return false;
    const changes = await bundle.incrementPublicApprovedDataCardUsageCount(bundle.db, cardId);
    return changes > 0;
  } catch (error) {
    console.error('增加数据卡使用次数失败:', error);
    return false;
  }
}

/**
 * 获取公开的数据卡列表，增加了完整的筛选功能。
 */
export async function getPublicDataCards(
  limit: number = 20,
  offset: number = 0,
  type?: DataCardType,
  search?: string,
  sortBy?: DataCardSortBy,
  tagIds?: string[],
  tagMatch?: 'any' | 'all',
  author?: string,
  minLikes?: number,
  maxLikes?: number,
  minUsage?: number,
  maxUsage?: number,
  minFavorites?: number,
  maxFavorites?: number,
  recommendedOnly?: boolean,
  nativeOnly?: boolean,
  nativeAllowedOnly?: boolean,
): Promise<any[]> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return [];

    const rows = await bundle.listPublicDataCardsWithFilters(bundle.db, {
      limit,
      offset,
      type,
      search,
      sortBy,
      tagIds,
      tagMatch,
      author,
      minLikes,
      maxLikes,
      minUsage,
      maxUsage,
      minFavorites,
      maxFavorites,
      recommendedOnly,
      nativeOnly,
      nativeAllowedOnly,
    });

    return withTagIds(rows);
  } catch (error) {
    console.error('获取公开数据卡失败:', error);
    return [];
  }
}

/**
 * [新增] 从数据库中随机获取一个公开的数据卡。
 */
export async function getRandomPublicCard(
  type: DataCardType,
  options?: {
    minLikeCount?: number | null;
    maxLikeCount?: number | null;
    minUsageCount?: number | null;
    maxUsageCount?: number | null;
    minFavoriteCount?: number | null;
    maxFavoriteCount?: number | null;
  },
): Promise<any | null> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return null;

    return await bundle.getRandomPublicDataCardWithFilters(bundle.db, {
      type,
      minLikeCount: options?.minLikeCount,
      maxLikeCount: options?.maxLikeCount,
      minUsageCount: options?.minUsageCount,
      maxUsageCount: options?.maxUsageCount,
      minFavoriteCount: options?.minFavoriteCount,
      maxFavoriteCount: options?.maxFavoriteCount,
    });
  } catch (error) {
    console.error('获取随机公开数据卡失败:', error);
    return null;
  }
}

/**
 * [新增] 从数据库中随机获取一个公开的数据卡，并排除指定的 id 列表。
 */
export async function getRandomPublicCardExcluding(
  type: DataCardType,
  excludeIds: string[],
  options?: {
    minLikeCount?: number | null;
    maxLikeCount?: number | null;
    minUsageCount?: number | null;
    maxUsageCount?: number | null;
    minFavoriteCount?: number | null;
    maxFavoriteCount?: number | null;
  },
): Promise<any | null> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return null;

    return await bundle.getRandomPublicDataCardWithFilters(bundle.db, {
      type,
      excludeIds,
      minLikeCount: options?.minLikeCount,
      maxLikeCount: options?.maxLikeCount,
      minUsageCount: options?.minUsageCount,
      maxUsageCount: options?.maxUsageCount,
      minFavoriteCount: options?.minFavoriteCount,
      maxFavoriteCount: options?.maxFavoriteCount,
    });
  } catch (error) {
    console.error('获取随机公开数据卡（排除列表）失败:', error);
    return null;
  }
}

export async function getDataCardStatsByIds(ids: string[]): Promise<Array<{ id: string; is_public: number; usage_count: number; like_count: number; favorite_count: number }>> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return [];
    return await bundle.getDataCardStatsRowsByIds(bundle.db, ids);
  } catch (error) {
    console.error('批量读取数据卡统计失败:', error);
    return [];
  }
}

export type UserTopDataCardRow = {
  id: string;
  type: DataCardType;
  name: string;
  description: string | null;
  is_public: number;
  review_status: string | null;
  usage_count: number;
  like_count: number;
  favorite_count: number;
  created_at: string | null;
  updated_at: string | null;
};

export async function getUserTopDataCardsByEngagement(
  userId: number,
  type: 'character' | 'scenario',
  limit: number,
): Promise<UserTopDataCardRow[]> {
  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return [];
    return await bundle.listUserTopDataCardsByEngagement(bundle.db, userId, type, limit);
  } catch (error) {
    console.error('读取用户热门数据卡失败:', error);
    return [];
  }
}

export type UserProfileCardDataStats = {
  total: number;
  characters: number;
  scenarios: number;
  history: number;
  publicCards: number;
  publicFavoriteTotal: number;
  publicUsageTotal: number;
  magicalGirl: number;
  canshou: number;
  general: number;
  unknownCharacter: number;
  likeTotal: number;
  favoriteTotal: number;
  usageTotal: number;
};

export async function getUserProfileCardDataStats(userId: number): Promise<UserProfileCardDataStats> {
  const out: UserProfileCardDataStats = {
    total: 0,
    characters: 0,
    scenarios: 0,
    history: 0,
    publicCards: 0,
    publicFavoriteTotal: 0,
    publicUsageTotal: 0,
    magicalGirl: 0,
    canshou: 0,
    general: 0,
    unknownCharacter: 0,
    likeTotal: 0,
    favoriteTotal: 0,
    usageTotal: 0,
  };

  try {
    const bundle = await readDataCardsRepoBundle();
    if (!bundle) return out;

    const rows = await bundle.listUserProfileCardStatsRows(bundle.db, userId);
    out.total = rows.length;

    for (const row of rows) {
      const isPublic = Boolean(row.is_public);
      if (isPublic) out.publicCards += 1;

      const likes = typeof row.like_count === 'number' ? row.like_count : Number(row.like_count || 0);
      const favorites = typeof row.favorite_count === 'number' ? row.favorite_count : Number(row.favorite_count || 0);
      const usage = typeof row.usage_count === 'number' ? row.usage_count : Number(row.usage_count || 0);
      out.likeTotal += Number.isFinite(likes) ? likes : 0;
      out.favoriteTotal += Number.isFinite(favorites) ? favorites : 0;
      out.usageTotal += Number.isFinite(usage) ? usage : 0;
      if (isPublic) {
        out.publicFavoriteTotal += Number.isFinite(favorites) ? favorites : 0;
        out.publicUsageTotal += Number.isFinite(usage) ? usage : 0;
      }

      if (row.type === 'character') {
        out.characters += 1;
        try {
          const parsed = JSON.parse(row.data);
          const kind = inferCharacterKind(parsed);
          if (kind === 'magical-girl') out.magicalGirl += 1;
          else if (kind === 'canshou') out.canshou += 1;
          else if (kind === 'general') out.general += 1;
          else out.unknownCharacter += 1;
        } catch {
          out.unknownCharacter += 1;
        }
      } else if (row.type === 'scenario') {
        out.scenarios += 1;
      } else if (row.type === 'history') {
        out.history += 1;
      }
    }

    return out;
  } catch (error) {
    console.error('统计用户资料卡数据失败:', error);
    return out;
  }
}

// 检查数据卡是否被封禁
export function isDataCardBanned(card: any): boolean {
  return card && card.is_public === -1;
}

// 获取数据卡状态描述
export function getDataCardStatus(card: any): { status: 'public' | 'private' | 'banned'; label: string; color: string } {
  if (!card) {
    return { status: 'private', label: '私有', color: 'gray' };
  }

  if (card.is_public === -1) {
    return { status: 'banned', label: '封禁', color: 'red' };
  } else if (card.is_public === 1) {
    return { status: 'public', label: '公开', color: 'green' };
  } else {
    return { status: 'private', label: '私有', color: 'gray' };
  }
}
