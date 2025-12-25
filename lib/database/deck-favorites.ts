import { queryFromD1 } from './core';

interface FavoriteOperationResult {
  success: boolean;
  alreadyExists?: boolean;
  notFound?: boolean;
  error?: string;
}

/**
 * 收藏公开卡组并维护收藏计数。
 */
export async function addDeckFavorite(userId: number, deckId: string): Promise<FavoriteOperationResult> {
  try {
    const insertResult = await queryFromD1(
      `INSERT OR IGNORE INTO deck_favorites (user_id, deck_id, created_at)
       SELECT ?, ?, CURRENT_TIMESTAMP
       FROM decks
       WHERE id = ?
         AND is_public = 1`,
      [userId, deckId, deckId]
    ) as any;

    if (!(insertResult?.success)) {
      return { success: false, error: '收藏失败' };
    }

    const changes = insertResult.result?.[0]?.meta?.changes ?? 0;
    if (changes === 0) {
      const existing = await queryFromD1(
        'SELECT 1 FROM deck_favorites WHERE user_id = ? AND deck_id = ? LIMIT 1',
        [userId, deckId]
      ) as any;

      const alreadyExists = !!existing?.result?.[0]?.results?.length;
      if (alreadyExists) return { success: true, alreadyExists: true };

      return { success: false, notFound: true };
    }

    const update = await queryFromD1(
      'UPDATE decks SET favorite_count = favorite_count + 1 WHERE id = ?',
      [deckId]
    ) as any;

    if (!(update?.success)) {
      return { success: false, error: '更新收藏计数失败' };
    }

    return { success: true };
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
    const deleteResult = await queryFromD1(
      'DELETE FROM deck_favorites WHERE user_id = ? AND deck_id = ?',
      [userId, deckId]
    ) as any;

    if (!(deleteResult?.success)) {
      return { success: false, error: '取消收藏失败' };
    }

    const changes = deleteResult.result?.[0]?.meta?.changes ?? 0;
    if (changes === 0) {
      return { success: false, notFound: true };
    }

    await queryFromD1(
      `UPDATE decks
       SET favorite_count = CASE WHEN favorite_count > 0 THEN favorite_count - 1 ELSE 0 END
       WHERE id = ?`,
      [deckId]
    );

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
    const result = await queryFromD1(
      `SELECT d.*,
              u.username,
              f.created_at AS favorited_at,
              (SELECT COUNT(*) FROM deck_cards dc WHERE dc.deck_id = d.id) AS card_count
       FROM deck_favorites f
       JOIN decks d ON f.deck_id = d.id
       JOIN users u ON d.user_id = u.id
       WHERE f.user_id = ?
         AND d.is_public = 1
       ORDER BY f.created_at DESC`,
      [userId]
    ) as any;

    return result?.success && result.result?.[0]?.results ? result.result[0].results : [];
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
    const result = await queryFromD1(
      'SELECT deck_id FROM deck_favorites WHERE user_id = ?',
      [userId]
    ) as any;

    if (result?.success && result.result?.[0]?.results) {
      return result.result[0].results.map((row: { deck_id: string }) => row.deck_id);
    }
    return [];
  } catch (error) {
    console.error('获取收藏卡组ID失败:', error);
    return [];
  }
}

