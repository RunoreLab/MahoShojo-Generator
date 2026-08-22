import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/hono-deploy.yml');
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
  test('gates the deploy job to the production branch', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    const deployJob = getJob(workflow, 'deploy');

    expect(deployJob).toMatch(
      new RegExp(`^    if: github\\.ref == '${escapeRegExp(PRODUCTION_BRANCH)}'\\s*$`, 'm'),
    );

    const verificationStep = getStep(getJob(workflow, 'build'), 'Verify Hono authentication and runtime');
    expect(verificationStep).toContain('run: pnpm exec vitest run');
    expect(verificationStep).toContain('tests/hono-deploy-workflow.test.ts');
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
