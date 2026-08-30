type DeckCardsRepoBundle = {
  db: unknown;
  listDeckCardsWithCardContextByDeckId: (db: unknown, deckId: string) => Promise<Array<any>>;
  getDeckCardMaxSortOrder: (db: unknown, deckId: string) => Promise<number>;
  listDataCardsForDeckMutationByIds: (db: unknown, cardIds: string[]) => Promise<Array<any>>;
  insertDeckCardIgnore: (
    db: unknown,
    payload: {
      deckId: string;
      dataCardId: string;
      cardNameSnapshot: string;
      cardTypeSnapshot: string;
      sortOrder: number;
    },
  ) => Promise<boolean>;
  deleteDeckCardsByDeckIdAndCardIds: (db: unknown, deckId: string, cardIds: string[]) => Promise<number>;
  isDeckOwnedByUser: (db: unknown, deckId: string, userId: number) => Promise<boolean>;
  pruneDeckInaccessibleCardsByDeckId: (db: unknown, deckId: string, ownerUserId: number) => Promise<number>;
  touchDeckUpdatedAt: (db: unknown, deckId: string) => Promise<void>;
};

const readDeckCardsRepoBundle = async (): Promise<DeckCardsRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, cardsRepo, decksRepo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/deck-cards'),
      import('@/lib/db/repositories/decks'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      listDeckCardsWithCardContextByDeckId: cardsRepo.listDeckCardsWithCardContextByDeckId as DeckCardsRepoBundle['listDeckCardsWithCardContextByDeckId'],
      getDeckCardMaxSortOrder: cardsRepo.getDeckCardMaxSortOrder as DeckCardsRepoBundle['getDeckCardMaxSortOrder'],
      listDataCardsForDeckMutationByIds: cardsRepo.listDataCardsForDeckMutationByIds as DeckCardsRepoBundle['listDataCardsForDeckMutationByIds'],
      insertDeckCardIgnore: cardsRepo.insertDeckCardIgnore as DeckCardsRepoBundle['insertDeckCardIgnore'],
      deleteDeckCardsByDeckIdAndCardIds: cardsRepo.deleteDeckCardsByDeckIdAndCardIds as DeckCardsRepoBundle['deleteDeckCardsByDeckIdAndCardIds'],
      isDeckOwnedByUser: cardsRepo.isDeckOwnedByUser as DeckCardsRepoBundle['isDeckOwnedByUser'],
      pruneDeckInaccessibleCardsByDeckId: cardsRepo.pruneDeckInaccessibleCardsByDeckId as DeckCardsRepoBundle['pruneDeckInaccessibleCardsByDeckId'],
      touchDeckUpdatedAt: decksRepo.touchDeckUpdatedAt as DeckCardsRepoBundle['touchDeckUpdatedAt'],
    };
  } catch {
    return null;
  }
};

type DeckCardAccessibility = {
  isAccessible: boolean;
  displayName: string;
  displayType: string;
  reason?: 'deleted' | 'private' | 'banned' | 'unknown';
};

const getSnapshotFallbackName = (snapshot: unknown): string => {
  if (typeof snapshot === 'string' && snapshot.trim()) return snapshot.trim();
  return '未知卡片';
};

const getSnapshotFallbackType = (snapshot: unknown): string => {
  if (typeof snapshot === 'string' && snapshot.trim()) return snapshot.trim();
  return 'unknown';
};

const resolveAccessibility = (row: any, viewerUserId?: number): DeckCardAccessibility => {
  const hasCard = Boolean(row?.card_id);
  const deletedAt = row?.card_deleted_at;

  if (!hasCard) {
    return {
      isAccessible: false,
      displayName: getSnapshotFallbackName(row?.card_name_snapshot),
      displayType: getSnapshotFallbackType(row?.card_type_snapshot),
      reason: 'deleted'
    };
  }

  if (deletedAt) {
    return {
      isAccessible: false,
      displayName: getSnapshotFallbackName(row?.card_name_snapshot ?? row?.card_name),
      displayType: getSnapshotFallbackType(row?.card_type_snapshot ?? row?.card_type),
      reason: 'deleted'
    };
  }

  const isOwner = typeof viewerUserId === 'number' && viewerUserId > 0 && row?.card_user_id === viewerUserId;
  const isPublicApproved = row?.card_is_public === 1 && row?.card_review_status === 'approved';

  if (isOwner || isPublicApproved) {
    return {
      isAccessible: true,
      displayName: typeof row?.card_name === 'string' && row.card_name.trim() ? row.card_name.trim() : getSnapshotFallbackName(row?.card_name_snapshot),
      displayType: typeof row?.card_type === 'string' && row.card_type.trim() ? row.card_type.trim() : getSnapshotFallbackType(row?.card_type_snapshot)
    };
  }

  if (row?.card_is_public === -1) {
    return {
      isAccessible: false,
      displayName: getSnapshotFallbackName(row?.card_name_snapshot ?? row?.card_name),
      displayType: getSnapshotFallbackType(row?.card_type_snapshot ?? row?.card_type),
      reason: 'banned'
    };
  }

  return {
    isAccessible: false,
    displayName: getSnapshotFallbackName(row?.card_name_snapshot ?? row?.card_name),
    displayType: getSnapshotFallbackType(row?.card_type_snapshot ?? row?.card_type),
    reason: 'private'
  };
};

export async function getDeckCardsWithAccess(
  deckId: string,
  viewerUserId?: number
): Promise<Array<any>> {
  try {
    const bundle = await readDeckCardsRepoBundle();
    if (!bundle) return [];
    const rows = await bundle.listDeckCardsWithCardContextByDeckId(bundle.db, deckId);

    return rows.map((row: any) => {
      const access = resolveAccessibility(row, viewerUserId);
      if (access.isAccessible) {
        return {
          data_card_id: row.data_card_id,
          sort_order: row.sort_order,
          isAccessible: true,
          displayName: access.displayName,
          displayType: access.displayType,
          card: {
            id: row.card_id,
            user_id: row.card_user_id,
            type: row.card_type,
            name: row.card_name,
            description: row.card_description,
            data: row.card_data,
            is_public: row.card_is_public,
            usage_count: row.usage_count,
            like_count: row.like_count,
            favorite_count: row.favorite_count,
            review_status: row.card_review_status,
            created_at: row.card_created_at,
            updated_at: row.card_updated_at,
            deleted_at: row.card_deleted_at,
            username: row.username
          }
        };
      }

      return {
        data_card_id: row.data_card_id,
        sort_order: row.sort_order,
        isAccessible: false,
        displayName: access.displayName,
        displayType: access.displayType,
        reason: access.reason || 'unknown'
      };
    });
  } catch (error) {
    console.error('获取卡组卡片失败:', error);
    return [];
  }
}

export async function addCardsToDeck(
  deckId: string,
  userId: number,
  cardIds: string[]
): Promise<{ success: boolean; added: number; skipped: number; error?: string }> {
  try {
    const bundle = await readDeckCardsRepoBundle();
    if (!bundle) return { success: false, added: 0, skipped: 0, error: '服务器内部错误' };
    const safeIds = [...new Set((cardIds || []).filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))].slice(0, 100);
    if (safeIds.length === 0) return { success: true, added: 0, skipped: 0 };

    const baseSort = await bundle.getDeckCardMaxSortOrder(bundle.db, deckId);

    const cards = await bundle.listDataCardsForDeckMutationByIds(bundle.db, safeIds);
    const cardMap = new Map<string, any>(cards.map((c: any) => [c.id, c]));

    let added = 0;
    let skipped = 0;

    for (let i = 0; i < safeIds.length; i++) {
      const cardId = safeIds[i];
      const card = cardMap.get(cardId);
      if (!card || card.deleted_at) {
        skipped += 1;
        continue;
      }

      const isOwner = card.user_id === userId;
      const isPublicApproved = card.is_public === 1 && card.review_status === 'approved';
      if (!isOwner && !isPublicApproved) {
        skipped += 1;
        continue;
      }

      const inserted = await bundle.insertDeckCardIgnore(bundle.db, {
        deckId,
        dataCardId: cardId,
        cardNameSnapshot: card.name || '',
        cardTypeSnapshot: card.type || '',
        sortOrder: baseSort + i + 1,
      });

      if (inserted) {
        added += 1;
      } else {
        skipped += 1;
      }
    }

    await bundle.touchDeckUpdatedAt(bundle.db, deckId);

    return { success: true, added, skipped };
  } catch (error) {
    console.error('添加卡组卡片失败:', error);
    return { success: false, added: 0, skipped: 0, error: '服务器内部错误' };
  }
}

export async function removeCardsFromDeck(
  deckId: string,
  userId: number,
  cardIds: string[]
): Promise<{ success: boolean; removed: number; error?: string }> {
  try {
    const bundle = await readDeckCardsRepoBundle();
    if (!bundle) return { success: false, removed: 0, error: '服务器内部错误' };
    const safeIds = [...new Set((cardIds || []).filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))].slice(0, 200);
    if (safeIds.length === 0) return { success: true, removed: 0 };

    const isOwner = await bundle.isDeckOwnedByUser(bundle.db, deckId, userId);
    const removed = isOwner
      ? await bundle.deleteDeckCardsByDeckIdAndCardIds(bundle.db, deckId, safeIds)
      : 0;

    await bundle.touchDeckUpdatedAt(bundle.db, deckId);
    return { success: true, removed };
  } catch (error) {
    console.error('移除卡组卡片失败:', error);
    return { success: false, removed: 0, error: '服务器内部错误' };
  }
}

export async function pruneDeckInaccessibleCards(
  deckId: string,
  ownerUserId: number
): Promise<{ success: boolean; removed: number; error?: string }> {
  try {
    const bundle = await readDeckCardsRepoBundle();
    if (!bundle) return { success: false, removed: 0, error: '服务器内部错误' };

    const isOwner = await bundle.isDeckOwnedByUser(bundle.db, deckId, ownerUserId);
    if (!isOwner) {
      return { success: false, removed: 0, error: '卡组不存在或无权访问' };
    }

    const removed = await bundle.pruneDeckInaccessibleCardsByDeckId(bundle.db, deckId, ownerUserId);
    await bundle.touchDeckUpdatedAt(bundle.db, deckId);
    return { success: true, removed };
  } catch (error) {
    console.error('清理不可用卡片失败:', error);
    return { success: false, removed: 0, error: '服务器内部错误' };
  }
}

