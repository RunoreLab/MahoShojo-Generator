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
  const response = await authStorage.fetch('/api/me/account/migration-status', {
    method: 'GET',
  });
  const data = (await response.json().catch(() => ({}))) as Partial<AuthMigrationResponse> & { error?: string };
  if (!response.ok || !data.success || !data.status) {
    throw new Error(data.error || '读取迁移状态失败');
  }

  return data.status;
};
