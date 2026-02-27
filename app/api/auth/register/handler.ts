import { issueActivityToken } from '@/lib/auth/activity-token';
import { recordAuthAuditLog } from '@/lib/auth/auth-audit';
import {
  appendSetCookieHeaders,
  extractErrorMessage,
  getBetterAuthBridgeAvailability,
  invokeBetterAuthJsonEndpoint,
  readJsonSafely,
} from '@/lib/auth/better-auth-bridge';
import {
  ensureAuthUserLink,
  ensureBusinessUserLegacyAuthKey,
  getLinkedBusinessUserByAuthUserId,
} from '@/lib/auth/user-auth-linking';
import { getPasswordPolicySummaryMessage, validatePasswordPolicy } from '@/lib/auth/password-policy';
import { getUserByEmail, getUserByUsername } from '@/lib/database/users';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import {
  getBusinessUserByEmail,
  getBusinessUserByUsername,
  setBusinessUserRegistrationIpIfEmpty,
} from '@/lib/db/repositories/business-users';
import { getClientIpFromHeaders } from '@/lib/arena/battle-report-log-utils';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { verifyTurnstileToken } from '@/lib/turnstile';

export const runtime = 'edge';

type RegisterPayload = {
  username?: string;
  email?: string;
  password?: string;
  turnstileToken?: string;
};

type BetterAuthSignUpPayload = {
  user?: {
    id?: unknown;
    email?: unknown;
    name?: unknown;
  };
};

const json = (payload: unknown, status = 200, headers?: Headers): Response => {
  const merged = new Headers(headers ?? {});
  if (!merged.has('Content-Type')) {
    merged.set('Content-Type', 'application/json');
  }
  return new Response(JSON.stringify(payload), { status, headers: merged });
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

type RegisterDeps = {
  recordAuthAuditLog: typeof recordAuthAuditLog;
  issueActivityToken: typeof issueActivityToken;
  appendSetCookieHeaders: typeof appendSetCookieHeaders;
  getBetterAuthBridgeAvailability: typeof getBetterAuthBridgeAvailability;
  extractErrorMessage: typeof extractErrorMessage;
  invokeBetterAuthJsonEndpoint: typeof invokeBetterAuthJsonEndpoint;
  readJsonSafely: typeof readJsonSafely;
  ensureAuthUserLink: typeof ensureAuthUserLink;
  ensureBusinessUserLegacyAuthKey: typeof ensureBusinessUserLegacyAuthKey;
  getLinkedBusinessUserByAuthUserId: typeof getLinkedBusinessUserByAuthUserId;
  getUserByEmail: typeof getUserByEmail;
  getUserByUsername: typeof getUserByUsername;
  getDrizzleDbFromRuntime: typeof getDrizzleDbFromRuntime;
  getBusinessUserByEmail: typeof getBusinessUserByEmail;
  getBusinessUserByUsername: typeof getBusinessUserByUsername;
  setBusinessUserRegistrationIpIfEmpty: typeof setBusinessUserRegistrationIpIfEmpty;
  quickCheck: typeof quickCheck;
  verifyTurnstileToken: typeof verifyTurnstileToken;
};

const defaultRegisterDeps: RegisterDeps = {
  recordAuthAuditLog,
  issueActivityToken,
  appendSetCookieHeaders,
  getBetterAuthBridgeAvailability,
  extractErrorMessage,
  invokeBetterAuthJsonEndpoint,
  readJsonSafely,
  ensureAuthUserLink,
  ensureBusinessUserLegacyAuthKey,
  getLinkedBusinessUserByAuthUserId,
  getUserByEmail,
  getUserByUsername,
  getDrizzleDbFromRuntime,
  getBusinessUserByEmail,
  getBusinessUserByUsername,
  setBusinessUserRegistrationIpIfEmpty,
  quickCheck,
  verifyTurnstileToken,
};

const buildRegisterHandler = (deps: RegisterDeps): ((req: Request) => Promise<Response>) => {
  const registerWithBetterAuth = async (
    req: Request,
    username: string,
    email: string,
    password: string,
  ): Promise<Response> => {
    const db = deps.getDrizzleDbFromRuntime();

    const existingUserByName = db ? await deps.getBusinessUserByUsername(db, username) : await deps.getUserByUsername(username);
    if (existingUserByName) {
      await deps.recordAuthAuditLog({
        req,
        eventType: 'register_failed',
        authSource: 'better-auth',
        identifierType: 'username',
        resultCode: 'USERNAME_EXISTS',
      });
      return json({ error: '用户名已存在' }, 409);
    }

    const existingUserByEmail = db ? await deps.getBusinessUserByEmail(db, email) : await deps.getUserByEmail(email);
    if (existingUserByEmail) {
      await deps.recordAuthAuditLog({
        req,
        eventType: 'register_failed',
        authSource: 'better-auth',
        identifierType: 'email',
        resultCode: 'EMAIL_EXISTS',
      });
      return json({ error: '邮箱已被注册' }, 409);
    }

    const bridge = await deps.invokeBetterAuthJsonEndpoint({
      path: '/api/auth/sign-up/email',
      body: {
        name: username,
        email,
        password,
        rememberMe: true,
      },
      sourceHeaders: req.headers,
    });

    if (!bridge.ok) {
      await deps.recordAuthAuditLog({
        req,
        eventType: 'register_failed',
        authSource: 'better-auth',
        resultCode: 'BRIDGE_UNAVAILABLE',
        resultMessage: bridge.code,
      });
      return json(
        {
          error: '密码注册当前不可用，请稍后重试。',
          code: bridge.code,
        },
        503,
      );
    }

    const payload = await deps.readJsonSafely<BetterAuthSignUpPayload>(bridge.response);
    if (!bridge.response.ok) {
      await deps.recordAuthAuditLog({
        req,
        eventType: 'register_failed',
        authSource: 'better-auth',
        resultCode: 'REGISTER_REJECTED',
        resultMessage: deps.extractErrorMessage(payload, '密码注册失败，请稍后重试'),
      });
      return json(
        {
          error: deps.extractErrorMessage(payload, '密码注册失败，请稍后重试'),
        },
        bridge.response.status || 400,
      );
    }

    const authUserId = toNonEmptyString(payload?.user?.id);
    if (!authUserId) {
      await deps.recordAuthAuditLog({
        req,
        eventType: 'register_failed',
        authSource: 'better-auth',
        resultCode: 'AUTH_USER_ID_MISSING',
      });
      return json({ error: '注册失败：未能解析会话用户标识' }, 500);
    }

    let businessUser = await deps.getLinkedBusinessUserByAuthUserId(authUserId);
    if (!businessUser) {
      businessUser = await deps.ensureAuthUserLink({
        authUserId,
        email: toNonEmptyString(payload?.user?.email) ?? email,
        name: toNonEmptyString(payload?.user?.name) ?? username,
      });
    }

    if (!businessUser) {
      await deps.recordAuthAuditLog({
        req,
        eventType: 'register_failed',
        authSource: 'better-auth',
        authUserId,
        resultCode: 'BUSINESS_LINK_MISSING',
      });
      return json({ error: '注册成功，但用户映射尚未建立，请联系管理员处理。' }, 409);
    }

    const businessUserWithAuthKey = await deps.ensureBusinessUserLegacyAuthKey(businessUser);
    if (!businessUserWithAuthKey) {
      await deps.recordAuthAuditLog({
        req,
        eventType: 'register_failed',
        authSource: 'better-auth',
        businessUserId: businessUser.id,
        authUserId,
        resultCode: 'LEGACY_COMPAT_KEY_INIT_FAILED',
      });
      return json({ error: '注册成功，但用户兼容凭证初始化失败，请稍后重试。' }, 500);
    }

    if (db) {
      try {
        await deps.setBusinessUserRegistrationIpIfEmpty(db, businessUserWithAuthKey.id, getClientIpFromHeaders(req.headers));
      } catch (error) {
        console.error('[auth/register] registration_ip 写入失败（已忽略）:', error);
      }
    }

    const activityToken = await deps.issueActivityToken(businessUserWithAuthKey.id);

    const headers = new Headers();
    deps.appendSetCookieHeaders(headers, bridge.response.headers);

    await deps.recordAuthAuditLog({
      req,
      eventType: 'register_success',
      authSource: 'better-auth',
      businessUserId: businessUserWithAuthKey.id,
      authUserId,
      identifierType: 'email',
      resultCode: 'SUCCESS',
    });

    return json(
      {
        success: true,
        authMode: 'better-auth',
        authKey: businessUserWithAuthKey.authKey ?? null,
        user: {
          id: businessUserWithAuthKey.id,
          username: businessUserWithAuthKey.username,
          prefix: businessUserWithAuthKey.prefix ?? null,
        },
        username: businessUserWithAuthKey.username,
        email: businessUserWithAuthKey.email,
        activityToken: activityToken ?? null,
        message: '注册成功，已自动登录。',
      },
      200,
      headers,
    );
  };

  return async (req: Request): Promise<Response> => {
    try {
      const payload = (await req.json()) as RegisterPayload;

      const username = toNonEmptyString(payload.username);
      const emailInput = toNonEmptyString(payload.email);
      const password = toNonEmptyString(payload.password);
      const turnstileToken = toNonEmptyString(payload.turnstileToken);

      if (!username || !emailInput || !password || !turnstileToken) {
        await deps.recordAuthAuditLog({
          req,
          eventType: 'register_failed',
          authSource: 'better-auth',
          resultCode: 'INVALID_PAYLOAD',
        });
        return json({ error: '用户名、邮箱、密码和安全验证不能为空' }, 400);
      }

      const normalizedEmail = normalizeEmail(emailInput);

      if (username.length < 2 || username.length > 20) {
        await deps.recordAuthAuditLog({
          req,
          eventType: 'register_failed',
          authSource: 'better-auth',
          identifierType: 'username',
          resultCode: 'USERNAME_INVALID',
        });
        return json({ error: '用户名长度必须在2-20个字符之间' }, 400);
      }

      if (!isValidEmail(normalizedEmail)) {
        await deps.recordAuthAuditLog({
          req,
          eventType: 'register_failed',
          authSource: 'better-auth',
          identifierType: 'email',
          resultCode: 'EMAIL_INVALID',
        });
        return json({ error: '请输入有效的邮箱地址' }, 400);
      }

      const passwordPolicy = validatePasswordPolicy(password, {
        username,
        email: normalizedEmail,
      });
      if (!passwordPolicy.ok) {
        await deps.recordAuthAuditLog({
          req,
          eventType: 'register_failed',
          authSource: 'better-auth',
          identifierType: 'email',
          resultCode: 'PASSWORD_POLICY_FAILED',
          resultMessage: getPasswordPolicySummaryMessage(passwordPolicy.issues) || '密码强度不足',
        });
        return json({ error: getPasswordPolicySummaryMessage(passwordPolicy.issues) || '密码强度不足' }, 400);
      }

      const availability = deps.getBetterAuthBridgeAvailability();
      if (!availability.available) {
        await deps.recordAuthAuditLog({
          req,
          eventType: 'register_failed',
          authSource: 'better-auth',
          resultCode: 'BRIDGE_UNAVAILABLE',
          resultMessage: availability.code,
        });
        return json(
          {
            error: '密码注册当前不可用，请稍后重试。',
            code: availability.code,
          },
          503,
        );
      }

      const isTurnstileValid = await deps.verifyTurnstileToken(turnstileToken);
      if (!isTurnstileValid) {
        await deps.recordAuthAuditLog({
          req,
          eventType: 'register_failed',
          authSource: 'better-auth',
          resultCode: 'TURNSTILE_FAILED',
        });
        return json({ error: '安全验证失败，请重新验证' }, 400);
      }

      try {
        const sensitiveCheck = await deps.quickCheck(username);
        if (sensitiveCheck.hasSensitiveWords) {
          await deps.recordAuthAuditLog({
            req,
            eventType: 'register_failed',
            authSource: 'better-auth',
            identifierType: 'username',
            resultCode: 'USERNAME_SENSITIVE',
          });
          return json({ error: '用户名包含不当内容，请重新输入' }, 400);
        }
      } catch (error) {
        console.error('Sensitive word check failed:', error);
      }

      return registerWithBetterAuth(req, username, normalizedEmail, password);
    } catch (error) {
      console.error('Registration error:', error);
      await deps.recordAuthAuditLog({
        req,
        eventType: 'register_failed',
        authSource: 'better-auth',
        resultCode: 'INTERNAL_ERROR',
      });
      return json({ error: '注册失败，请稍后重试' }, 500);
    }
  };
};

export const createRegisterHandler = (overrides: Partial<RegisterDeps> = {}): ((req: Request) => Promise<Response>) => {
  return buildRegisterHandler({ ...defaultRegisterDeps, ...overrides });
};

export const POST = createRegisterHandler();
