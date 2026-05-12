import { issueActivityToken } from '@/lib/auth/activity-token';
import {
  acquireAuthAttemptRateLimit,
  buildAuthAttemptRateLimitResponse,
} from '@/lib/auth/attempt-rate-limit';
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
import { anonymizeIp, getClientIpFromHeaders } from '@/lib/arena/battle-report-log-utils';
import { getUserById, getUserByUsername, verifyUserLogin } from '@/lib/database/users';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import {
  countRecentFailedLoginsByIpAnonymized,
  countRecentFailedLoginsByLoginIdentifierHash,
} from '@/lib/db/repositories/auth-audit-logs';
import { sha256Hex } from '@/lib/pvp/crypto';
import { verifyTurnstileToken } from '@/lib/turnstile';

export const runtime = 'edge';

type LoginMode = 'password' | 'legacy';
type PasswordIdentifierType = 'email' | 'username' | 'user-id';

const LOGIN_TURNSTILE_IDENTIFIER_FAILURE_THRESHOLD = 5;
const LOGIN_TURNSTILE_IP_FAILURE_THRESHOLD = 10;
const LOGIN_TURNSTILE_FAILURE_WINDOW_SECONDS = 15 * 60;

type LoginPayload = {
  identifier?: string;
  credential?: string;
  username?: string;
  authKey?: string;
  mode?: LoginMode;
  turnstileToken?: string;
};

type BetterAuthSignInPayload = {
  user?: {
    id?: unknown;
    email?: unknown;
    name?: unknown;
  };
};

type LoginChallengeReason = 'none' | 'identifier-failures' | 'ip-failures';

type LoginChallengeDecision = {
  requiresTurnstile: boolean;
  reason: LoginChallengeReason;
  loginIdentifierHash: string;
  identifierFailures: number;
  ipFailures: number;
};

type LoginAuditMetadata = {
  loginIdentifierHash: string;
  loginChallengeReason?: LoginChallengeReason;
  loginIdentifierFailures?: number;
  loginIpFailures?: number;
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

const isValidEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const hashLoginIdentifier = async (identifier: string): Promise<string> => {
  return sha256Hex(`auth-login:${identifier.trim().toLowerCase()}`);
};

const buildLoginAuditMetadata = (challenge: LoginChallengeDecision): LoginAuditMetadata => {
  const metadata: LoginAuditMetadata = {
    loginIdentifierHash: challenge.loginIdentifierHash,
  };
  if (challenge.reason !== 'none') {
    metadata.loginChallengeReason = challenge.reason;
    metadata.loginIdentifierFailures = challenge.identifierFailures;
    metadata.loginIpFailures = challenge.ipFailures;
  }
  return metadata;
};

const parsePasswordIdentifier = (
  identifier: string,
): { type: PasswordIdentifierType; value: string; userId: number | null } => {
  const normalized = identifier.trim();
  if (isValidEmail(normalized.toLowerCase())) {
    return {
      type: 'email',
      value: normalized.toLowerCase(),
      userId: null,
    };
  }

  if (/^\d+$/.test(normalized)) {
    const userId = Number(normalized);
    if (Number.isSafeInteger(userId) && userId > 0) {
      return {
        type: 'user-id',
        value: normalized,
        userId,
      };
    }
  }

  return {
    type: 'username',
    value: normalized,
    userId: null,
  };
};

type LoginDeps = {
  acquireAuthAttemptRateLimit: typeof acquireAuthAttemptRateLimit;
  buildAuthAttemptRateLimitResponse: typeof buildAuthAttemptRateLimitResponse;
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
  getUserById: typeof getUserById;
  getUserByUsername: typeof getUserByUsername;
  verifyUserLogin: typeof verifyUserLogin;
  verifyTurnstileToken: typeof verifyTurnstileToken;
  getDrizzleDbFromRuntime: typeof getDrizzleDbFromRuntime;
  countRecentFailedLoginsByLoginIdentifierHash: typeof countRecentFailedLoginsByLoginIdentifierHash;
  countRecentFailedLoginsByIpAnonymized: typeof countRecentFailedLoginsByIpAnonymized;
};

const defaultLoginDeps: LoginDeps = {
  acquireAuthAttemptRateLimit,
  buildAuthAttemptRateLimitResponse,
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
  getUserById,
  getUserByUsername,
  verifyUserLogin,
  verifyTurnstileToken,
  getDrizzleDbFromRuntime,
  countRecentFailedLoginsByLoginIdentifierHash,
  countRecentFailedLoginsByIpAnonymized,
};

const buildLoginHandler = (deps: LoginDeps): ((req: Request) => Promise<Response>) => {
  const getLoginChallengeDecision = async (req: Request, identifier: string): Promise<LoginChallengeDecision> => {
    const loginIdentifierHash = await hashLoginIdentifier(identifier);
    const emptyDecision: LoginChallengeDecision = {
      requiresTurnstile: false,
      reason: 'none',
      loginIdentifierHash,
      identifierFailures: 0,
      ipFailures: 0,
    };

    const db = deps.getDrizzleDbFromRuntime();
    if (!db) return emptyDecision;

    const sinceEpochSeconds = Math.floor(Date.now() / 1000) - LOGIN_TURNSTILE_FAILURE_WINDOW_SECONDS;
    const ipAnonymized = anonymizeIp(getClientIpFromHeaders(req.headers));

    try {
      const [identifierFailures, ipFailures] = await Promise.all([
        deps.countRecentFailedLoginsByLoginIdentifierHash(db, {
          loginIdentifierHash,
          sinceEpochSeconds,
        }),
        ipAnonymized
          ? deps.countRecentFailedLoginsByIpAnonymized(db, {
              ipAnonymized,
              sinceEpochSeconds,
            })
          : Promise.resolve(0),
      ]);

      if (identifierFailures >= LOGIN_TURNSTILE_IDENTIFIER_FAILURE_THRESHOLD) {
        return {
          requiresTurnstile: true,
          reason: 'identifier-failures',
          loginIdentifierHash,
          identifierFailures,
          ipFailures,
        };
      }

      if (ipFailures >= LOGIN_TURNSTILE_IP_FAILURE_THRESHOLD) {
        return {
          requiresTurnstile: true,
          reason: 'ip-failures',
          loginIdentifierHash,
          identifierFailures,
          ipFailures,
        };
      }

      return {
        requiresTurnstile: false,
        reason: 'none',
        loginIdentifierHash,
        identifierFailures,
        ipFailures,
      };
    } catch (error) {
      console.error('[auth/login] 登录 Turnstile 升级判断失败（已放行）:', error);
      return emptyDecision;
    }
  };

  const resolveEmailByIdentifier = async (
    parsed: { type: PasswordIdentifierType; value: string; userId: number | null },
  ): Promise<string | null> => {
    if (parsed.type === 'email') {
      return parsed.value;
    }

    if (parsed.type === 'username') {
      const user = await deps.getUserByUsername(parsed.value);
      return toNonEmptyString(user?.email)?.toLowerCase() ?? null;
    }

    if (!parsed.userId) return null;
    const user = await deps.getUserById(parsed.userId);
    return toNonEmptyString(user?.email)?.toLowerCase() ?? null;
  };

  const toAuditSource = (mode: LoginMode): 'legacy' | 'better-auth' => (mode === 'legacy' ? 'legacy' : 'better-auth');

  const toAuditIdentifierType = (type: PasswordIdentifierType): 'email' | 'username' | 'user-id' => {
    if (type === 'user-id') return 'user-id';
    if (type === 'username') return 'username';
    return 'email';
  };

  const loginWithLegacyAuthKey = async (
    req: Request,
    username: string,
    authKey: string,
    auditMetadata: LoginAuditMetadata,
  ): Promise<Response> => {
    const user = await deps.verifyUserLogin(username, authKey);
    if (!user) {
      await deps.recordAuthAuditLog({
        req,
        eventType: 'login_failed',
        authSource: 'legacy',
        identifierType: 'username',
        resultCode: 'INVALID_CREDENTIAL',
        metadata: auditMetadata,
      });
      return json({ error: '用户名或密钥错误' }, 401);
    }

    const activityToken = await deps.issueActivityToken(user.id);
    await deps.recordAuthAuditLog({
      req,
      eventType: 'login_success',
      authSource: 'legacy',
      businessUserId: user.id,
      identifierType: 'username',
      resultCode: 'SUCCESS',
    });
    return json({
      success: true,
      authMode: 'legacy',
      authKey,
      user: {
        id: user.id,
        username: user.username,
        prefix: user.prefix,
      },
      activityToken: activityToken ?? null,
    });
  };

  const loginWithBetterAuthPassword = async (
    req: Request,
    email: string,
    password: string,
    identifierType: PasswordIdentifierType,
    auditMetadata: LoginAuditMetadata,
  ): Promise<Response> => {
    const bridge = await deps.invokeBetterAuthJsonEndpoint({
      path: '/api/auth/sign-in/email',
      body: {
        email,
        password,
        rememberMe: true,
      },
      sourceHeaders: req.headers,
    });

    if (!bridge.ok) {
      await deps.recordAuthAuditLog({
        req,
        eventType: 'login_failed',
        authSource: 'better-auth',
        identifierType: toAuditIdentifierType(identifierType),
        resultCode: 'BRIDGE_UNAVAILABLE',
        resultMessage: bridge.code,
      });
      return json(
        {
          error: '密码登录当前不可用，请改用旧版密钥登录。',
          code: bridge.code,
        },
        503,
      );
    }

    const payload = await deps.readJsonSafely<BetterAuthSignInPayload>(bridge.response);
    if (!bridge.response.ok) {
      const upstreamMessage = deps.extractErrorMessage(payload, '邮箱或密码错误');
      await deps.recordAuthAuditLog({
        req,
        eventType: 'login_failed',
        authSource: 'better-auth',
        identifierType: toAuditIdentifierType(identifierType),
        resultCode: 'INVALID_CREDENTIAL',
        resultMessage: upstreamMessage,
        metadata: auditMetadata,
      });
      return json(
        {
          error: '账号或密码错误',
        },
        401,
      );
    }

    const authUserId = toNonEmptyString(payload?.user?.id);
    if (!authUserId) {
      await deps.recordAuthAuditLog({
        req,
        eventType: 'login_failed',
        authSource: 'better-auth',
        identifierType: toAuditIdentifierType(identifierType),
        resultCode: 'AUTH_USER_ID_MISSING',
      });
      return json({ error: '登录失败：未能解析会话用户标识' }, 500);
    }

    let businessUser = await deps.getLinkedBusinessUserByAuthUserId(authUserId);
    if (!businessUser) {
      businessUser = await deps.ensureAuthUserLink({
        authUserId,
        email: toNonEmptyString(payload?.user?.email),
        name: toNonEmptyString(payload?.user?.name),
      });
    }

    if (!businessUser) {
      await deps.recordAuthAuditLog({
        req,
        eventType: 'login_failed',
        authSource: 'better-auth',
        authUserId,
        identifierType: toAuditIdentifierType(identifierType),
        resultCode: 'BUSINESS_LINK_MISSING',
      });
      return json({ error: '登录成功，但用户映射尚未建立，请联系管理员处理。' }, 409);
    }

    const businessUserWithAuthKey = await deps.ensureBusinessUserLegacyAuthKey(businessUser);
    if (!businessUserWithAuthKey) {
      await deps.recordAuthAuditLog({
        req,
        eventType: 'login_failed',
        authSource: 'better-auth',
        businessUserId: businessUser.id,
        authUserId,
        identifierType: toAuditIdentifierType(identifierType),
        resultCode: 'LEGACY_COMPAT_KEY_INIT_FAILED',
      });
      return json({ error: '登录成功，但用户兼容凭证初始化失败，请稍后重试。' }, 500);
    }

    const activityToken = await deps.issueActivityToken(businessUserWithAuthKey.id);

    const headers = new Headers();
    deps.appendSetCookieHeaders(headers, bridge.response.headers);

    await deps.recordAuthAuditLog({
      req,
      eventType: 'login_success',
      authSource: 'better-auth',
      businessUserId: businessUserWithAuthKey.id,
      authUserId,
      identifierType: toAuditIdentifierType(identifierType),
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
        activityToken: activityToken ?? null,
      },
      200,
      headers,
    );
  };

  return async (req: Request): Promise<Response> => {
    try {
      const payload = (await req.json()) as LoginPayload;

      const turnstileToken = toNonEmptyString(payload.turnstileToken);
      const identifier = toNonEmptyString(payload.identifier) ?? toNonEmptyString(payload.username);
      const credential = toNonEmptyString(payload.credential) ?? toNonEmptyString(payload.authKey);
      const mode: LoginMode = payload.mode === 'legacy' ? 'legacy' : 'password';
      const auditSource = toAuditSource(mode);

      if (!identifier || !credential) {
        await deps.recordAuthAuditLog({
          req,
          eventType: 'login_failed',
          authSource: auditSource,
          resultCode: 'INVALID_PAYLOAD',
        });
        return json({ error: '登录信息不能为空' }, 400);
      }

      const parsedIdentifier = mode === 'password' ? parsePasswordIdentifier(identifier) : null;
      const auditIdentifierType =
        mode === 'legacy'
          ? 'username'
          : parsedIdentifier
            ? toAuditIdentifierType(parsedIdentifier.type)
            : 'unknown';

      if (mode === 'password') {
        const availability = deps.getBetterAuthBridgeAvailability();
        if (!availability.available) {
          await deps.recordAuthAuditLog({
            req,
            eventType: 'login_failed',
            authSource: 'better-auth',
            resultCode: 'BRIDGE_UNAVAILABLE',
            resultMessage: availability.code,
          });
          return json(
            {
              error: '密码登录当前不可用，请改用旧版密钥登录。',
              code: availability.code,
            },
            503,
          );
        }
      }

      const rateLimit = deps.acquireAuthAttemptRateLimit({
        req,
        actionType: 'login',
        identifier,
      });
      if (!rateLimit.allowed) {
        await deps.recordAuthAuditLog({
          req,
          eventType: 'login_failed',
          authSource: auditSource,
          identifierType: rateLimit.scope === 'identifier' ? auditIdentifierType : 'unknown',
          resultCode: 'RATE_LIMITED',
          resultMessage: `reason=${rateLimit.reason}`,
          metadata: {
            retryAfterSeconds: rateLimit.retryAfterSeconds,
            scope: rateLimit.scope,
          },
        });
        return deps.buildAuthAttemptRateLimitResponse(rateLimit);
      }

      const challenge = await getLoginChallengeDecision(req, identifier);
      const auditMetadata = buildLoginAuditMetadata(challenge);
      if (challenge.requiresTurnstile) {
        if (!turnstileToken) {
          await deps.recordAuthAuditLog({
            req,
            eventType: 'login_failed',
            authSource: auditSource,
            identifierType: auditIdentifierType,
            resultCode: 'TURNSTILE_REQUIRED',
            metadata: auditMetadata,
          });
          return json({ requiresTurnstile: true, error: '请完成安全验证' }, 400);
        }

        const isTurnstileValid = await deps.verifyTurnstileToken(turnstileToken);
        if (!isTurnstileValid) {
          await deps.recordAuthAuditLog({
            req,
            eventType: 'login_failed',
            authSource: auditSource,
            identifierType: auditIdentifierType,
            resultCode: 'TURNSTILE_FAILED',
            metadata: auditMetadata,
          });
          return json({ requiresTurnstile: true, error: '安全验证失败，请重新验证' }, 400);
        }
      }

      if (mode === 'legacy') {
        return loginWithLegacyAuthKey(req, identifier, credential, auditMetadata);
      }

      const safeParsedIdentifier = parsedIdentifier ?? parsePasswordIdentifier(identifier);
      const email = await resolveEmailByIdentifier(safeParsedIdentifier);
      if (!email) {
        await deps.recordAuthAuditLog({
          req,
          eventType: 'login_failed',
          authSource: 'better-auth',
          identifierType: toAuditIdentifierType(safeParsedIdentifier.type),
          resultCode: 'INVALID_CREDENTIAL',
          metadata: auditMetadata,
        });
        return json({ error: '账号或密码错误' }, 401);
      }

      return loginWithBetterAuthPassword(req, email, credential, safeParsedIdentifier.type, auditMetadata);
    } catch (error) {
      console.error('Login error:', error);
      await deps.recordAuthAuditLog({
        req,
        eventType: 'login_failed',
        authSource: 'unknown',
        resultCode: 'INTERNAL_ERROR',
      });
      return json({ error: '登录失败，请稍后重试' }, 500);
    }
  };
};

export const createLoginHandler = (overrides: Partial<LoginDeps> = {}): ((req: Request) => Promise<Response>) => {
  return buildLoginHandler({ ...defaultLoginDeps, ...overrides });
};

export const POST = createLoginHandler();
