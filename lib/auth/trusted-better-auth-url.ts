const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const invalidConfiguration = (reason: string): Error =>
  new Error(`BETTER_AUTH_URL 配置无效：${reason}`);

export const parseTrustedBetterAuthBaseUrl = (
  raw: string | undefined,
  options: { allowLocalHttp?: boolean } = {},
): URL => {
  const configured = raw?.trim();
  if (!configured) {
    throw invalidConfiguration('必须显式配置可信 Better Auth origin');
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw invalidConfiguration('必须是绝对 URL');
  }

  if (url.username || url.password) {
    throw invalidConfiguration('不得包含 URL credentials');
  }
  const allowLocalHttp = options.allowLocalHttp ?? process.env.NODE_ENV !== 'production';
  if (
    url.protocol !== 'https:'
    && !(allowLocalHttp && url.protocol === 'http:' && LOCAL_HTTP_HOSTS.has(url.hostname))
  ) {
    throw invalidConfiguration('当前环境必须使用 HTTPS（仅非生产本机开发允许 HTTP）');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw invalidConfiguration('必须只包含 origin，不得包含 path、query 或 fragment');
  }

  return url;
};

export const resolveTrustedBetterAuthSubrequestUrl = (path: string): URL => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!/^\/api\/auth\/[A-Za-z0-9][A-Za-z0-9/_-]*$/u.test(normalizedPath)) {
    throw new Error('Better Auth 子请求路径无效');
  }

  const baseUrl = parseTrustedBetterAuthBaseUrl(process.env.BETTER_AUTH_URL);
  const targetUrl = new URL(normalizedPath, baseUrl.origin);
  if (targetUrl.origin !== baseUrl.origin || targetUrl.pathname !== normalizedPath) {
    throw new Error('Better Auth 子请求路径无效');
  }
  return targetUrl;
};
