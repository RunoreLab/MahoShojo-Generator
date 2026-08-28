import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const rootDirectory = process.cwd();
const workflowPath = resolve(rootDirectory, '.github/workflows/hono-deploy.yml');
const deployScriptPath = resolve(rootDirectory, 'apps/api/deploy/deploy-bundle.sh');
const dockerfilePath = resolve(rootDirectory, 'apps/api/Dockerfile');
const composePath = resolve(rootDirectory, 'apps/api/deploy/compose.yml');

function readDeployScript(): string | null {
  expect(existsSync(deployScriptPath), 'apps/api 必须拥有 deploy-bundle.sh').toBe(true);
  return existsSync(deployScriptPath) ? readFileSync(deployScriptPath, 'utf8') : null;
}

describe('Hono content-addressed release transaction', () => {
  test('构建、Compose 与 runtime 预检使用同一 Node 镜像 digest', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8');
    const compose = readFileSync(composePath, 'utf8');
    const script = readDeployScript();
    if (!script) return;

    const imagePattern = 'node:22-alpine@sha256:[0-9a-f]{64}';
    const dockerfileImages = [...dockerfile.matchAll(
      new RegExp(`^FROM (${imagePattern})(?: AS [a-z]+)?$`, 'gmu'),
    )].map((match) => match[1]);
    const composeImage = compose.match(new RegExp(`^\\s*image: (${imagePattern})$`, 'mu'))?.[1];
    const runtimeImage = script.match(
      new RegExp(`^runtime_image='(${imagePattern})'$`, 'mu'),
    )?.[1];

    expect(dockerfileImages).toHaveLength(2);
    expect(new Set(dockerfileImages)).toEqual(new Set([composeImage]));
    expect(runtimeImage).toBe(composeImage);
  });

  test('release id 覆盖 bundle、compose 与 deploy script 的完整 tuple', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toMatch(/sha256sum\s+index\.mjs\s+compose\.yml\s+deploy-bundle\.sh\s+\\\s+arena-room-release-gate\.json\s+arena-room-release-gate-schema\.mjs\s*>\s*release\.manifest/);
    expect(workflow).toMatch(/sha256sum\s+release\.manifest\s*>\s*release\.sha256/);
    expect(workflow).toContain('artifact/release.manifest');
    expect(workflow).toContain('artifact/release.sha256');
    expect(workflow).toContain('artifact/arena-room-release-gate.json');
    expect(workflow).toContain('artifact/arena-room-release-gate-schema.mjs');
    expect(workflow).toContain("release_id=\"$(awk '{print $1}' artifact/release.sha256)\"");

    const script = readDeployScript();
    if (!script) return;
    expect(script).toContain('release.manifest');
    expect(script).toContain('release.sha256');
    expect(script).toContain('arena-room-release-gate.json');
    expect(script).toContain('arena-room-release-gate-schema.mjs');
    expect(script).toContain('node /gate-schema.mjs --manifest /gate.json');
    expect(script).toMatch(/sha256sum\s+-c\s+["']?release\.manifest/);
  });

  test('release tuple 为 Arena Room 保留独立的精确网页 Origin 配置', () => {
    const compose = readFileSync(composePath, 'utf8');
    const script = readDeployScript();
    if (!script) return;

    expect(compose).toContain('HONO_CORS_ORIGINS: "https://*.colanns.me"');
    expect(compose).toContain(
      'ARENA_ROOM_ALLOWED_ORIGINS: "https://mahoshojo.colanns.me"',
    );
    expect(script).toContain("-e HONO_CORS_ORIGINS='https://*.colanns.me'");
    expect(script).toContain(
      "-e ARENA_ROOM_ALLOWED_ORIGINS='https://mahoshojo.colanns.me'",
    );
  });

  test('新旧版本都使用各自 release-local compose，失败时恢复整个旧 tuple', () => {
    const script = readDeployScript();
    if (!script) return;

    expect(script).toContain('compose_file="$release_dir/compose.yml"');
    expect(script).not.toContain('compose_file="$root_dir/compose.yml"');
    expect(script).toMatch(/candidate_previous=.*HONO_RELEASE_DIR/);
    expect(script).toContain('restore_previous_tuple');
    expect(script).toContain('rollback_transaction');
    expect(script).toContain('current.next');
    expect(script).toMatch(/mv\s+-Tf\s+["']?\$root_dir\/current\.next/);
    expect(script).toContain('verify_release_tuple "$previous_release_dir"');
    expect(script).toContain('validate_release_compose "$previous_release_dir"');
  });

  test('部署事务有跨进程互斥、持久 journal、信号回滚与 next-start recovery', () => {
    const script = readDeployScript();
    if (!script) return;

    expect(script).toMatch(/flock\s+-n\s+9/u);
    expect(script).toContain('transaction_file="$root_dir/deploy.transaction"');
    expect(script).toContain('write_transaction');
    expect(script).toContain('recover_pending_transaction');
    expect(script).toMatch(/trap\s+[^\n]*(?:HUP|INT|TERM)/u);

    const recovery = script.indexOf('recover_pending_transaction');
    const activation = script.indexOf('if activate_release');
    expect(recovery).toBeGreaterThan(-1);
    expect(activation).toBeGreaterThan(recovery);
  });

  test('显式纳管旧文档布局并用 format marker 禁止 managed 状态降级', () => {
    const script = readDeployScript();
    if (!script) return;

    expect(script).toContain('adopt_legacy_layout');
    expect(script).toContain('legacy-layout');
    expect(script).toContain('index.mjs.sha256');
    expect(script).toContain('$root_dir/compose.yml');
    expect(script).toContain('format_file="$root_dir/deployment-format"');
    expect(script).toContain('release-tuple-v2');
    expect(script).toContain('verify_legacy_release');
  });

  test('metadata 与 probe 使用安全临时文件，candidate/previous 运行同等级生产预检', () => {
    const script = readDeployScript();
    if (!script) return;

    expect(script).toContain('mktemp "$root_dir/.env.next.XXXXXX"');
    expect(script).toContain('mktemp "$root_dir/.deploy.transaction.next.XXXXXX"');
    expect(script).toContain('mktemp -d /tmp/mahoshojo-hono-probe.XXXXXX');
    expect(script).toContain('validate_release_runtime "$release_dir"');
    expect(script).toContain('validate_release_runtime "$previous_release_dir"');
    expect(script).toContain('run_cancellable curl');
    expect(script).toContain('hosted_api_environment="${HONO_HOSTED_API_ENVIRONMENT:-}"');
    expect(script).not.toContain('HONO_HOSTED_API_ENVIRONMENT:-production');
    expect(script).toContain('HONO_REDIS_KEY_PREFIX=preview');
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
    expect(script).toContain('[ "$probe_status" = \'400\' ]');
    expect(script).toContain('Name is required');
    expect(script).toContain('Access-Control-Allow-Origin');

    const transactionStart = script.indexOf('if activate_release');
    const publicProbe = script.indexOf('verify_public_contract', transactionStart);
    const promotion = script.indexOf('promote_release', transactionStart);
    const rollback = script.indexOf('rollback_transaction', transactionStart);
    expect(transactionStart).toBeGreaterThan(-1);
    expect(publicProbe).toBeGreaterThan(transactionStart);
    expect(promotion).toBeGreaterThan(publicProbe);
    expect(rollback).toBeGreaterThan(promotion);
  });
});
