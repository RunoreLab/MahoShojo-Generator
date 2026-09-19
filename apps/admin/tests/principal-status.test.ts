import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import type { AdminDatabase } from '@mahoshojo/hosted-runtime/admin/database';
import { createAccessJwtVerifier, type AccessVerifier } from '../src/security/access';
import { readAdminPrincipalStatus } from '../scripts/principal-status';

const issuer = 'https://status-fixture.cloudflareaccess.com';
const audience = 'status-fixture';
const allowedCapabilities = ['admin.shell.read', 'users.read'];
let runtime: Miniflare;
let db: AdminDatabase;
let verifier: AccessVerifier;
let token: (subject: string, aud?: string, service?: boolean) => Promise<string>;

beforeAll(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({ modules: true,
    script: 'export default { fetch() { return new Response("fixture"); } }',
    compatibilityDate: '2026-08-01', d1Databases: ['DB'] }));
  db = await runtime.getD1Database('DB') as unknown as AdminDatabase;
  await db.prepare('CREATE TABLE admin_principals (id TEXT, issuer TEXT, subject TEXT, kind TEXT, status TEXT, capabilities_json TEXT)').run();
  for (const [subject, kind, status, capabilities] of [
    ['active', 'human', 'active', ['admin.shell.read']],
    ['disabled', 'human', 'disabled', ['admin.shell.read']],
    ['limited', 'human', 'active', ['users.read']],
    ['service-only', 'service', 'active', ['admin.shell.read']],
    ['invalid', 'human', 'active', ['unknown.capability']],
  ] as const) {
    await db.prepare('INSERT INTO admin_principals VALUES (?, ?, ?, ?, ?, ?)')
      .bind(subject, issuer, subject, kind, status, JSON.stringify(capabilities)).run();
  }
  const pair = await generateKeyPair('RS256');
  const jwk = await exportJWK(pair.publicKey); jwk.kid = 'status-test';
  verifier = createAccessJwtVerifier({issuer, audience, jwks: createLocalJWKSet({keys: [jwk]})});
  token = (subject, aud = audience, service = false) => new SignJWT({type: 'app', email: 'private@example.invalid', ...(service ? {common_name: subject} : {})})
    .setProtectedHeader({alg: 'RS256', kid: jwk.kid}).setIssuer(issuer).setAudience(aud)
    .setSubject(service ? '' : subject).setExpirationTime('5m').sign(pair.privateKey);
}, 30_000);
afterAll(async () => { await runtime?.dispose(); });

test.each([
  ['active', 'active', true, null],
  ['missing', 'missing', false, 'ADMIN_PRINCIPAL_MISSING'],
  ['disabled', 'disabled', false, 'ADMIN_PRINCIPAL_DISABLED'],
  ['limited', 'active', false, 'ADMIN_CAPABILITY_MISSING'],
  ['service-only', 'missing', false, 'ADMIN_PRINCIPAL_MISSING'],
] as const)('验签后诊断 %s，不写库或输出身份凭据', async (subject, principal, shellAllowed, denialCode) => {
  const before = await db.prepare('SELECT * FROM admin_principals ORDER BY id').all();
  const assertion = await token(subject);
  const result = await readAdminPrincipalStatus(db, verifier, assertion, allowedCapabilities);
  expect(result).toEqual({access: 'valid', identityKind: 'human', principal, shellAllowed, denialCode});
  const output = JSON.stringify(result);
  for (const privateValue of [assertion, issuer, 'private@example.invalid']) expect(output).not.toContain(privateValue);
  expect((await db.prepare('SELECT * FROM admin_principals ORDER BY id').all()).results).toEqual(before.results);
});

test('错误 audience 在访问数据库前拒绝', async () => {
  const prepare = vi.fn(() => { throw new Error('database must not be accessed'); });
  await expect(readAdminPrincipalStatus({...db, prepare}, verifier, await token('active', 'wrong-audience'), allowedCapabilities))
    .rejects.toMatchObject({code: 'ACCESS_TOKEN_INVALID'});
  expect(prepare).not.toHaveBeenCalled();
});

test('损坏的 principal 不被报告为 missing 或允许访问', async () => {
  await expect(readAdminPrincipalStatus(db, verifier, await token('invalid'), allowedCapabilities))
    .rejects.toThrow('ADMIN_PRINCIPAL_INVALID');
});

test('真实 service claim 保持 service 身份，不降级为 human', async () => {
  expect(await readAdminPrincipalStatus(db, verifier, await token('service-only', audience, true), allowedCapabilities))
    .toEqual({access: 'valid', identityKind: 'service', principal: 'active', shellAllowed: true, denialCode: null});
});

test('数据库故障不被误报为 missing', async () => {
  const unavailable = {...db, prepare: () => { throw new Error('database unavailable'); }};
  await expect(readAdminPrincipalStatus(unavailable, verifier, await token('active'), allowedCapabilities))
    .rejects.toThrow('database unavailable');
});
