interface FavoriteOperationResult {
  success: boolean;
  alreadyExists?: boolean;
  notFound?: boolean;
  error?: string;
}

type FavoriteCardType = 'character' | 'scenario' | 'history' | 'questionnaire';

type FavoritesRepoBundle = {
  db: unknown;
  isDataCardFavoritable: (db: unknown, cardId: string) => Promise<boolean>;
  hasFavoriteRecord: (db: unknown, userId: number, cardId: string) => Promise<boolean>;
  insertFavoriteIgnore: (db: unknown, userId: number, cardId: string) => Promise<boolean>;
  incrementDataCardFavoriteCount: (db: unknown, cardId: string) => Promise<void>;
  deleteFavoriteRecord: (db: unknown, userId: number, cardId: string) => Promise<number>;
  decrementDataCardFavoriteCount: (db: unknown, cardId: string) => Promise<void>;
  listUserFavoritesWithCards: (db: unknown, userId: number, type?: FavoriteCardType) => Promise<any[]>;
  listUserFavoriteCardIds: (db: unknown, userId: number, type?: FavoriteCardType) => Promise<string[]>;
};

const readFavoritesRepoBundle = async (): Promise<FavoritesRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/favorites'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      isDataCardFavoritable: repo.isDataCardFavoritable as FavoritesRepoBundle['isDataCardFavoritable'],
      hasFavoriteRecord: repo.hasFavoriteRecord as FavoritesRepoBundle['hasFavoriteRecord'],
      insertFavoriteIgnore: repo.insertFavoriteIgnore as FavoritesRepoBundle['insertFavoriteIgnore'],
      incrementDataCardFavoriteCount: repo.incrementDataCardFavoriteCount as FavoritesRepoBundle['incrementDataCardFavoriteCount'],
      deleteFavoriteRecord: repo.deleteFavoriteRecord as FavoritesRepoBundle['deleteFavoriteRecord'],
      decrementDataCardFavoriteCount: repo.decrementDataCardFavoriteCount as FavoritesRepoBundle['decrementDataCardFavoriteCount'],
      listUserFavoritesWithCards: repo.listUserFavoritesWithCards as FavoritesRepoBundle['listUserFavoritesWithCards'],
      listUserFavoriteCardIds: repo.listUserFavoriteCardIds as FavoritesRepoBundle['listUserFavoriteCardIds'],
    };
  } catch {
    return null;
  }
};

/**
 * 添加收藏记录并维护数据卡的收藏计数。
 * 只允许收藏公开且审核通过的卡片。
 */
export async function addFavorite(userId: number, cardId: string): Promise<FavoriteOperationResult> {
  try {
    const bundle = await readFavoritesRepoBundle();
    if (!bundle) return { success: false, error: '收藏失败' };

    const favoritable = await bundle.isDataCardFavoritable(bundle.db, cardId);
    if (favoritable) {
      const inserted = await bundle.insertFavoriteIgnore(bundle.db, userId, cardId);
      if (inserted) {
        await bundle.incrementDataCardFavoriteCount(bundle.db, cardId);
        return { success: true };
      }
    }

    const favoriteExists = await bundle.hasFavoriteRecord(bundle.db, userId, cardId);
    if (favoriteExists) {
      return { success: true, alreadyExists: true };
    }

    return { success: false, notFound: true };
  } catch (error) {
    console.error('添加收藏失败:', error);
    return { success: false, error: '服务器内部错误' };
  }
}

/**
 * 取消收藏并回收收藏计数。
 */
export async function removeFavorite(userId: number, cardId: string): Promise<FavoriteOperationResult> {
  try {
    const bundle = await readFavoritesRepoBundle();
    if (!bundle) return { success: false, error: '取消收藏失败' };

    const changes = await bundle.deleteFavoriteRecord(bundle.db, userId, cardId);
    if (changes <= 0) {
      return { success: false, notFound: true };
    }

    await bundle.decrementDataCardFavoriteCount(bundle.db, cardId);

    return { success: true };
  } catch (error) {
    console.error('取消收藏失败:', error);
    return { success: false, error: '服务器内部错误' };
  }
}

/**
 * 获取用户收藏的卡片完整详情列表。
 */
export async function getUserFavorites(
  userId: number,
  type?: FavoriteCardType
): Promise<any[]> {
  try {
    const bundle = await readFavoritesRepoBundle();
    if (!bundle) return [];
    const rows = await bundle.listUserFavoritesWithCards(bundle.db, userId, type);
    return rows.map((row) => {
      const raw = typeof row?.tag_ids === 'string' ? row.tag_ids : '';
      const tagIds = raw
        .split(',')
        .map((id: string) => id.trim())
        .filter(Boolean);
      return { ...row, tagIds };
    });
  } catch (error) {
    console.error('获取收藏列表失败:', error);
    return [];
  }
}

/**
 * 获取用户收藏的卡片 ID 集合。
 */
export async function getUserFavoriteIds(
  userId: number,
  type?: FavoriteCardType
): Promise<string[]> {
  try {
    const bundle = await readFavoritesRepoBundle();
    if (!bundle) return [];
    return await bundle.listUserFavoriteCardIds(bundle.db, userId, type);
  } catch (error) {
    console.error('获取收藏 ID 失败:', error);
    return [];
  }
}
