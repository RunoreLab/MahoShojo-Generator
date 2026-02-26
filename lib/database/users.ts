export type UserProfileRow = {
  signature: string | null;
  avatar_webp_base64: string | null;
};

export type UserProfileCardRow = {
  id: number;
  username: string;
  prefix: string | null;
  created_at: string;
  signature: string | null;
  avatar_webp_base64: string | null;
};

type UsersRepoBundle = {
  db: unknown;
  createBusinessUser: (
    db: unknown,
    input: { username: string; email: string; authKey: string },
  ) => Promise<any | null>;
  getBusinessUserByUsername: (db: unknown, username: string) => Promise<any | null>;
  getBusinessUserByEmail: (db: unknown, email: string) => Promise<any | null>;
  getBusinessUserById: (db: unknown, userId: number) => Promise<any | null>;
  getBusinessUserByAuthKey: (db: unknown, authKey: string) => Promise<any | null>;
  verifyBusinessUserLoginByUsernameAndAuthKey: (
    db: unknown,
    username: string,
    authKey: string,
  ) => Promise<{ id: number; username: string; prefix: string | null } | null>;
  touchBusinessUserLastLoginAt: (db: unknown, userId: number) => Promise<void>;
  updateBusinessUserAuthKey: (db: unknown, userId: number, authKey: string) => Promise<any | null>;
  getBusinessUserProfileCardById: (
    db: unknown,
    userId: number,
  ) => Promise<{ id: number; username: string; prefix: string | null; createdAt: string | null; signature: string | null; avatarWebpBase64: string | null } | null>;
  getBusinessUserProfileById: (
    db: unknown,
    userId: number,
  ) => Promise<{ signature: string | null; avatarWebpBase64: string | null } | null>;
  updateBusinessUserSignatureById: (
    db: unknown,
    userId: number,
    signature: string | null,
  ) => Promise<number>;
  updateBusinessUserAvatarWebpBase64ById: (
    db: unknown,
    userId: number,
    avatarWebpBase64: string | null,
  ) => Promise<number>;
  updateBusinessUserSlotCountById: (db: unknown, userId: number, slotCount: number) => Promise<number>;
};

const readUsersRepoBundle = async (): Promise<UsersRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/business-users'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      createBusinessUser: repo.createBusinessUser as UsersRepoBundle['createBusinessUser'],
      getBusinessUserByUsername: repo.getBusinessUserByUsername as UsersRepoBundle['getBusinessUserByUsername'],
      getBusinessUserByEmail: repo.getBusinessUserByEmail as UsersRepoBundle['getBusinessUserByEmail'],
      getBusinessUserById: repo.getBusinessUserById as UsersRepoBundle['getBusinessUserById'],
      getBusinessUserByAuthKey: repo.getBusinessUserByAuthKey as UsersRepoBundle['getBusinessUserByAuthKey'],
      verifyBusinessUserLoginByUsernameAndAuthKey: repo.verifyBusinessUserLoginByUsernameAndAuthKey as UsersRepoBundle['verifyBusinessUserLoginByUsernameAndAuthKey'],
      touchBusinessUserLastLoginAt: repo.touchBusinessUserLastLoginAt as UsersRepoBundle['touchBusinessUserLastLoginAt'],
      updateBusinessUserAuthKey: repo.updateBusinessUserAuthKey as UsersRepoBundle['updateBusinessUserAuthKey'],
      getBusinessUserProfileCardById: repo.getBusinessUserProfileCardById as UsersRepoBundle['getBusinessUserProfileCardById'],
      getBusinessUserProfileById: repo.getBusinessUserProfileById as UsersRepoBundle['getBusinessUserProfileById'],
      updateBusinessUserSignatureById: repo.updateBusinessUserSignatureById as UsersRepoBundle['updateBusinessUserSignatureById'],
      updateBusinessUserAvatarWebpBase64ById: repo.updateBusinessUserAvatarWebpBase64ById as UsersRepoBundle['updateBusinessUserAvatarWebpBase64ById'],
      updateBusinessUserSlotCountById: repo.updateBusinessUserSlotCountById as UsersRepoBundle['updateBusinessUserSlotCountById'],
    };
  } catch {
    return null;
  }
};

const toNullableString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const toInteger = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return null;
};

const mapBusinessUserToLegacyRow = (row: any): any => {
  if (!row || typeof row !== 'object') return null;

  return {
    id: toInteger(row.id),
    username: typeof row.username === 'string' ? row.username : null,
    email: typeof row.email === 'string' ? row.email : null,
    auth_key: toNullableString(row.authKey),
    prefix: toNullableString(row.prefix),
    is_banned: toNullableString(row.isBanned),
    is_admin: toInteger(row.isAdmin),
    is_review_exempt: toInteger(row.isReviewExempt),
    slot_count: toInteger(row.slotCount),
    signature: toNullableString(row.signature),
    avatar_webp_base64: toNullableString(row.avatarWebpBase64),
    created_at: toNullableString(row.createdAt),
    updated_at: toNullableString(row.updatedAt),
    last_login_at: toNullableString(row.lastLoginAt),
  };
};

// 创建用户
export async function createUser(username: string, email: string, authKey: string): Promise<number | null> {
  try {
    const bundle = await readUsersRepoBundle();
    if (!bundle) return null;

    const row = await bundle.createBusinessUser(bundle.db, { username, email, authKey });
    const userId = toInteger(row?.id);
    return userId && userId > 0 ? userId : null;
  } catch (error) {
    console.error('创建用户失败:', error);
    return null;
  }
}

// 根据用户名查找用户
export async function getUserByUsername(username: string): Promise<any> {
  try {
    const bundle = await readUsersRepoBundle();
    if (!bundle) return null;
    const row = await bundle.getBusinessUserByUsername(bundle.db, username);
    return mapBusinessUserToLegacyRow(row);
  } catch (error) {
    console.error('查找用户失败:', error);
    return null;
  }
}

// 根据邮箱查找用户
export async function getUserByEmail(email: string): Promise<any> {
  try {
    const bundle = await readUsersRepoBundle();
    if (!bundle) return null;
    const row = await bundle.getBusinessUserByEmail(bundle.db, email);
    return mapBusinessUserToLegacyRow(row);
  } catch (error) {
    console.error('根据邮箱查找用户失败:', error);
    return null;
  }
}

// 根据用户 ID 查找用户
export async function getUserById(userId: number): Promise<any> {
  try {
    const bundle = await readUsersRepoBundle();
    if (!bundle) return null;
    const row = await bundle.getBusinessUserById(bundle.db, userId);
    return mapBusinessUserToLegacyRow(row);
  } catch (error) {
    console.error('根据用户ID查找用户失败:', error);
    return null;
  }
}

// 根据认证密钥查找用户
export async function getUserByAuthKey(authKey: string): Promise<any> {
  try {
    const bundle = await readUsersRepoBundle();
    if (!bundle) return null;
    const row = await bundle.getBusinessUserByAuthKey(bundle.db, authKey);
    return mapBusinessUserToLegacyRow(row);
  } catch (error) {
    console.error('查找用户失败:', error);
    return null;
  }
}

export async function verifyUserLogin(username: string, authKey: string): Promise<any> {
  try {
    const bundle = await readUsersRepoBundle();
    if (!bundle) return null;

    const user = await bundle.verifyBusinessUserLoginByUsernameAndAuthKey(bundle.db, username, authKey);
    if (!user) return null;

    await bundle.touchBusinessUserLastLoginAt(bundle.db, user.id);

    return {
      id: user.id,
      username: user.username,
      prefix: user.prefix,
    };
  } catch (error) {
    console.error('验证登录失败:', error);
    return null;
  }
}

// 重置用户登录密钥（用于找回流程）
export async function updateUserAuthKey(userId: number, nextAuthKey: string): Promise<boolean> {
  try {
    const normalizedKey = typeof nextAuthKey === 'string' ? nextAuthKey.trim() : '';
    if (!Number.isSafeInteger(userId) || userId <= 0 || !normalizedKey) {
      return false;
    }

    const bundle = await readUsersRepoBundle();
    if (!bundle) return false;

    const current = await bundle.getBusinessUserById(bundle.db, userId);
    if (!current) return false;
    if (typeof current.authKey === 'string' && current.authKey === normalizedKey) {
      return false;
    }

    const updated = await bundle.updateBusinessUserAuthKey(bundle.db, userId, normalizedKey);
    return Boolean(updated);
  } catch (error) {
    console.error('更新用户登录密钥失败:', error);
    return false;
  }
}

export async function getUserProfileCardRowByUserId(userId: number): Promise<UserProfileCardRow | null> {
  try {
    const bundle = await readUsersRepoBundle();
    if (!bundle) return null;

    const row = await bundle.getBusinessUserProfileCardById(bundle.db, userId);
    if (!row) return null;

    return {
      id: row.id,
      username: row.username,
      prefix: row.prefix,
      created_at: row.createdAt ?? '',
      signature: row.signature,
      avatar_webp_base64: row.avatarWebpBase64,
    };
  } catch (error) {
    console.error('获取用户资料卡信息失败:', error);
    return null;
  }
}

export async function getUserProfileByUserId(userId: number): Promise<UserProfileRow | null> {
  try {
    const bundle = await readUsersRepoBundle();
    if (!bundle) return null;

    const row = await bundle.getBusinessUserProfileById(bundle.db, userId);
    if (!row) return null;

    return {
      signature: row.signature,
      avatar_webp_base64: row.avatarWebpBase64,
    };
  } catch (error) {
    console.error('获取用户个人资料失败:', error);
    return null;
  }
}

export async function updateUserSignature(userId: number, signature: string | null): Promise<boolean> {
  try {
    const bundle = await readUsersRepoBundle();
    if (!bundle) return false;
    const affected = await bundle.updateBusinessUserSignatureById(bundle.db, userId, signature);
    return affected > 0;
  } catch (error) {
    console.error('更新用户签名失败:', error);
    return false;
  }
}

export async function updateUserAvatarWebpBase64(userId: number, avatarWebpBase64: string | null): Promise<boolean> {
  try {
    const bundle = await readUsersRepoBundle();
    if (!bundle) return false;
    const affected = await bundle.updateBusinessUserAvatarWebpBase64ById(bundle.db, userId, avatarWebpBase64);
    return affected > 0;
  } catch (error) {
    console.error('更新用户头像失败:', error);
    return false;
  }
}

// 获取用户数据卡容量限制
export async function getUserDataCardCapacity(userId: number, defaultCapacity: number): Promise<number> {
  try {
    const bundle = await readUsersRepoBundle();
    if (!bundle) return defaultCapacity;

    const user = await bundle.getBusinessUserById(bundle.db, userId);
    if (!user) return defaultCapacity;

    const slotCount = toInteger(user.slotCount);
    return slotCount && slotCount > 0 ? slotCount : defaultCapacity;
  } catch (error) {
    console.error('获取用户数据卡容量失败:', error);
    return defaultCapacity;
  }
}

// 增加用户的槽位数量
export async function increaseUserSlotCount(userId: number, increaseBy: number): Promise<boolean> {
  try {
    const bundle = await readUsersRepoBundle();
    if (!bundle) return false;

    const user = await bundle.getBusinessUserById(bundle.db, userId);
    if (!user) return false;

    const currentSlotCount = toInteger(user.slotCount) ?? 0;
    const newSlotCount = currentSlotCount + increaseBy;

    const affected = await bundle.updateBusinessUserSlotCountById(bundle.db, userId, newSlotCount);
    return affected > 0;
  } catch (error) {
    console.error('增加用户槽位数量失败:', error);
    return false;
  }
}
