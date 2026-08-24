export type HonoAuthMode = 'hybrid' | 'bearer';

const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export const readHonoAuthMode = (
  env: NodeJS.ProcessEnv = process.env,
): HonoAuthMode => {
  const raw = env.HONO_AUTH_MODE?.trim().toLowerCase() || 'hybrid';
  if (raw === 'hybrid' || raw === 'bearer') return raw;
  throw new Error(`HONO_AUTH_MODE 必须是 hybrid 或 bearer，当前值：${raw}`);
};

export const parseTrustedBetterAuthBaseUrl = (
  raw: string | undefined,
  options: { allowLocalHttp?: boolean } = {},
): URL => {
  const configured = raw?.trim();
  if (!configured) {
    throw new Error('BETTER_AUTH_URL 配置无效：必须显式配置可信 Better Auth origin');
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('BETTER_AUTH_URL 配置无效：必须是绝对 URL');
  }

  if (url.username || url.password) {
    throw new Error('BETTER_AUTH_URL 配置无效：不得包含 URL credentials');
  }
  const allowLocalHttp = options.allowLocalHttp ?? process.env.NODE_ENV !== 'production';
  if (
    url.protocol !== 'https:'
    && !(allowLocalHttp && url.protocol === 'http:' && LOCAL_HTTP_HOSTS.has(url.hostname))
  ) {
    throw new Error('BETTER_AUTH_URL 配置无效：当前环境必须使用 HTTPS（仅非生产本机开发允许 HTTP）');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('BETTER_AUTH_URL 配置无效：必须只包含 origin，不得包含 path、query 或 fragment');
  }
  return url;
};
