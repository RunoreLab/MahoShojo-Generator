import { queryFromD1, generateUUID } from './core';

// 检查公开数据卡是否存在同名
export async function checkPublicCardNameExists(
  name: string,
  type: 'character' | 'scenario'
): Promise<boolean> {
  try {
    const result = await queryFromD1(
      'SELECT COUNT(*) as count FROM data_cards WHERE name = ? AND type = ? AND is_public = 1',
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
  isPublic: boolean = false
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
      'INSERT INTO data_cards (id, user_id, type, name, description, data, is_public) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uuid, userId, type, name, description, dataWithAuthor, isPublic ? 1 : 0]
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
  isPublic: boolean = false
): Promise<string | null> {
  try {
    // 生成 UUID 作为主键
    const uuid = generateUUID();
    
    const result = await queryFromD1(
      'INSERT INTO data_cards (id, user_id, type, name, description, data, is_public) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uuid, userId, type, name, description, data, isPublic ? 1 : 0]
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
  sortBy?: 'likes' | 'usage' | 'created_at'
): Promise<any[]> {
  try {
    let sql = 'SELECT * FROM data_cards WHERE user_id = ?';
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
  isPublic?: boolean
): Promise<boolean> {
  try {
    let sql = 'UPDATE data_cards SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP';
    const params: any[] = [name, description];
    
    if (isPublic !== undefined) {
      sql += ', is_public = ?';
      params.push(isPublic ? 1 : 0);
    }
    
    sql += ' WHERE id = ? AND user_id = ?';
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
      'DELETE FROM data_cards WHERE id = ? AND user_id = ?',
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
    const result = await queryFromD1(
      'SELECT dc.*, u.username FROM data_cards dc JOIN users u ON dc.user_id = u.id WHERE dc.id = ? AND dc.is_public = ?',
      [cardId, isPublic ? 1 : 0]
    ) as any;
    
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
      'UPDATE data_cards SET like_count = like_count + 1 WHERE id = ? AND is_public = 1',
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
      'UPDATE data_cards SET usage_count = usage_count + 1 WHERE id = ? AND is_public = 1',
      [cardId]
    ) as any;
    
    return result.success && result.result && result.result[0]?.meta?.changes > 0;
  } catch (error) {
    console.error("增加数据卡使用次数失败:", error);
    return false;
  }
}

// 获取公开的数据卡列表
export async function getPublicDataCards(
  limit: number = 20,
  offset: number = 0,
  type?: 'character' | 'scenario',
  search?: string,
  sortBy?: 'likes' | 'usage' | 'created_at'
): Promise<any[]> {
  try {
    let sql = 'SELECT dc.*, u.username FROM data_cards dc JOIN users u ON dc.user_id = u.id WHERE dc.is_public = 1';
    const params: any[] = [];
    
    if (type) {
      sql += ' AND dc.type = ?';
      params.push(type);
    }
    
    if (search) {
      sql += ' AND (dc.name LIKE ? OR dc.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    // 添加排序逻辑
    let orderBy = 'dc.created_at DESC'; // 默认按创建时间排序
    if (sortBy === 'likes') {
      orderBy = 'dc.like_count DESC, dc.created_at DESC';
    } else if (sortBy === 'usage') {
      orderBy = 'dc.usage_count DESC, dc.created_at DESC';
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