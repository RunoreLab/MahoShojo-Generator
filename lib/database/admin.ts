// lib/database/admin.ts

import { queryFromD1 } from './core';

/**
 * [新增] 获取仪表盘所需的各项统计数据。
 * @description
 * 该函数通过并发执行多个独立的聚合查询来收集核心指标。
 * D1数据库不支持在单次请求中执行多条语句，因此我们使用 Promise.all 来并行处理，以提高性能。
 * @returns {Promise<object>} 返回一个包含所有统计数据的对象。
 */
export async function getDashboardStats(): Promise<{
  totalUsers: number;
  totalDataCards: number;
  pendingReviewCount: number;
  bannedUsersCount: number;
  bannedDataCardsCount: number;
  newUsersToday: number;
  newDataCardsToday: number;
}> {
  try {
    // 定义所有需要执行的查询
    const queries = {
      totalUsers: "SELECT COUNT(id) as total FROM users;",
      totalDataCards: "SELECT COUNT(id) as total FROM data_cards;",
      pendingReviewCount: "SELECT COUNT(id) as total FROM data_cards WHERE review_status = 'pending' AND is_public = 1;",
      bannedUsersCount: "SELECT COUNT(id) as total FROM users WHERE is_banned IS NOT NULL AND is_banned != '';",
      bannedDataCardsCount: "SELECT COUNT(id) as total FROM data_cards WHERE is_public = -1;",
      // 注意：D1 使用 strftime 和 'now', 'localtime' 来处理日期
      newUsersToday: "SELECT COUNT(id) as total FROM users WHERE DATE(created_at) = DATE('now', 'localtime');",
      newDataCardsToday: "SELECT COUNT(id) as total FROM data_cards WHERE DATE(created_at) = DATE('now', 'localtime');",
    };

    // 使用 Promise.all 并行执行所有查询
    const results = await Promise.all(
      Object.values(queries).map(sql => queryFromD1(sql))
    );

    // 辅助函数，用于安全地从查询结果中提取计数值
    const getCount = (result: any): number => {
      // D1 API的返回结构可能有多层嵌套
      return result?.result?.[0]?.results?.[0]?.total || 0;
    };
    
    // 将查询结果映射到最终的返回对象
    const [
      totalUsersResult,
      totalDataCardsResult,
      pendingReviewCountResult,
      bannedUsersCountResult,
      bannedDataCardsCountResult,
      newUsersTodayResult,
      newDataCardsTodayResult
    ] = results;

    return {
      totalUsers: getCount(totalUsersResult),
      totalDataCards: getCount(totalDataCardsResult),
      pendingReviewCount: getCount(pendingReviewCountResult),
      bannedUsersCount: getCount(bannedUsersCountResult),
      bannedDataCardsCount: getCount(bannedDataCardsCountResult),
      newUsersToday: getCount(newUsersTodayResult),
      newDataCardsToday: getCount(newDataCardsTodayResult),
    };

  } catch (error) {
    console.error('[Admin] 获取仪表盘统计数据失败:', error);
    // 在出错时返回一组默认值，避免前端崩溃
    return {
      totalUsers: 0,
      totalDataCards: 0,
      pendingReviewCount: 0,
      bannedUsersCount: 0,
      bannedDataCardsCount: 0,
      newUsersToday: 0,
      newDataCardsToday: 0,
    };
  }
}

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
  isRecommended?: '0' | '1';
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
    isRecommended,
    type,
    search,
  } = filters;

  const offset = (page - 1) * limit;
  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  // --- 动态构建 WHERE 子句 ---
  if (reviewStatus) {
    whereClauses.push('dc.review_status = ?');
    params.push(reviewStatus);
  }
  if (isPublic) {
    whereClauses.push('dc.is_public = ?');
    params.push(parseInt(isPublic, 10));
  }
  if (isRecommended) {
    whereClauses.push('dc.is_recommended = ?');
    params.push(parseInt(isRecommended, 10));
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
  updates: { review_status?: 'approved' | 'rejected'; is_public?: 0 | 1 | -1; is_recommended?: 0 | 1 }
): Promise<boolean> {
  if (cardIds.length === 0) return true;

  const setClauses: string[] = [];
  const params: (string | number)[] = [];

  if (updates.review_status) {
    setClauses.push('review_status = ?');
    params.push(updates.review_status);
  }
  if (updates.is_public !== undefined) {
    setClauses.push('is_public = ?');
    params.push(updates.is_public);
  }
  if (updates.is_recommended !== undefined) {
    setClauses.push('is_recommended = ?');
    params.push(updates.is_recommended);
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

/**
 * [Admin] 获取用户列表，支持复杂的多维度筛选和分页
 * [修改] 增加了 card count 相关的筛选参数
 * @param filters - 包含所有筛选条件的对
 * @returns 返回查询到的用户数组及总数
 */
export async function getAdminUsers(filters: {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string; // 搜索用户名
  regDateStart?: string;
  regDateEnd?: string;
  loginDateStart?: string;
  loginDateEnd?: string;
  status?: 'normal' | 'banned' | 'exempt';
  minPublicCards?: number; // 新增：最少公开卡片数
  maxPublicCards?: number; // 新增：最多公开卡片数
  minBannedCards?: number; // 新增：最少封禁卡片数
  maxBannedCards?: number; // 新增：最多封禁卡片数
}) {
  const {
    page = 1,
    limit = 20,
    sortBy = 'created_at',
    sortOrder = 'desc',
    search,
    regDateStart,
    regDateEnd,
    loginDateStart,
    loginDateEnd,
    status,
    minPublicCards,
    maxPublicCards,
    minBannedCards,
    maxBannedCards,
  } = filters;

  const offset = (page - 1) * limit;
  const whereClauses: string[] = [];
  const havingClauses: string[] = []; // 新增：用于 HAVING 子句
  const params: (string | number)[] = []; // WHERE 和 HAVING 共用参数列表

  // --- 动态构建 WHERE 子句 (过滤用户属性) ---
  if (search) {
    // 搜索范围包括用户名和邮箱，方便管理员通过邮件或用户名定位用户
    whereClauses.push('(u.username LIKE ? OR u.email LIKE ?)');
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm);
  }
  if (regDateStart) {
    whereClauses.push('u.created_at >= ?');
    params.push(regDateStart);
  }
  if (regDateEnd) {
    whereClauses.push('u.created_at <= ?');
    params.push(regDateEnd);
  }
  if (loginDateStart) {
    whereClauses.push('u.last_login_at >= ?');
    params.push(loginDateStart);
  }
  if (loginDateEnd) {
    whereClauses.push('u.last_login_at <= ?');
    params.push(loginDateEnd);
  }
  if (status) {
    if (status === 'banned') whereClauses.push("u.is_banned IS NOT NULL AND u.is_banned != ''");
    else if (status === 'exempt') whereClauses.push('u.is_review_exempt = 1');
    else if (status === 'normal') whereClauses.push("(u.is_banned IS NULL OR u.is_banned = '') AND u.is_review_exempt = 0");
  }

  // --- 动态构建 HAVING 子句 (过滤聚合结果) ---
  if (minPublicCards !== undefined) { havingClauses.push('public_cards >= ?'); params.push(minPublicCards); }
  if (maxPublicCards !== undefined) { havingClauses.push('public_cards <= ?'); params.push(maxPublicCards); }
  if (minBannedCards !== undefined) { havingClauses.push('banned_cards >= ?'); params.push(minBannedCards); }
  if (maxBannedCards !== undefined) { havingClauses.push('banned_cards <= ?'); params.push(maxBannedCards); }
  // 处理特殊情况： "no banned cards"
  if (maxBannedCards === 0 && minBannedCards === undefined) {
      if (!havingClauses.some(c => c.includes('banned_cards <= ?'))) {
          havingClauses.push('banned_cards <= ?');
          params.push(0);
      }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const havingSql = havingClauses.length > 0 ? `HAVING ${havingClauses.join(' AND ')}` : '';

  // D1 不支持在 FROM 子句中使用复杂的子查询，所以我们将使用 LEFT JOIN 和 COUNT
  const dataSql = `
    SELECT
      u.id, u.username, u.email, u.created_at, u.last_login_at, u.is_banned, u.is_review_exempt,
      COUNT(dc.id) as total_cards,
      SUM(CASE WHEN dc.is_public = 1 THEN 1 ELSE 0 END) as public_cards,
      SUM(CASE WHEN dc.is_public = -1 THEN 1 ELSE 0 END) as banned_cards,
      SUM(CASE WHEN dc.review_status = 'rejected' THEN 1 ELSE 0 END) as rejected_cards
    FROM users u
    LEFT JOIN data_cards dc ON u.id = dc.user_id
    ${whereSql}
    GROUP BY u.id -- 按用户分组
    ${havingSql} -- 在分组后应用聚合筛选
    ORDER BY u.${sortBy} ${sortOrder.toUpperCase()}
    LIMIT ? OFFSET ?;
  `;

  // --- 构建总数查询 SQL (使用子查询来应用 HAVING) ---
  const countSql = `
    SELECT COUNT(*) as total
    FROM (
      SELECT
        u.id,
        SUM(CASE WHEN dc.is_public = 1 THEN 1 ELSE 0 END) as public_cards,
        SUM(CASE WHEN dc.is_public = -1 THEN 1 ELSE 0 END) as banned_cards
      FROM users u
      LEFT JOIN data_cards dc ON u.id = dc.user_id
      ${whereSql}
      GROUP BY u.id
      ${havingSql}
    ) AS subquery;
  `;

  try {
    const dataParams = [...params, limit, offset];
    const countParams = [...params];

    // 并行执行数据查询和总数查询
    const [dataResult, countResult] = await Promise.all([
      queryFromD1(dataSql, dataParams),
      queryFromD1(countSql, countParams)
    ]) as [any, any];

    const users = dataResult.success ? dataResult.result[0]?.results || [] : [];
    const total = countResult.success ? countResult.result[0]?.results[0]?.total || 0 : 0;

    return { users, total };
  } catch (error) {
    console.error('[Admin] 获取用户列表失败:', error);
    throw error;
  }
}

/**
 * [Admin] 批量更新用户的状态
 * @param userIds - 要更新的用户ID数组
 * @param updates - 要更新的字段和值, e.g., { is_review_exempt: 1 }
 * @returns 返回操作是否成功的布尔值
 */
export async function batchUpdateUsers(
  userIds: number[],
  updates: { is_review_exempt?: 0 | 1; is_banned?: string | null }
): Promise<boolean> {
  if (userIds.length === 0) return true;

  const setClauses: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.is_review_exempt !== undefined) {
    setClauses.push('is_review_exempt = ?');
    params.push(updates.is_review_exempt);
  }
  if (updates.is_banned !== undefined) {
    setClauses.push('is_banned = ?');
    params.push(updates.is_banned);
  }

  if (setClauses.length === 0) return false;

  const placeholders = userIds.map(() => '?').join(', ');
  const sql = `UPDATE users SET ${setClauses.join(', ')} WHERE id IN (${placeholders})`;
  const finalParams = [...params, ...userIds];

  try {
    const result = (await queryFromD1(sql, finalParams)) as any;
    return result.success;
  } catch (error) {
    console.error('[Admin] 批量更新用户失败:', error);
    return false;
  }
}
