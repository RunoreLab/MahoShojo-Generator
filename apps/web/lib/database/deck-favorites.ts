interface FavoriteOperationResult {
  success: boolean;
  alreadyExists?: boolean;
  notFound?: boolean;
  error?: string;
}

type DeckFavoritesRepoBundle = {
  db: unknown;
  isDeckFavoritable: (db: unknown, deckId: string) => Promise<boolean>;
  hasDeckFavoriteRecord: (db: unknown, userId: number, deckId: string) => Promise<boolean>;
  insertDeckFavoriteIgnore: (db: unknown, userId: number, deckId: string) => Promise<boolean>;
  incrementDeckFavoriteCount: (db: unknown, deckId: string) => Promise<void>;
  deleteDeckFavoriteRecord: (db: unknown, userId: number, deckId: string) => Promise<number>;
  decrementDeckFavoriteCount: (db: unknown, deckId: string) => Promise<void>;
  listUserDeckFavoritesWithDeck: (db: unknown, userId: number) => Promise<any[]>;
  listUserDeckFavoriteDeckIds: (db: unknown, userId: number) => Promise<string[]>;
};

const readDeckFavoritesRepoBundle = async (): Promise<DeckFavoritesRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/deck-favorites'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      isDeckFavoritable: repo.isDeckFavoritable as DeckFavoritesRepoBundle['isDeckFavoritable'],
      hasDeckFavoriteRecord: repo.hasDeckFavoriteRecord as DeckFavoritesRepoBundle['hasDeckFavoriteRecord'],
      insertDeckFavoriteIgnore: repo.insertDeckFavoriteIgnore as DeckFavoritesRepoBundle['insertDeckFavoriteIgnore'],
      incrementDeckFavoriteCount: repo.incrementDeckFavoriteCount as DeckFavoritesRepoBundle['incrementDeckFavoriteCount'],
      deleteDeckFavoriteRecord: repo.deleteDeckFavoriteRecord as DeckFavoritesRepoBundle['deleteDeckFavoriteRecord'],
      decrementDeckFavoriteCount: repo.decrementDeckFavoriteCount as DeckFavoritesRepoBundle['decrementDeckFavoriteCount'],
      listUserDeckFavoritesWithDeck: repo.listUserDeckFavoritesWithDeck as DeckFavoritesRepoBundle['listUserDeckFavoritesWithDeck'],
      listUserDeckFavoriteDeckIds: repo.listUserDeckFavoriteDeckIds as DeckFavoritesRepoBundle['listUserDeckFavoriteDeckIds'],
    };
  } catch {
    return null;
  }
};

/**
 * 收藏公开卡组并维护收藏计数。
 */
export async function addDeckFavorite(userId: number, deckId: string): Promise<FavoriteOperationResult> {
  try {
    const bundle = await readDeckFavoritesRepoBundle();
    if (!bundle) return { success: false, error: '收藏失败' };

    const favoritable = await bundle.isDeckFavoritable(bundle.db, deckId);
    if (favoritable) {
      const inserted = await bundle.insertDeckFavoriteIgnore(bundle.db, userId, deckId);
      if (inserted) {
        await bundle.incrementDeckFavoriteCount(bundle.db, deckId);
        return { success: true };
      }
    }

    const alreadyExists = await bundle.hasDeckFavoriteRecord(bundle.db, userId, deckId);
    if (alreadyExists) return { success: true, alreadyExists: true };

    return { success: false, notFound: true };
  } catch (error) {
    console.error('收藏卡组失败:', error);
    return { success: false, error: '服务器内部错误' };
  }
}

/**
 * 取消收藏公开卡组并回收收藏计数。
 */
export async function removeDeckFavorite(userId: number, deckId: string): Promise<FavoriteOperationResult> {
  try {
    const bundle = await readDeckFavoritesRepoBundle();
    if (!bundle) return { success: false, error: '取消收藏失败' };

    const changes = await bundle.deleteDeckFavoriteRecord(bundle.db, userId, deckId);
    if (changes <= 0) {
      return { success: false, notFound: true };
    }

    await bundle.decrementDeckFavoriteCount(bundle.db, deckId);

    return { success: true };
  } catch (error) {
    console.error('取消收藏卡组失败:', error);
    return { success: false, error: '服务器内部错误' };
  }
}

/**
 * 获取用户收藏的卡组完整详情列表。
 */
export async function getUserDeckFavorites(userId: number): Promise<any[]> {
  try {
    const bundle = await readDeckFavoritesRepoBundle();
    if (!bundle) return [];
    return await bundle.listUserDeckFavoritesWithDeck(bundle.db, userId);
  } catch (error) {
    console.error('获取收藏卡组失败:', error);
    return [];
  }
}

/**
 * 获取用户收藏的卡组 ID 集合。
 */
export async function getUserDeckFavoriteIds(userId: number): Promise<string[]> {
  try {
    const bundle = await readDeckFavoritesRepoBundle();
    if (!bundle) return [];
    return await bundle.listUserDeckFavoriteDeckIds(bundle.db, userId);
  } catch (error) {
    console.error('获取收藏卡组ID失败:', error);
    return [];
  }
}

