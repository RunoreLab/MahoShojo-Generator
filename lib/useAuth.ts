import { useState, useEffect } from 'react';
import { authApi, authStorage } from './auth';
import { getUserBadges } from './userBadges';
import type { UserBadge } from '@/types/badge';

export interface User {
  id: number;
  username: string;
  prefix?: string | null;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userBadges, setUserBadges] = useState<UserBadge[]>([]);
  const [badgesLoading, setBadgesLoading] = useState(false);

  // 加载用户徽章
  const loadUserBadges = async () => {
    setBadgesLoading(true);
    try {
      const badges = await getUserBadges();
      setUserBadges(badges);
    } finally {
      setBadgesLoading(false);
    }
  };

  // 初始化时验证登录状态
  useEffect(() => {
    const checkAuth = async () => {
      const legacyAuth = await authStorage.getAuth();
      const result = await authApi.verify();

      if (result.success && result.user) {
        setUser(result.user);
        if (Array.isArray(result.badges)) {
          setUserBadges(result.badges);
          setBadgesLoading(false);
        } else {
          await loadUserBadges();
        }
      } else {
        if (legacyAuth) {
          authStorage.clearAuth();
        }
        setBadgesLoading(false);
      }

      setLoading(false);
    };

    checkAuth();
  }, []);

  // 注册
  const register = async (username: string, email: string, turnstileToken: string, password?: string) => {
    const result = await authApi.register(username, email, turnstileToken, password);
    if (result.success) {
      // 注册成功后自动验证登录
      const verifyResult = await authApi.verify();
      if (verifyResult.success && verifyResult.user) {
        setUser(verifyResult.user);
        if (Array.isArray(verifyResult.badges)) {
          setUserBadges(verifyResult.badges);
        } else {
          void loadUserBadges();
        }
      }
    }
    return result;
  };

  // 登录
  const login = async (
    identifier: string,
    credential: string,
    turnstileToken: string,
    mode: 'password' | 'legacy' = 'password',
  ) => {
    const result = await authApi.login(identifier, credential, turnstileToken, mode);
    if (result.success && result.user) {
      setUser(result.user);
      // 加载用户徽章
      await loadUserBadges();
    }
    return result;
  };

  // 退出登录
  const logout = async () => {
    await authApi.logout();
    setUser(null);
    setUserBadges([]);
    setBadgesLoading(false);
  };

  // 重新加载徽章（用于徽章更新后刷新）
  const refreshBadges = async () => {
    await loadUserBadges();
  };

  return {
    user,
    userBadges,
    loading,
    isAuthenticated: !!user,
    badgesLoading,
    register,
    login,
    logout,
    refreshBadges
  };
}
