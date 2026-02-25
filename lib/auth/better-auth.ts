const BETTER_AUTH_SESSION_COOKIE_KEYS = [
  '__Secure-better-auth.session_token',
  'better-auth.session_token',
] as const;

export type BetterAuthBootstrapStatus = 'disabled' | 'misconfigured' | 'ready';

const isTruthy = (value: string | undefined): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

export const isBetterAuthEnabled = (): boolean => isTruthy(process.env.BETTER_AUTH_ENABLED);

export const getBetterAuthBootstrapStatus = (): BetterAuthBootstrapStatus => {
  if (!isBetterAuthEnabled()) return 'disabled';

  const secret = process.env.BETTER_AUTH_SECRET?.trim() ?? '';
  if (!secret) return 'misconfigured';

  return 'ready';
};

const parseCookies = (cookieHeader: string | null): Map<string, string> => {
  const result = new Map<string, string>();
  if (!cookieHeader) return result;

  const entries = cookieHeader.split(';');
  for (const entry of entries) {
    const index = entry.indexOf('=');
    if (index <= 0) continue;

    const key = entry.slice(0, index).trim();
    if (!key) continue;

    const value = entry.slice(index + 1).trim();
    result.set(key, value);
  }

  return result;
};

export const hasBetterAuthSessionCookie = (req: Request): boolean => {
  const cookies = parseCookies(req.headers.get('cookie'));
  return BETTER_AUTH_SESSION_COOKIE_KEYS.some((key) => {
    const value = cookies.get(key);
    return typeof value === 'string' && value.trim().length > 0;
  });
};
