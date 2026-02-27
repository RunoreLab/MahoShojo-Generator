'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { loadAuthMigrationStatus } from '@/components/me/authMigrationStatus';
import { authStorage } from '@/lib/auth';
import {
  PASSWORD_MIN_LENGTH,
  evaluatePasswordStrength,
  getPasswordPolicySummaryMessage,
  getPasswordStrengthLabel,
  validatePasswordPolicy,
} from '@/lib/auth/password-policy';

type Notice = {
  type: 'success' | 'error' | 'info';
  text: string;
} | null;

const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const getStrengthBarClassName = (score: number): string => {
  if (score >= 3) return 'bg-green-500';
  if (score >= 2) return 'bg-yellow-500';
  return 'bg-red-500';
};

const authedJson = async <T,>(path: string, method: 'PUT', body: Record<string, unknown>): Promise<T> => {
  const authHeader = await authStorage.getAuthHeader();
  if (!authHeader) throw new Error('未登录');

  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
};

export function AccountSecurityPanel({ userId, username }: { userId: number | null; username: string | null }) {
  const query = useQuery({
    queryKey: ['me-auth-migration', userId],
    enabled: Boolean(userId),
    queryFn: loadAuthMigrationStatus,
    staleTime: 20_000,
  });

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setupNewPassword, setSetupNewPassword] = useState('');
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('');
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [setupNotice, setSetupNotice] = useState<Notice>(null);
  const [passwordNotice, setPasswordNotice] = useState<Notice>(null);
  const [emailNotice, setEmailNotice] = useState<Notice>(null);
  const [isSubmittingSetupPassword, setIsSubmittingSetupPassword] = useState(false);
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
  const [isSubmittingEmail, setIsSubmittingEmail] = useState(false);

  const migrationStatus = query.data ?? null;
  const isLegacySession = migrationStatus?.authSource === 'legacy-bearer';
  const hasPassword = migrationStatus?.hasPassword ?? null;
  const canSetInitialPassword = Boolean(userId) && hasPassword === false;
  const canChangePassword = Boolean(userId) && !isLegacySession && hasPassword === true;
  const canChangeEmail = Boolean(userId) && !isLegacySession;

  const strength = evaluatePasswordStrength(newPassword);
  const strengthPercent = Math.round((strength.score / Math.max(1, strength.maxScore)) * 100);
  const setupStrength = evaluatePasswordStrength(setupNewPassword);
  const setupStrengthPercent = Math.round((setupStrength.score / Math.max(1, setupStrength.maxScore)) * 100);

  const passwordPolicyError = useMemo(() => {
    if (!newPassword) return '';
    const policy = validatePasswordPolicy(newPassword, {
      username: username ?? undefined,
      email: undefined,
    });
    if (policy.ok) return '';
    return getPasswordPolicySummaryMessage(policy.issues);
  }, [newPassword, username]);

  const setupPasswordPolicyError = useMemo(() => {
    if (!setupNewPassword) return '';
    const policy = validatePasswordPolicy(setupNewPassword, {
      username: username ?? undefined,
      email: undefined,
    });
    if (policy.ok) return '';
    return getPasswordPolicySummaryMessage(policy.issues);
  }, [setupNewPassword, username]);

  const handleSetInitialPasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSetupNotice(null);

    if (!setupNewPassword || !setupConfirmPassword) {
      setSetupNotice({ type: 'error', text: '请完整填写密码字段' });
      return;
    }
    if (setupNewPassword !== setupConfirmPassword) {
      setSetupNotice({ type: 'error', text: '两次输入的新密码不一致' });
      return;
    }
    const policy = validatePasswordPolicy(setupNewPassword, {
      username: username ?? undefined,
      email: undefined,
    });
    if (!policy.ok) {
      setSetupNotice({ type: 'error', text: getPasswordPolicySummaryMessage(policy.issues) || '新密码强度不足' });
      return;
    }

    setIsSubmittingSetupPassword(true);
    try {
      const result = await authedJson<{ success: boolean; message?: string }>('/api/me/account/password/set', 'PUT', {
        newPassword: setupNewPassword,
      });
      setSetupNotice({ type: 'success', text: result.message || '登录密码设置成功' });
      setSetupNewPassword('');
      setSetupConfirmPassword('');
      await query.refetch();
    } catch (error) {
      setSetupNotice({ type: 'error', text: error instanceof Error ? error.message : '设置密码失败' });
    } finally {
      setIsSubmittingSetupPassword(false);
    }
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordNotice(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordNotice({ type: 'error', text: '请完整填写密码字段' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordNotice({ type: 'error', text: '两次输入的新密码不一致' });
      return;
    }
    const policy = validatePasswordPolicy(newPassword, {
      username: username ?? undefined,
      email: undefined,
    });
    if (!policy.ok) {
      setPasswordNotice({ type: 'error', text: getPasswordPolicySummaryMessage(policy.issues) || '新密码强度不足' });
      return;
    }

    setIsSubmittingPassword(true);
    try {
      const result = await authedJson<{ success: boolean; message?: string }>('/api/me/account/password', 'PUT', {
        currentPassword,
        newPassword,
        revokeOtherSessions,
      });
      setPasswordNotice({ type: 'success', text: result.message || '密码修改成功' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await query.refetch();
    } catch (error) {
      setPasswordNotice({ type: 'error', text: error instanceof Error ? error.message : '修改密码失败' });
    } finally {
      setIsSubmittingPassword(false);
    }
  };

  const handleEmailSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmailNotice(null);

    const normalized = newEmail.trim().toLowerCase();
    if (!normalized) {
      setEmailNotice({ type: 'error', text: '请输入新邮箱地址' });
      return;
    }
    if (!isValidEmail(normalized)) {
      setEmailNotice({ type: 'error', text: '请输入有效的邮箱地址' });
      return;
    }

    setIsSubmittingEmail(true);
    try {
      const result = await authedJson<{ success: boolean; message?: string; email?: string }>('/api/me/account/email', 'PUT', {
        newEmail: normalized,
      });
      setEmailNotice({
        type: 'success',
        text: result.message || '邮箱更新请求已提交，请留意后续验证邮件',
      });
      setNewEmail('');
      await query.refetch();
    } catch (error) {
      setEmailNotice({ type: 'error', text: error instanceof Error ? error.message : '修改邮箱失败' });
    } finally {
      setIsSubmittingEmail(false);
    }
  };

  if (!userId) {
    return (
      <div className="rounded-2xl border bg-white p-4 text-sm text-gray-700">
        你尚未登录，无法修改账号安全设置。
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border bg-white p-4">
      <div className="font-semibold text-gray-900">账号安全设置</div>
      <div className="mt-1 text-xs text-gray-500">支持修改密码与邮箱。旧密钥登录用户请先完成账号迁移后再操作。</div>

      {query.isLoading ? <div className="mt-3 text-sm text-gray-600">正在读取账号迁移状态...</div> : null}
      {query.isError ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          读取迁移状态失败：{query.error instanceof Error ? query.error.message : '未知错误'}
        </div>
      ) : null}

      {migrationStatus && isLegacySession ? (
        <div className="mt-3 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-900">
          你当前使用的是旧密钥登录。若尚未设置密码，可先在下方设置登录密码；改密码/改邮箱需要切换为密码登录后操作。
        </div>
      ) : null}

      {migrationStatus && hasPassword === false ? (
        <div className="mt-3 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-900">
          检测到当前账号尚未设置密码。请先设置登录密码完成迁移，再进行后续安全设置。
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {canSetInitialPassword ? (
          <form onSubmit={handleSetInitialPasswordSubmit} className="rounded-xl border bg-gray-50 p-3">
            <div className="text-sm font-medium text-gray-900">设置登录密码（迁移）</div>
            <div className="mt-1 text-xs text-gray-500">该操作会为当前账号启用新版密码登录。</div>

            <label className="mt-3 block text-xs text-gray-600">新密码</label>
            <input
              type="password"
              className="input-field mt-1"
              value={setupNewPassword}
              onChange={(event) => setSetupNewPassword(event.target.value)}
              required
              minLength={PASSWORD_MIN_LENGTH}
              disabled={isSubmittingSetupPassword}
            />

            <div className="mt-2 rounded-md border border-gray-200 bg-white p-2">
              <div className="flex items-center justify-between text-[11px] text-gray-600">
                <span>强度</span>
                <span>
                  {getPasswordStrengthLabel(setupStrength.level)}（{setupStrength.score}/{setupStrength.maxScore}）
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-gray-200">
                <div
                  className={`h-full rounded-full transition-all ${getStrengthBarClassName(setupStrength.score)}`}
                  style={{ width: `${setupStrengthPercent}%` }}
                />
              </div>
            </div>
            {setupPasswordPolicyError ? <div className="mt-1 text-xs text-red-600">{setupPasswordPolicyError}</div> : null}

            <label className="mt-3 block text-xs text-gray-600">确认新密码</label>
            <input
              type="password"
              className="input-field mt-1"
              value={setupConfirmPassword}
              onChange={(event) => setSetupConfirmPassword(event.target.value)}
              required
              minLength={PASSWORD_MIN_LENGTH}
              disabled={isSubmittingSetupPassword}
            />

            <button
              type="submit"
              className="mt-3 rounded-lg border bg-white px-3 py-2 text-xs hover:bg-gray-100 disabled:opacity-50"
              disabled={isSubmittingSetupPassword}
            >
              {isSubmittingSetupPassword ? '提交中...' : '设置登录密码'}
            </button>

            {setupNotice ? (
              <div
                className={`mt-2 rounded px-2 py-1 text-xs ${
                  setupNotice.type === 'success'
                    ? 'border border-green-200 bg-green-50 text-green-700'
                    : setupNotice.type === 'info'
                      ? 'border border-blue-200 bg-blue-50 text-blue-700'
                      : 'border border-red-200 bg-red-50 text-red-700'
                }`}
              >
                {setupNotice.text}
              </div>
            ) : null}
          </form>
        ) : (
          <form onSubmit={handlePasswordSubmit} className="rounded-xl border bg-gray-50 p-3">
            <div className="text-sm font-medium text-gray-900">修改密码</div>

            <label className="mt-3 block text-xs text-gray-600">当前密码</label>
            <input
              type="password"
              className="input-field mt-1"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              disabled={!canChangePassword || isSubmittingPassword}
            />

            <label className="mt-3 block text-xs text-gray-600">新密码</label>
            <input
              type="password"
              className="input-field mt-1"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={PASSWORD_MIN_LENGTH}
              disabled={!canChangePassword || isSubmittingPassword}
            />

            <div className="mt-2 rounded-md border border-gray-200 bg-white p-2">
              <div className="flex items-center justify-between text-[11px] text-gray-600">
                <span>强度</span>
                <span>
                  {getPasswordStrengthLabel(strength.level)}（{strength.score}/{strength.maxScore}）
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-gray-200">
                <div
                  className={`h-full rounded-full transition-all ${getStrengthBarClassName(strength.score)}`}
                  style={{ width: `${strengthPercent}%` }}
                />
              </div>
            </div>
            {passwordPolicyError ? <div className="mt-1 text-xs text-red-600">{passwordPolicyError}</div> : null}

            <label className="mt-3 block text-xs text-gray-600">确认新密码</label>
            <input
              type="password"
              className="input-field mt-1"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              minLength={PASSWORD_MIN_LENGTH}
              disabled={!canChangePassword || isSubmittingPassword}
            />

            <label className="mt-3 flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={revokeOtherSessions}
                onChange={(event) => setRevokeOtherSessions(event.target.checked)}
                disabled={!canChangePassword || isSubmittingPassword}
              />
              修改后注销其他会话
            </label>

            <button
              type="submit"
              className="mt-3 rounded-lg border bg-white px-3 py-2 text-xs hover:bg-gray-100 disabled:opacity-50"
              disabled={!canChangePassword || isSubmittingPassword}
            >
              {isSubmittingPassword ? '提交中...' : '保存新密码'}
            </button>

            {passwordNotice ? (
              <div
                className={`mt-2 rounded px-2 py-1 text-xs ${
                  passwordNotice.type === 'success'
                    ? 'border border-green-200 bg-green-50 text-green-700'
                    : passwordNotice.type === 'info'
                      ? 'border border-blue-200 bg-blue-50 text-blue-700'
                      : 'border border-red-200 bg-red-50 text-red-700'
                }`}
              >
                {passwordNotice.text}
              </div>
            ) : null}
          </form>
        )}

        <form onSubmit={handleEmailSubmit} className="rounded-xl border bg-gray-50 p-3">
          <div className="text-sm font-medium text-gray-900">修改邮箱</div>
          <label className="mt-3 block text-xs text-gray-600">新邮箱地址</label>
          <input
            type="email"
            className="input-field mt-1"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            required
            disabled={!canChangeEmail || isSubmittingEmail}
          />
          <div className="mt-2 text-xs text-gray-500">提交后若需要验证，请按邮件指引完成确认。</div>

          <button
            type="submit"
            className="mt-3 rounded-lg border bg-white px-3 py-2 text-xs hover:bg-gray-100 disabled:opacity-50"
            disabled={!canChangeEmail || isSubmittingEmail}
          >
            {isSubmittingEmail ? '提交中...' : '提交改绑邮箱'}
          </button>

          {emailNotice ? (
            <div
              className={`mt-2 rounded px-2 py-1 text-xs ${
                emailNotice.type === 'success'
                  ? 'border border-green-200 bg-green-50 text-green-700'
                  : emailNotice.type === 'info'
                    ? 'border border-blue-200 bg-blue-50 text-blue-700'
                    : 'border border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {emailNotice.text}
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
