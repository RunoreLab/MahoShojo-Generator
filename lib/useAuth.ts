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

  // 加载用户徽章
  const loadUserBadges = async () => {
    const badges = await getUserBadges();
    setUserBadges(badges);
  };

  // 初始化时验证登录状态
  useEffect(() => {
    const checkAuth = async () => {
      const auth = await authStorage.getAuth();
      if (auth) {
        const result = await authApi.verify();
        if (result.success && result.user) {
          setUser(result.user);
          if (Array.isArray(result.badges)) {
            setUserBadges(result.badges);
          } else {
            void loadUserBadges();
          }
        } else {
          authStorage.clearAuth();
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  // 注册
  const register = async (username: string, email: string, turnstileToken: string) => {
    const result = await authApi.register(username, email, turnstileToken);
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
  const login = async (username: string, authKey: string, turnstileToken: string) => {
    const result = await authApi.login(username, authKey, turnstileToken);
    if (result.success && result.user) {
      setUser(result.user);
      // 加载用户徽章
      void loadUserBadges();
    }
    return result;
  };

  // 退出登录
  const logout = () => {
    authApi.logout();
    setUser(null);
    setUserBadges([]);
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
    register,
    login,
    logout,
    refreshBadges
  };
}
