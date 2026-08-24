import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const rootDirectory = process.cwd();
const workflowPath = resolve(rootDirectory, '.github/workflows/hono-deploy.yml');
const deployScriptPath = resolve(rootDirectory, 'apps/api/deploy/deploy-bundle.sh');

function readDeployScript(): string | null {
  expect(existsSync(deployScriptPath), 'apps/api 必须拥有 deploy-bundle.sh').toBe(true);
  return existsSync(deployScriptPath) ? readFileSync(deployScriptPath, 'utf8') : null;
}

describe('Hono content-addressed release transaction', () => {
  test('release id 覆盖 bundle、compose 与 deploy script 的完整 tuple', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toMatch(/sha256sum\s+index\.mjs\s+compose\.yml\s+deploy-bundle\.sh\s*>\s*release\.manifest/);
    expect(workflow).toMatch(/sha256sum\s+release\.manifest\s*>\s*release\.sha256/);
    expect(workflow).toContain('artifact/release.manifest');
    expect(workflow).toContain('artifact/release.sha256');
    expect(workflow).toContain("release_id=\"$(awk '{print $1}' artifact/release.sha256)\"");

    const script = readDeployScript();
    if (!script) return;
    expect(script).toContain('release.manifest');
    expect(script).toContain('release.sha256');
    expect(script).toMatch(/sha256sum\s+-c\s+["']?release\.manifest/);
  });

  test('新旧版本都使用各自 release-local compose，失败时恢复整个旧 tuple', () => {
    const script = readDeployScript();
    if (!script) return;

    expect(script).toContain('compose_file="$release_dir/compose.yml"');
    expect(script).not.toContain('compose_file="$root_dir/compose.yml"');
    expect(script).toMatch(/previous_release_dir=.*HONO_RELEASE_DIR/);
    expect(script).toContain('previous_compose_file="$previous_release_dir/compose.yml"');
    expect(script).toContain('rollback_release');
    expect(script).toContain('current.next');
    expect(script).toMatch(/mv\s+-Tf\s+["']?\$root_dir\/current\.next/);
  });

  test('公网 retained-route contract probe 位于部署事务内，失败会进入 rollback', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    const script = readDeployScript();
    if (!script) return;

    expect(workflow).not.toContain('- name: Verify public endpoint');
    expect(workflow).toMatch(/deploy-bundle\.sh[^\n]*https:\/\/homura\.colanns\.me/);

    expect(script).toContain('verify_public_contract');
    expect(script).toContain('/health/ready');
    expect(script).toContain('/api/generate-magical-girl');
    expect(script).toContain("test \"$probe_status\" = '400'");
    expect(script).toContain('Name is required');
    expect(script).toContain('Access-Control-Allow-Origin');

    const transactionStart = script.indexOf('if activate_release');
    const publicProbe = script.indexOf('verify_public_contract', transactionStart);
    const promotion = script.indexOf('promote_release', transactionStart);
    const rollback = script.indexOf('rollback_release', transactionStart);
    expect(transactionStart).toBeGreaterThan(-1);
    expect(publicProbe).toBeGreaterThan(transactionStart);
    expect(promotion).toBeGreaterThan(publicProbe);
    expect(rollback).toBeGreaterThan(promotion);
  });
});
