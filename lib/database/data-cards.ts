import { queryFromD1, generateUUID } from './core';

// 检查公开数据卡是否存在同名
export async function checkPublicCardNameExists(
  name: string,
  type: 'character' | 'scenario'
): Promise<boolean> {
  try {
    const result = await queryFromD1(
      'SELECT COUNT(*) as count FROM data_cards WHERE name = ? AND type = ? AND is_public = 1 AND deleted_at IS NULL',
      [name, type]
    ) as any;
    
    if (result.success && result.result && result.result[0]?.results?.length > 0) {
      return result.result[0].results[0].count > 0;
    }
    return false;
  } catch (error) {
    console.error("检查同名数据卡失败:", error);
    return false;
  }
}

// 创建数据卡（增强版，带作者信息）
export async function createDataCardWithAuthor(
  userId: number,
  username: string,
  type: 'character' | 'scenario',
  name: string,
  description: string,
  data: string,
  isPublic: boolean | number = false,
  reviewStatus: 'pending' | 'approved' // [v0.4.2 新增] 传入审查状态
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    // 如果是公开卡，先检查是否有同名
    // 暂时取消检查
    // if (isPublic) {
    //   const exists = await checkPublicCardNameExists(name, type);
    //   if (exists) {
    //     return { success: false, error: '已存在同名的公开数据卡，请修改名称' };
    //   }
    // }
    
    // 创建包含作者信息的数据对象
    const dataWithAuthor = JSON.stringify({
      ...JSON.parse(data),
      _author: username,
      _authorId: userId
    });
    
    // 生成 UUID 作为主键
    const uuid = generateUUID();
    
    const result = await queryFromD1(
      'INSERT INTO data_cards (id, user_id, type, name, description, data, is_public, review_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [uuid, userId, type, name, description, dataWithAuthor, typeof isPublic === 'number' ? isPublic : (isPublic ? 1 : 0), reviewStatus]
    ) as any;
    
    if (result.success && result.result) {
      return { success: true, id: uuid };
    }
    return { success: false, error: '创建失败' };
  } catch (error) {
    console.error("创建数据卡失败:", error);
    return { success: false, error: '创建数据卡失败' };
  }
}

// 创建数据卡（基础版，向后兼容）
export async function createDataCard(
  userId: number,
  type: 'character' | 'scenario',
  name: string,
  description: string,
  data: string,
  isPublic: boolean | number = false
): Promise<string | null> {
  try {
    // 生成 UUID 作为主键
    const uuid = generateUUID();
    
    const result = await queryFromD1(
      'INSERT INTO data_cards (id, user_id, type, name, description, data, is_public) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uuid, userId, type, name, description, data, typeof isPublic === 'number' ? isPublic : (isPublic ? 1 : 0)]
    ) as any;
    
    if (result.success && result.result) {
      return uuid;
    }
    return null;
  } catch (error) {
    console.error("创建数据卡失败:", error);
    return null;
  }
}

// 获取用户的所有数据卡
export async function getUserDataCards(
  userId: number, 
  search?: string,
  sortBy?: 'likes' | 'usage' | 'favorites' | 'created_at'
): Promise<any[]> {
  try {
    let sql = 'SELECT * FROM data_cards WHERE user_id = ? AND deleted_at IS NULL';
    const params: any[] = [userId];
    
    if (search) {
      sql += ' AND (name LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    // 添加排序逻辑
    let orderBy = 'updated_at DESC'; // 默认按更新时间排序
    if (sortBy === 'likes') {
      orderBy = 'like_count DESC, updated_at DESC';
    } else if (sortBy === 'usage') {
      orderBy = 'usage_count DESC, updated_at DESC';
    } else if (sortBy === 'favorites') {
      orderBy = 'favorite_count DESC, updated_at DESC';
    } else if (sortBy === 'created_at') {
      orderBy = 'created_at DESC';
    }
    
    sql += ` ORDER BY ${orderBy}`;
    
    const result = await queryFromD1(sql, params) as any;
    
    if (result.success && result.result && result.result[0]?.results) {
      return result.result[0].results;
    }
    return [];
  } catch (error) {
    console.error("获取数据卡失败:", error);
    return [];
  }
}

// 更新数据卡信息
export async function updateDataCard(
  id: string,
  userId: number,
  name: string,
  description: string,
  isPublic?: boolean | number,
  reviewStatus?: 'pending' | 'approved' | 'rejected' // [v0.4.2 新增] 允许更新审查状态
): Promise<boolean> {
  try {
    let sql = 'UPDATE data_cards SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP';
    const params: any[] = [name, description];
    
    if (isPublic !== undefined) {
      sql += ', is_public = ?';
      params.push(typeof isPublic === 'number' ? isPublic : (isPublic ? 1 : 0));
    }

    // [v0.4.2 新增] 如果传入了 reviewStatus，则一并更新
    if (reviewStatus) {
        sql += ', review_status = ?';
        params.push(reviewStatus);
    }

    sql += ' WHERE id = ? AND user_id = ? AND deleted_at IS NULL';
    params.push(id, userId);
    
    const result = await queryFromD1(sql, params) as any;
    
    if (result.success && result.result && result.result[0]?.meta?.changes > 0) {
      return true;
    }
    return false;
  } catch (error) {
    console.error("更新数据卡失败:", error);
    return false;
  }
}

// 删除数据卡
export async function deleteDataCard(id: string, userId: number): Promise<boolean> {
  try {
    const result = await queryFromD1(
      'UPDATE data_cards SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      [id, userId]
    ) as any;

    if (result.success && result.result && result.result[0]?.meta?.changes > 0) {
      return true;
    }
    return false;
  } catch (error) {
    console.error("删除数据卡失败:", error);
    return false;
  }
}

// 永久删除（物理删除）指定的数据卡
export async function permanentlyDeleteDataCards(ids: string[], userId: number): Promise<number> {
  if (!ids.length) {
    return 0;
  }

  try {
    const placeholders = ids.map(() => '?').join(',');
    const result = await queryFromD1(
      `DELETE FROM data_cards WHERE user_id = ? AND id IN (${placeholders})`,
      [userId, ...ids]
    ) as any;

    if (result.success && result.result) {
      return result.result[0]?.meta?.changes ?? 0;
    }
    return 0;
  } catch (error) {
    console.error("永久删除数据卡失败:", error);
    return 0;
  }
}

// 获取用户回收站中的数据卡
export async function getUserRecycleBinCards(userId: number): Promise<any[]> {
  try {
    const result = await queryFromD1(
      'SELECT * FROM data_cards WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC',
      [userId]
    ) as any;

    if (result.success && result.result && result.result[0]?.results) {
      return result.result[0].results;
    }
    return [];
  } catch (error) {
    console.error("获取回收站数据卡失败:", error);
    return [];
  }
}

// 从回收站恢复数据卡
export async function restoreDataCard(cardId: string, userId: number): Promise<boolean> {
  try {
    const result = await queryFromD1(
      'UPDATE data_cards SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL',
      [cardId, userId]
    ) as any;

    if (result.success && result.result && result.result[0]?.meta?.changes > 0) {
      return true;
    }
    return false;
  } catch (error) {
    console.error("恢复数据卡失败:", error);
    return false;
  }
}

// 裁剪回收站，只保留最新的 keep 条目
export async function pruneUserRecycleBin(userId: number, keep: number): Promise<string[]> {
  try {
    const result = await queryFromD1(
      'SELECT id FROM data_cards WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC',
      [userId]
    ) as any;

    if (!(result.success && result.result && result.result[0]?.results)) {
      return [];
    }

    const rows = result.result[0].results as Array<{ id: string }>;
    if (rows.length <= keep) {
      return [];
    }

    const idsToDelete = rows.slice(keep).map((row) => row.id);
    await permanentlyDeleteDataCards(idsToDelete, userId);
    return idsToDelete;
  } catch (error) {
    console.error("裁剪回收站失败:", error);
    return [];
  }
}

// 验证数据卡所有权
export async function verifyCardOwnership(cardId: string, userId: number): Promise<boolean> {
  try {
    const result = await queryFromD1(
      'SELECT id FROM data_cards WHERE id = ? AND user_id = ?',
      [cardId, userId]
    ) as any;
    
    if (result.success && result.result && result.result[0]?.results?.length > 0) {
      return true;
    }
    return false;
  } catch (error) {
    console.error("验证数据卡所有权失败:", error);
    return false;
  }
}

// 通过ID获取单个数据卡（公开或私有）
export async function getDataCardById(cardId: string, isPublic: boolean = false): Promise<any | null> {
  try {
    let sql = 'SELECT dc.*, u.username FROM data_cards dc JOIN users u ON dc.user_id = u.id WHERE dc.id = ? AND dc.deleted_at IS NULL';
    const params: any[] = [cardId];

    // [v0.4.2 修改] 如果是查询公开卡，则必须是通过审查的
    if (isPublic) {
        sql += " AND dc.is_public = 1 AND dc.review_status = 'approved'";
    }
    
    const result = await queryFromD1(sql, params) as any;
    
    if (result.success && result.result && result.result[0]?.results?.length > 0) {
      return result.result[0].results[0];
    }
    return null;
  } catch (error) {
    console.error("通过ID获取数据卡失败:", error);
    return null;
  }
}

// 增加数据卡的点赞数
export async function incrementDataCardLike(cardId: string): Promise<boolean> {
  try {
    const result = await queryFromD1(
      "UPDATE data_cards SET like_count = like_count + 1 WHERE id = ? AND is_public = 1 AND review_status = 'approved' AND deleted_at IS NULL",
      [cardId]
    ) as any;
    
    return result.success && result.result && result.result[0]?.meta?.changes > 0;
  } catch (error) {
    console.error("增加数据卡点赞数失败:", error);
    return false;
  }
}

// 增加数据卡的使用次数
export async function incrementDataCardUsage(cardId: string): Promise<boolean> {
  try {
    const result = await queryFromD1(
      "UPDATE data_cards SET usage_count = usage_count + 1 WHERE id = ? AND is_public = 1 AND review_status = 'approved' AND deleted_at IS NULL",
      [cardId]
    ) as any;
    
    return result.success && result.result && result.result[0]?.meta?.changes > 0;
  } catch (error) {
    console.error("增加数据卡使用次数失败:", error);
    return false;
  }
}

/**
 * 获取公开的数据卡列表，增加了完整的筛选功能。
 * @param author - 作者用户名 (精确匹配)
 * @param minLikes - 最小点赞数
 * @param maxLikes - 最大点赞数
 * @param minUsage - 最少使用数
 * @param maxUsage - 最多使用数
 */
export async function getPublicDataCards(
  limit: number = 20,
  offset: number = 0,
  type?: 'character' | 'scenario',
  search?: string,
  sortBy?: 'likes' | 'usage' | 'favorites' | 'created_at',
  author?: string,
  minLikes?: number,
  maxLikes?: number,
  minUsage?: number,
  maxUsage?: number,
  minFavorites?: number,
  maxFavorites?: number,
  recommendedOnly?: boolean
): Promise<any[]> {
  try {
    // 基础查询语句
    let sql = "SELECT dc.*, u.username FROM data_cards dc JOIN users u ON dc.user_id = u.id WHERE dc.is_public = 1 AND dc.review_status = 'approved' AND dc.deleted_at IS NULL";
    const params: any[] = [];
    
    // -- 动态构建 WHERE 子句 --
    // 这是一个稳健的实践，可以根据传入的参数动态添加过滤条件
    if (type) {
      sql += ' AND dc.type = ?';
      params.push(type);
    }
    if (search) {
      sql += ' AND (dc.name LIKE ? OR dc.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (author) {
      sql += ' AND u.username = ?';
      params.push(author);
    }
    if (minLikes !== undefined && minLikes !== null) {
      sql += ' AND dc.like_count >= ?';
      params.push(minLikes);
    }
    if (maxLikes !== undefined && maxLikes !== null) {
      sql += ' AND dc.like_count <= ?';
      params.push(maxLikes);
    }
    if (minUsage !== undefined && minUsage !== null) {
      sql += ' AND dc.usage_count >= ?';
      params.push(minUsage);
    }
    if (maxUsage !== undefined && maxUsage !== null) {
      sql += ' AND dc.usage_count <= ?';
      params.push(maxUsage);
    }
    if (minFavorites !== undefined && minFavorites !== null) {
      sql += ' AND dc.favorite_count >= ?';
      params.push(minFavorites);
    }
    if (maxFavorites !== undefined && maxFavorites !== null) {
      sql += ' AND dc.favorite_count <= ?';
      params.push(maxFavorites);
    }
    if (recommendedOnly) {
      sql += ' AND dc.is_recommended = 1';
    }
    
    // -- 排序逻辑 --
    let orderBy = 'dc.created_at DESC'; // 默认按创建时间排序
    if (sortBy === 'likes') {
      orderBy = 'dc.like_count DESC, dc.created_at DESC';
    } else if (sortBy === 'usage') {
      orderBy = 'dc.usage_count DESC, dc.created_at DESC';
    } else if (sortBy === 'favorites') {
      orderBy = 'dc.favorite_count DESC, dc.created_at DESC';
    }

    if (recommendedOnly && sortBy !== 'favorites') {
      // 推荐列表默认按推荐时间倒序，其次按创建时间
      orderBy = 'dc.updated_at DESC, dc.created_at DESC';
    } else if (!recommendedOnly) {
      // 推荐项在普通列表中仍需优先展示
      orderBy = `dc.is_recommended DESC, ${orderBy}`;
    }

    sql += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    const result = await queryFromD1(sql, params) as any;
    
    if (result.success && result.result && result.result[0]?.results) {
      return result.result[0].results;
    }
    return [];
  } catch (error) {
    console.error("获取公开数据卡失败:", error);
    return [];
  }
}

/**
 * [新增] 从数据库中随机获取一个公开的数据卡。
 * @param type - 'character' 或 'scenario'，用于指定要获取的数据卡类型。
 * @returns {Promise<any | null>} 返回一个随机的数据卡对象，如果没有符合条件的则返回 null。
 */
export async function getRandomPublicCard(
  type: 'character' | 'scenario'
): Promise<any | null> {
  try {
    // D1 数据库支持 RANDOM() 函数，这使得随机选择非常高效。
    const result = await queryFromD1(
      "SELECT dc.*, u.username FROM data_cards dc JOIN users u ON dc.user_id = u.id WHERE dc.is_public = 1 AND dc.type = ? AND dc.review_status = 'approved' AND dc.deleted_at IS NULL ORDER BY RANDOM() LIMIT 1",
      [type]
    ) as any;
    
    // 检查查询是否成功，以及是否真的返回了结果
    if (result.success && result.result && result.result[0]?.results?.length > 0) {
      // 返回找到的第一个（也是唯一一个）结果
      return result.result[0].results[0];
    }
    // 如果没有找到任何数据卡，则返回 null
    return null;
  } catch (error) {
    console.error("获取随机公开数据卡失败:", error);
    // 在发生错误时也返回 null
    return null;
  }
}

// 检查数据卡是否被封禁
export function isDataCardBanned(card: any): boolean {
  return card && card.is_public === -1;
}

// 获取数据卡状态描述
export function getDataCardStatus(card: any): { status: 'public' | 'private' | 'banned', label: string, color: string } {
  if (!card) {
    return { status: 'private', label: '私有', color: 'gray' };
  }
  
  if (card.is_public === -1) {
    return { status: 'banned', label: '封禁', color: 'red' };
  } else if (card.is_public === 1) {
    return { status: 'public', label: '公开', color: 'green' };
  } else {
    return { status: 'private', label: '私有', color: 'gray' };
  }
}
