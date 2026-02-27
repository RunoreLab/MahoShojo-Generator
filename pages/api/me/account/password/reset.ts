import {
  appendSetCookieHeaders,
  extractErrorMessage,
  invokeBetterAuthSubrequest,
  readJsonSafely,
} from '@/lib/auth/better-auth-subrequest';
import { recordAuthAuditLog } from '@/lib/auth/auth-audit';
import { getPasswordPolicySummaryMessage, validatePasswordPolicy } from '@/lib/auth/password-policy';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getBusinessUserById } from '@/lib/db/repositories/business-users';
import { getAuthMigrationStatusByBusinessUserId } from '@/lib/db/repositories/user-auth-links';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type ResetPasswordPayload = {
  token?: unknown;
  newPassword?: unknown;
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const mapBetterAuthResetPasswordError = (message: string): string => {
  const normalized = message.trim().toUpperCase();
  if (!normalized) return '重置密码失败，请稍后重试';
  if (normalized.includes('INVALID_TOKEN')) return '重置令牌无效或已过期，请重新发起找回流程';
  if (normalized.includes('PASSWORD_TOO_SHORT')) return '新密码长度不足';
  if (normalized.includes('PASSWORD_TOO_LONG')) return '新密码长度过长';
  return message;
};

export default withPvpErrorBoundary(async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;
  const auditSource = auth.source === 'legacy-bearer' ? 'legacy' : 'better-auth';

  const parsed = await readJson<ResetPasswordPayload>(req);
  if ('response' in parsed) return parsed.response;

  const token = toNonEmptyString(parsed.data.token);
  const newPassword = toNonEmptyString(parsed.data.newPassword);
  if (!token || !newPassword) {
    await recordAuthAuditLog({
      req,
      eventType: 'password_reset',
      authSource: auditSource,
      businessUserId: auth.user.id,
      resultCode: 'INVALID_PAYLOAD',
    });
    return json({ error: '重置令牌和新密码不能为空' }, { status: 400 });
  }

  const db = getDrizzleDbFromRuntime();
  if (!db) return json({ error: '数据库不可用，请稍后重试' }, { status: 503 });

  const businessUser = await getBusinessUserById(db, auth.user.id);
  const passwordPolicy = validatePasswordPolicy(newPassword, {
    username: auth.user.username,
    email: businessUser?.email ?? null,
  });
  if (!passwordPolicy.ok) {
    await recordAuthAuditLog({
      req,
      eventType: 'password_reset',
      authSource: auditSource,
      businessUserId: auth.user.id,
      resultCode: 'PASSWORD_POLICY_FAILED',
      resultMessage: getPasswordPolicySummaryMessage(passwordPolicy.issues) || '新密码强度不足',
    });
    return json({ error: getPasswordPolicySummaryMessage(passwordPolicy.issues) || '新密码强度不足' }, { status: 400 });
  }

  let response: Response;
  try {
    response = await invokeBetterAuthSubrequest({
      req,
      path: '/api/auth/reset-password',
      body: {
        token,
        newPassword,
      },
    });
  } catch (error) {
    console.error('[me/account/password/reset] Better Auth 子请求失败:', error);
    await recordAuthAuditLog({
      req,
      eventType: 'password_reset',
      authSource: auditSource,
      businessUserId: auth.user.id,
      resultCode: 'BRIDGE_UNAVAILABLE',
    });
    return json({ error: '重置密码当前不可用，请稍后重试' }, { status: 503 });
  }

  const payload = await readJsonSafely<{ error?: string; message?: string }>(response);
  if (!response.ok) {
    const message = mapBetterAuthResetPasswordError(extractErrorMessage(payload, '重置密码失败'));
    await recordAuthAuditLog({
      req,
      eventType: 'password_reset',
      authSource: auditSource,
      businessUserId: auth.user.id,
      resultCode: 'RESET_PASSWORD_REJECTED',
      resultMessage: message,
    });
    return json({ error: message }, { status: response.status || 400 });
  }

  const headers = new Headers();
  appendSetCookieHeaders(headers, response.headers);

  const latestStatus = await getAuthMigrationStatusByBusinessUserId(db, auth.user.id);
  const migrationRequired = !latestStatus.hasAuthLink || !latestStatus.hasPassword;
  const legacyOnly = auth.source === 'legacy-bearer' || migrationRequired;

  await recordAuthAuditLog({
    req,
    eventType: 'password_reset',
    authSource: auditSource,
    businessUserId: auth.user.id,
    authUserId: latestStatus.authUserId,
    resultCode: 'SUCCESS',
  });

  return json(
    {
      success: true,
      message: '密码重置成功',
      status: {
        ...latestStatus,
        authSource: auth.source,
        migrationRequired,
        legacyOnly,
      },
    },
    { headers },
  );
});
