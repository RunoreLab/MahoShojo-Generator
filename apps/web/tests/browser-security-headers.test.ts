import { describe, expect, test } from 'vitest';

import {
  buildContentSecurityPolicy,
  buildPermissionsPolicy,
  buildStaticBrowserSecurityHeaders,
  getRequestProtocol,
  shouldRedirectToHttps,
} from '@/lib/security/browser-headers';

describe('browser security headers', () => {
  test('静态安全头包含基础浏览器硬化项与 CSP', () => {
    const headers = buildStaticBrowserSecurityHeaders({
      allowGoogleAnalytics: true,
      allowTurnstile: true,
      isProduction: true,
    });

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
    expect(headers).toContainEqual({
      key: 'Content-Security-Policy',
      value: buildContentSecurityPolicy({
        allowGoogleAnalytics: true,
        allowTurnstile: true,
        isProduction: true,
      }),
    });
  });

  test('CSP 会启用 anti-frame、静态脚本白名单与 HTTPS 升级', () => {
    const policy = buildContentSecurityPolicy({
      allowGoogleAnalytics: true,
      allowTurnstile: true,
      isProduction: true,
    });

    expect(policy).toContain(`frame-ancestors 'none'`);
    expect(policy).toContain(`script-src 'self' 'unsafe-inline'`);
    expect(policy).toContain('https://challenges.cloudflare.com');
    expect(policy).toContain('https://www.googletagmanager.com');
    expect(policy).toContain(`script-src-attr 'none'`);
    expect(policy).toContain('upgrade-insecure-requests');
  });

  test('开发环境 CSP 会保留 Next 开发调试所需的 unsafe-eval', () => {
    const policy = buildContentSecurityPolicy({
      allowGoogleAnalytics: false,
      allowTurnstile: false,
      isProduction: false,
    });

    expect(policy).toContain(`'unsafe-eval'`);
  });

  test('HTTPS 跳转会尊重代理协议头且放过本地开发地址', () => {
    expect(
      shouldRedirectToHttps(new URL('http://mahoshojo.example.com/free'), new Headers()),
    ).toBe(true);

    expect(
      shouldRedirectToHttps(
        new URL('https://mahoshojo.example.com/free'),
        new Headers({ 'x-forwarded-proto': 'https' }),
      ),
    ).toBe(false);

    expect(
      shouldRedirectToHttps(new URL('http://localhost:3000/free'), new Headers()),
    ).toBe(false);
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
