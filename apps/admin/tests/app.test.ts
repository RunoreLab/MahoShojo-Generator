import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from 'jose';
import { beforeAll, describe, expect, test } from 'vitest';

const issuer = 'https://admin-example.cloudflareaccess.com';
const audience = 'admin-audience';

let privateKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(pair.publicKey);
  publicJwk.alg = 'RS256';
  publicJwk.kid = 'app-test';
  publicJwk.use = 'sig';
  privateKey = pair.privateKey;
  jwks = createLocalJWKSet({ keys: [publicJwk] });
});

const signToken = async (subject = 'human-subject-1') => new SignJWT({ type: 'app', email: 'operator@example.com' })
  .setProtectedHeader({ alg: 'RS256', kid: 'app-test' })
  .setIssuer(issuer)
  .setAudience(audience)
  .setSubject(subject)
  .setIssuedAt()
  .setExpirationTime('5m')
  .sign(privateKey);

const loadApp = async (capabilities: string[] = ['admin.shell.read']) => {
  const [{ createAdminApp }, access, authorization] = await Promise.all([
    import('../src/app'),
    import('../src/security/access'),
    import('../src/security/authorization'),
  ]);
  const verifier = access.createAccessJwtVerifier({ issuer, audience, jwks });
  const principals = authorization.createPrincipalDirectory([
    {
      id: 'principal-1',
      externalIdentity: { issuer, subject: 'human-subject-1', kind: 'human' },
      status: 'active',
      capabilities,
    },
  ]);
  return createAdminApp({ accessVerifier: verifier, principals });
};

const authorizedHeaders = async (subject?: string) => ({
  'Cf-Access-Jwt-Assertion': await signToken(subject),
});

describe('independent Admin shell', () => {
  test('liveness 不泄漏配置且不假装生产 Access readiness', async () => {
    const app = await loadApp();
    const response = await app.request('/health/live');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', scope: 'g3-p0-prework' });
  });

  test('缺失 Access assertion 被拒绝', async () => {
    const app = await loadApp();
    const response = await app.request('/');

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'ADMIN_UNAUTHORIZED' });
  });

  test('Access 合法但无 internal principal 被拒绝', async () => {
    const app = await loadApp();
    const response = await app.request('/', { headers: await authorizedHeaders('unknown-subject') });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'ADMIN_FORBIDDEN' });
  });

  test('Access/principal 合法但缺 route capability 被拒绝', async () => {
    const app = await loadApp(['users.read']);
    const response = await app.request('/', { headers: await authorizedHeaders() });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'ADMIN_FORBIDDEN' });
  });

  test('route 未声明 capability 时拒绝而不是落入宽泛 catch-all', async () => {
    const app = await loadApp();
    const response = await app.request('/api/admin/undeclared', { headers: await authorizedHeaders() });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'ADMIN_FORBIDDEN' });
  });

  test('已授权 shell 使用安全 headers，响应不回显 token/email/server secret', async () => {
    const app = await loadApp();
    const token = await signToken();
    const response = await app.request('/', { headers: { 'Cf-Access-Jwt-Assertion': token } });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(body).toContain('Admin 安全基座');
    expect(body).not.toContain(token);
    expect(body).not.toContain('operator@example.com');
    expect(body).not.toContain('ADMIN_ACCESS_JWKS_URL');
  });

  test('session response 只返回内部安全主体信息', async () => {
    const app = await loadApp();
    const response = await app.request('/api/admin/session', { headers: await authorizedHeaders() });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      principalId: 'principal-1',
      principalKind: 'human',
      capabilities: ['admin.shell.read'],
    });
  });
});
