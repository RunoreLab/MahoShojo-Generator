import { buildWebPageContentSecurityPolicy, type WebPageContentSecurityPolicyOptions } from '@mahoshojo/web-package/execution-policy';

type StaticHeader = {
  key: string;
  value: string;
};

type BrowserSecurityHeaderOptions = WebPageContentSecurityPolicyOptions;

const LOCAL_HOSTNAMES = new Set([
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'localhost',
]);

export function buildPermissionsPolicy(): string {
  return [
    'accelerometer=()',
    'autoplay=()',
    'camera=()',
    'clipboard-read=(self)',
    'clipboard-write=(self)',
    'display-capture=()',
    'fullscreen=(self)',
    'geolocation=()',
    'gyroscope=()',
    'hid=()',
    'magnetometer=()',
    'microphone=()',
    'midi=()',
    'payment=()',
    'serial=()',
    'usb=()',
    'xr-spatial-tracking=()',
  ].join(', ');
}

export const buildContentSecurityPolicy = buildWebPageContentSecurityPolicy;

export function buildStaticBrowserSecurityHeaders(options: BrowserSecurityHeaderOptions): StaticHeader[] {
  return [
    ...(options.isProduction
      ? [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ]
      : []),
    {
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
    },
    {
      key: 'X-Content-Type-Options',
      value: 'nosniff',
    },
    {
      key: 'X-Frame-Options',
      value: 'DENY',
    },
    {
      key: 'Permissions-Policy',
      value: buildPermissionsPolicy(),
    },
    {
      key: 'Content-Security-Policy',
      value: buildContentSecurityPolicy(options),
    },
  ];
}

/**
 * `/password-recovery` 专属响应头（OWASP 密码重置指引）。
 *
 * 恢复令牌以 query 传递；`no-referrer` 防止它经 Referer 进入同源子请求、
 * 外链与日志链路。next.config 在通用 `/:path*` 头之后追加本条目覆盖。
 */
export const PASSWORD_RECOVERY_ROUTE_HEADERS: StaticHeader[] = [
  {
    key: 'Referrer-Policy',
    value: 'no-referrer',
  },
];

export function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
}

export function getRequestProtocol(url: URL, headers: Headers): string {
  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (forwardedProto) return forwardedProto.replace(/:$/, '').toLowerCase();

  const forwarded = headers.get('forwarded');
  const forwardedMatch = forwarded?.match(/proto=(https?)/i);
  if (forwardedMatch?.[1]) return forwardedMatch[1].toLowerCase();

  const cfVisitor = headers.get('cf-visitor');
  if (cfVisitor) {
    try {
      const parsed = JSON.parse(cfVisitor) as { scheme?: string };
      if (parsed.scheme) return parsed.scheme.toLowerCase();
    } catch {
      // ignore malformed proxy headers
    }
  }

  return url.protocol.replace(/:$/, '').toLowerCase();
}

export function shouldRedirectToHttps(url: URL, headers: Headers): boolean {
  if (isLocalHostname(url.hostname)) return false;
  return getRequestProtocol(url, headers) === 'http';
}
