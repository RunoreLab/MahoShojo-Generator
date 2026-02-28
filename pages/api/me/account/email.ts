import {
  appendSetCookieHeaders,
  extractErrorMessage,
  invokeBetterAuthSubrequest,
  readJsonSafely,
} from '@/lib/auth/better-auth-subrequest';
import { guardMailSendByAudit } from '@/lib/auth/mail-send-guard';
import { recordAuthAuditLog } from '@/lib/auth/auth-audit';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getBusinessUserById, updateBusinessUserEmailById } from '@/lib/db/repositories/business-users';
import {
  getAuthUserProfileByAuthUserId,
  getUserAuthLinkByBusinessUserId,
} from '@/lib/db/repositories/user-auth-links';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type ChangeEmailPayload = {
  newEmail?: unknown;
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const mapBetterAuthEmailError = (message: string): string => {
  const normalized = message.trim().toUpperCase();
  if (!normalized) return '修改邮箱失败，请稍后重试';
  if (normalized.includes('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL')) return '该邮箱已被占用';
  if (normalized.includes('CHANGE EMAIL IS DISABLED')) return '当前环境暂未开启改绑邮箱';
  if (normalized.includes('EMAIL IS THE SAME')) return '新邮箱不能与当前邮箱相同';
  return message;
};

export default withPvpErrorBoundary(async function handler(req: Request): Promise<Response> {
  if (req.method !== 'PUT') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;
  const auditSource = auth.source === 'legacy-bearer' ? 'legacy' : 'better-auth';

  if (auth.source === 'legacy-bearer') {
    await recordAuthAuditLog({
      req,
      eventType: 'email_change',
      authSource: auditSource,
      businessUserId: auth.user.id,
      resultCode: 'LEGACY_SESSION_BLOCKED',
    });
    return json({ error: '你当前使用旧密钥登录，请先改用密码登录后再修改邮箱' }, { status: 409 });
  }

  const parsed = await readJson<ChangeEmailPayload>(req);
  if ('response' in parsed) return parsed.response;

  const email = toNonEmptyString(parsed.data.newEmail)?.toLowerCase() ?? null;
  if (!email) {
    await recordAuthAuditLog({
      req,
      eventType: 'email_change',
      authSource: auditSource,
      businessUserId: auth.user.id,
      resultCode: 'INVALID_PAYLOAD',
    });
    return json({ error: '新邮箱不能为空' }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    await recordAuthAuditLog({
      req,
      eventType: 'email_change',
      authSource: auditSource,
      businessUserId: auth.user.id,
      identifierType: 'email',
      resultCode: 'EMAIL_INVALID',
    });
    return json({ error: '请输入有效的邮箱地址' }, { status: 400 });
  }

  const db = getDrizzleDbFromRuntime();
  if (!db) return json({ error: '数据库不可用，请稍后重试' }, { status: 503 });

  const businessUser = await getBusinessUserById(db, auth.user.id);
  if (!businessUser) return json({ error: '用户不存在' }, { status: 404 });
  if (businessUser.email?.toLowerCase() === email) {
    await recordAuthAuditLog({
      req,
      eventType: 'email_change',
      authSource: auditSource,
      businessUserId: auth.user.id,
      identifierType: 'email',
      resultCode: 'EMAIL_SAME',
    });
    return json({ error: '新邮箱不能与当前邮箱相同' }, { status: 400 });
  }

  const guard = await guardMailSendByAudit({
    db,
    req,
    eventType: 'email_change',
    businessUserId: auth.user.id,
    minIntervalSeconds: 30,
    maxPerUserWindow: {
      windowSeconds: 30 * 60,
      max: 3,
    },
    maxPerIpWindow: {
      windowSeconds: 30 * 60,
      max: 12,
    },
  });
  if (!guard.allowed) {
    await recordAuthAuditLog({
      req,
      eventType: 'email_change',
      authSource: auditSource,
      businessUserId: auth.user.id,
      identifierType: 'email',
      resultCode: 'RATE_LIMITED',
      resultMessage: `reason=${guard.reason}`,
      metadata: {
        retryAfterSeconds: guard.retryAfterSeconds,
      },
    });

    const headers = new Headers({
      'Retry-After': String(Math.max(1, guard.retryAfterSeconds)),
    });
    return json(
      {
        error: `请求过于频繁，请在 ${Math.max(1, guard.retryAfterSeconds)} 秒后重试`,
      },
      {
        status: 429,
        headers,
      },
    );
  }

  const requestUrl = new URL(req.url);
  const callbackURL = new URL('/me', requestUrl.origin).toString();
  let response: Response;
  try {
    response = await invokeBetterAuthSubrequest({
      req,
      path: '/api/auth/change-email',
      body: {
        newEmail: email,
        callbackURL,
      },
    });
  } catch (error) {
    console.error('[me/account/email] Better Auth 子请求失败:', error);
    await recordAuthAuditLog({
      req,
      eventType: 'email_change',
      authSource: auditSource,
      businessUserId: auth.user.id,
      identifierType: 'email',
      resultCode: 'BRIDGE_UNAVAILABLE',
    });
    return json({ error: '改绑邮箱当前不可用，请稍后重试' }, { status: 503 });
  }

  const payload = await readJsonSafely<{ error?: string; message?: string }>(response);
  if (!response.ok) {
    const message = mapBetterAuthEmailError(extractErrorMessage(payload, '修改邮箱失败'));
    await recordAuthAuditLog({
      req,
      eventType: 'email_change',
      authSource: auditSource,
      businessUserId: auth.user.id,
      identifierType: 'email',
      resultCode: 'CHANGE_EMAIL_REJECTED',
      resultMessage: message,
    });
    return json({ error: message }, { status: response.status || 400 });
  }

  const link = await getUserAuthLinkByBusinessUserId(db, auth.user.id);
  if (link) {
    const authProfile = await getAuthUserProfileByAuthUserId(db, link.authUserId);
    const syncEmail = authProfile?.email ?? email;
    if (syncEmail !== businessUser.email.toLowerCase()) {
      await updateBusinessUserEmailById(db, auth.user.id, syncEmail);
    }
  } else {
    await updateBusinessUserEmailById(db, auth.user.id, email);
  }

  const headers = new Headers();
  appendSetCookieHeaders(headers, response.headers);

  await recordAuthAuditLog({
    req,
    eventType: 'email_change',
    authSource: auditSource,
    businessUserId: auth.user.id,
    identifierType: 'email',
    resultCode: 'SUCCESS',
  });

  return json(
    {
      success: true,
      message: '邮箱更新请求已提交',
      email,
    },
    {
      headers,
    },
  );
});
