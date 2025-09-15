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