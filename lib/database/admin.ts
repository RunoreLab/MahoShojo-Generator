// lib/database/admin.ts

import { queryFromD1 } from './core';

/**
 * [Admin] 获取数据卡列表，支持多维度筛选和分页
 * @param filters - 包含所有筛选条件的对
 * @returns 返回查询到的数据卡数组
 */
export async function getAdminDataCards(filters: {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  reviewStatus?: 'pending' | 'approved' | 'rejected';
  isPublic?: '0' | '1' | '-1'; // 0=私有, 1=公开, -1=封禁
  type?: 'character' | 'scenario';
  search?: string; // 搜索名称、描述或作者名
}): Promise<{ cards: any[], total: number }> {
  const {
    page = 1,
    limit = 20,
    sortBy = 'updated_at',
    sortOrder = 'desc',
    reviewStatus,
    isPublic,
    type,
    search,
  } = filters;

  const offset = (page - 1) * limit;
  let whereClauses: string[] = [];
  let params: (string | number)[] = [];

  // --- 动态构建 WHERE 子句 ---
  if (reviewStatus) {
    whereClauses.push('dc.review_status = ?');
    params.push(reviewStatus);
  }
  if (isPublic) {
    whereClauses.push('dc.is_public = ?');
    params.push(parseInt(isPublic, 10));
  }
  if (type) {
    whereClauses.push('dc.type = ?');
    params.push(type);
  }
  if (search) {
    // 搜索范围包括卡片名称、描述和作者用户名
    whereClauses.push('(dc.name LIKE ? OR dc.description LIKE ? OR u.username LIKE ?)');
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // --- 分别构建数据查询和总数查询 ---
  const dataSql = `
    SELECT dc.*, u.username 
    FROM data_cards dc
    JOIN users u ON dc.user_id = u.id
    ${whereSql}
    ORDER BY dc.${sortBy} ${sortOrder.toUpperCase()}
    LIMIT ? OFFSET ?;
  `;
  const countSql = `
    SELECT COUNT(dc.id) as total
    FROM data_cards dc
    JOIN users u ON dc.user_id = u.id
    ${whereSql};
  `;

  // D1 不支持在单次请求中执行多条语句，因此我们分别执行
  try {
    const dataParams = [...params, limit, offset];
    const countParams = [...params];

    const dataResult = (await queryFromD1(dataSql, dataParams)) as any;
    const countResult = (await queryFromD1(countSql, countParams)) as any;

    const cards = dataResult.success ? dataResult.result[0]?.results || [] : [];
    const total = countResult.success ? countResult.result[0]?.results[0]?.total || 0 : 0;
    
    return { cards, total };
  } catch (error) {
    console.error('[Admin] 获取数据卡失败:', error);
    throw error;
  }
}

/**
 * [Admin] 批量更新数据卡的状态
 * @param cardIds - 要更新的数据卡ID数组
 * @param updates - 要更新的字段和值，例如 { review_status: 'approved' }
 * @returns 返回一个布尔值表示操作是否成功
 */
export async function batchUpdateDataCards(
  cardIds: string[],
  updates: { review_status?: 'approved' | 'rejected'; is_public?: 0 | 1 | -1 }
): Promise<boolean> {
  if (cardIds.length === 0) return true;

  let setClauses: string[] = [];
  let params: (string | number)[] = [];

  if (updates.review_status) {
    setClauses.push('review_status = ?');
    params.push(updates.review_status);
  }
  if (updates.is_public !== undefined) {
    setClauses.push('is_public = ?');
    params.push(updates.is_public);
  }

  if (setClauses.length === 0) {
    // 没有需要更新的字段
    return false;
  }
  
  // 添加 updated_at 以反映最后修改时间
  setClauses.push('updated_at = CURRENT_TIMESTAMP');

  // 构建 '?' 占位符字符串，例如 (?, ?, ?)
  const placeholders = cardIds.map(() => '?').join(', ');
  
  const sql = `
    UPDATE data_cards
    SET ${setClauses.join(', ')}
    WHERE id IN (${placeholders})
  `;

  const finalParams = [...params, ...cardIds];

  try {
    const result = (await queryFromD1(sql, finalParams)) as any;
    return result.success;
  } catch (error) {
    console.error('[Admin] 批量更新数据卡失败:', error);
    return false;
  }
}

/**
 * [Admin] 根据ID列表获取用于导出的数据卡核心数据
 * @param cardIds - 要导出的数据卡ID数组
 * @returns 返回一个包含data字段内容的数组
 */
export async function getDataForExport(cardIds: string[]): Promise<any[]> {
  if (cardIds.length === 0) return [];

  const placeholders = cardIds.map(() => '?').join(', ');
  const sql = `SELECT data FROM data_cards WHERE id IN (${placeholders})`;

  try {
    const result = (await queryFromD1(sql, cardIds)) as any;
    if (result.success && result.result[0]?.results) {
      // 从结果中提取 data 字段并解析 JSON 字符串
      return result.result[0].results.map((row: { data: string }) => JSON.parse(row.data));
    }
    return [];
  } catch (error) {
    console.error('[Admin] 获取导出数据失败:', error);
    throw error;
  }
}

/**
 * [Admin] 根据ID列表获取AI审查所需的数据卡核心内容
 * @param cardIds - 要审查的数据卡ID数组
 * @returns 返回一个包含审查所需字段的数组
 */
export async function getCardsForReview(cardIds: string[]): Promise<{ id: string; name: string; description: string; data: string; }[]> {
  if (cardIds.length === 0) return [];

  const placeholders = cardIds.map(() => '?').join(', ');
  const sql = `SELECT id, name, description, data FROM data_cards WHERE id IN (${placeholders})`;

  try {
    const result = (await queryFromD1(sql, cardIds)) as any;
    if (result.success && result.result[0]?.results) {
      return result.result[0].results;
    }
    return [];
  } catch (error) {
    console.error('[Admin] 获取审查数据失败:', error);
    throw error;
  }
}