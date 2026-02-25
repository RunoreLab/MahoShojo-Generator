import { getBetterAuthBootstrapStatus } from '@/lib/auth/better-auth';
import { getBetterAuthInstance, hasBetterAuthDatabaseBinding } from '@/lib/auth/better-auth-app';

export type BetterAuthBridgeUnavailableCode =
  | 'BETTER_AUTH_DISABLED'
  | 'BETTER_AUTH_MISCONFIGURED'
  | 'BETTER_AUTH_DB_UNAVAILABLE'
  | 'BETTER_AUTH_INIT_FAILED';

export type BetterAuthBridgeResult =
  | { ok: true; response: Response }
  | { ok: false; code: BetterAuthBridgeUnavailableCode; message: string };

type HeadersWithSetCookie = Headers & {
  getSetCookie?: () => string[];
};

const DEFAULT_BETTER_AUTH_BASE_URL = 'http://localhost:3000';

const resolveBetterAuthBaseURL = (): string => {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  return configured || DEFAULT_BETTER_AUTH_BASE_URL;
};

const copyHeader = (source: Headers, target: Headers, key: string): void => {
  const value = source.get(key);
  if (value && value.trim().length > 0) {
    target.set(key, value);
  }
};

export const invokeBetterAuthJsonEndpoint = async (input: {
  path: string;
  body: unknown;
  sourceHeaders: Headers;
}): Promise<BetterAuthBridgeResult> => {
  const status = getBetterAuthBootstrapStatus();
  if (status === 'disabled') {
    return { ok: false, code: 'BETTER_AUTH_DISABLED', message: 'Better Auth 尚未启用' };
  }

  if (status === 'misconfigured') {
    return { ok: false, code: 'BETTER_AUTH_MISCONFIGURED', message: 'Better Auth 配置不完整' };
  }

  if (!hasBetterAuthDatabaseBinding()) {
    return { ok: false, code: 'BETTER_AUTH_DB_UNAVAILABLE', message: 'Better Auth 所需 D1 绑定不可用' };
  }

  const auth = getBetterAuthInstance();
  if (!auth) {
    return { ok: false, code: 'BETTER_AUTH_INIT_FAILED', message: 'Better Auth 初始化失败' };
  }

  const normalizedPath = input.path.startsWith('/') ? input.path : `/${input.path}`;
  const url = new URL(normalizedPath, resolveBetterAuthBaseURL());

  const requestHeaders = new Headers({
    'Content-Type': 'application/json',
  });
  copyHeader(input.sourceHeaders, requestHeaders, 'cookie');
  copyHeader(input.sourceHeaders, requestHeaders, 'origin');
  copyHeader(input.sourceHeaders, requestHeaders, 'referer');
  copyHeader(input.sourceHeaders, requestHeaders, 'user-agent');
  copyHeader(input.sourceHeaders, requestHeaders, 'x-forwarded-for');
  copyHeader(input.sourceHeaders, requestHeaders, 'x-real-ip');
  copyHeader(input.sourceHeaders, requestHeaders, 'cf-connecting-ip');

  try {
    const response = await (auth as { handler: (req: Request) => Promise<Response> }).handler(
      new Request(url.toString(), {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(input.body ?? {}),
      }),
    );

    return { ok: true, response };
  } catch (error) {
    console.error('[auth][bridge] 调用 Better Auth 端点失败:', {
      path: normalizedPath,
      error,
    });
    return { ok: false, code: 'BETTER_AUTH_INIT_FAILED', message: 'Better Auth 请求执行失败' };
  }
};

export const appendSetCookieHeaders = (target: Headers, source: Headers): void => {
  const maybeHeaders = source as HeadersWithSetCookie;
  if (typeof maybeHeaders.getSetCookie === 'function') {
    const cookies = maybeHeaders.getSetCookie();
    for (const value of cookies) {
      target.append('Set-Cookie', value);
    }
    return;
  }

  const raw = source.get('set-cookie');
  if (raw && raw.trim().length > 0) {
    target.append('Set-Cookie', raw);
  }
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

  const error = record.error;
  if (typeof error === 'string' && error.trim().length > 0) return error;

  const message = record.message;
  if (typeof message === 'string' && message.trim().length > 0) return message;

  return fallback;
};
