import { authApi, authStorage, type AuthSessionSource } from '@/lib/auth';
import { completePasskeyLogin, requestPasskeyLoginAssertion } from '@/lib/auth/passkey-client';
import { getUserBadges } from '@/lib/userBadges';
import type { UserBadge } from '@/types/badge';
import { AuthStorageError, beginAuthIdentityTransition, captureAuthIdentity, checkAuthIdentityOwner, subscribeAuthIdentity, type AuthIdentityOwner } from '@/lib/auth-identity';

export interface User {
  id: number;
  username: string;
  prefix?: string | null;
}

export interface AuthSnapshot {
  identityEpoch: number;
  user: User | null;
  userBadges: UserBadge[];
  loading: boolean;
  badgesLoading: boolean;
  /**
   * 当前身份的凭据来源。`better-auth-session` 才可用于桌面端 native grant；
   * `legacy-bearer`（旧版密钥）与 null 均不可。
   */
  authSource: AuthSessionSource | null;
}

const createInitialAuthSnapshot = (): AuthSnapshot => ({
  identityEpoch: captureAuthIdentity().epoch,
  user: null,
  userBadges: [],
  loading: true,
  badgesLoading: false,
  authSource: null,
});

const authModeToSessionSource = (
  authMode: 'better-auth' | 'legacy' | undefined,
): AuthSessionSource | null =>
  authMode === 'better-auth'
    ? 'better-auth-session'
    : authMode === 'legacy'
      ? 'legacy-bearer'
      : null;

let authSnapshot = createInitialAuthSnapshot();
let authCheck: { owner: AuthIdentityOwner; promise: Promise<void> } | null = null;
const authListeners = new Set<() => void>();
let activeTransition: AuthIdentityOwner | null = null;

const emitAuthSnapshot = () => {
  for (const listener of authListeners) {
    listener();
  }
};

const updateAuthSnapshot = (updater: AuthSnapshot | ((current: AuthSnapshot) => AuthSnapshot)) => {
  authSnapshot = typeof updater === 'function' ? updater(authSnapshot) : updater;
  emitAuthSnapshot();
};

const mergeAuthSnapshot = (patch: Partial<AuthSnapshot>) => {
  updateAuthSnapshot((current) => ({
    ...current,
    ...patch,
  }));
};

const loadAuthUserBadges = async (owner: AuthIdentityOwner): Promise<UserBadge[]> => {
  if (!checkAuthIdentityOwner(owner)) return [];
  mergeAuthSnapshot({ badgesLoading: true });

  try {
    const badges = await getUserBadges();
    if (!checkAuthIdentityOwner(owner)) return [];
    mergeAuthSnapshot({ userBadges: badges });
    return badges;
  } finally {
    if (owner.identity.isCurrent()) mergeAuthSnapshot({ badgesLoading: false });
  }
};

const syncVerifiedAuthState = async (
  result: Awaited<ReturnType<typeof authApi.verify>>,
  fallbackAuthExists: boolean,
  owner: AuthIdentityOwner,
) => {
  if (!checkAuthIdentityOwner(owner)) return;
  if (result.success && result.user) {
    mergeAuthSnapshot({
      identityEpoch: owner.identity.epoch,
      user: result.user,
      loading: false,
      authSource: result.authSource ?? null,
    });

    if (Array.isArray(result.badges)) {
      mergeAuthSnapshot({
        userBadges: result.badges,
        badgesLoading: false,
      });
      return;
    }

    await loadAuthUserBadges(owner);
    return;
  }

  if (fallbackAuthExists) {
    authStorage.clearAuth(owner);
    if (!checkAuthIdentityOwner(owner)) return;
  }

  mergeAuthSnapshot({
    identityEpoch: owner.identity.epoch,
    user: null,
    userBadges: [],
    loading: false,
    badgesLoading: false,
    authSource: null,
  });
};

export const getAuthSnapshot = (): AuthSnapshot => authSnapshot;

export const subscribeAuthSnapshot = (listener: () => void): (() => void) => {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
};

// 存储事件先同步撤销所有共享消费者；自身提交由其 owner 完成本轮验证，避免递归 ensure。
subscribeAuthIdentity((event) => {
  authCheck = null;
  if (activeTransition && !activeTransition.identity.isCurrent()) activeTransition = null;
  authSnapshot = {
    ...authSnapshot,
    identityEpoch: event.identity.epoch,
    user: null,
    userBadges: [],
    loading: event.reason !== 'unavailable',
    badgesLoading: false,
    authSource: null,
  };
  emitAuthSnapshot();
  if ((event.reason === 'external' || event.revalidate) && event.identity.isCurrent() && authListeners.size > 0) {
    void ensureAuthState();
  }
});

export const ensureAuthState = async (): Promise<void> => {
  const identity = captureAuthIdentity();
  if (!identity.isCurrent()) {
    mergeAuthSnapshot({ loading: false });
    return;
  }
  if (!authSnapshot.loading || activeTransition?.identity.isCurrent()) return;
  if (!authCheck?.owner.identity.isCurrent()) {
    const owner = { identity, settlesSnapshot: true };
    const entry = {
      owner,
      promise: (async () => {
        try {
          const legacyAuth = await authStorage.getAuth();
          if (!checkAuthIdentityOwner(owner)) return;
          const result = await authApi.verify({ owner });
          await syncVerifiedAuthState(result, legacyAuth !== null, owner);
        } catch {
          if (owner.identity.isCurrent()) await syncVerifiedAuthState({ success: false }, false, owner);
        }
      })(),
    };
    authCheck = entry;
    try {
      await entry.promise;
    } finally {
      if (authCheck === entry) authCheck = null;
    }
    return;
  }
  await authCheck.promise;
};

const finishAuthResult = <T extends { success: boolean; error?: string }>(owner: AuthIdentityOwner, result: T) => {
  try {
    if (checkAuthIdentityOwner(owner)) return result;
  } catch (error) {
    if (!(error instanceof AuthStorageError)) throw error;
  }
  if (owner.failure?.isCurrent()) return { success: false as const, error: owner.failure.message };
  return { success: false as const, error: '登录身份已变化，请重试' };
};

const beginStoreTransition = (): AuthIdentityOwner => {
  const owner = { ...beginAuthIdentityTransition(), settlesSnapshot: true };
  activeTransition = owner;
  return owner;
};
const restoreAfterFailedTransition = async (owner: AuthIdentityOwner) => {
  if (!checkAuthIdentityOwner(owner)) return;
  const result = await authApi.verify({ owner });
  await syncVerifiedAuthState(result, false, owner);
};

export const registerAndSyncAuthState = async (
  username: string,
  email: string,
  turnstileToken: string,
  password: string,
) => {
  const owner = beginStoreTransition();
  try {
    const result = await authApi.register(username, email, turnstileToken, password, owner);
    if (!owner.identity.isCurrent()) return finishAuthResult(owner, result);
    const verifyResult = await authApi.verify({ owner });
    await syncVerifiedAuthState(verifyResult, false, owner);
    return finishAuthResult(owner, result);
  } catch (error) {
    if (!(error instanceof AuthStorageError)) throw error;
    return finishAuthResult(owner, { success: false, error: error.message });
  } finally {
    if (activeTransition === owner) activeTransition = null;
    if (owner.identity.isCurrent()) mergeAuthSnapshot({ loading: false });
  }
};

export const loginAndSyncAuthState = async (
  identifier: string,
  credential: string,
  turnstileToken: string,
  mode: 'password' | 'legacy' = 'password',
): Promise<Awaited<ReturnType<typeof authApi.login>>> => {
  const owner = beginStoreTransition();
  try {
    const result = await authApi.login(identifier, credential, turnstileToken, mode, owner);
    if (!owner.identity.isCurrent()) return finishAuthResult(owner, result);
    if (result.success && result.user) {
      const storedAuth = await authStorage.getAuth();
      if (!owner.identity.isCurrent()) return finishAuthResult(owner, result);
      if (!storedAuth?.authKey) {
        const verified = await authApi.verify({ owner });
        await syncVerifiedAuthState(verified, false, owner);
        return finishAuthResult(owner, result);
      }
      mergeAuthSnapshot({
        identityEpoch: owner.identity.epoch,
        user: result.user,
        loading: false,
        authSource: authModeToSessionSource(result.authMode),
      });
      await loadAuthUserBadges(owner);
    } else {
      await restoreAfterFailedTransition(owner);
    }
    return finishAuthResult(owner, result);
  } catch (error) {
    if (!(error instanceof AuthStorageError)) throw error;
    return finishAuthResult(owner, { success: false, error: error.message });
  } finally {
    if (activeTransition === owner) activeTransition = null;
    if (owner.identity.isCurrent()) mergeAuthSnapshot({ loading: false });
  }
};

export const logoutAndSyncAuthState = async () => {
  const owner = beginStoreTransition();
  try {
    await authApi.logout(owner);
  } catch (error) {
    if (!(error instanceof AuthStorageError) || error.isCurrent()) throw error;
  } finally {
    if (activeTransition === owner) activeTransition = null;
    if (owner.identity.isCurrent()) await syncVerifiedAuthState({ success: false }, false, owner);
  }
};

export const loginWithPasskeyAndSyncAuthState = async (
  signal: AbortSignal,
): Promise<{ success: boolean; error?: string }> => {
  const identity = captureAuthIdentity();
  // 等本机验证完成后再切换身份，关闭弹窗或取消认证不会清除当前登录。
  const assertion = await requestPasskeyLoginAssertion(signal);
  signal.throwIfAborted();
  if (!identity.isCurrent()) return { success: false, error: '登录身份已变化，请重试。' };

  const owner = beginStoreTransition();
  const request = new AbortController();
  const unsubscribe = subscribeAuthIdentity(() => {
    if (!owner.identity.isCurrent()) request.abort();
  });
  try {
    const { userId } = await completePasskeyLogin(assertion, request.signal);
    if (!checkAuthIdentityOwner(owner)) return finishAuthResult(owner, { success: false });
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('未能核对登录账号。');
    const result = await authApi.verify({ owner, expectedSessionUserId: userId });
    await syncVerifiedAuthState(result, false, owner);
    return finishAuthResult(owner, result.success ? { success: true } : {
      success: false, error: '未能确认登录会话，请重试。',
    });
  } catch (error) {
    if (owner.identity.isCurrent()) await restoreAfterFailedTransition(owner);
    return finishAuthResult(owner, {
      success: false, error: error instanceof Error ? error.message : '通行密钥登录失败。',
    });
  } finally {
    unsubscribe();
    if (activeTransition === owner) activeTransition = null;
    if (owner.identity.isCurrent()) mergeAuthSnapshot({ loading: false });
  }
};

export const refreshAuthBadges = async () => {
  const identity = captureAuthIdentity();
  if (!authSnapshot.user || authSnapshot.loading) return;
  try {
    await loadAuthUserBadges({ identity });
  } catch (error) {
    if (!(error instanceof AuthStorageError)) throw error;
  }
};

export const resetAuthStoreForTests = () => {
  authSnapshot = createInitialAuthSnapshot();
  authCheck = null;
  activeTransition = null;
  emitAuthSnapshot();
};
