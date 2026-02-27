import { issueActivityToken } from '@/lib/auth/activity-token';
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
  const resolveEmailByIdentifier = async (identifier: string): Promise<string | null> => {
    const parsed = parsePasswordIdentifier(identifier);
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

  const loginWithLegacyAuthKey = async (username: string, authKey: string): Promise<Response> => {
    const user = await deps.verifyUserLogin(username, authKey);
    if (!user) {
      return json({ error: '用户名或密钥错误' }, 401);
    }

    const activityToken = await deps.issueActivityToken(user.id);
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

  const loginWithBetterAuthPassword = async (req: Request, email: string, password: string): Promise<Response> => {
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
      return json(
        {
          error: deps.extractErrorMessage(payload, '邮箱或密码错误'),
        },
        bridge.response.status || 401,
      );
    }

    const authUserId = toNonEmptyString(payload?.user?.id);
    if (!authUserId) {
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
      return json({ error: '登录成功，但用户映射尚未建立，请联系管理员处理。' }, 409);
    }

    const businessUserWithAuthKey = await deps.ensureBusinessUserLegacyAuthKey(businessUser);
    if (!businessUserWithAuthKey) {
      return json({ error: '登录成功，但用户兼容凭证初始化失败，请稍后重试。' }, 500);
    }

    const activityToken = await deps.issueActivityToken(businessUserWithAuthKey.id);

    const headers = new Headers();
    deps.appendSetCookieHeaders(headers, bridge.response.headers);

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

      if (!turnstileToken || !identifier || !credential) {
        return json({ error: '登录信息和安全验证不能为空' }, 400);
      }

      const isTurnstileValid = await deps.verifyTurnstileToken(turnstileToken);
      if (!isTurnstileValid) {
        return json({ error: '安全验证失败，请重新验证' }, 400);
      }

      if (mode === 'legacy') {
        return loginWithLegacyAuthKey(identifier, credential);
      }

      const email = await resolveEmailByIdentifier(identifier);
      if (!email) {
        return json({ error: '账号或密码错误' }, 401);
      }

      return loginWithBetterAuthPassword(req, email, credential);
    } catch (error) {
      console.error('Login error:', error);
      return json({ error: '登录失败，请稍后重试' }, 500);
    }
  };
};

export const createLoginHandler = (overrides: Partial<LoginDeps> = {}): ((req: Request) => Promise<Response>) => {
  return buildLoginHandler({ ...defaultLoginDeps, ...overrides });
};

export const POST = createLoginHandler();
