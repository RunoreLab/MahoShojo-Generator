import { getRequestUrl } from '@/lib/request-url';
import { buildSubrequestAuthHeaders } from '@/lib/subrequest-auth';

type BetterAuthSubrequestInput = {
  req: Request;
  path: string;
  body: unknown;
};

const copyHeader = (source: Headers, target: Headers, key: string): void => {
  const value = source.get(key);
  if (value && value.trim().length > 0) {
    target.set(key, value);
  }
};

export const invokeBetterAuthSubrequest = async (input: BetterAuthSubrequestInput): Promise<Response> => {
  const requestUrl = getRequestUrl(input.req);
  const normalizedPath = input.path.startsWith('/') ? input.path : `/${input.path}`;
  const targetUrl = new URL(normalizedPath, requestUrl.origin);

  const headers = new Headers({
    'Content-Type': 'application/json',
  });

  const subrequestHeaders = buildSubrequestAuthHeaders(input.req);
  for (const [key, value] of Object.entries(subrequestHeaders)) {
    headers.set(key, value);
  }

  copyHeader(input.req.headers, headers, 'cookie');
  copyHeader(input.req.headers, headers, 'origin');
  copyHeader(input.req.headers, headers, 'referer');
  copyHeader(input.req.headers, headers, 'user-agent');
  copyHeader(input.req.headers, headers, 'x-forwarded-for');
  copyHeader(input.req.headers, headers, 'x-real-ip');
  copyHeader(input.req.headers, headers, 'cf-connecting-ip');

  return fetch(targetUrl.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(input.body ?? {}),
  });
};

export const readJsonSafely = async <T>(response: Response): Promise<T | null> => {
  try {
    return (await response.clone().json()) as T;
  } catch {
    return null;
  }
};

export const extractErrorMessage = (payload: unknown, fallback: string): string => {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error.trim().length > 0) return record.error;
  if (typeof record.message === 'string' && record.message.trim().length > 0) return record.message;
  return fallback;
};

export const appendSetCookieHeaders = (target: Headers, source: Headers): void => {
  const anySource = source as Headers & { getSetCookie?: () => string[] };
  if (typeof anySource.getSetCookie === 'function') {
    const cookies = anySource.getSetCookie();
    for (const cookie of cookies) {
      if (cookie && cookie.trim().length > 0) {
        target.append('Set-Cookie', cookie);
      }
    }
    return;
  }

  const setCookie = source.get('set-cookie');
  if (setCookie && setCookie.trim().length > 0) {
    target.append('Set-Cookie', setCookie);
  }
};
