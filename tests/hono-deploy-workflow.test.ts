import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'comment-json';
import { describe, expect, test } from 'vitest';

const HONO_WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/hono-deploy.yml');
const CLOUDFLARE_WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/cloudflare-deploy.yml');
const PREVIEW_WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/preview-deploy.yml');
const WEB_WRANGLER_PATH = resolve(process.cwd(), 'apps/web/wrangler.jsonc');
const WEB_ENV_EXAMPLE_PATH = resolve(process.cwd(), 'apps/web/env.example');
const HONO_DEPLOY_GUIDE_PATH = resolve(
  process.cwd(),
  'docs/2026-08-22_034220_Hono服务部署与自动发布指南.md',
);
const HONO_COMPOSE_PATH = resolve(process.cwd(), 'apps/api/deploy/compose.yml');
const HONO_DEPLOY_SCRIPT_PATH = resolve(process.cwd(), 'apps/api/deploy/deploy-bundle.sh');
const HONO_INSTALL_SCRIPT_PATH = resolve(process.cwd(), 'apps/api/deploy/install-bundle.sh');
const PRODUCTION_BRANCH = 'refs/heads/feature/v0.2.0_Battle_Growth_MahoShojo';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getJob(workflow: string, jobKey: string): string {
  const escapedJobKey = escapeRegExp(jobKey);
  const jobStart = workflow.match(
    new RegExp(`^  (?:${escapedJobKey}|"${escapedJobKey}"|'${escapedJobKey}')\\s*:\\s*(?:#.*)?$`, 'm'),
  );
  expect(jobStart, `hono-deploy.yml must define a ${jobKey} job`).not.toBeNull();

  const start = jobStart!.index!;
  const followingJob = workflow
    .slice(start + jobStart![0].length)
    .search(/^  (?:"[^"\r\n]+"|'[^'\r\n]+'|[A-Za-z0-9_-]+)\s*:\s*(?:#.*)?$/m);
  const end = followingJob === -1 ? workflow.length : start + jobStart![0].length + followingJob;

  return workflow.slice(start, end);
}

function getStep(job: string, stepName: string): string {
  const stepStart = job.match(
    new RegExp(`^      - name: ${escapeRegExp(stepName)}\\s*(?:#.*)?$`, 'm'),
  );
  expect(stepStart, `workflow job must define a ${stepName} step`).not.toBeNull();

  const start = stepStart!.index!;
  const followingStep = job.slice(start + stepStart![0].length).search(/^      - name:\s/m);
  const end = followingStep === -1 ? job.length : start + stepStart![0].length + followingStep;

  return job.slice(start, end);
}

function getActiveStepLines(step: string): string[] {
  return step
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function getActiveRunLines(step: string): string[] {
  const runMarker = step.match(/^        run: \|\s*$/m);
  expect(runMarker, 'required gate step must use a literal run block').not.toBeNull();
  return getActiveStepLines(step.slice(runMarker!.index! + runMarker![0].length));
}

function hasShellBooleanContinuation(lines: string[]): boolean {
  return lines.some((line) => /(?:&&|\|\|)\s*\\?$/u.test(line));
}

function expectRequiredGateStep(step: string): void {
  expect(step).not.toMatch(/^        (?:continue-on-error|if):/m);
  const runLines = getActiveRunLines(step);
  const runBody = runLines.join('\n');
  expect(runLines[0]).toBe('set -euo pipefail');
  expect(runBody).not.toMatch(/\bset\s+\+(?:e\b|o\s+(?:errexit|pipefail)\b)/u);
  expect(hasShellBooleanContinuation(runLines)).toBe(false);
}

describe('Hono deployment workflow', () => {
  test.each(['true ||', 'false &&', 'true || \\', 'false && \\'])(
    'recognizes a %s shell continuation that could bypass a terminal gate',
    (line) => {
      expect(hasShellBooleanContinuation([line])).toBe(true);
    },
  );

  test('public probe exercises a retained shared route instead of a generic CORS preflight', () => {
    const workflow = readFileSync(HONO_WORKFLOW_PATH, 'utf8');
    const deployScript = readFileSync(HONO_DEPLOY_SCRIPT_PATH, 'utf8');
    const routeInventory = JSON.parse(readFileSync(
      resolve(process.cwd(), 'config/hono-api-routes.json'),
      'utf8',
    )) as { exitedRouteIds: string[]; sharedRouteIds: string[] };
    const probePath = deployScript.match(/\$public_base_url\/api\/([A-Za-z0-9-]+)/)?.[1];

    expect(probePath).toBeDefined();
    expect(routeInventory.sharedRouteIds).toContain(probePath);
    expect(routeInventory.exitedRouteIds).not.toContain(probePath);
    expect(deployScript).toContain('--request POST');
    expect(deployScript).toContain("[ \"$probe_status\" = '400' ]");
    expect(deployScript).toContain('Name is required');
    expect(workflow).not.toContain('- name: Verify public endpoint');
  });

  test('gates the deploy job to the production branch', () => {
    const workflow = readFileSync(HONO_WORKFLOW_PATH, 'utf8');
    const deployJob = getJob(workflow, 'deploy');

    expect(deployJob).toMatch(
      new RegExp(`^    if: github\\.ref == '${escapeRegExp(PRODUCTION_BRANCH)}'\\s*$`, 'm'),
    );
    expect(deployJob).toContain('HONO_HOSTED_API_ENVIRONMENT=production');

    const verificationStep = getStep(getJob(workflow, 'build'), 'Verify Hono authentication and runtime');
    expect(verificationStep).toContain('pnpm --filter @mahoshojo/api run test');
    expect(verificationStep).toContain('pnpm exec vitest run');
    expect(verificationStep).toContain('tests/hono-deploy-workflow.test.ts');
    expect(verificationStep).toContain('tests/hono-deploy-script.test.ts');
  });

  test.each([
    ['Hono', HONO_WORKFLOW_PATH, 'build'],
    ['Cloudflare', CLOUDFLARE_WORKFLOW_PATH, 'deploy'],
  ])('%s workflow verifies workspaces and repository gates through the unified entrypoint', (_, path, jobKey) => {
    const workflow = readFileSync(path, 'utf8');
    const verificationStep = getStep(getJob(workflow, jobKey), 'Verify workspace and repository gates');

    expect(verificationStep).toContain('run: pnpm run ci:verify');
  });

  test('builds and deploys Cloudflare Web through the apps/web lifecycle', () => {
    const workflow = readFileSync(CLOUDFLARE_WORKFLOW_PATH, 'utf8');
    const deployJob = getJob(workflow, 'deploy');

    expect(deployJob).toMatch(
      new RegExp(`^    if: github\\.ref == '${escapeRegExp(PRODUCTION_BRANCH)}'\\s*$`, 'm'),
    );

    expect(getStep(deployJob, 'Build Cloudflare bundle')).toContain(
      'run: pnpm --filter @mahoshojo/web run build:cf',
    );
    expect(getStep(deployJob, 'Deploy production')).toContain(
      'run: pnpm --filter @mahoshojo/web exec wrangler deploy --env production --keep-vars',
    );
    expect(deployJob).not.toContain('- name: Deploy preview');

    const previewWorkflow = readFileSync(PREVIEW_WORKFLOW_PATH, 'utf8');
    expect(getStep(getJob(previewWorkflow, 'deploy-cloudflare-preview'), 'Deploy Cloudflare preview')).toContain(
      'run: pnpm --filter @mahoshojo/web exec wrangler deploy --env preview --keep-vars',
    );
  });

  test('Cloudflare production 与 preview deploy 均要求 Arena finalization secret', () => {
    const wrangler = parse(readFileSync(WEB_WRANGLER_PATH, 'utf8'), undefined, true) as {
      env?: {
        production?: {
          secrets?: { required?: string[] };
        };
        preview?: {
          secrets?: { required?: string[] };
        };
      };
    };
    const webEnvExample = readFileSync(WEB_ENV_EXAMPLE_PATH, 'utf8');

    expect(wrangler.env?.production?.secrets?.required).toContain(
      'ARENA_FINALIZATION_HMAC_SECRET',
    );
    expect(wrangler.env?.preview?.secrets?.required).toContain(
      'ARENA_FINALIZATION_HMAC_SECRET',
    );
    expect(webEnvExample).toContain('ARENA_FINALIZATION_HMAC_SECRET=');
    expect(webEnvExample).toContain('必须与 Hono 使用同一个独立 secret');
  });

  test('preview 分支串行发布隔离 Hono 后再发布 Cloudflare', () => {
    const workflow = readFileSync(PREVIEW_WORKFLOW_PATH, 'utf8');
    const verifyJob = getJob(workflow, 'verify-and-build-hono');
    const cloudflareBuildJob = getJob(workflow, 'verify-and-build-cloudflare');
    const honoJob = getJob(workflow, 'deploy-hono-preview');
    const cloudflareJob = getJob(workflow, 'deploy-cloudflare-preview');

    for (const job of [verifyJob, honoJob, cloudflareJob]) {
      expect(job).toMatch(/^    if: github\.ref == 'refs\/heads\/preview'\s*$/m);
    }
    expect(workflow).toMatch(/branches:\s*\n\s*- preview/u);
    expect(honoJob).toContain('HONO_DEPLOY_ROOT_DIR: /opt/mahoshojo-hono-preview');
    expect(honoJob).toContain('HONO_CONTAINER_NAME: mahoshojo-hono-preview');
    expect(honoJob).toContain("HONO_BIND_PORT: '8081'");
    expect(honoJob).toContain('HONO_REDIS_KEY_PREFIX: ${{ vars.PREVIEW_REDIS_KEY_PREFIX }}');
    expect(honoJob).toContain('HONO_REDIS_NETWORK_NAME: ${{ vars.PREVIEW_REDIS_NETWORK_NAME }}');
    expect(honoJob).toContain('PREVIEW_VPS_HOST: ${{ vars.PREVIEW_VPS_HOST }}');
    expect(honoJob).toContain('PREVIEW_VPS_USER: ${{ vars.PREVIEW_VPS_USER }}');
    expect(honoJob).toContain('PREVIEW_VPS_SSH_PRIVATE_KEY: ${{ secrets.PREVIEW_VPS_SSH_PRIVATE_KEY }}');
    expect(honoJob).toContain('PREVIEW_VPS_HOST_KEY: ${{ secrets.PREVIEW_VPS_HOST_KEY }}');
    expect(honoJob).toContain('check:preview:environment -- --require-provisioned');
    expect(honoJob).toContain('https://homura-preview.colanns.me');
    expect(cloudflareBuildJob).toContain('needs: verify-and-build-hono');
    expect(cloudflareBuildJob).toContain('run: pnpm --filter @mahoshojo/web run build:cf');
    expect(honoJob).toContain('- verify-and-build-hono');
    expect(honoJob).toContain('- verify-and-build-cloudflare');
    expect(cloudflareJob).toContain('- deploy-hono-preview');
    expect(cloudflareJob).toContain('- verify-and-build-cloudflare');
    expect(cloudflareJob).toContain(
      'NEXT_PUBLIC_HONO_API_ORIGIN: https://homura-preview.colanns.me',
    );
  });

  test('preview Hono deploy 在资源门禁前初始化 pnpm、Node.js 与依赖', () => {
    const workflow = readFileSync(PREVIEW_WORKFLOW_PATH, 'utf8');
    const honoJob = getJob(workflow, 'deploy-hono-preview');
    const setupPnpmStep = getStep(honoJob, 'Setup pnpm');
    const setupNodeStep = getStep(honoJob, 'Setup Node.js');
    const installStep = getStep(honoJob, 'Install dependencies');

    expect(setupPnpmStep).toContain('uses: pnpm/action-setup@v6');
    expect(setupPnpmStep).toContain('version: 11.3.0');
    expect(setupNodeStep).toContain('uses: actions/setup-node@v6');
    expect(setupNodeStep).toContain('node-version: 22');
    expect(setupNodeStep).toContain('cache: pnpm');
    expect(installStep).toContain('run: pnpm install --frozen-lockfile');

    const setupPnpmIndex = honoJob.indexOf('- name: Setup pnpm');
    const setupNodeIndex = honoJob.indexOf('- name: Setup Node.js');
    const installIndex = honoJob.indexOf('- name: Install dependencies');
    const gateIndex = honoJob.indexOf('- name: Require preview resources and authority isolation');

    expect(setupNodeIndex).toBeGreaterThan(setupPnpmIndex);
    expect(installIndex).toBeGreaterThan(setupNodeIndex);
    expect(gateIndex).toBeGreaterThan(installIndex);
  });

  test('builds the Hono container before assembling and uploading the deployment artifact', () => {
    const workflow = readFileSync(HONO_WORKFLOW_PATH, 'utf8');
    const compose = readFileSync(HONO_COMPOSE_PATH, 'utf8');
    const buildJob = getJob(workflow, 'build');
    const containerBuildStep = getStep(buildJob, 'Verify Hono container build');
    const activeLines = getActiveRunLines(containerBuildStep);
    const composeConfigCommand = 'sudo --preserve-env=HONO_RELEASE_DIR,HONO_HOSTED_API_ENVIRONMENT docker compose -f apps/api/deploy/compose.yml config --no-env-resolution';
    const composeEnvironmentSafetyCheck = 'sudo test ! -e "$COMPOSE_ENV_DIRECTORY"';
    const composeEnvironmentSymlinkCheck = 'sudo test ! -L "$COMPOSE_ENV_DIRECTORY"';
    const composeEnvironmentCleanupTrap = 'trap cleanup_compose_environment EXIT';
    const composeEnvironmentDirectoryCreate = 'sudo mkdir -m 700 -- "$COMPOSE_ENV_DIRECTORY"';
    const composeEnvironmentInstall = 'sudo install -m 600 /dev/null "$COMPOSE_ENV_FILE"';
    const composeEnvironmentFileCleanup = 'sudo rm -f -- "$COMPOSE_ENV_FILE"';
    const composeEnvironmentDirectoryCleanup = 'sudo rmdir -- "$COMPOSE_ENV_DIRECTORY"';
    const containerCommands = [
      'docker build --file apps/api/Dockerfile .',
      composeConfigCommand,
    ];

    expectRequiredGateStep(containerBuildStep);
    expect(containerBuildStep).toContain('HONO_RELEASE_DIR: /tmp/mahoshojo-hono-release');
    expect(containerBuildStep).toContain('HONO_HOSTED_API_ENVIRONMENT: production');
    expect(containerBuildStep).toContain(
      'COMPOSE_ENV_DIRECTORY: /opt/mahoshojo-hono',
    );
    expect(containerBuildStep).toContain(
      'COMPOSE_ENV_FILE: /opt/mahoshojo-hono/.env.hono',
    );
    expect(compose).toContain(
      '- ${HONO_DEPLOY_ROOT_DIR:-/opt/mahoshojo-hono}/.env.hono',
    );
    expect(compose).toContain(
      'HOSTED_API_ENVIRONMENT: ${HONO_HOSTED_API_ENVIRONMENT:?HONO_HOSTED_API_ENVIRONMENT must be explicit}',
    );
    expect(activeLines).toContain(composeEnvironmentSafetyCheck);
    expect(activeLines).toContain(composeEnvironmentSymlinkCheck);
    expect(activeLines).toContain(composeEnvironmentCleanupTrap);
    expect(activeLines).toContain(composeEnvironmentDirectoryCreate);
    expect(activeLines).not.toContain('sudo install -d -m 700 "$COMPOSE_ENV_DIRECTORY"');
    expect(activeLines).toContain(composeEnvironmentInstall);
    expect(activeLines).toContain(composeEnvironmentFileCleanup);
    expect(activeLines).toContain(composeEnvironmentDirectoryCleanup);
    const cleanupStart = activeLines.indexOf('cleanup_compose_environment() {');
    const cleanupEnd = activeLines.indexOf('}', cleanupStart);
    expect(activeLines.slice(cleanupStart, cleanupEnd + 1)).toEqual([
      'cleanup_compose_environment() {',
      composeEnvironmentFileCleanup,
      composeEnvironmentDirectoryCleanup,
      '}',
    ]);
    expect(activeLines.indexOf(composeEnvironmentSafetyCheck)).toBeLessThan(
      activeLines.indexOf(composeEnvironmentSymlinkCheck),
    );
    expect(activeLines.indexOf(composeEnvironmentSymlinkCheck)).toBeLessThan(
      activeLines.indexOf(composeEnvironmentDirectoryCreate),
    );
    expect(activeLines.indexOf(composeEnvironmentDirectoryCreate)).toBeLessThan(
      activeLines.indexOf(composeEnvironmentCleanupTrap),
    );
    expect(activeLines.indexOf(composeEnvironmentCleanupTrap)).toBeLessThan(
      activeLines.indexOf(composeEnvironmentInstall),
    );
    expect(activeLines.indexOf(composeEnvironmentInstall)).toBeLessThan(
      activeLines.indexOf(composeConfigCommand),
    );
    expect(activeLines.slice(-2)).toEqual(containerCommands);
    expect(buildJob.indexOf(containerBuildStep)).toBeLessThan(
      buildJob.indexOf('- name: Build single-file server'),
    );
  });

  test('verifies the built runtime against isolated local D1 and real Redis', () => {
    const workflow = readFileSync(HONO_WORKFLOW_PATH, 'utf8');
    const buildJob = getJob(workflow, 'build');
    const runtimeStep = getStep(buildJob, 'Verify Hono built runtime integration');
    const activeJobLines = getActiveStepLines(buildJob);
    const activeStepLines = getActiveStepLines(runtimeStep);
    const activeLines = getActiveRunLines(runtimeStep);
    const gatewayCommand = 'pnpm --filter @mahoshojo/d1-gateway exec wrangler dev --local \\';
    const healthProbe = 'if curl --fail --silent --show-error "$D1_GATEWAY_URL/health" >/dev/null; then';
    const runtimeVerifier = 'pnpm run verify:server:runtime';
    const arenaRedisVerifier = 'pnpm --filter @mahoshojo/api run verify:arena-redis';
    const hostedDrRedisVerifier = 'REDIS_URL=redis://127.0.0.1:6379/15 pnpm run verify:hosted-dr:redis';

    expectRequiredGateStep(runtimeStep);
    expect(buildJob).toMatch(/^    services:\s*\n      redis:\s*$/m);
    expect(activeJobLines).toContain('image: redis:7-alpine');
    expect(activeJobLines).toContain('- 6379:6379');
    expect(activeJobLines).toContain('--health-cmd "redis-cli ping"');
    expect(activeStepLines).toContain('REDIS_URL: redis://127.0.0.1:6379');
    expect(activeStepLines).toContain('D1_GATEWAY_URL: http://127.0.0.1:8788');
    expect(activeStepLines).toContain(
      'D1_GATEWAY_HMAC_SECRET: g25c-ci-only-d1-gateway-hmac-secret',
    );
    expect(activeStepLines).toContain(
      'ARENA_FINALIZATION_HMAC_SECRET: g25r-ci-only-independent-finalization-secret',
    );
    expect(activeStepLines).toContain('R2_BUCKET_NAME: g25r-ci-only-r2-bucket');
    expect(runtimeStep).not.toContain('${{ secrets.');
    expect(runtimeStep).not.toContain('--remote');
    expect(runtimeStep).not.toMatch(/CLOUDFLARE_(?:ACCOUNT_ID|API_TOKEN)|D1_DATABASE_ID/u);
    expect(activeLines).toContain(gatewayCommand);
    expect(activeLines).toContain('--ip 127.0.0.1 \\');
    expect(activeLines).toContain('--port 8788 \\');
    expect(activeLines).toContain('--persist-to "$RUNNER_TEMP/d1-gateway-state" \\');
    expect(activeLines).toContain(healthProbe);
    expect(activeLines).toContain('trap cleanup EXIT');
    expect(activeLines).toContain(arenaRedisVerifier);
    expect(activeLines).toContain(hostedDrRedisVerifier);
    expect(activeLines.at(-1)).toBe(runtimeVerifier);
    expect(activeLines.indexOf(gatewayCommand)).toBeLessThan(activeLines.indexOf(healthProbe));
    expect(activeLines.indexOf(healthProbe)).toBeLessThan(activeLines.indexOf(runtimeVerifier));
    expect(activeLines.indexOf(arenaRedisVerifier)).toBeLessThan(
      activeLines.indexOf(runtimeVerifier),
    );
    expect(activeLines.indexOf(hostedDrRedisVerifier)).toBeLessThan(
      activeLines.indexOf(runtimeVerifier),
    );
    expect(buildJob.indexOf('- name: Build single-file server')).toBeLessThan(
      buildJob.indexOf(runtimeStep),
    );
    expect(buildJob.indexOf(runtimeStep)).toBeLessThan(
      buildJob.indexOf('- name: Upload bundle'),
    );
  });

  test('uploads to random staging and atomically installs under the deploy lock', () => {
    const workflow = readFileSync(HONO_WORKFLOW_PATH, 'utf8');
    const installer = readFileSync(HONO_INSTALL_SCRIPT_PATH, 'utf8');
    const uploadStep = getStep(getJob(workflow, 'deploy'), 'Upload release');

    expect(uploadStep).toContain("'sh -s -- create' < apps/api/deploy/install-bundle.sh");
    expect(uploadStep).toContain('"sh -s -- install');
    expect(uploadStep).toContain('< apps/api/deploy/install-bundle.sh');
    expect(uploadStep).toContain('/releases/.upload.');
    expect(uploadStep).not.toContain('install -d -m 755 /opt/mahoshojo-hono/releases/$release_id');
    expect(uploadStep).toContain("''|*[!0-9a-f]*)");
    expect(uploadStep).toContain('test "${#release_id}" -eq 64');
    expect(uploadStep).toContain("''|*[!A-Za-z0-9]*)");
    expect(uploadStep.indexOf("case \"$release_id\"")).toBeLessThan(
      uploadStep.indexOf("\"sh -s -- install '$release_id' '$upload_dir'\""),
    );
    expect(uploadStep.indexOf('case "$upload_suffix"')).toBeLessThan(
      uploadStep.indexOf('scp -i ~/.ssh/deploy_key'),
    );
    expect(installer).toContain('flock -n 9');
    expect(installer).toContain('mktemp -d "$releases_dir/.upload.XXXXXX"');
    expect(installer).toContain('mv -Tn "$staging_dir" "$final_dir"');
    expect(installer.match(/verify_uploaded_tuple "\$final_dir" "\$release_id"/gu)).toHaveLength(2);
  });

  test('手工发布指南生成并上传当前七文件 release tuple', () => {
    const guide = readFileSync(HONO_DEPLOY_GUIDE_PATH, 'utf8');

    expect(guide).toContain(
      'cp config/arena-room-release-gate.json apps/api/dist/arena-room-release-gate.json',
    );
    expect(guide).toContain(
      'cp scripts/arena-room-release-gate-schema.mjs apps/api/dist/arena-room-release-gate-schema.mjs',
    );
    expect(guide).toMatch(
      /sha256sum index\.mjs compose\.yml deploy-bundle\.sh \\\s+arena-room-release-gate\.json arena-room-release-gate-schema\.mjs > release\.manifest/u,
    );
    expect(guide).toMatch(
      /scp apps\/api\/dist\/index\.mjs[\s\S]*apps\/api\/dist\/arena-room-release-gate\.json[\s\S]*apps\/api\/dist\/arena-room-release-gate-schema\.mjs[\s\S]*apps\/api\/dist\/release\.sha256/u,
    );
    expect(guide).toContain('精确七文件 tuple');
    expect(guide).not.toContain('精确五文件 tuple');
  });

  test('手工回退指南从 immutable current tuple 发起并声明数据边界', () => {
    const guide = readFileSync(HONO_DEPLOY_GUIDE_PATH, 'utf8');

    expect(guide).toContain('ROLLBACK_BASELINE_RELEASE_ID=<previous-release-id>');
    expect(guide).toContain(
      'current_dir="$(readlink -f /opt/mahoshojo-hono/current)"',
    );
    expect(guide).toContain(
      '"$current_dir/deploy-bundle.sh" rollback "$target_id" https://homura.colanns.me',
    );
    expect(guide).toContain('不得调用根旧 `deploy-bundle.sh`');
    expect(guide).toContain('不得删除 `deployment-format` 或 `deploy.transaction`');
    expect(guide).toContain('不得通过 full git revert');
    expect(guide).toContain('不会 flush/restore Redis，也不会回滚 D1 或 R2');
    expect(guide).toContain('wrangler versions list --env production --json');
    expect(guide).toContain(
      'wrangler rollback "$worker_version_id" --env production --yes --message "$rollback_reason"',
    );
  });

  test('所有 Hono artifact 与部署生命周期都引用 apps/api owner', () => {
    const workflow = readFileSync(HONO_WORKFLOW_PATH, 'utf8');
    const buildJob = getJob(workflow, 'build');
    const deployJob = getJob(workflow, 'deploy');

    expect(buildJob).toContain('pnpm --filter @mahoshojo/api');
    expect(buildJob).toContain('apps/api/dist');
    expect(buildJob).toContain('apps/api/deploy/compose.yml');
    expect(buildJob).toContain('apps/api/deploy/deploy-bundle.sh');
    expect(workflow).not.toContain('Dockerfile.hono');
    expect(workflow).not.toContain('deploy/hono/');
    expect(deployJob).toContain('artifact/release.sha256');
    expect(deployJob).not.toContain('artifact/index.mjs.sha256');
  });

  test('finds a quoted deploy job key with an inline comment', () => {
    const workflow = [
      'jobs:',
      '  build-task: # build job',
      '    runs-on: ubuntu-latest',
      '  "deploy": # deploy job',
      '    if: github.ref == \'refs/heads/feature/v0.2.0_Battle_Growth_MahoShojo\'',
      '  post-job: # following job',
      '    runs-on: ubuntu-latest',
    ].join('\n');

    const deployJob = getJob(workflow, 'deploy');
    expect(deployJob).toContain('if: github.ref');
    expect(deployJob).not.toContain('post-job');
  });
});
