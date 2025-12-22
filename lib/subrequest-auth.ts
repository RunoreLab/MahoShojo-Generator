type HeaderRecord = Record<string, string>;

const getEnvString = (key: string): string | null => {
  try {
    const raw = (process.env as Record<string, string | undefined> | undefined)?.[key];
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    return value ? value : null;
  } catch {
    return null;
  }
};

const setIfPresent = (target: HeaderRecord, key: string, value: string | null): void => {
  if (!value) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  target[key] = trimmed;
};

/**
 * Edge Runtime 下的“同源二次请求”有时会被 Cloudflare Access 拦截并返回 HTML 登录页。
 * 这里尝试透传必要的认证信息（Cookie / JWT 断言 / 可选 Service Token）以确保能拿到 JSON。
 */
export const buildSubrequestAuthHeaders = (req: Request): HeaderRecord => {
  const headers: HeaderRecord = {};

  setIfPresent(headers, 'cookie', req.headers.get('cookie'));
  setIfPresent(headers, 'cf-access-jwt-assertion', req.headers.get('cf-access-jwt-assertion'));

  const clientId = getEnvString('CF_ACCESS_CLIENT_ID');
  const clientSecret = getEnvString('CF_ACCESS_CLIENT_SECRET');
  if (clientId && clientSecret) {
    headers['cf-access-client-id'] = clientId;
    headers['cf-access-client-secret'] = clientSecret;
  }

  return headers;
};

