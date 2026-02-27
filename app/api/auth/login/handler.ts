import { issueActivityToken } from '@/lib/auth/activity-token';
import { recordAuthAuditLog } from '@/lib/auth/auth-audit';
import {
  appendSetCookieHeaders,
  extractErrorMessage,
  invokeBetterAuthJsonEndpoint,
  readJsonSafely,
} from '@/lib/auth/better-auth-bridge';
import {
  ensureAuthUserLink,
  ensureBusinessUserLegacyAuthKey,
  getLinkedBusinessUserByAuthUserId,
} from '@/lib/auth/user-auth-linking';
import { getUserById, getUserByUsername, verifyUserLogin } from '@/lib/database/users';
import { verifyTurnstileToken } from '@/lib/turnstile';

export const runtime = 'edge';

type LoginMode = 'password' | 'legacy';
type PasswordIdentifierType = 'email' | 'username' | 'user-id';

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
  issueActivityToken: typeof issueActivityToken;
  appendSetCookieHeaders: typeof appendSetCookieHeaders;
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
};

const defaultLoginDeps: LoginDeps = {
  issueActivityToken,
  appendSetCookieHeaders,
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
};

const buildLoginHandler = (deps: LoginDeps): ((req: Request) => Promise<Response>) => {
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

  const loginWithLegacyAuthKey = async (req: Request, username: string, authKey: string): Promise<Response> => {
    const user = await deps.verifyUserLogin(username, authKey);
    if (!user) {
      await recordAuthAuditLog({
        req,
        eventType: 'login_failed',
        authSource: 'legacy',
        identifierType: 'username',
        resultCode: 'INVALID_CREDENTIAL',
      });
      return json({ error: '用户名或密钥错误' }, 401);
    }

    const activityToken = await deps.issueActivityToken(user.id);
    await recordAuthAuditLog({
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
      await recordAuthAuditLog({
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
      await recordAuthAuditLog({
        req,
        eventType: 'login_failed',
        authSource: 'better-auth',
        identifierType: toAuditIdentifierType(identifierType),
        resultCode: 'INVALID_CREDENTIAL',
        resultMessage: deps.extractErrorMessage(payload, '邮箱或密码错误'),
      });
      return json(
        {
          error: deps.extractErrorMessage(payload, '邮箱或密码错误'),
        },
        bridge.response.status || 401,
      );
    }

    const authUserId = toNonEmptyString(payload?.user?.id);
    if (!authUserId) {
      await recordAuthAuditLog({
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
      await recordAuthAuditLog({
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
      await recordAuthAuditLog({
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

    await recordAuthAuditLog({
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

      if (!turnstileToken || !identifier || !credential) {
        await recordAuthAuditLog({
          req,
          eventType: 'login_failed',
          authSource: auditSource,
          resultCode: 'INVALID_PAYLOAD',
        });
        return json({ error: '登录信息和安全验证不能为空' }, 400);
      }

      const isTurnstileValid = await deps.verifyTurnstileToken(turnstileToken);
      if (!isTurnstileValid) {
        await recordAuthAuditLog({
          req,
          eventType: 'login_failed',
          authSource: auditSource,
          resultCode: 'TURNSTILE_FAILED',
        });
        return json({ error: '安全验证失败，请重新验证' }, 400);
      }

      if (mode === 'legacy') {
        return loginWithLegacyAuthKey(req, identifier, credential);
      }

      const parsedIdentifier = parsePasswordIdentifier(identifier);
      const email = await resolveEmailByIdentifier(parsedIdentifier);
      if (!email) {
        await recordAuthAuditLog({
          req,
          eventType: 'login_failed',
          authSource: 'better-auth',
          identifierType: toAuditIdentifierType(parsedIdentifier.type),
          resultCode: 'INVALID_CREDENTIAL',
        });
        return json({ error: '账号或密码错误' }, 401);
      }

      return loginWithBetterAuthPassword(req, email, credential, parsedIdentifier.type);
    } catch (error) {
      console.error('Login error:', error);
      await recordAuthAuditLog({
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
