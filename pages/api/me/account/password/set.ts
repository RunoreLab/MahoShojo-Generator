import {
  appendSetCookieHeaders,
  extractErrorMessage,
  invokeBetterAuthSubrequest,
  readJsonSafely,
} from '@/lib/auth/better-auth-subrequest';
import { mapSetPasswordError } from '@/lib/auth/error-message';
import { recordAuthAuditLog } from '@/lib/auth/auth-audit';
import { ensureAuthUserLink } from '@/lib/auth/user-auth-linking';
import { getPasswordPolicySummaryMessage, validatePasswordPolicy } from '@/lib/auth/password-policy';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getBusinessUserById } from '@/lib/db/repositories/business-users';
import {
  createAuthResetPasswordVerification,
  getAuthMigrationStatusByBusinessUserId,
} from '@/lib/db/repositories/user-auth-links';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

const RESET_TOKEN_TTL_SECONDS = 5 * 60;

type SetPasswordPayload = {
  newPassword?: unknown;
};

type BetterAuthSignUpPayload = {
  user?: {
    id?: unknown;
    email?: unknown;
    name?: unknown;
  };
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toEmail = (value: string): string => value.trim().toLowerCase();

const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const randomHex = (byteLength: number): string => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const createVerificationId = (): string => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `verify_${Date.now().toString(36)}_${randomHex(8)}`;
};

const createResetPasswordToken = (): string => randomHex(24);

export default withPvpErrorBoundary(async function handler(req: Request): Promise<Response> {
  if (req.method !== 'PUT') return json({ error: 'Method not allowed' }, { status: 405 });

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;
  const auditSource = auth.source === 'legacy-bearer' ? 'legacy' : 'better-auth';

  const parsed = await readJson<SetPasswordPayload>(req);
  if ('response' in parsed) return parsed.response;

  const newPassword = toNonEmptyString(parsed.data.newPassword);
  if (!newPassword) {
    await recordAuthAuditLog({
      req,
      eventType: 'password_set',
      authSource: auditSource,
      businessUserId: auth.user.id,
      resultCode: 'INVALID_PAYLOAD',
    });
    return json({ error: '新密码不能为空' }, { status: 400 });
  }

  const db = getDrizzleDbFromRuntime();
  if (!db) return json({ error: '数据库不可用，请稍后重试' }, { status: 503 });

  const businessUser = await getBusinessUserById(db, auth.user.id);
  if (!businessUser) return json({ error: '用户不存在' }, { status: 404 });

  const normalizedEmail = toEmail(businessUser.email);
  const policy = validatePasswordPolicy(newPassword, {
    username: auth.user.username,
    email: normalizedEmail,
  });
  if (!policy.ok) {
    await recordAuthAuditLog({
      req,
      eventType: 'password_set',
      authSource: auditSource,
      businessUserId: auth.user.id,
      resultCode: 'PASSWORD_POLICY_FAILED',
      resultMessage: getPasswordPolicySummaryMessage(policy.issues) || '新密码强度不足',
    });
    return json({ error: getPasswordPolicySummaryMessage(policy.issues) || '新密码强度不足' }, { status: 400 });
  }

  const currentStatus = await getAuthMigrationStatusByBusinessUserId(db, auth.user.id);
  if (currentStatus.hasPassword) {
    await recordAuthAuditLog({
      req,
      eventType: 'password_set',
      authSource: auditSource,
      businessUserId: auth.user.id,
      resultCode: 'ALREADY_HAS_PASSWORD',
    });
    return json({ error: '当前账号已设置密码，请使用修改密码功能' }, { status: 409 });
  }

  const headers = new Headers();
  if (currentStatus.hasAuthLink && currentStatus.authUserId) {
    const token = createResetPasswordToken();
    const expiresAt = Math.floor(Date.now() / 1000) + RESET_TOKEN_TTL_SECONDS;
    await createAuthResetPasswordVerification(db, {
      id: createVerificationId(),
      token,
      authUserId: currentStatus.authUserId,
      expiresAt,
    });

    let resetResponse: Response;
    try {
      resetResponse = await invokeBetterAuthSubrequest({
        req,
        path: '/api/auth/reset-password',
        body: {
          token,
          newPassword,
        },
      });
    } catch (error) {
      console.error('[me/account/password/set] reset-password 子请求失败:', error);
      await recordAuthAuditLog({
        req,
        eventType: 'password_set',
        authSource: auditSource,
        businessUserId: auth.user.id,
        authUserId: currentStatus.authUserId,
        resultCode: 'BRIDGE_UNAVAILABLE',
      });
      return json({ error: '设置密码当前不可用，请稍后重试' }, { status: 503 });
    }

    const resetPayload = await readJsonSafely<{ error?: string; message?: string }>(resetResponse);
    if (!resetResponse.ok) {
      const message = mapSetPasswordError(extractErrorMessage(resetPayload, '设置密码失败'));
      await recordAuthAuditLog({
        req,
        eventType: 'password_set',
        authSource: auditSource,
        businessUserId: auth.user.id,
        authUserId: currentStatus.authUserId,
        resultCode: 'RESET_PASSWORD_REJECTED',
        resultMessage: message,
      });
      return json({ error: message }, { status: resetResponse.status || 400 });
    }

    appendSetCookieHeaders(headers, resetResponse.headers);
  } else {
    if (!isValidEmail(normalizedEmail)) {
      await recordAuthAuditLog({
        req,
        eventType: 'password_set',
        authSource: auditSource,
        businessUserId: auth.user.id,
        identifierType: 'email',
        resultCode: 'EMAIL_INVALID',
      });
      return json({ error: '当前账号邮箱无效，请先更新邮箱后再设置密码' }, { status: 409 });
    }

    let signUpResponse: Response;
    try {
      signUpResponse = await invokeBetterAuthSubrequest({
        req,
        path: '/api/auth/sign-up/email',
        body: {
          name: auth.user.username,
          email: normalizedEmail,
          password: newPassword,
          rememberMe: true,
        },
      });
    } catch (error) {
      console.error('[me/account/password/set] sign-up/email 子请求失败:', error);
      await recordAuthAuditLog({
        req,
        eventType: 'password_set',
        authSource: auditSource,
        businessUserId: auth.user.id,
        identifierType: 'email',
        resultCode: 'BRIDGE_UNAVAILABLE',
      });
      return json({ error: '账号迁移认领当前不可用，请稍后重试' }, { status: 503 });
    }

    const signUpPayload = await readJsonSafely<BetterAuthSignUpPayload & { error?: string; message?: string }>(signUpResponse);
    if (!signUpResponse.ok) {
      const message = mapSetPasswordError(extractErrorMessage(signUpPayload, '账号迁移认领失败'));
      await recordAuthAuditLog({
        req,
        eventType: 'password_set',
        authSource: auditSource,
        businessUserId: auth.user.id,
        identifierType: 'email',
        resultCode: 'SIGN_UP_REJECTED',
        resultMessage: message,
      });
      return json({ error: message }, { status: signUpResponse.status || 400 });
    }

    const authUserId = toNonEmptyString(signUpPayload?.user?.id);
    const linked = authUserId
      ? await ensureAuthUserLink({
          authUserId,
          email: toNonEmptyString(signUpPayload?.user?.email) ?? normalizedEmail,
          name: toNonEmptyString(signUpPayload?.user?.name) ?? auth.user.username,
        })
      : null;
    if (!linked) {
      await recordAuthAuditLog({
        req,
        eventType: 'password_set',
        authSource: auditSource,
        businessUserId: auth.user.id,
        authUserId: authUserId ?? null,
        resultCode: 'BUSINESS_LINK_MISSING',
      });
      return json({ error: '账号迁移映射建立失败，请稍后重试或联系管理员' }, { status: 409 });
    }

    appendSetCookieHeaders(headers, signUpResponse.headers);
  }

  const latestStatus = await getAuthMigrationStatusByBusinessUserId(db, auth.user.id);
  if (!latestStatus.hasPassword) {
    await recordAuthAuditLog({
      req,
      eventType: 'password_set',
      authSource: auditSource,
      businessUserId: auth.user.id,
      authUserId: latestStatus.authUserId,
      resultCode: 'VERIFY_FAILED',
    });
    return json({ error: '密码设置结果未生效，请稍后重试' }, { status: 500 });
  }

  const migrationRequired = !latestStatus.hasAuthLink || !latestStatus.hasPassword;
  const legacyOnly = auth.source === 'legacy-bearer' || migrationRequired;

  await recordAuthAuditLog({
    req,
    eventType: 'password_set',
    authSource: auditSource,
    businessUserId: auth.user.id,
    authUserId: latestStatus.authUserId,
    resultCode: 'SUCCESS',
  });

  return json(
    {
      success: true,
      message:
        auth.source === 'legacy-bearer'
          ? '已设置登录密码。请重新使用密码登录，完成新版认证迁移。'
          : '登录密码设置成功',
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
