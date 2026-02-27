'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { authStorage } from '@/lib/auth';

type AuthMigrationStatus = {
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

const loadMigrationStatus = async (): Promise<AuthMigrationStatus> => {
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

export function AuthMigrationPanel({ userId }: { userId: number | null }) {
  const query = useQuery({
    queryKey: ['me-auth-migration', userId],
    enabled: Boolean(userId),
    queryFn: loadMigrationStatus,
    staleTime: 20_000,
  });

  const status = query.data ?? null;
  const showPanel = Boolean(status && (status.migrationRequired || status.legacyOnly));

  const tip = useMemo(() => {
    if (!status) return '';
    if (!status.hasAuthLink) {
      return '你的账号还未完成新版认证映射，请先完成一次密码登录。';
    }
    if (!status.hasPassword) {
      return '你当前仍依赖旧版密钥登录。请尽快设置密码，避免未来旧版登录下线后无法直接登录。';
    }
    if (status.authSource === 'legacy-bearer') {
      return '你本次使用的是旧版密钥登录。建议改用密码登录，并在账号设置中完成迁移。';
    }
    return '建议继续完成账号迁移步骤，保证后续登录体验与安全能力完整。';
  }, [status]);

  if (!userId) return null;

  if (query.isLoading) {
    return (
      <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
        正在检查账号迁移状态...
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        无法读取账号迁移状态：{query.error instanceof Error ? query.error.message : '未知错误'}
      </div>
    );
  }

  if (!showPanel || !status) return null;

  return (
    <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
      <div className="font-semibold">账号迁移提醒</div>
      <div className="mt-2">{tip}</div>
      <div className="mt-2 text-xs text-yellow-800">
        当前状态：
        {!status.hasAuthLink ? ' 未映射新版账号；' : ' 已映射新版账号；'}
        {!status.hasPassword ? ' 未设置密码；' : ' 已设置密码；'}
        {status.emailVerified ? ' 邮箱已验证。' : ' 邮箱未验证。'}
      </div>
    </div>
  );
}
