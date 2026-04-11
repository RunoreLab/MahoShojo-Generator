import { authApi, authStorage } from '@/lib/auth';
import { getUserBadges } from '@/lib/userBadges';
import type { UserBadge } from '@/types/badge';

export interface User {
  id: number;
  username: string;
  prefix?: string | null;
}

export interface AuthSnapshot {
  user: User | null;
  userBadges: UserBadge[];
  loading: boolean;
  badgesLoading: boolean;
}

const createInitialAuthSnapshot = (): AuthSnapshot => ({
  user: null,
  userBadges: [],
  loading: true,
  badgesLoading: false,
});

let authSnapshot = createInitialAuthSnapshot();
let authCheckPromise: Promise<void> | null = null;
const authListeners = new Set<() => void>();

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

const loadAuthUserBadges = async (): Promise<UserBadge[]> => {
  mergeAuthSnapshot({ badgesLoading: true });

  try {
    const badges = await getUserBadges();
    mergeAuthSnapshot({ userBadges: badges });
    return badges;
  } finally {
    mergeAuthSnapshot({ badgesLoading: false });
  }
};

const syncVerifiedAuthState = async (
  result: Awaited<ReturnType<typeof authApi.verify>>,
  fallbackAuthExists: boolean,
) => {
  if (result.success && result.user) {
    mergeAuthSnapshot({
      user: result.user,
      loading: false,
    });

    if (Array.isArray(result.badges)) {
      mergeAuthSnapshot({
        userBadges: result.badges,
        badgesLoading: false,
      });
      return;
    }

    await loadAuthUserBadges();
    return;
  }

  if (fallbackAuthExists) {
    authStorage.clearAuth();
  }

  mergeAuthSnapshot({
    user: null,
    userBadges: [],
    loading: false,
    badgesLoading: false,
  });
};

export const getAuthSnapshot = (): AuthSnapshot => authSnapshot;

export const subscribeAuthSnapshot = (listener: () => void): (() => void) => {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
};

export const ensureAuthState = async (): Promise<void> => {
  if (!authSnapshot.loading) {
    return;
  }

  if (!authCheckPromise) {
    authCheckPromise = (async () => {
      const legacyAuth = await authStorage.getAuth();
      const result = await authApi.verify();
      await syncVerifiedAuthState(result, legacyAuth !== null);
    })().finally(() => {
      authCheckPromise = null;
    });
  }

  await authCheckPromise;
};

export const registerAndSyncAuthState = async (
  username: string,
  email: string,
  turnstileToken: string,
  password: string,
) => {
  const result = await authApi.register(username, email, turnstileToken, password);

  if (result.success) {
    const verifyResult = await authApi.verify();
    await syncVerifiedAuthState(verifyResult, false);
  }

  return result;
};

export const loginAndSyncAuthState = async (
  identifier: string,
  credential: string,
  turnstileToken: string,
  mode: 'password' | 'legacy' = 'password',
) => {
  const result = await authApi.login(identifier, credential, turnstileToken, mode);

  if (result.success && result.user) {
    mergeAuthSnapshot({
      user: result.user,
      loading: false,
    });
    await loadAuthUserBadges();
  }

  return result;
};

export const logoutAndSyncAuthState = async () => {
  await authApi.logout();
  mergeAuthSnapshot({
    user: null,
    userBadges: [],
    loading: false,
    badgesLoading: false,
  });
};

export const refreshAuthBadges = async () => {
  await loadAuthUserBadges();
};

export const resetAuthStoreForTests = () => {
  authSnapshot = createInitialAuthSnapshot();
  authCheckPromise = null;
  emitAuthSnapshot();
};
