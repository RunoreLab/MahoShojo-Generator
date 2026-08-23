const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const invalidConfiguration = (reason: string): Error =>
  new Error(`BETTER_AUTH_URL 配置无效：${reason}`);

export const parseTrustedBetterAuthBaseUrl = (raw: string | undefined): URL => {
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
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HTTP_HOSTS.has(url.hostname))) {
    throw invalidConfiguration('非本机地址必须使用 HTTPS');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw invalidConfiguration('必须只包含 origin，不得包含 path、query 或 fragment');
  }

  return url;
};

export const resolveTrustedBetterAuthSubrequestUrl = (path: string): URL => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (
    !normalizedPath.startsWith('/api/auth/')
    || normalizedPath.startsWith('//')
    || normalizedPath.includes('\\')
  ) {
    throw new Error('Better Auth 子请求路径无效');
  }

  const baseUrl = parseTrustedBetterAuthBaseUrl(process.env.BETTER_AUTH_URL);
  const targetUrl = new URL(normalizedPath, baseUrl.origin);
  if (targetUrl.origin !== baseUrl.origin) {
    throw new Error('Better Auth 子请求路径无效');
  }
  return targetUrl;
};
