import { queryFromD1 } from './core';

export type UserProfileRow = {
  user_id: number;
  signature: string | null;
  avatar_webp_base64: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function getUserProfileByUserId(userId: number): Promise<UserProfileRow | null> {
  try {
    const result = (await queryFromD1(
      'SELECT user_id, signature, avatar_webp_base64, created_at, updated_at FROM user_profiles WHERE user_id = ? LIMIT 1',
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

async function ensureProfileRow(userId: number): Promise<void> {
  await queryFromD1(
    'INSERT INTO user_profiles (user_id, created_at, updated_at) VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO NOTHING',
    [userId],
  );
}

export async function updateUserSignature(userId: number, signature: string | null): Promise<boolean> {
  try {
    await ensureProfileRow(userId);
    const result = (await queryFromD1(
      'UPDATE user_profiles SET signature = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
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
    await ensureProfileRow(userId);
    const result = (await queryFromD1(
      'UPDATE user_profiles SET avatar_webp_base64 = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [avatarWebpBase64, userId],
    )) as any;
    return Boolean(result?.success);
  } catch (error) {
    console.error('更新用户头像失败:', error);
    return false;
  }
}

