const BETTER_AUTH_SESSION_COOKIE_KEYS = [
  '__Secure-better-auth.session_token',
  'better-auth.session_token',
] as const;

export type BetterAuthBootstrapStatus = 'misconfigured' | 'ready';

export const getBetterAuthBootstrapStatus = (): BetterAuthBootstrapStatus => {
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
