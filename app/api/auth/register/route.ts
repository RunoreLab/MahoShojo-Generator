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
import { getSecureRandomValues } from '@/lib/crypto';
import { createUser, getUserByEmail, getUserByUsername } from '@/lib/database/users';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { getBusinessUserByEmail, getBusinessUserByUsername } from '@/lib/db/repositories/business-users';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { verifyTurnstileToken } from '@/lib/turnstile';

export const runtime = 'nodejs';

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

const getRandomValues = getSecureRandomValues;

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

const generateAuthKey = async (): Promise<string> => {
  const array = new Uint8Array(32);
  getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const registerWithBetterAuth = async (
  req: Request,
  username: string,
  email: string,
  password: string,
): Promise<Response> => {
  const db = getDrizzleDbFromRuntime();

  const existingUserByName = db ? await getBusinessUserByUsername(db, username) : await getUserByUsername(username);
  if (existingUserByName) {
    return json({ error: '用户名已存在' }, 409);
  }

  const existingUserByEmail = db ? await getBusinessUserByEmail(db, email) : await getUserByEmail(email);
  if (existingUserByEmail) {
    return json({ error: '邮箱已被注册' }, 409);
  }

  const bridge = await invokeBetterAuthJsonEndpoint({
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
    return json(
      {
        error: '密码注册当前不可用，请稍后重试或改用旧版密钥注册。',
        code: bridge.code,
      },
      503,
    );
  }

  const payload = await readJsonSafely<BetterAuthSignUpPayload>(bridge.response);
  if (!bridge.response.ok) {
    return json(
      {
        error: extractErrorMessage(payload, '密码注册失败，请稍后重试'),
      },
      bridge.response.status || 400,
    );
  }

  const authUserId = toNonEmptyString(payload?.user?.id);
  if (!authUserId) {
    return json({ error: '注册失败：未能解析会话用户标识' }, 500);
  }

  let businessUser = await getLinkedBusinessUserByAuthUserId(authUserId);
  if (!businessUser) {
    businessUser = await ensureAuthUserLink({
      authUserId,
      email: toNonEmptyString(payload?.user?.email) ?? email,
      name: toNonEmptyString(payload?.user?.name) ?? username,
    });
  }

  if (!businessUser) {
    return json({ error: '注册成功，但用户映射尚未建立，请联系管理员处理。' }, 409);
  }

  const businessUserWithAuthKey = await ensureBusinessUserLegacyAuthKey(businessUser);
  if (!businessUserWithAuthKey) {
    return json({ error: '注册成功，但用户兼容凭证初始化失败，请稍后重试。' }, 500);
  }

  const activityToken = await issueActivityToken(businessUserWithAuthKey.id);

  const headers = new Headers();
  appendSetCookieHeaders(headers, bridge.response.headers);

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

const registerWithLegacyAuthKey = async (username: string, email: string): Promise<Response> => {
  const existingUser = await getUserByUsername(username);
  if (existingUser) {
    return json({ error: '用户名已存在' }, 409);
  }

  const existingEmail = await getUserByEmail(email);
  if (existingEmail) {
    return json({ error: '邮箱已被注册' }, 409);
  }

  const authKey = await generateAuthKey();
  const userId = await createUser(username, email, authKey);

  if (!userId) {
    return json({ error: '创建用户失败' }, 500);
  }

  const activityToken = await issueActivityToken(userId);

  return json({
    success: true,
    authMode: 'legacy',
    user: {
      id: userId,
      username,
      prefix: null,
    },
    username,
    email,
    authKey,
    activityToken: activityToken ?? null,
    message: '注册成功！请妥善保存您的登录密钥',
  });
};

export async function POST(req: Request): Promise<Response> {
  try {
    const payload = (await req.json()) as RegisterPayload;

    const username = toNonEmptyString(payload.username);
    const emailInput = toNonEmptyString(payload.email);
    const password = toNonEmptyString(payload.password);
    const turnstileToken = toNonEmptyString(payload.turnstileToken);

    if (!username || !emailInput || !turnstileToken) {
      return json({ error: '用户名、邮箱和安全验证不能为空' }, 400);
    }

    const normalizedEmail = normalizeEmail(emailInput);

    const isTurnstileValid = await verifyTurnstileToken(turnstileToken);
    if (!isTurnstileValid) {
      return json({ error: '安全验证失败，请重新验证' }, 400);
    }

    if (username.length < 2 || username.length > 20) {
      return json({ error: '用户名长度必须在2-20个字符之间' }, 400);
    }

    if (!isValidEmail(normalizedEmail)) {
      return json({ error: '请输入有效的邮箱地址' }, 400);
    }

    if (password && password.length < 8) {
      return json({ error: '密码长度至少需要 8 位' }, 400);
    }

    try {
      const sensitiveCheck = await quickCheck(username);
      if (sensitiveCheck.hasSensitiveWords) {
        return json({ error: '用户名包含不当内容，请重新输入' }, 400);
      }
    } catch (error) {
      console.error('Sensitive word check failed:', error);
    }

    if (password) {
      return registerWithBetterAuth(req, username, normalizedEmail, password);
    }

    return registerWithLegacyAuthKey(username, normalizedEmail);
  } catch (error) {
    console.error('Registration error:', error);
    return json({ error: '注册失败，请稍后重试' }, 500);
  }
}
