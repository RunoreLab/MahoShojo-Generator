import { useEffect, useSyncExternalStore } from 'react';

import {
  ensureAuthState,
  getAuthSnapshot,
  loginAndSyncAuthState,
  logoutAndSyncAuthState,
  refreshAuthBadges,
  registerAndSyncAuthState,
  subscribeAuthSnapshot,
} from '@/lib/auth-client-store';

export type { User } from '@/lib/auth-client-store';

export function useAuth() {
  const snapshot = useSyncExternalStore(subscribeAuthSnapshot, getAuthSnapshot, getAuthSnapshot);

  useEffect(() => {
    void ensureAuthState();
  }, []);

  return {
    user: snapshot.user,
    userBadges: snapshot.userBadges,
    loading: snapshot.loading,
    isAuthenticated: !!snapshot.user,
    badgesLoading: snapshot.badgesLoading,
    register: registerAndSyncAuthState,
    login: loginAndSyncAuthState,
    logout: logoutAndSyncAuthState,
    refreshBadges: refreshAuthBadges,
  };
}
