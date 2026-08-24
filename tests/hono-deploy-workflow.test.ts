import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const HONO_WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/hono-deploy.yml');
const CLOUDFLARE_WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/cloudflare-deploy.yml');
const HONO_DEPLOY_SCRIPT_PATH = resolve(process.cwd(), 'apps/api/deploy/deploy-bundle.sh');
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

describe('Hono deployment workflow', () => {
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
    expect(deployScript).toContain("test \"$probe_status\" = '400'");
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
    const buildJob = getJob(workflow, 'build');
    const containerBuildStep = getStep(buildJob, 'Verify Hono container build');

    expect(containerBuildStep).toContain('run: docker build --file apps/api/Dockerfile .');
    expect(buildJob.indexOf(containerBuildStep)).toBeLessThan(
      buildJob.indexOf('- name: Build single-file server'),
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
