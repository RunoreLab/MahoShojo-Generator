import { generateUUID } from './core';

export type DeckSortBy = 'likes' | 'favorites' | 'created_at';

export function isDeckBanned(deck: any): boolean {
  return deck && deck.is_public === -1;
}

export function getDeckStatus(deck: any): { status: 'public' | 'private' | 'banned'; label: string; color: string } {
  if (!deck) {
    return { status: 'private', label: '私有', color: 'gray' };
  }

  if (deck.is_public === -1) {
    return { status: 'banned', label: '封禁', color: 'red' };
  }
  if (deck.is_public === 1) {
    return { status: 'public', label: '公开', color: 'green' };
  }
  return { status: 'private', label: '私有', color: 'gray' };
}

type DecksRepoBundle = {
  db: unknown;
  countDecksByUserId: (db: unknown, userId: number) => Promise<number>;
  insertDeck: (
    db: unknown,
    payload: { id: string; userId: number; name: string; description: string; isPublic: number },
  ) => Promise<boolean>;
  listDecksByUserIdWithCardCount: (db: unknown, userId: number) => Promise<any[]>;
  listPublicDecksWithAuthor: (
    db: unknown,
    params: { limit: number; offset: number; search?: string; sortBy?: DeckSortBy },
  ) => Promise<any[]>;
  getDeckByIdWithAuthor: (db: unknown, deckId: string) => Promise<any | null>;
  updateDeckByIdOwnedByUser: (
    db: unknown,
    deckId: string,
    userId: number,
    payload: { name?: string; description?: string; isPublic?: number },
  ) => Promise<number>;
  deleteDeckByIdOwnedByUser: (db: unknown, deckId: string, userId: number) => Promise<number>;
  incrementPublicDeckLikeCountById: (db: unknown, deckId: string) => Promise<number>;
};

const readDecksRepoBundle = async (): Promise<DecksRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/decks'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      countDecksByUserId: repo.countDecksByUserId as DecksRepoBundle['countDecksByUserId'],
      insertDeck: repo.insertDeck as DecksRepoBundle['insertDeck'],
      listDecksByUserIdWithCardCount: repo.listDecksByUserIdWithCardCount as DecksRepoBundle['listDecksByUserIdWithCardCount'],
      listPublicDecksWithAuthor: repo.listPublicDecksWithAuthor as DecksRepoBundle['listPublicDecksWithAuthor'],
      getDeckByIdWithAuthor: repo.getDeckByIdWithAuthor as DecksRepoBundle['getDeckByIdWithAuthor'],
      updateDeckByIdOwnedByUser: repo.updateDeckByIdOwnedByUser as DecksRepoBundle['updateDeckByIdOwnedByUser'],
      deleteDeckByIdOwnedByUser: repo.deleteDeckByIdOwnedByUser as DecksRepoBundle['deleteDeckByIdOwnedByUser'],
      incrementPublicDeckLikeCountById: repo.incrementPublicDeckLikeCountById as DecksRepoBundle['incrementPublicDeckLikeCountById'],
    };
  } catch {
    return null;
  }
};

export async function countUserDecks(userId: number): Promise<number> {
  try {
    const bundle = await readDecksRepoBundle();
    if (!bundle) return 0;
    return await bundle.countDecksByUserId(bundle.db, userId);
  } catch (error) {
    console.error('统计卡组数量失败:', error);
    return 0;
  }
}

export async function createDeck(
  userId: number,
  name: string,
  description: string,
  isPublic: boolean | number = 0
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const bundle = await readDecksRepoBundle();
    if (!bundle) return { success: false, error: '创建卡组失败' };
    const id = generateUUID();
    const publicValue = typeof isPublic === 'number' ? isPublic : (isPublic ? 1 : 0);

    const ok = await bundle.insertDeck(bundle.db, {
      id,
      userId,
      name,
      description,
      isPublic: publicValue,
    });
    if (ok) {
      return { success: true, id };
    }

    return { success: false, error: '创建卡组失败' };
  } catch (error) {
    console.error('创建卡组失败:', error);
    return { success: false, error: '创建卡组失败' };
  }
}

export async function getUserDecks(userId: number): Promise<any[]> {
  try {
    const bundle = await readDecksRepoBundle();
    if (!bundle) return [];
    return await bundle.listDecksByUserIdWithCardCount(bundle.db, userId);
  } catch (error) {
    console.error('获取用户卡组失败:', error);
    return [];
  }
}

export async function getPublicDecks(
  limit: number,
  offset: number,
  search?: string,
  sortBy?: DeckSortBy
): Promise<any[]> {
  try {
    const bundle = await readDecksRepoBundle();
    if (!bundle) return [];
    return await bundle.listPublicDecksWithAuthor(bundle.db, {
      limit,
      offset,
      search,
      sortBy,
    });
  } catch (error) {
    console.error('获取公开卡组失败:', error);
    return [];
  }
}

export async function getDeckById(deckId: string): Promise<any | null> {
  try {
    const bundle = await readDecksRepoBundle();
    if (!bundle) return null;
    return await bundle.getDeckByIdWithAuthor(bundle.db, deckId);
  } catch (error) {
    console.error('获取卡组失败:', error);
    return null;
  }
}

export async function updateDeck(
  deckId: string,
  userId: number,
  payload: { name?: string; description?: string; isPublic?: boolean | number }
): Promise<{ success: boolean; error?: string }> {
  try {
    const bundle = await readDecksRepoBundle();
    if (!bundle) return { success: false, error: '更新卡组失败' };
    const fields: string[] = [];
    const repoPayload: { name?: string; description?: string; isPublic?: number } = {};

    if (payload.name !== undefined) {
      fields.push('name = ?');
      repoPayload.name = payload.name;
    }

    if (payload.description !== undefined) {
      fields.push('description = ?');
      repoPayload.description = payload.description;
    }

    if (payload.isPublic !== undefined) {
      fields.push('is_public = ?');
      repoPayload.isPublic = typeof payload.isPublic === 'number' ? payload.isPublic : (payload.isPublic ? 1 : 0);
    }

    if (fields.length === 0) {
      return { success: true };
    }

    const changed = await bundle.updateDeckByIdOwnedByUser(bundle.db, deckId, userId, repoPayload);
    if (changed > 0) {
      return { success: true };
    }

    return { success: false, error: '卡组不存在或无权访问' };
  } catch (error) {
    console.error('更新卡组失败:', error);
    return { success: false, error: '更新卡组失败' };
  }
}

export async function deleteDeck(deckId: string, userId: number): Promise<boolean> {
  try {
    const bundle = await readDecksRepoBundle();
    if (!bundle) return false;
    const changed = await bundle.deleteDeckByIdOwnedByUser(bundle.db, deckId, userId);
    return changed > 0;
  } catch (error) {
    console.error('删除卡组失败:', error);
    return false;
  }
}

export async function incrementDeckLike(deckId: string): Promise<boolean> {
  try {
    const bundle = await readDecksRepoBundle();
    if (!bundle) return false;
    const changed = await bundle.incrementPublicDeckLikeCountById(bundle.db, deckId);
    return changed > 0;
  } catch (error) {
    console.error('点赞卡组失败:', error);
    return false;
  }
}

