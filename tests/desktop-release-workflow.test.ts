import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

const text = readFileSync(new URL('../.github/workflows/desktop-release-candidate.yml', import.meta.url), 'utf8');
const workflow = parse(text);

describe('desktop candidate workflow privilege and promotion boundary', () => {
  test('only manual runs use a fixed release environment after repository checks', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(workflow.jobs.verify.needs).toBe('preflight');
    expect(workflow.jobs.verify.uses).toBe('./.github/workflows/ci.yml');
    expect(workflow.jobs.preflight.steps.at(-1).run).toContain('--check-source');
    expect(workflow.jobs.preflight.environment).toBeUndefined();
    expect(workflow.jobs.preflight.steps.some((step: { run?: string }) => step.run?.includes('pnpm'))).toBe(false);
    expect(workflow.jobs.candidate.needs).toBe('verify');
    expect(workflow.jobs.candidate.environment).toBe('desktop-release');
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    expect(workflow.jobs.candidate.steps[0].env.RELEASE_ENABLED).toBe('${{ vars.DESKTOP_RELEASE_ENABLED }}');
  });

  test('never grants Release write permission or embeds untrusted inputs in shell source', () => {
    expect(workflow.permissions.contents).toBe('read');
    expect(workflow.jobs.candidate.permissions).toEqual({ contents: 'read', 'id-token': 'write', attestations: 'write' });
    for (const step of [...workflow.jobs.candidate.steps, ...workflow.jobs.preflight.steps]) {
      if (step.run) expect(step.run).not.toMatch(/\$\{\{\s*(inputs|github\.event)/u);
    }
    expect(text).not.toMatch(/gh release|git tag|git push|contents: write|--clobber/u);
  });

  test('exposes signing secrets only to build, then attests and uploads the same staged directory', () => {
    const steps = workflow.jobs.candidate.steps;
    const keySteps = steps.filter((step: { env?: Record<string, string> }) => JSON.stringify(step.env ?? {}).includes('secrets.'));
    expect(keySteps).toHaveLength(1);
    expect(keySteps[0].run).toContain('tauri build --target x86_64-pc-windows-msvc');
    const stagingIndex = steps.findIndex((step: { name: string }) => step.name === 'Stage immutable candidate files');
    const attestIndex = steps.findIndex((step: { id?: string }) => step.id === 'attest');
    expect(attestIndex).toBe(stagingIndex + 1);
    expect(steps[attestIndex].with['subject-path']).toBe('.tmp/desktop-release-candidate/*');
    expect(steps[attestIndex + 1].with.path).toContain('.tmp/desktop-release-candidate/*');
    expect(steps[attestIndex + 1].with.path).toContain('${{ steps.attest.outputs.bundle-path }}');
  });
});
