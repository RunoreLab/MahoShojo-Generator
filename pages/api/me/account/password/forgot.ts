import {
  appendSetCookieHeaders,
  extractErrorMessage,
  invokeBetterAuthSubrequest,
  readJsonSafely,
} from '@/lib/auth/better-auth-subrequest';
import { guardMailSendByAudit } from '@/lib/auth/mail-send-guard';
import { recordAuthAuditLog } from '@/lib/auth/auth-audit';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getBusinessUserById } from '@/lib/db/repositories/business-users';
import { getUserAuthLinkByBusinessUserId } from '@/lib/db/repositories/user-auth-links';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type RequestPasswordResetPayload = {
  redirectTo?: unknown;
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const mapBetterAuthRequestResetError = (message: string): string => {
  const normalized = message.trim().toUpperCase();
  if (!normalized) return '发送重置邮件失败，请稍后重试';
  if (normalized.includes("RESET PASSWORD ISN'T ENABLED")) return '当前环境暂未开启密码找回能力';
  return message;
};

export default withPvpErrorBoundary(async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;
  const auditSource = auth.source === 'legacy-bearer' ? 'legacy' : 'better-auth';

  const parsed = await readJson<RequestPasswordResetPayload>(req);
  if ('response' in parsed) return parsed.response;

  const db = getDrizzleDbFromRuntime();
  if (!db) return json({ error: '数据库不可用，请稍后重试' }, { status: 503 });

  const businessUser = await getBusinessUserById(db, auth.user.id);
  if (!businessUser) return json({ error: '用户不存在' }, { status: 404 });

  const normalizedEmail = toNonEmptyString(businessUser.email)?.toLowerCase() ?? null;
  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    await recordAuthAuditLog({
      req,
      eventType: 'password_reset_request',
      authSource: auditSource,
      businessUserId: auth.user.id,
      identifierType: 'email',
      resultCode: 'EMAIL_INVALID',
    });
    return json({ error: '当前账号邮箱无效，请先更新邮箱后再重试' }, { status: 409 });
  }

  const authLink = await getUserAuthLinkByBusinessUserId(db, auth.user.id);
  if (!authLink?.authUserId) {
    await recordAuthAuditLog({
      req,
      eventType: 'password_reset_request',
      authSource: auditSource,
      businessUserId: auth.user.id,
      identifierType: 'email',
      resultCode: 'AUTH_LINK_MISSING',
    });
    return json({ error: '当前账号尚未完成新版映射，请先在账号安全设置中设置登录密码' }, { status: 409 });
  }

  const guard = await guardMailSendByAudit({
    db,
    req,
    eventType: 'password_reset_request',
    businessUserId: auth.user.id,
    authUserId: authLink.authUserId,
    minIntervalSeconds: 60,
    maxPerUserWindow: {
      windowSeconds: 30 * 60,
      max: 3,
    },
    maxPerIpWindow: {
      windowSeconds: 30 * 60,
      max: 10,
    },
  });
  if (!guard.allowed) {
    await recordAuthAuditLog({
      req,
      eventType: 'password_reset_request',
      authSource: auditSource,
      businessUserId: auth.user.id,
      authUserId: authLink.authUserId,
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
  const defaultRedirectTo = new URL('/me?tab=settings', requestUrl.origin).toString();
  const redirectTo = toNonEmptyString(parsed.data.redirectTo) ?? defaultRedirectTo;

  let response: Response;
  try {
    response = await invokeBetterAuthSubrequest({
      req,
      path: '/api/auth/request-password-reset',
      body: {
        email: normalizedEmail,
        redirectTo,
      },
    });
  } catch (error) {
    console.error('[me/account/password/forgot] Better Auth 子请求失败:', error);
    await recordAuthAuditLog({
      req,
      eventType: 'password_reset_request',
      authSource: auditSource,
      businessUserId: auth.user.id,
      authUserId: authLink.authUserId,
      identifierType: 'email',
      resultCode: 'BRIDGE_UNAVAILABLE',
    });
    return json({ error: '发送重置邮件当前不可用，请稍后重试' }, { status: 503 });
  }

  const payload = await readJsonSafely<{ error?: string; message?: string }>(response);
  if (!response.ok) {
    const message = mapBetterAuthRequestResetError(extractErrorMessage(payload, '发送重置邮件失败'));
    await recordAuthAuditLog({
      req,
      eventType: 'password_reset_request',
      authSource: auditSource,
      businessUserId: auth.user.id,
      authUserId: authLink.authUserId,
      identifierType: 'email',
      resultCode: 'REQUEST_RESET_REJECTED',
      resultMessage: message,
    });
    return json({ error: message }, { status: response.status || 400 });
  }

  const headers = new Headers();
  appendSetCookieHeaders(headers, response.headers);

  await recordAuthAuditLog({
    req,
    eventType: 'password_reset_request',
    authSource: auditSource,
    businessUserId: auth.user.id,
    authUserId: authLink.authUserId,
    identifierType: 'email',
    resultCode: 'SUCCESS',
  });

  return json(
    {
      success: true,
      message: payload?.message || '重置邮件已发送，请查收邮箱并按邮件指引完成重置',
    },
    { headers },
  );
});
