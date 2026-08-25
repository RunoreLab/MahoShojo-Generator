import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const HONO_WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/hono-deploy.yml');
const CLOUDFLARE_WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/cloudflare-deploy.yml');
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

    const verificationStep = getStep(getJob(workflow, 'build'), 'Verify Hono authentication and runtime');
    expect(verificationStep).toContain('pnpm --filter @mahoshojo/api run test');
    expect(verificationStep).toContain('pnpm exec vitest run');
    expect(verificationStep).toContain('tests/hono-deploy-workflow.test.ts');
    expect(verificationStep).toContain('tests/hono-deploy-script.test.ts');
  });

  test.each([
    ['Hono', HONO_WORKFLOW_PATH, 'build'],
    ['Cloudflare', CLOUDFLARE_WORKFLOW_PATH, 'deploy'],
  ])('%s workflow verifies workspaces and the legacy root through the unified entrypoint', (_, path, jobKey) => {
    const workflow = readFileSync(path, 'utf8');
    const verificationStep = getStep(getJob(workflow, jobKey), 'Verify workspace and legacy root');

    expect(verificationStep).toContain('run: pnpm run ci:verify');
  });

  test('builds the Hono container before assembling and uploading the deployment artifact', () => {
    const workflow = readFileSync(HONO_WORKFLOW_PATH, 'utf8');
    const compose = readFileSync(HONO_COMPOSE_PATH, 'utf8');
    const buildJob = getJob(workflow, 'build');
    const containerBuildStep = getStep(buildJob, 'Verify Hono container build');
    const activeLines = getActiveRunLines(containerBuildStep);
    const composeConfigCommand = 'sudo --preserve-env=HONO_RELEASE_DIR docker compose -f apps/api/deploy/compose.yml config --no-env-resolution';
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
    expect(containerBuildStep).toContain(
      'COMPOSE_ENV_DIRECTORY: /opt/mahoshojo-hono',
    );
    expect(containerBuildStep).toContain(
      'COMPOSE_ENV_FILE: /opt/mahoshojo-hono/.env.hono',
    );
    expect(compose).toContain('- /opt/mahoshojo-hono/.env.hono');
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
    expect(activeLines.at(-1)).toBe(runtimeVerifier);
    expect(activeLines.indexOf(gatewayCommand)).toBeLessThan(activeLines.indexOf(healthProbe));
    expect(activeLines.indexOf(healthProbe)).toBeLessThan(activeLines.indexOf(runtimeVerifier));
    expect(activeLines.indexOf(arenaRedisVerifier)).toBeLessThan(
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
