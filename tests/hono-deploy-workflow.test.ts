import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const productionWorkflow = () => readFileSync(resolve('.github/workflows/hono-deploy.yml'), 'utf8');
const previewWorkflow = () => readFileSync(resolve('.github/workflows/preview-deploy.yml'), 'utf8');

describe('Hono deployment workflows', () => {
  test('production 不重复整仓 ci:verify，保留部署特有验证并按 Hono → Cloudflare 顺序发布', () => {
    const workflow = productionWorkflow();

    expect(workflow).not.toContain('pnpm run ci:verify');
    expect(workflow).toContain('Verify Hono container build');
    expect(workflow).toContain('Verify Hono built runtime integration');
    expect(workflow).toMatch(/deploy:\s*[\s\S]*?needs: build/u);
    expect(workflow).toMatch(/deploy-cloudflare:\s*[\s\S]*?needs: deploy/u);
    expect(workflow).toContain('environment: hono-production');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('~/.ssh/known_hosts');
  });

  test('production 直接上传五文件 release 目录并运行其中的部署脚本', () => {
    const workflow = productionWorkflow();

    expect(workflow).toContain('release_dir="/opt/mahoshojo-hono/releases/$release_id"');
    expect(workflow).toContain("test ! -L '$release_dir'");
    expect(workflow).toContain('artifact/index.mjs');
    expect(workflow).toContain('artifact/compose.yml');
    expect(workflow).toContain('artifact/deploy-bundle.sh');
    expect(workflow).toContain('artifact/release.manifest');
    expect(workflow).toContain('artifact/release.sha256');
    expect(workflow).toContain("'$release_dir/deploy-bundle.sh' publish '$release_id'");
    expect(workflow).not.toContain('install-bundle.sh');
    expect(workflow).not.toContain('/releases/.upload.');
  });

  test('preview 使用隔离 target 并在 Hono 成功后发布 Web', () => {
    const workflow = previewWorkflow();

    expect(workflow).toContain('HONO_REDIS_KEY_PREFIX: preview');
    expect(workflow).toContain('HONO_HOSTED_API_ENVIRONMENT=preview');
    expect(workflow).toContain('release_dir="$HONO_DEPLOY_ROOT_DIR/releases/$release_id"');
    expect(workflow).toContain("'$release_dir/deploy-bundle.sh' publish '$release_id'");
    expect(workflow).toMatch(/deploy-cloudflare-preview:\s*[\s\S]*?- deploy-hono-preview/u);
    expect(workflow).not.toContain('install-bundle.sh');
  });

  test('multiplayer 输入只控制 Web exposure，Hono 读取服务器 feature flag', () => {
    const combined = `${productionWorkflow()}\n${previewWorkflow()}`;

    expect(combined).toContain('ARENA_MULTIPLAYER_ENABLED');
    expect(combined).toContain('Hono runtime 由服务器 ARENA_MULTIPLAYER_ENABLED 控制');
    expect(combined).not.toContain('ARENA_ROOM_WRITER_ACTIVATION');
    expect(combined).not.toContain('ARENA_ROOM_PRODUCTION_GO_NO_GO');
    expect(combined).not.toContain('arena-room-release-gate');
  });
});
