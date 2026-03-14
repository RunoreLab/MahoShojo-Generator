export const NONCE_HEADER = 'x-nonce';

type StaticHeader = {
  key: string;
  value: string;
};

type ContentSecurityPolicyOptions = {
  allowGoogleAnalytics?: boolean;
  allowTurnstile?: boolean;
  isProduction: boolean;
  nonce: string;
};

const LOCAL_HOSTNAMES = new Set([
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'localhost',
]);

const PUBLIC_FILE_PATTERN = /\.[a-z0-9]+$/i;

export function buildPermissionsPolicy(): string {
  return [
    'accelerometer=()',
    'ambient-light-sensor=()',
    'autoplay=()',
    'battery=()',
    'bluetooth=()',
    'camera=()',
    'clipboard-read=(self)',
    'clipboard-write=(self)',
    'display-capture=()',
    'document-domain=()',
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

export function buildStaticBrowserSecurityHeaders(isProduction: boolean): StaticHeader[] {
  return [
    ...(isProduction
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
  ];
}

export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

export function buildContentSecurityPolicy(options: ContentSecurityPolicyOptions): string {
  const scriptSources = [`'self'`, `'nonce-${options.nonce}'`];
  const connectSources = [`'self'`, 'https:', 'wss:'];
  const frameSources = [`'self'`];

  if (!options.isProduction) {
    scriptSources.push(`'unsafe-eval'`);
    connectSources.push('http:', 'ws:');
  }

  if (options.allowTurnstile) {
    scriptSources.push('https://challenges.cloudflare.com');
    frameSources.push('https://challenges.cloudflare.com');
  }

  if (options.allowGoogleAnalytics) {
    scriptSources.push('https://www.googletagmanager.com');
    connectSources.push('https://www.google-analytics.com', 'https://region1.google-analytics.com');
  }

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `script-src ${Array.from(new Set(scriptSources)).join(' ')}`,
    `script-src-attr 'none'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src ${Array.from(new Set(connectSources)).join(' ')}`,
    `media-src 'self' data: blob: https:`,
    `frame-src ${Array.from(new Set(frameSources)).join(' ')}`,
    `manifest-src 'self'`,
    `worker-src 'self' blob:`,
  ];

  if (options.isProduction) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

export function isDocumentRequest(pathname: string, headers: Headers): boolean {
  if (pathname.startsWith('/_next/') || pathname.startsWith('/api/')) return false;
  if (PUBLIC_FILE_PATTERN.test(pathname)) return false;

  const secFetchDest = headers.get('sec-fetch-dest')?.toLowerCase();
  if (secFetchDest === 'document') return true;
  if (secFetchDest && secFetchDest !== 'empty') return false;

  const accept = headers.get('accept')?.toLowerCase() ?? '';
  return accept.includes('text/html');
}

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
