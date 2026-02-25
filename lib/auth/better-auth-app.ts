import { betterAuth } from 'better-auth';
import { toNextJsHandler } from 'better-auth/next-js';
import { getBetterAuthBootstrapStatus } from '@/lib/auth/better-auth';

type BetterAuthInstance = ReturnType<typeof betterAuth>;
type BetterAuthRouteHandlers = ReturnType<typeof toNextJsHandler>;

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
    secret,
    basePath: '/api/auth',
    ...(readBaseURL() ? { baseURL: readBaseURL() } : {}),
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
