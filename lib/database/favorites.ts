import { queryFromD1 } from './core';

interface FavoriteOperationResult {
  success: boolean;
  alreadyExists?: boolean;
  notFound?: boolean;
  error?: string;
}

/**
 * 添加收藏记录并维护数据卡的收藏计数。
 * 只允许收藏公开且审核通过的卡片。
 */
export async function addFavorite(userId: number, cardId: string): Promise<FavoriteOperationResult> {
  try {
    const insertResult = await queryFromD1(
      `INSERT OR IGNORE INTO favorites (user_id, data_card_id, created_at)
       SELECT ?, ?, CURRENT_TIMESTAMP
       FROM data_cards
       WHERE id = ?
         AND is_public = 1
         AND review_status = 'approved'
         AND deleted_at IS NULL`,
      [userId, cardId, cardId]
    ) as any;

    if (!(insertResult?.success)) {
      return { success: false, error: '收藏失败' };
    }

    const changes = insertResult.result?.[0]?.meta?.changes ?? 0;

    if (changes === 0) {
      // 需要区分是重复收藏还是卡片无效
      const existingFavorite = await queryFromD1(
        'SELECT 1 FROM favorites WHERE user_id = ? AND data_card_id = ? LIMIT 1',
        [userId, cardId]
      ) as any;

      const favoriteExists = !!existingFavorite?.result?.[0]?.results?.length;
      if (favoriteExists) {
        return { success: true, alreadyExists: true };
      }

      return { success: false, notFound: true };
    }

    const updateResult = await queryFromD1(
      'UPDATE data_cards SET favorite_count = favorite_count + 1 WHERE id = ?',
      [cardId]
    ) as any;

    if (!(updateResult?.success)) {
      return { success: false, error: '更新收藏计数失败' };
    }

    return { success: true };
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
    const deleteResult = await queryFromD1(
      'DELETE FROM favorites WHERE user_id = ? AND data_card_id = ?',
      [userId, cardId]
    ) as any;

    if (!(deleteResult?.success)) {
      return { success: false, error: '取消收藏失败' };
    }

    const changes = deleteResult.result?.[0]?.meta?.changes ?? 0;
    if (changes === 0) {
      return { success: false, notFound: true };
    }

    await queryFromD1(
      `UPDATE data_cards
       SET favorite_count = CASE WHEN favorite_count > 0 THEN favorite_count - 1 ELSE 0 END
       WHERE id = ?`,
      [cardId]
    );

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
  type?: 'character' | 'scenario' | 'history'
): Promise<any[]> {
  try {
    let sql = `
      SELECT dc.*, u.username, f.created_at AS favorited_at,
             (
               SELECT group_concat(DISTINCT dct.tag_id)
               FROM data_card_tags dct
               WHERE dct.data_card_id = dc.id
             ) AS tag_ids
      FROM favorites f
      JOIN data_cards dc ON f.data_card_id = dc.id
      JOIN users u ON dc.user_id = u.id
      WHERE f.user_id = ?
        AND dc.is_public = 1
        AND dc.review_status = 'approved'
        AND dc.deleted_at IS NULL
    `;
    const params: any[] = [userId];

    if (type) {
      sql += ' AND dc.type = ?';
      params.push(type);
    }

    sql += ' ORDER BY f.created_at DESC';

    const result = await queryFromD1(sql, params) as any;

    if (result?.success && result.result?.[0]?.results) {
      const rows = result.result[0].results as any[];
      return rows.map((row) => {
        const raw = typeof row?.tag_ids === 'string' ? row.tag_ids : '';
        const tagIds = raw
          .split(',')
          .map((id: string) => id.trim())
          .filter(Boolean);
        return { ...row, tagIds };
      });
    }

    return [];
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
  type?: 'character' | 'scenario' | 'history'
): Promise<string[]> {
  try {
    let sql = 'SELECT f.data_card_id FROM favorites f';
    const params: any[] = [userId];

    if (type) {
      sql += ' JOIN data_cards dc ON f.data_card_id = dc.id';
    }

    sql += ' WHERE f.user_id = ?';

    if (type) {
      sql += ' AND dc.type = ? AND dc.deleted_at IS NULL';
      params.push(type);
    }

    const result = await queryFromD1(sql, params) as any;

    if (result?.success && result.result?.[0]?.results) {
      return result.result[0].results.map((row: { data_card_id: string }) => row.data_card_id);
    }

    return [];
  } catch (error) {
    console.error('获取收藏 ID 失败:', error);
    return [];
  }
}
