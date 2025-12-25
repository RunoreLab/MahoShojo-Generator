import { generateUUID, queryFromD1 } from './core';

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

export async function countUserDecks(userId: number): Promise<number> {
  try {
    const result = await queryFromD1('SELECT COUNT(*) AS count FROM decks WHERE user_id = ?', [userId]) as any;
    return Number(result?.result?.[0]?.results?.[0]?.count ?? 0) || 0;
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
    const id = generateUUID();
    const publicValue = typeof isPublic === 'number' ? isPublic : (isPublic ? 1 : 0);

    const result = await queryFromD1(
      'INSERT INTO decks (id, user_id, name, description, is_public) VALUES (?, ?, ?, ?, ?)',
      [id, userId, name, description, publicValue]
    ) as any;

    if (result?.success) {
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
    const result = await queryFromD1(
      `SELECT d.*,
              (SELECT COUNT(*) FROM deck_cards dc WHERE dc.deck_id = d.id) AS card_count
       FROM decks d
       WHERE d.user_id = ?
       ORDER BY d.updated_at DESC, d.created_at DESC`,
      [userId]
    ) as any;

    return result?.success && result.result?.[0]?.results ? result.result[0].results : [];
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
    let sql = `
      SELECT d.*,
             u.username,
             (SELECT COUNT(*) FROM deck_cards dc WHERE dc.deck_id = d.id) AS card_count
      FROM decks d
      JOIN users u ON d.user_id = u.id
      WHERE d.is_public = 1
    `;
    const params: any[] = [];

    if (search) {
      sql += ' AND (d.name LIKE ? OR d.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    let orderBy = 'd.created_at DESC';
    if (sortBy === 'likes') {
      orderBy = 'd.like_count DESC, d.created_at DESC';
    } else if (sortBy === 'favorites') {
      orderBy = 'd.favorite_count DESC, d.created_at DESC';
    }

    sql += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const result = await queryFromD1(sql, params) as any;
    return result?.success && result.result?.[0]?.results ? result.result[0].results : [];
  } catch (error) {
    console.error('获取公开卡组失败:', error);
    return [];
  }
}

export async function getDeckById(deckId: string): Promise<any | null> {
  try {
    const result = await queryFromD1(
      `SELECT d.*,
              u.username,
              (SELECT COUNT(*) FROM deck_cards dc WHERE dc.deck_id = d.id) AS card_count
       FROM decks d
       JOIN users u ON d.user_id = u.id
       WHERE d.id = ?
       LIMIT 1`,
      [deckId]
    ) as any;

    if (result?.success && result.result?.[0]?.results?.length > 0) {
      return result.result[0].results[0];
    }
    return null;
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
    const fields: string[] = [];
    const params: any[] = [];

    if (payload.name !== undefined) {
      fields.push('name = ?');
      params.push(payload.name);
    }

    if (payload.description !== undefined) {
      fields.push('description = ?');
      params.push(payload.description);
    }

    if (payload.isPublic !== undefined) {
      fields.push('is_public = ?');
      params.push(typeof payload.isPublic === 'number' ? payload.isPublic : (payload.isPublic ? 1 : 0));
    }

    if (fields.length === 0) {
      return { success: true };
    }

    const sql = `UPDATE decks SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`;
    const result = await queryFromD1(sql, [...params, deckId, userId]) as any;

    const changes = result?.result?.[0]?.meta?.changes ?? 0;
    if (result?.success && changes > 0) {
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
    const result = await queryFromD1('DELETE FROM decks WHERE id = ? AND user_id = ?', [deckId, userId]) as any;
    const changes = result?.result?.[0]?.meta?.changes ?? 0;
    return Boolean(result?.success && changes > 0);
  } catch (error) {
    console.error('删除卡组失败:', error);
    return false;
  }
}

export async function incrementDeckLike(deckId: string): Promise<boolean> {
  try {
    const result = await queryFromD1(
      'UPDATE decks SET like_count = like_count + 1 WHERE id = ? AND is_public = 1',
      [deckId]
    ) as any;

    const changes = result?.result?.[0]?.meta?.changes ?? 0;
    return Boolean(result?.success && changes > 0);
  } catch (error) {
    console.error('点赞卡组失败:', error);
    return false;
  }
}

