import { describe, expect, test } from 'vitest';

import worker, { createAdminWorker } from '../src/index';
import { loadAdminConfiguration } from '../src/configuration';

const denyAllBindings: CloudflareBindings = {
  ADMIN_ACCESS_ISSUER: 'https://unconfigured.cloudflareaccess.invalid',
  ADMIN_ACCESS_AUDIENCE: 'UNCONFIGURED_DENY_ALL',
  ADMIN_ACCESS_JWKS_URL: 'https://unconfigured.cloudflareaccess.invalid/cdn-cgi/access/certs',
  ADMIN_PRINCIPALS_JSON: '[]',
};

describe('Admin runtime configuration', () => {
  test('仓库只提供无 principal 的 deny-all placeholder', () => {
    const configuration = loadAdminConfiguration(denyAllBindings);

    expect(configuration.principals.resolve({
      issuer: denyAllBindings.ADMIN_ACCESS_ISSUER,
      subject: 'any-human',
      kind: 'human',
    })).toBeNull();
  });

  test('缺失或 email-only principal 配置 fail closed', () => {
    expect(() => loadAdminConfiguration({})).toThrow('ADMIN_ACCESS_ISSUER is required');
    expect(() => loadAdminConfiguration({
      ...denyAllBindings,
      ADMIN_PRINCIPALS_JSON: JSON.stringify([{
        id: 'email-only',
        email: 'operator@example.com',
        status: 'active',
        capabilities: ['admin.shell.read'],
      }]),
    })).toThrow('invalid Admin principal');
  });

  test('Worker 在 deny-all 配置下拒绝 direct-origin/missing assertion，且不泄漏配置', async () => {
    const response = await worker.fetch(new Request('https://admin.example.test/'), denyAllBindings);
    const body = await response.text();

    expect(response.status).toBe(401);
    expect(body).toBe('{"error":"ADMIN_UNAUTHORIZED"}');
    for (const value of Object.values(denyAllBindings)) expect(body).not.toContain(value);
  });

  test('同一 immutable bindings/config 复用 verifier 与 remote JWKS cache', async () => {
    let verifierCreations = 0;
    const cachedWorker = createAdminWorker({
      createAccessVerifier: () => {
        verifierCreations += 1;
        return { verify: async () => { throw new Error('should not be called without assertion'); } };
      },
    });

    const first = await cachedWorker.fetch(new Request('https://admin.example.test/'), denyAllBindings);
    const second = await cachedWorker.fetch(new Request('https://admin.example.test/'), { ...denyAllBindings });

    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(verifierCreations).toBe(1);
  });

  test('配置错误响应也使用完整 fail-closed security headers', async () => {
    const response = await worker.fetch(new Request('https://admin.example.test/'), {} as CloudflareBindings);

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(response.headers.get('Permissions-Policy')).toContain('camera=()');
  });
});
