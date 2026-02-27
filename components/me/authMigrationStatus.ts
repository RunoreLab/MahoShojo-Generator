'use client';

import { authStorage } from '@/lib/auth';

export type AuthMigrationStatus = {
  hasAuthLink: boolean;
  authUserId: string | null;
  hasPassword: boolean;
  emailVerified: boolean;
  authSource: 'better-auth-session' | 'legacy-bearer';
  migrationRequired: boolean;
  legacyOnly: boolean;
};

type AuthMigrationResponse = {
  success: boolean;
  status: AuthMigrationStatus;
};

export const loadAuthMigrationStatus = async (): Promise<AuthMigrationStatus> => {
  const authHeader = await authStorage.getAuthHeader();
  if (!authHeader) throw new Error('未登录');

  const response = await fetch('/api/me/account/migration-status', {
    method: 'GET',
    headers: {
      Authorization: authHeader,
    },
  });
  const data = (await response.json().catch(() => ({}))) as Partial<AuthMigrationResponse> & { error?: string };
  if (!response.ok || !data.success || !data.status) {
    throw new Error(data.error || '读取迁移状态失败');
  }

  return data.status;
};
