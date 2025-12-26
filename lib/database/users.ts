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

export type UserProfileRow = {
  signature: string | null;
  avatar_webp_base64: string | null;
};

export async function getUserProfileByUserId(userId: number): Promise<UserProfileRow | null> {
  try {
    const result = (await queryFromD1(
      'SELECT signature, avatar_webp_base64 FROM users WHERE id = ? LIMIT 1',
      [userId],
    )) as any;

    if (result.success && result.result && result.result[0]?.results?.length > 0) {
      return result.result[0].results[0] as UserProfileRow;
    }
    return null;
  } catch (error) {
    console.error('获取用户个人资料失败:', error);
    return null;
  }
}

export async function updateUserSignature(userId: number, signature: string | null): Promise<boolean> {
  try {
    const result = (await queryFromD1(
      'UPDATE users SET signature = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [signature, userId],
    )) as any;
    return Boolean(result?.success);
  } catch (error) {
    console.error('更新用户签名失败:', error);
    return false;
  }
}

export async function updateUserAvatarWebpBase64(userId: number, avatarWebpBase64: string | null): Promise<boolean> {
  try {
    const result = (await queryFromD1(
      'UPDATE users SET avatar_webp_base64 = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [avatarWebpBase64, userId],
    )) as any;
    return Boolean(result?.success);
  } catch (error) {
    console.error('更新用户头像失败:', error);
    return false;
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

// 增加用户的槽位数量
export async function increaseUserSlotCount(userId: number, increaseBy: number): Promise<boolean> {
  try {
    // 先获取当前的 slot_count
    const result = await queryFromD1(
      'SELECT slot_count FROM users WHERE id = ?',
      [userId]
    ) as any;

    if (!result.success || !result.result || result.result[0]?.results?.length === 0) {
      return false;
    }

    const currentSlotCount = result.result[0].results[0].slot_count || 0;
    const newSlotCount = currentSlotCount + increaseBy;

    // 更新 slot_count
    const updateResult = await queryFromD1(
      'UPDATE users SET slot_count = ? WHERE id = ?',
      [newSlotCount, userId]
    ) as any;

    return updateResult.success;
  } catch (error) {
    console.error("增加用户槽位数量失败:", error);
    return false;
  }
}
