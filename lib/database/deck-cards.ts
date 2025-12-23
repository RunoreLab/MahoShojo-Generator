import { queryFromD1 } from './core';

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
    const result = await queryFromD1(
      `SELECT rel.deck_id,
              rel.data_card_id,
              rel.card_name_snapshot,
              rel.card_type_snapshot,
              rel.sort_order,
              rel.created_at AS rel_created_at,

              dc.id AS card_id,
              dc.user_id AS card_user_id,
              dc.type AS card_type,
              dc.name AS card_name,
              dc.description AS card_description,
              dc.data AS card_data,
              dc.is_public AS card_is_public,
              dc.usage_count AS usage_count,
              dc.like_count AS like_count,
              dc.favorite_count AS favorite_count,
              dc.review_status AS card_review_status,
              dc.created_at AS card_created_at,
              dc.updated_at AS card_updated_at,
              dc.deleted_at AS card_deleted_at,
              u.username AS username
       FROM deck_cards rel
       LEFT JOIN data_cards dc ON rel.data_card_id = dc.id
       LEFT JOIN users u ON dc.user_id = u.id
       WHERE rel.deck_id = ?
       ORDER BY rel.sort_order ASC, rel.created_at ASC`,
      [deckId]
    ) as any;

    const rows = result?.success && result.result?.[0]?.results ? result.result[0].results : [];

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
    const safeIds = [...new Set((cardIds || []).filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))].slice(0, 100);
    if (safeIds.length === 0) return { success: true, added: 0, skipped: 0 };

    // 获取当前最大排序
    const maxResult = await queryFromD1(
      'SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM deck_cards WHERE deck_id = ?',
      [deckId]
    ) as any;
    const baseSort = Number(maxResult?.result?.[0]?.results?.[0]?.max_sort ?? 0) || 0;

    // 批量读取可加入的卡（必须是本人私有或公开+审核通过，且不在回收站）
    const placeholders = safeIds.map(() => '?').join(', ');
    const cardsResult = await queryFromD1(
      `SELECT id, user_id, type, name, is_public, review_status, deleted_at
       FROM data_cards
       WHERE id IN (${placeholders})`,
      safeIds
    ) as any;
    const cards = cardsResult?.success && cardsResult.result?.[0]?.results ? cardsResult.result[0].results : [];
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

      const insertResult = await queryFromD1(
        `INSERT OR IGNORE INTO deck_cards (deck_id, data_card_id, card_name_snapshot, card_type_snapshot, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [deckId, cardId, card.name || '', card.type || '', baseSort + i + 1]
      ) as any;

      if (!(insertResult?.success)) {
        return { success: false, added, skipped, error: '添加卡片失败' };
      }

      const changes = insertResult.result?.[0]?.meta?.changes ?? 0;
      if (changes > 0) {
        added += 1;
      } else {
        skipped += 1;
      }
    }

    await queryFromD1('UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [deckId]);

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
    const safeIds = [...new Set((cardIds || []).filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))].slice(0, 200);
    if (safeIds.length === 0) return { success: true, removed: 0 };

    const placeholders = safeIds.map(() => '?').join(', ');
    const params = [deckId, ...safeIds, userId];
    const result = await queryFromD1(
      `DELETE FROM deck_cards
       WHERE deck_id = ?
         AND data_card_id IN (${placeholders})
         AND EXISTS (SELECT 1 FROM decks d WHERE d.id = deck_cards.deck_id AND d.user_id = ?)`,
      params
    ) as any;

    const changes = result?.result?.[0]?.meta?.changes ?? 0;
    if (result?.success) {
      await queryFromD1('UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [deckId]);
      return { success: true, removed: Number(changes) || 0 };
    }

    return { success: false, removed: 0, error: '移除失败' };
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
    // 仅允许卡组所有者执行清理
    const ownerCheck = await queryFromD1('SELECT 1 FROM decks WHERE id = ? AND user_id = ? LIMIT 1', [deckId, ownerUserId]) as any;
    const isOwner = !!ownerCheck?.result?.[0]?.results?.length;
    if (!isOwner) {
      return { success: false, removed: 0, error: '卡组不存在或无权访问' };
    }

    const result = await queryFromD1(
      `DELETE FROM deck_cards
       WHERE deck_id = ?
         AND NOT EXISTS (
           SELECT 1
           FROM data_cards dc
           WHERE dc.id = deck_cards.data_card_id
             AND dc.deleted_at IS NULL
             AND (dc.user_id = ? OR (dc.is_public = 1 AND dc.review_status = 'approved'))
         )`,
      [deckId, ownerUserId]
    ) as any;

    const removed = Number(result?.result?.[0]?.meta?.changes ?? 0) || 0;
    if (result?.success) {
      await queryFromD1('UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [deckId]);
      return { success: true, removed };
    }

    return { success: false, removed: 0, error: '清理失败' };
  } catch (error) {
    console.error('清理不可用卡片失败:', error);
    return { success: false, removed: 0, error: '服务器内部错误' };
  }
}

