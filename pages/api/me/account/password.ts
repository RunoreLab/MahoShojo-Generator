import {
  appendSetCookieHeaders,
  extractErrorMessage,
  invokeBetterAuthSubrequest,
  readJsonSafely,
} from '@/lib/auth/better-auth-subrequest';
import { getPasswordPolicySummaryMessage, validatePasswordPolicy } from '@/lib/auth/password-policy';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getBusinessUserById } from '@/lib/db/repositories/business-users';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

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

const mapBetterAuthPasswordError = (message: string): string => {
  const normalized = message.trim().toUpperCase();
  if (!normalized) return '修改密码失败，请稍后重试';
  if (normalized.includes('INVALID_PASSWORD')) return '当前密码错误';
  if (normalized.includes('PASSWORD_TOO_SHORT')) return '新密码长度不足';
  if (normalized.includes('PASSWORD_TOO_LONG')) return '新密码长度过长';
  if (normalized.includes('CREDENTIAL_ACCOUNT_NOT_FOUND')) return '当前账号尚未设置密码，请先完成账号迁移';
  return message;
};

export default withPvpErrorBoundary(async function handler(req: Request): Promise<Response> {
  if (req.method !== 'PUT') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  if (auth.source === 'legacy-bearer') {
    return json({ error: '你当前使用旧密钥登录，请先改用密码登录后再修改密码' }, { status: 409 });
  }

  const parsed = await readJson<ChangePasswordPayload>(req);
  if ('response' in parsed) return parsed.response;

  const currentPassword = toNonEmptyString(parsed.data.currentPassword);
  const newPassword = toNonEmptyString(parsed.data.newPassword);
  const revokeOtherSessions = toBoolean(parsed.data.revokeOtherSessions);

  if (!currentPassword || !newPassword) {
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
    return json({ error: '修改密码当前不可用，请稍后重试' }, { status: 503 });
  }

  const payload = await readJsonSafely<{ error?: string; message?: string }>(response);
  if (!response.ok) {
    const message = mapBetterAuthPasswordError(extractErrorMessage(payload, '修改密码失败'));
    return json({ error: message }, { status: response.status || 400 });
  }

  const headers = new Headers();
  appendSetCookieHeaders(headers, response.headers);

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
