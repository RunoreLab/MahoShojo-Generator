import {
  appendSetCookieHeaders,
  extractErrorMessage,
  invokeBetterAuthSubrequest,
  readJsonSafely,
} from '@/lib/auth/better-auth-subrequest';
import { recordAuthAuditLog } from '@/lib/auth/auth-audit';
import { mapChangePasswordError } from '@/lib/auth/error-message';
import { getPasswordPolicySummaryMessage, validatePasswordPolicy } from '@/lib/auth/password-policy';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getBusinessUserById } from '@/lib/db/repositories/business-users';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

type ChangePasswordPayload = {
  currentPassword?: unknown;
  newPassword?: unknown;
  revokeOtherSessions?: unknown;
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  return undefined;
};

export default withPvpErrorBoundary(async function handler(req: Request): Promise<Response> {
  if (req.method !== 'PUT') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;
  const auditSource = auth.source === 'legacy-bearer' ? 'legacy' : 'better-auth';

  if (auth.source === 'legacy-bearer') {
    await recordAuthAuditLog({
      req,
      eventType: 'password_change',
      authSource: auditSource,
      businessUserId: auth.user.id,
      resultCode: 'LEGACY_SESSION_BLOCKED',
    });
    return json({ error: '你当前使用旧密钥登录，请先改用密码登录后再修改密码' }, { status: 409 });
  }

  const parsed = await readJson<ChangePasswordPayload>(req);
  if ('response' in parsed) return parsed.response;

  const currentPassword = toNonEmptyString(parsed.data.currentPassword);
  const newPassword = toNonEmptyString(parsed.data.newPassword);
  const revokeOtherSessions = toBoolean(parsed.data.revokeOtherSessions);

  if (!currentPassword || !newPassword) {
    await recordAuthAuditLog({
      req,
      eventType: 'password_change',
      authSource: auditSource,
      businessUserId: auth.user.id,
      resultCode: 'INVALID_PAYLOAD',
    });
    return json({ error: '当前密码和新密码不能为空' }, { status: 400 });
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
      eventType: 'password_change',
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
      path: '/api/auth/change-password',
      body: {
        currentPassword,
        newPassword,
        ...(revokeOtherSessions !== undefined ? { revokeOtherSessions } : {}),
      },
    });
  } catch (error) {
    console.error('[me/account/password] Better Auth 子请求失败:', error);
    await recordAuthAuditLog({
      req,
      eventType: 'password_change',
      authSource: auditSource,
      businessUserId: auth.user.id,
      resultCode: 'BRIDGE_UNAVAILABLE',
    });
    return json({ error: '修改密码当前不可用，请稍后重试' }, { status: 503 });
  }

  const payload = await readJsonSafely<{ error?: string; message?: string }>(response);
  if (!response.ok) {
    const message = mapChangePasswordError(extractErrorMessage(payload, '修改密码失败'));
    await recordAuthAuditLog({
      req,
      eventType: 'password_change',
      authSource: auditSource,
      businessUserId: auth.user.id,
      resultCode: 'CHANGE_PASSWORD_REJECTED',
      resultMessage: message,
    });
    return json({ error: message }, { status: response.status || 400 });
  }

  const headers = new Headers();
  appendSetCookieHeaders(headers, response.headers);

  await recordAuthAuditLog({
    req,
    eventType: 'password_change',
    authSource: auditSource,
    businessUserId: auth.user.id,
    resultCode: 'SUCCESS',
  });

  return json(
    {
      success: true,
      message: '密码修改成功',
    },
    {
      headers,
    },
  );
});
