import {
  appendSetCookieHeaders,
  extractErrorMessage,
  invokeBetterAuthSubrequest,
  readJsonSafely,
} from '@/lib/auth/better-auth-subrequest';
import { mapRecoverResetPasswordError, mapRecoverSignUpError } from '@/lib/auth/error-message';
import { hashRecoveryToken } from '@/lib/auth/recovery-token';
import { getPasswordPolicySummaryMessage, validatePasswordPolicy } from '@/lib/auth/password-policy';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getBusinessUserById } from '@/lib/db/repositories/business-users';
import {
  consumePasswordResetTokenByHash,
  getActivePasswordResetTokenByHash,
  invalidateActivePasswordResetTokensByUserId,
} from '@/lib/db/repositories/password-reset-tokens';
import {
  createAuthResetPasswordVerification,
  getAuthMigrationStatusByBusinessUserId,
  getAuthUserProfileByEmail,
  getUserAuthLinkByAuthUserId,
  markAuthUserEmailVerifiedById,
  upsertUserAuthLink,
} from '@/lib/db/repositories/user-auth-links';

const RESET_PASSWORD_TOKEN_TTL_SECONDS = 5 * 60;

const json = (payload: unknown, status = 200, headers?: HeadersInit): Response => {
  const mergedHeaders = new Headers(headers);
  if (!mergedHeaders.has('Content-Type')) {
    mergedHeaders.set('Content-Type', 'application/json');
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: mergedHeaders,
  });
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

type RecoverResetPayload = {
  token?: unknown;
  newPassword?: unknown;
  newAuthKey?: unknown;
};

type BetterAuthSignUpPayload = {
  user?: {
    id?: unknown;
    email?: unknown;
    name?: unknown;
  };
  error?: string;
  message?: string;
};

type BetterAuthResetPayload = {
  error?: string;
  message?: string;
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

type ResetDeps = {
  hashRecoveryToken: typeof hashRecoveryToken;
  getDrizzleDbFromRuntime: typeof getDrizzleDbFromRuntime;
  getBusinessUserById: typeof getBusinessUserById;
  getAuthMigrationStatusByBusinessUserId: typeof getAuthMigrationStatusByBusinessUserId;
  getAuthUserProfileByEmail: typeof getAuthUserProfileByEmail;
  getUserAuthLinkByAuthUserId: typeof getUserAuthLinkByAuthUserId;
  upsertUserAuthLink: typeof upsertUserAuthLink;
  markAuthUserEmailVerifiedById: typeof markAuthUserEmailVerifiedById;
  createAuthResetPasswordVerification: typeof createAuthResetPasswordVerification;
  getActivePasswordResetTokenByHash: typeof getActivePasswordResetTokenByHash;
  consumePasswordResetTokenByHash: typeof consumePasswordResetTokenByHash;
  invalidateActivePasswordResetTokensByUserId: typeof invalidateActivePasswordResetTokensByUserId;
  invokeBetterAuthSubrequest: typeof invokeBetterAuthSubrequest;
  readJsonSafely: typeof readJsonSafely;
  extractErrorMessage: typeof extractErrorMessage;
  appendSetCookieHeaders: typeof appendSetCookieHeaders;
  createVerificationId: () => string;
  createResetPasswordToken: () => string;
  now: () => number;
};

const defaultResetDeps: ResetDeps = {
  hashRecoveryToken,
  getDrizzleDbFromRuntime,
  getBusinessUserById,
  getAuthMigrationStatusByBusinessUserId,
  getAuthUserProfileByEmail,
  getUserAuthLinkByAuthUserId,
  upsertUserAuthLink,
  markAuthUserEmailVerifiedById,
  createAuthResetPasswordVerification,
  getActivePasswordResetTokenByHash,
  consumePasswordResetTokenByHash,
  invalidateActivePasswordResetTokensByUserId,
  invokeBetterAuthSubrequest,
  readJsonSafely,
  extractErrorMessage,
  appendSetCookieHeaders,
  createVerificationId,
  createResetPasswordToken,
  now: () => Date.now(),
};

const buildResetHandler = (deps: ResetDeps): ((req: Request) => Promise<Response>) => {
  return async (req: Request): Promise<Response> => {
    let payload: RecoverResetPayload;
    try {
      payload = await req.json();
    } catch {
      return json({ success: false, error: '请求体格式错误' }, 400);
    }

    const token = toNonEmptyString(payload.token);
    const newPassword = toNonEmptyString(payload.newPassword) ?? toNonEmptyString(payload.newAuthKey);
    if (!token || !newPassword) {
      return json({ success: false, error: '重置令牌或新密码不合法' }, 400);
    }

    const db = deps.getDrizzleDbFromRuntime();
    if (!db) {
      return json({ success: false, error: '数据库绑定不可用，请稍后重试' }, 503);
    }

    try {
      const tokenHash = await deps.hashRecoveryToken(token);
      const nowEpochSeconds = Math.floor(deps.now() / 1000);
      const activeToken = await deps.getActivePasswordResetTokenByHash(db, tokenHash, nowEpochSeconds);
      if (!activeToken) {
        return json({ success: false, error: '重置链接无效或已过期，请重新发起找回流程' }, 400);
      }

      const businessUser = await deps.getBusinessUserById(db, activeToken.userId);
      if (!businessUser) {
        return json({ success: false, error: '用户不存在或已被移除' }, 404);
      }

      const passwordPolicy = validatePasswordPolicy(newPassword, {
        username: businessUser.username,
        email: businessUser.email,
      });
      if (!passwordPolicy.ok) {
        return json(
          {
            success: false,
            error: getPasswordPolicySummaryMessage(passwordPolicy.issues) || '新密码强度不足',
          },
          400,
        );
      }

      const consumed = await deps.consumePasswordResetTokenByHash(db, tokenHash, nowEpochSeconds);
      if (!consumed) {
        return json({ success: false, error: '重置链接无效或已过期，请重新发起找回流程' }, 400);
      }

      const responseHeaders = new Headers();
      let authUserId: string | null = null;
      let passwordSetBySignUp = false;

      const migrationStatus = await deps.getAuthMigrationStatusByBusinessUserId(db, consumed.userId);
      if (migrationStatus.hasAuthLink && migrationStatus.authUserId) {
        authUserId = migrationStatus.authUserId;
      } else {
        const normalizedEmail = toEmail(businessUser.email ?? '');
        if (!isValidEmail(normalizedEmail)) {
          return json({ success: false, error: '当前账号邮箱无效，请联系管理员处理后重试' }, 409);
        }

        const existingAuthUser = await deps.getAuthUserProfileByEmail(db, normalizedEmail);
        if (existingAuthUser) {
          const linkedRow = await deps.getUserAuthLinkByAuthUserId(db, existingAuthUser.id);
          if (linkedRow && linkedRow.businessUserId !== consumed.userId) {
            return json({ success: false, error: '该邮箱已关联其他账号，请联系管理员处理账号冲突' }, 409);
          }

          await deps.upsertUserAuthLink(db, {
            authUserId: existingAuthUser.id,
            businessUserId: consumed.userId,
          });
          authUserId = existingAuthUser.id;
        } else {
          let signUpResponse: Response;
          try {
            signUpResponse = await deps.invokeBetterAuthSubrequest({
              req,
              path: '/api/auth/sign-up/email',
              body: {
                name: businessUser.username,
                email: normalizedEmail,
                password: newPassword,
                rememberMe: true,
              },
            });
          } catch (error) {
            console.error('[recover/reset] sign-up/email 子请求失败:', error);
            return json({ success: false, error: '账号迁移认领当前不可用，请稍后重试' }, 503);
          }

          const signUpPayload = await deps.readJsonSafely<BetterAuthSignUpPayload>(signUpResponse);
          if (!signUpResponse.ok) {
            const raceAuthUser = await deps.getAuthUserProfileByEmail(db, normalizedEmail);
            if (!raceAuthUser) {
              const message = mapRecoverSignUpError(
                deps.extractErrorMessage(signUpPayload, '账号迁移认领失败，请稍后重试'),
              );
              return json({ success: false, error: message }, signUpResponse.status || 400);
            }

            const linkedRow = await deps.getUserAuthLinkByAuthUserId(db, raceAuthUser.id);
            if (linkedRow && linkedRow.businessUserId !== consumed.userId) {
              return json({ success: false, error: '该邮箱已关联其他账号，请联系管理员处理账号冲突' }, 409);
            }

            await deps.upsertUserAuthLink(db, {
              authUserId: raceAuthUser.id,
              businessUserId: consumed.userId,
            });
            authUserId = raceAuthUser.id;
          } else {
            const signUpAuthUserId = toNonEmptyString(signUpPayload?.user?.id);
            if (!signUpAuthUserId) {
              return json({ success: false, error: '账号迁移映射建立失败，请稍后重试或联系管理员' }, 409);
            }

            await deps.upsertUserAuthLink(db, {
              authUserId: signUpAuthUserId,
              businessUserId: consumed.userId,
            });
            deps.appendSetCookieHeaders(responseHeaders, signUpResponse.headers);
            authUserId = signUpAuthUserId;
            passwordSetBySignUp = true;
          }
        }
      }

      if (!authUserId) {
        return json({ success: false, error: '账号迁移映射建立失败，请稍后重试或联系管理员' }, 409);
      }

      if (!passwordSetBySignUp) {
        const resetToken = deps.createResetPasswordToken();
        await deps.createAuthResetPasswordVerification(db, {
          id: deps.createVerificationId(),
          token: resetToken,
          authUserId,
          expiresAt: nowEpochSeconds + RESET_PASSWORD_TOKEN_TTL_SECONDS,
        });

        let resetPasswordResponse: Response;
        try {
          resetPasswordResponse = await deps.invokeBetterAuthSubrequest({
            req,
            path: '/api/auth/reset-password',
            body: {
              token: resetToken,
              newPassword,
            },
          });
        } catch (error) {
          console.error('[recover/reset] reset-password 子请求失败:', error);
          return json({ success: false, error: '设置新密码当前不可用，请稍后重试' }, 503);
        }

        const resetPayload = await deps.readJsonSafely<BetterAuthResetPayload>(resetPasswordResponse);
        if (!resetPasswordResponse.ok) {
          const message = mapRecoverResetPasswordError(
            deps.extractErrorMessage(resetPayload, '设置新密码失败，请稍后重试'),
          );
          return json({ success: false, error: message }, resetPasswordResponse.status || 400);
        }

        deps.appendSetCookieHeaders(responseHeaders, resetPasswordResponse.headers);
      }

      await deps.markAuthUserEmailVerifiedById(db, authUserId);
      await deps.invalidateActivePasswordResetTokensByUserId(db, consumed.userId, nowEpochSeconds);

      return json(
        {
          success: true,
          message: '新密码设置成功，请使用密码登录。',
        },
        200,
        responseHeaders,
      );
    } catch (error) {
      console.error('Password recovery reset error:', error);
      return json({ success: false, error: '服务器错误，请稍后重试' }, 500);
    }
  };
};

export const createRecoverResetHandler = (overrides: Partial<ResetDeps> = {}): ((req: Request) => Promise<Response>) => {
  return buildResetHandler({ ...defaultResetDeps, ...overrides });
};

export const POST = createRecoverResetHandler();
