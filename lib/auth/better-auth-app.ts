import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { toNextJsHandler } from 'better-auth/next-js';
import { getBetterAuthBootstrapStatus } from '@/lib/auth/better-auth';
import { ensureAuthUserLink } from '@/lib/auth/user-auth-linking';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';
import { baAccounts, baSessions, baUsers, baVerifications } from '@/lib/db/schema/auth';

type BetterAuthInstance = ReturnType<typeof betterAuth>;
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

let cachedAuthInstance: BetterAuthInstance | null | undefined;
let cachedRouteHandlers: BetterAuthRouteHandlers | null | undefined;

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

  cachedAuthInstance = betterAuth({
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
