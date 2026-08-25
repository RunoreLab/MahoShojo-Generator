import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { toNextJsHandler } from 'better-auth/next-js';
import { getBetterAuthBootstrapStatus } from '@/lib/auth/better-auth';
import { ensureAuthUserLink } from '@/lib/auth/user-auth-linking';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { baAccounts, baSessions, baUsers, baVerifications } from '@/lib/db/schema/auth';

type BetterAuthRouteHandlers = ReturnType<typeof toNextJsHandler>;

const betterAuthSchema = {
  user: baUsers,
  session: baSessions,
  account: baAccounts,
  verification: baVerifications,
};

const runtimeDbProxy = new Proxy(
  {},
  {
    get(_target, prop, receiver) {
      const db = getDrizzleDbFromRuntime();
      if (!db) {
        throw new Error('Better Auth 初始化失败：当前请求上下文未检测到可用的 Cloudflare D1 绑定 `DB`。');
      }
      const value = Reflect.get(db as object, prop, receiver);
      return typeof value === 'function' ? value.bind(db) : value;
    },
    set(_target, prop, value, receiver) {
      const db = getDrizzleDbFromRuntime();
      if (!db) {
        throw new Error('Better Auth 初始化失败：当前请求上下文未检测到可用的 Cloudflare D1 绑定 `DB`。');
      }
      Reflect.set(db as object, prop, value, receiver);
      return true;
    },
  },
);

const readBaseURL = (): string | undefined => {
  const raw = process.env.BETTER_AUTH_URL?.trim();
  if (!raw) return undefined;
  return raw;
};

const readSecret = (): string | null => {
  const raw = process.env.BETTER_AUTH_SECRET?.trim();
  if (!raw) return null;
  return raw;
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readTrustedOrigins = (): string[] => {
  const raw = process.env.BETTER_AUTH_TRUSTED_ORIGINS?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};

const withTrustedOrigins = (): { trustedOrigins: string[] } | Record<string, never> => {
  const origins = readTrustedOrigins();
  if (origins.length === 0) return {};
  return { trustedOrigins: origins };
};

const readResendApiKey = (): string | null => {
  const raw = process.env.RESEND_API_KEY?.trim();
  if (!raw) return null;
  return raw;
};

const sendPasswordResetEmailByResend = async (payload: {
  user?: { email?: unknown; name?: unknown };
  url?: unknown;
}): Promise<void> => {
  const apiKey = readResendApiKey();
  if (!apiKey) {
    console.error('[auth][app] RESEND_API_KEY 未配置，已跳过密码重置邮件发送。');
    return;
  }

  const email = toNonEmptyString(payload.user?.email)?.toLowerCase() ?? null;
  const resetUrl = toNonEmptyString(payload.url);
  if (!email || !resetUrl) {
    console.error('[auth][app] 密码重置邮件参数不完整，已跳过发送。', {
      hasEmail: Boolean(email),
      hasResetUrl: Boolean(resetUrl),
    });
    return;
  }

  const displayName = toNonEmptyString(payload.user?.name) ?? email.split('@')[0] ?? '用户';

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: '魔事院档案馆 <recovery@send.colanns.me>',
        to: [email],
        subject: '魔法少女生成器 ~ 密码重置链接',
        html: `<p>您好 <strong>${displayName}</strong>,</p>
<p>请点击下方一次性链接设置新密码：</p>
<p><a href="${resetUrl}">${resetUrl}</a></p>
<p>如果这不是您的操作，请忽略本邮件。</p>`,
        text: `您好 ${displayName},\n\n请访问以下一次性链接设置新密码：\n${resetUrl}\n\n如果这不是您的操作，请忽略本邮件。`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[auth][app] Resend 发送密码重置邮件失败：', response.status, errorText);
    }
  } catch (error) {
    console.error('[auth][app] Resend 发送密码重置邮件异常：', error);
  }
};

const onBetterAuthUserCreated = async (user: { id?: unknown; email?: unknown; name?: unknown }): Promise<void> => {
  const authUserId = toNonEmptyString(user.id);
  if (!authUserId) return;

  const linked = await ensureAuthUserLink({
    authUserId,
    email: toNonEmptyString(user.email),
    name: toNonEmptyString(user.name),
  });

  if (!linked) {
    console.warn('[auth][app] Better Auth 新用户创建后未建立业务映射：', {
      authUserId,
      email: user.email,
    });
  }
};

export const hasBetterAuthDatabaseBinding = (): boolean => {
  return getDrizzleDbFromRuntime() !== null;
};

const createBetterAuthInstance = (secret: string) =>
  betterAuth({
    database: drizzleAdapter(runtimeDbProxy, {
      provider: 'sqlite',
      schema: betterAuthSchema,
    }),
    secret,
    basePath: '/api/auth',
    ...(readBaseURL() ? { baseURL: readBaseURL() } : {}),
    ...withTrustedOrigins(),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        await sendPasswordResetEmailByResend({
          user: {
            email: user?.email,
            name: user?.name,
          },
          url,
        });
      },
    },
    user: {
      changeEmail: {
        enabled: true,
        updateEmailWithoutVerification: true,
      },
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: onBetterAuthUserCreated,
        },
      },
    },
  });

type BetterAuthInstance = ReturnType<typeof createBetterAuthInstance>;

let cachedAuthInstance: BetterAuthInstance | null | undefined;
let cachedRouteHandlers: BetterAuthRouteHandlers | null | undefined;

export const getBetterAuthInstance = (): BetterAuthInstance | null => {
  if (cachedAuthInstance !== undefined) {
    return cachedAuthInstance;
  }

  if (getBetterAuthBootstrapStatus() !== 'ready') {
    cachedAuthInstance = null;
    return null;
  }

  const secret = readSecret();
  if (!secret) {
    cachedAuthInstance = null;
    return null;
  }

  cachedAuthInstance = createBetterAuthInstance(secret);

  return cachedAuthInstance;
};

export const getBetterAuthRouteHandlers = (): BetterAuthRouteHandlers | null => {
  if (cachedRouteHandlers !== undefined) {
    return cachedRouteHandlers;
  }

  const auth = getBetterAuthInstance();
  if (!auth) {
    cachedRouteHandlers = null;
    return null;
  }

  cachedRouteHandlers = toNextJsHandler(auth);
  return cachedRouteHandlers;
};
