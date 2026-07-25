const LOCAL_REQUEST_ORIGIN = 'https://mahoshojo.local';

const readHeader = (req: Request, name: string): string | null => {
  const headers = req.headers;
  if (!headers || typeof headers.get !== 'function') return null;
  return headers.get(name);
};

const readCloudflareScheme = (req: Request): string | null => {
  const cfVisitor = readHeader(req, 'cf-visitor');
  if (!cfVisitor) return null;

  try {
    const parsed = JSON.parse(cfVisitor) as { scheme?: unknown };
    return typeof parsed.scheme === 'string' && parsed.scheme ? parsed.scheme : null;
  } catch {
    return null;
  }
};

const inferRequestOrigin = (req: Request): string => {
  const host = readHeader(req, 'x-forwarded-host') || readHeader(req, 'host');
  if (!host) return LOCAL_REQUEST_ORIGIN;

  const proto = readHeader(req, 'x-forwarded-proto') || readCloudflareScheme(req) || 'https';
  return `${proto.split(',')[0]?.trim() || 'https'}://${host.split(',')[0]?.trim() || host}`;
};

export const getRequestUrl = (req: Request): URL => {
  const rawUrl = req.url || '/';

  try {
    return new URL(rawUrl);
  } catch {
    return new URL(rawUrl, inferRequestOrigin(req));
  }
};

export const getRequestOrigin = (req: Request): string => getRequestUrl(req).origin;

export const getRequestCacheKey = (req: Request, key: string): string => {
  try {
    return new URL(key).toString();
  } catch {
    return new URL(key || getRequestUrl(req).pathname, getRequestOrigin(req)).toString();
  }
};
