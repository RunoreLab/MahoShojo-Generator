import { expect, test } from 'vitest';
import { validateDeploymentConfig } from '../scripts/deploy.mjs';
import { isAdminBrowserSourcePath, validateAdminWranglerConfig } from '../../../scripts/check-admin-security-boundary.mjs';
const config = () => ({ workers_dev: false, preview_urls: false,
  assets: {binding: 'ASSETS', directory: './dist/client', run_worker_first: true},
  routes: [{pattern: 'admin.mahoshojo.colanns.me', custom_domain: true}],
  vars: {ADMIN_ACCESS_ISSUER: 'https://fixture.cloudflareaccess.com', ADMIN_ACCESS_AUDIENCE: 'a'.repeat(64),
    ADMIN_ACCESS_JWKS_URL: 'https://fixture.cloudflareaccess.com/cdn-cgi/access/certs', ADMIN_PRINCIPALS_JSON: '[]'},
  d1_databases: [{binding: 'DB', database_name: 'fixture-admin', database_id: '11111111-1111-1111-1111-111111111111'}],
  r2_buckets: [{binding: 'ADMIN_OBJECTS', bucket_name: 'fixture-exports'}, {binding: 'LARGE_OBJECTS', bucket_name: 'fixture-large'}],
  queues: {producers: [{binding: 'ADMIN_QUEUE', queue: 'fixture-jobs'}], consumers: [{queue: 'fixture-jobs', max_batch_size: 5, max_retries: 3}]},
  triggers: {crons: ['*/10 * * * *']},
});
test('private配置完整声明同源入口、D1、私有R2与有界Queue', () => {
  expect(validateDeploymentConfig(config())).toEqual(config());
});
test.each([
  {workers_dev: true}, {preview_urls: true}, {assets: {binding: 'ASSETS', run_worker_first: false}},
  {routes: [{pattern: 'example.com', custom_domain: true}]}, {r2_buckets: []}, {queues: {}}, {triggers: {crons: ['* * * * *']}},
  {env: {production: {workers_dev: true}}}, {build: {command: 'unexpected-hook'}}, {services: [{binding: 'BYPASS'}]},
])('拒绝缺失资源、公开入口或未审查配置 %j', changes => {
  expect(() => validateDeploymentConfig({...config(), ...changes})).toThrow();
});
test('Windows client路径也需要安全扫描，格式错误的本地bindings fail closed', () => {
  expect(isAdminBrowserSourcePath('D:\\repo\\apps\\admin\\src\\client\\app.tsx')).toBe(true);
  expect(isAdminBrowserSourcePath('D:\\repo\\apps\\admin\\src\\security\\access.ts')).toBe(false);
  expect(validateAdminWranglerConfig(JSON.stringify({d1_databases: {}, r2_buckets: null}))).not.toEqual([]);
});

test('自动快照委托主体为可选的有界标识，不能携带控制字符', () => {
  expect(validateDeploymentConfig({...config(), vars: {...config().vars, ADMIN_ANALYTICS_PRINCIPAL_ID: 'daily-operator'}})).toBeTruthy();
  for (const id of ['', ' padded', 'line\nbreak', 'x'.repeat(129), 42]) {
    expect(() => validateDeploymentConfig({...config(), vars: {...config().vars, ADMIN_ANALYTICS_PRINCIPAL_ID: id}})).toThrow();
  }
});
