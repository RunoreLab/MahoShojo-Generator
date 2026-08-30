import { getRequestUrl } from '@/lib/request-url';
/**
 * 在 Cloudflare / Edge Runtime 下，req.url 有时可能不是用户实际访问的 Host。
 * 这里优先从转发头推导 origin，避免在同源 fetch（如读取 /presets/*.json）时打到错误域名。
 */
export function getRequestOrigin(req: Request): string {
  const url = getRequestUrl(req);

  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();

  const host = forwardedHost || req.headers.get('host') || url.host;
  const protocol = forwardedProto || url.protocol.replace(':', '');

  if (!host) return url.origin;
  if (!protocol) return `https://${host}`;
  return `${protocol}://${host}`;
}

