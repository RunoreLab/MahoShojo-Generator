import { expect, test, vi } from 'vitest';
import { createAdminApp } from '../src/app';
import { createPrincipalDirectory } from '../src/security/authorization';
const identity = { issuer: 'https://example.cloudflareaccess.com', subject: 'one', kind: 'human' as const };
const principal = { id: 'operator', externalIdentity: identity, status: 'active' as const, capabilities: ['admin.shell.read', 'users.read'] };
const headers = { 'Cf-Access-Jwt-Assertion': 'test-verifier-assertion' };

test('ASSETS不可变fetch响应仍可安全加头并返回',async()=>{
 const app=createAdminApp({accessVerifier:{verify:async()=>identity},principals:createPrincipalDirectory([principal]),
  assets:()=>fetch('data:text/javascript,export%20default%201')});
 const response=await app.request('/assets/app.js',{headers});
 expect(response.status).toBe(200);expect(await response.text()).toBe('export default 1');expect(response.headers.get('Cache-Control')).toBe('no-store');
});
test('业务请求先授权再读取，且未知API不会进入资源fallback', async () => {
  const readResource = vi.fn(async () => ({ items: [], nextCursor: null }));
  const assets = vi.fn(async () => new Response('asset'));
  const app = createAdminApp({ accessVerifier: { verify: async () => identity }, principals: createPrincipalDirectory([principal]), readResource, assets });
  expect((await app.request('/api/admin/v1/users')).status).toBe(401);
  expect(readResource).not.toHaveBeenCalled();
  expect((await app.request('/api/admin/v1/users', { headers })).status).toBe(200);
  expect((await app.request('/api/admin/v1/unknown', { headers })).status).toBe(403);
  expect(assets).not.toHaveBeenCalled();
});
test('资源受身份保护，读取失败明确503；撤权逐请求生效', async () => {
  const resolvePrincipal = vi.fn(async () => principal);
  const app = createAdminApp({ accessVerifier: { verify: async () => identity }, principals: createPrincipalDirectory([]), resolvePrincipal,
    readResource: async () => { throw new Error('database credential detail'); }, assets: async () => new Response('asset') });
  expect((await app.request('/assets/app.js')).status).toBe(401);
  expect((await app.request('/assets/app.js', { headers })).status).toBe(200);
  const failed = await app.request('/api/admin/v1/users', { headers });
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain('credential');
  resolvePrincipal.mockResolvedValueOnce({ ...principal, status: 'disabled' } as never);
  expect((await app.request('/api/admin/v1/users', { headers })).status).toBe(403);
});
