import { describe, expect, test } from 'bun:test';

import {
  buildContentSecurityPolicy,
  buildPermissionsPolicy,
  buildStaticBrowserSecurityHeaders,
  getRequestProtocol,
  isDocumentRequest,
  shouldRedirectToHttps,
} from '@/lib/security/browser-headers';

describe('browser security headers', () => {
  test('静态安全头包含基础浏览器硬化项', () => {
    const headers = buildStaticBrowserSecurityHeaders(true);

    expect(headers).toContainEqual({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains',
    });
    expect(headers).toContainEqual({
      key: 'X-Frame-Options',
      value: 'DENY',
    });
    expect(headers).toContainEqual({
      key: 'Permissions-Policy',
      value: buildPermissionsPolicy(),
    });
  });

  test('CSP 会启用 anti-frame、nonce 脚本白名单与 HTTPS 升级', () => {
    const policy = buildContentSecurityPolicy({
      allowGoogleAnalytics: true,
      allowTurnstile: true,
      isProduction: true,
      nonce: 'test-nonce',
    });

    expect(policy).toContain(`frame-ancestors 'none'`);
    expect(policy).toContain(`script-src 'self' 'nonce-test-nonce'`);
    expect(policy).toContain('https://challenges.cloudflare.com');
    expect(policy).toContain('https://www.googletagmanager.com');
    expect(policy).toContain(`script-src-attr 'none'`);
    expect(policy).toContain('upgrade-insecure-requests');
  });

  test('仅文档请求才会附加 nonce 型 CSP', () => {
    expect(isDocumentRequest('/', new Headers({ Accept: 'text/html' }))).toBeTrue();
    expect(isDocumentRequest('/api/data-cards', new Headers({ Accept: 'text/html' }))).toBeFalse();
    expect(isDocumentRequest('/favicon.ico', new Headers({ Accept: 'text/html' }))).toBeFalse();
    expect(isDocumentRequest('/languages.json', new Headers({ Accept: 'application/json' }))).toBeFalse();
  });

  test('HTTPS 跳转会尊重代理协议头且放过本地开发地址', () => {
    expect(
      shouldRedirectToHttps(new URL('http://mahoshojo.example.com/free'), new Headers()),
    ).toBeTrue();

    expect(
      shouldRedirectToHttps(
        new URL('https://mahoshojo.example.com/free'),
        new Headers({ 'x-forwarded-proto': 'https' }),
      ),
    ).toBeFalse();

    expect(
      shouldRedirectToHttps(new URL('http://localhost:3000/free'), new Headers()),
    ).toBeFalse();
  });

  test('协议识别会优先读取代理透传头', () => {
    expect(
      getRequestProtocol(
        new URL('https://mahoshojo.example.com/free'),
        new Headers({ 'x-forwarded-proto': 'http' }),
      ),
    ).toBe('http');

    expect(
      getRequestProtocol(
        new URL('https://mahoshojo.example.com/free'),
        new Headers({ 'cf-visitor': JSON.stringify({ scheme: 'https' }) }),
      ),
    ).toBe('https');
  });
});
