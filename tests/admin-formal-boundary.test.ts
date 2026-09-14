import { expect, test } from 'vitest';
import { validateAdminWranglerConfig, validateAdminWorkflow } from '../scripts/check-admin-security-boundary.mjs';

const config = () => ({
  name: 'mahoshojo-admin', main: 'src/index.ts', compatibility_date: '2026-09-12',
  compatibility_flags: ['nodejs_compat'], workers_dev: false, preview_urls: false,
  assets: { directory: './dist/client', binding: 'ASSETS', run_worker_first: true },
  vars: { ADMIN_ACCESS_ISSUER: 'https://unconfigured.cloudflareaccess.invalid',
    ADMIN_ACCESS_AUDIENCE: 'UNCONFIGURED_DENY_ALL',
    ADMIN_ACCESS_JWKS_URL: 'https://unconfigured.cloudflareaccess.invalid/cdn-cgi/access/certs',
    ADMIN_PRINCIPALS_JSON: '[]' },
  d1_databases: [{ binding: 'DB', database_name: 'admin-local', database_id: '00000000-0000-0000-0000-000000000000' }],
});
test('正式边界允许经过Worker认证的静态资源和本地D1', () => {
  expect(validateAdminWranglerConfig(JSON.stringify(config()))).toEqual([]);
});
test('静态资源和额外环境不能绕过Worker认证', () => {
  expect(validateAdminWranglerConfig(JSON.stringify({ ...config(), assets: { ...config().assets, run_worker_first: false } }))).not.toEqual([]);
  expect(validateAdminWranglerConfig(JSON.stringify({ ...config(), env: { production: { workers_dev: true } } }))).not.toEqual([]);
});
test('独立发布只允许手动触发且绑定生产environment', () => {
  const workflow = 'on: { workflow_dispatch: {} }\njobs:\n  deploy:\n    environment: admin-production\n    steps:\n      - run: pnpm --filter @mahoshojo/admin run deploy\n';
  expect(validateAdminWorkflow(workflow, '.github/workflows/admin-deploy.yml')).toEqual([]);
  expect(validateAdminWorkflow(workflow.replace('workflow_dispatch', 'push'), '.github/workflows/admin-deploy.yml')).not.toEqual([]);
});
