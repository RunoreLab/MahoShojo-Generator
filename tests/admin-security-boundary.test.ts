import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  isAdminBrowserArtifactPath,
  validateAdminPackageManifest,
  validateAdminSourceImports,
  validateAdminWorkflow,
  validateAdminWranglerConfig,
} from '../scripts/check-admin-security-boundary.mjs';

const rootDirectory = path.resolve(import.meta.dirname, '..');
const directAdminWorkflowFailure = (workflowPath: string) => (
  `${workflowPath} G3-P0 workflow 不得直接引用 Admin；请使用 root workspace orchestration`
);

describe('Admin security boundary parser', () => {
  test('当前 deny-all Wrangler config 通过结构化 allowlist', () => {
    const source = readFileSync(path.join(rootDirectory, 'apps/admin/wrangler.jsonc'), 'utf8');
    expect(validateAdminWranglerConfig(source)).toEqual([]);
  });

  test('env override、route 或额外 binding 不能绕过 deny-all config', () => {
    const source = `{
      "name": "mahoshojo-admin",
      "main": "src/index.ts",
      "compatibility_date": "2026-08-29",
      "workers_dev": false,
      "vars": {
        "ADMIN_ACCESS_ISSUER": "https://unconfigured.cloudflareaccess.invalid",
        "ADMIN_ACCESS_AUDIENCE": "UNCONFIGURED_DENY_ALL",
        "ADMIN_ACCESS_JWKS_URL": "https://unconfigured.cloudflareaccess.invalid/cdn-cgi/access/certs",
        "ADMIN_PRINCIPALS_JSON": "[]"
      },
      "env": { "production": { "workers_dev": true } }
    }`;
    expect(validateAdminWranglerConfig(source)).toContain('Wrangler config 包含未允许的顶层键: env');
  });

  test('多行 workflow 的 Admin 直接引用被拒绝', () => {
    const source = `
name: forbidden-admin-deploy
on: workflow_dispatch
jobs:
  deploy:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/admin
    steps:
      - run: |
          pnpm exec wrangler deploy
`;
    expect(validateAdminWorkflow(source, '.github/workflows/forbidden.yml'))
      .toContain(directAdminWorkflowFailure('.github/workflows/forbidden.yml'));
  });

  test('workflow 不得直接调用 Admin build/deploy 命令', () => {
    const workflow = (command: string) => `
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - working-directory: apps/admin
        run: ${command}
`;
    expect(validateAdminWorkflow(
      workflow('pnpm exec wrangler deploy --dry-run'),
      '.github/workflows/verify.yml',
    )).toContain(directAdminWorkflowFailure('.github/workflows/verify.yml'));
    expect(validateAdminWorkflow(
      workflow('pnpm exec wrangler deploy --dry-run && pnpm exec wrangler deploy'),
      '.github/workflows/combined.yml',
    )).toContain(directAdminWorkflowFailure('.github/workflows/combined.yml'));
    expect(validateAdminWorkflow(
      workflow('pnpm exec wrangler deploy --dry-run & pnpm exec wrangler deploy'),
      '.github/workflows/background.yml',
    )).toContain(directAdminWorkflowFailure('.github/workflows/background.yml'));
    expect(validateAdminWorkflow(
      workflow('pnpm exec wrangler versions upload'),
      '.github/workflows/upload.yml',
    )).toContain(directAdminWorkflowFailure('.github/workflows/upload.yml'));
    expect(validateAdminWorkflow(
      workflow('pnpm run build'),
      '.github/workflows/safe-build.yml',
    )).toContain(directAdminWorkflowFailure('.github/workflows/safe-build.yml'));
    expect(validateAdminWorkflow(
      workflow('pnpm exec wrangler deploy --dry-run=false'),
      '.github/workflows/dry-run-false.yml',
    )).toContain(directAdminWorkflowFailure('.github/workflows/dry-run-false.yml'));
    expect(validateAdminWorkflow(
      workflow('pnpm exec wrangler deploy --dry-run $(pnpm exec wrangler deploy)'),
      '.github/workflows/substitution.yml',
    )).toContain(directAdminWorkflowFailure('.github/workflows/substitution.yml'));
  });

  test('动态 app working-directory 不能隐藏 matrix 中的 Admin deploy', () => {
    const source = `
jobs:
  deploy:
    strategy:
      matrix:
        app: [web, admin]
    steps:
      - working-directory: apps/\${{ matrix.app }}
        run: pnpm exec wrangler deploy
`;
    expect(validateAdminWorkflow(source, '.github/workflows/matrix.yml'))
      .toContain(directAdminWorkflowFailure('.github/workflows/matrix.yml'));
  });

  test('绝对/环境路径 cd 不能隐藏 Admin deploy', () => {
    const source = `
jobs:
  deploy:
    steps:
      - run: cd "$GITHUB_WORKSPACE/apps/admin" && pnpm exec wrangler deploy
`;
    expect(validateAdminWorkflow(source, '.github/workflows/absolute.yml'))
      .toContain(directAdminWorkflowFailure('.github/workflows/absolute.yml'));
  });

  test('step action 与 reusable workflow 不能隐藏 Admin 引用', () => {
    const stepAction = `
jobs:
  deploy:
    steps:
      - uses: ./apps/admin/deploy-action
`;
    const reusableWorkflow = `
jobs:
  deploy:
    uses: example/repository/.github/workflows/admin-deploy.yml@main
`;
    expect(validateAdminWorkflow(stepAction, '.github/workflows/action.yml'))
      .toContain(directAdminWorkflowFailure('.github/workflows/action.yml'));
    expect(validateAdminWorkflow(reusableWorkflow, '.github/workflows/reusable.yml'))
      .toContain(directAdminWorkflowFailure('.github/workflows/reusable.yml'));
  });

  test('无 Admin 字面引用的 root workspace 编排仍可运行', () => {
    const source = `
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm run ci:verify
`;
    expect(validateAdminWorkflow(source, '.github/workflows/ci.yml')).toEqual([]);
  });

  test('dist 中显式 client/browser/static artifact 名称 fail closed', () => {
    expect(isAdminBrowserArtifactPath('apps/admin/dist/client.js')).toBe(true);
    expect(isAdminBrowserArtifactPath('apps/admin/dist/clientfoo.js')).toBe(true);
    expect(isAdminBrowserArtifactPath('apps/admin/dist/assets/chunk.js')).toBe(true);
    expect(isAdminBrowserArtifactPath('apps/admin/dist/index.css')).toBe(true);
    expect(isAdminBrowserArtifactPath('apps/admin/dist/index.js')).toBe(false);
  });

  test('Admin package 全部脚本固定，不能通过 lifecycle 或 alias 间接改成部署', () => {
    const manifest = readFileSync(path.join(rootDirectory, 'apps/admin/package.json'), 'utf8');
    expect(validateAdminPackageManifest(manifest)).toEqual([]);
    const lifecycleManifest = JSON.parse(manifest) as { scripts: Record<string, string> };
    lifecycleManifest.scripts.prebuild = 'wrangler deploy';
    expect(validateAdminPackageManifest(JSON.stringify(lifecycleManifest)))
      .toContain('apps/admin scripts 必须精确保持受审查的 dev/types/test/lint/build/deploy 集合，禁止 lifecycle/alias 漂移');

    const aliasManifest = JSON.parse(manifest) as { scripts: Record<string, string> };
    aliasManifest.scripts.test = 'pnpm run deploy';
    expect(validateAdminPackageManifest(JSON.stringify(aliasManifest)))
      .toContain('apps/admin scripts 必须精确保持受审查的 dev/types/test/lint/build/deploy 集合，禁止 lifecycle/alias 漂移');
  });

  test('workspace package alias 的跨 app import 被拒绝', () => {
    expect(validateAdminSourceImports("import api from '@mahoshojo/api/internal';", 'apps/admin/src/example.ts'))
      .toEqual(['apps/admin/src/example.ts 跨 app 源码导入']);
  });
});
