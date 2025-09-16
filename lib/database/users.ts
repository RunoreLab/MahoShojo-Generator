import { queryFromD1 } from './core';

// 创建用户
export async function createUser(username: string, email: string, authKey: string): Promise<number | null> {
  try {
    const result = await queryFromD1(
      'INSERT INTO users (username, email, auth_key) VALUES (?, ?, ?)',
      [username, email, authKey]
    ) as any;
    
    if (result.success && result.result) {
      return result.result[0]?.meta?.last_row_id || null;
    }
    return null;
  } catch (error) {
    console.error("创建用户失败:", error);
    return null;
  }
}

// 根据用户名查找用户
export async function getUserByUsername(username: string): Promise<any> {
  try {
    const result = await queryFromD1(
      'SELECT * FROM users WHERE username = ?',
      [username]
    ) as any;
    
    if (result.success && result.result && result.result[0]?.results?.length > 0) {
      return result.result[0].results[0];
    }
    return null;
  } catch (error) {
    console.error("查找用户失败:", error);
    return null;
  }
}

// 根据邮箱查找用户
export async function getUserByEmail(email: string): Promise<any> {
  try {
    const result = await queryFromD1(
      'SELECT * FROM users WHERE email = ?',
      [email]
    ) as any;
    
    if (result.success && result.result && result.result[0]?.results?.length > 0) {
      return result.result[0].results[0];
    }
    return null;
  } catch (error) {
    console.error("根据邮箱查找用户失败:", error);
    return null;
  }
}

// 根据认证密钥查找用户
export async function getUserByAuthKey(authKey: string): Promise<any> {
  try {
    const result = await queryFromD1(
      'SELECT * FROM users WHERE auth_key = ?',
      [authKey]
    ) as any;
    
    if (result.success && result.result && result.result[0]?.results?.length > 0) {
      return result.result[0].results[0];
    }
    return null;
  } catch (error) {
    console.error("查找用户失败:", error);
    return null;
  }
}

export async function verifyUserLogin(username: string, authKey: string): Promise<any> {
  try {
    const result = await queryFromD1(
      'SELECT id, username, prefix FROM users WHERE username = ? AND auth_key = ?',
      [username, authKey]
    ) as any;
    
    if (result.success && result.result && result.result[0]?.results?.length > 0) {
      const user = result.result[0].results[0];
      // 更新最后登录时间
      await queryFromD1(
        'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?',
        [user.id]
      );
      return user;
    }
    return null;
  } catch (error) {
    console.error("验证登录失败:", error);
    return null;
  }
}

// 获取用户数据卡容量限制
export async function getUserDataCardCapacity(userId: number, defaultCapacity: number): Promise<number> {
  try {
    const result = await queryFromD1(
      'SELECT slot_count FROM users WHERE id = ?',
      [userId]
    ) as any;
    
    if (result.success && result.result && result.result[0]?.results?.length > 0) {
      const user = result.result[0].results[0];
      const slotCount = user.slot_count;
      // 如果 slot_count 为 0 或 null，使用默认值
      return (slotCount && slotCount > 0) ? slotCount : defaultCapacity;
    }
    return defaultCapacity;
  } catch (error) {
    console.error("获取用户数据卡容量失败:", error);
    return defaultCapacity;
  }
}

// 获取所有用户（管理员功能）
export async function getAllUsers(limit = 20, offset = 0, searchTerm = ''): Promise<{ users: any[], total: number }> {
  try {
    let query = 'SELECT * FROM users';
    const params: any[] = [];

    if (searchTerm) {
      query += ' WHERE username LIKE ? OR email LIKE ?';
      params.push(`%${searchTerm}%`, `%${searchTerm}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const result = await queryFromD1(query, params) as any;

    let users = [];
    if (result.success && result.result && result.result[0]?.results) {
      users = result.result[0].results;
    }

    // 获取总数
    let countQuery = 'SELECT COUNT(*) as total FROM users';
    const countParams: any[] = [];
    
    if (searchTerm) {
      countQuery += ' WHERE username LIKE ? OR email LIKE ?';
      countParams.push(`%${searchTerm}%`, `%${searchTerm}%`);
    }

    const countResult = await queryFromD1(countQuery, countParams) as any;
    let total = 0;
    
    if (countResult.success && countResult.result && countResult.result[0]?.results?.length > 0) {
      total = countResult.result[0].results[0].total;
    }

    return { users, total };
  } catch (error) {
    console.error("获取用户列表失败:", error);
    return { users: [], total: 0 };
  }
}

// 根据ID更新用户信息（管理员功能）
export async function updateUserById(userId: number, updates: { is_banned?: string | null, slot_count?: number | null, prefix?: string | null }): Promise<any> {
  try {
    const updateFields: string[] = [];
    const params: any[] = [];

    if (updates.is_banned !== undefined) {
      updateFields.push('is_banned = ?');
      params.push(updates.is_banned);
    }

    if (updates.slot_count !== undefined) {
      updateFields.push('slot_count = ?');
      params.push(updates.slot_count);
    }

    if (updates.prefix !== undefined) {
      updateFields.push('prefix = ?');
      params.push(updates.prefix);
    }

    if (updateFields.length === 0) {
      throw new Error('没有要更新的字段');
    }

    params.push(userId);
    
    const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
    const result = await queryFromD1(query, params) as any;

    if (result.success) {
      // 返回更新后的用户信息
      const getUserResult = await queryFromD1('SELECT * FROM users WHERE id = ?', [userId]) as any;
      
      if (getUserResult.success && getUserResult.result && getUserResult.result[0]?.results?.length > 0) {
        return getUserResult.result[0].results[0];
      }
    }
    
    return null;
  } catch (error) {
    console.error("更新用户信息失败:", error);
    return null;
  }
}

// 根据ID获取用户信息
export async function getUserById(userId: number): Promise<any> {
  try {
    const result = await queryFromD1(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    ) as any;
    
    if (result.success && result.result && result.result[0]?.results?.length > 0) {
      return result.result[0].results[0];
    }
    return null;
  } catch (error) {
    console.error("根据ID查找用户失败:", error);
    return null;
  }
}