import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

const text = readFileSync(new URL('../.github/workflows/desktop-release-candidate.yml', import.meta.url), 'utf8');
const workflow = parse(text);

describe('desktop candidate workflow privilege and promotion boundary', () => {
  test('only manual runs use a fixed release environment after repository checks', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(workflow.jobs.verify.uses).toBe('./.github/workflows/ci.yml');
    expect(Object.keys(workflow.jobs)).toEqual(['verify', 'candidate']);
    expect(workflow.jobs.candidate.needs).toBe('verify');
    expect(workflow.jobs.candidate.environment).toBe('desktop-release');
    // 每次上传的 artifact 带 run ID；候选构建不修改共享 Release，无需跨版本串行锁。
    expect(workflow.concurrency).toBeUndefined();
    expect(text).not.toContain('DESKTOP_RELEASE_ENABLED');
    expect(workflow.jobs.candidate.steps.filter((step: { run?: string }) => step.run?.includes('--check-source'))).toHaveLength(1);
  });

  test('never grants Release write permission or embeds untrusted inputs in shell source', () => {
    expect(workflow.permissions.contents).toBe('read');
    expect(workflow.jobs.candidate.permissions).toEqual({ contents: 'read', 'id-token': 'write', attestations: 'write' });
    for (const step of workflow.jobs.candidate.steps) {
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
    expect(steps[attestIndex + 1].env.ATTESTATION_BUNDLE_PATH).toBe('${{ steps.attest.outputs.bundle-path }}');
    expect(steps[attestIndex + 1].run).toContain('-Destination .tmp/desktop-release-candidate/provenance.jsonl');
    expect(steps[attestIndex + 2].with.path).toBe('.tmp/desktop-release-candidate/*');
  });

  test('internal packaging stays usable without the updater private key', () => {
    const internalText = readFileSync(new URL('../.github/workflows/desktop-package.yml', import.meta.url), 'utf8');
    const internal = parse(internalText);
    expect(Object.keys(internal.on)).toEqual(['workflow_dispatch']);
    const build = internal.jobs['package-nsis'].steps.find((step: { name: string }) => step.name === 'Build desktop app and NSIS bundle');
    expect(build.run).toContain('{"bundle":{"createUpdaterArtifacts":false}}');
    expect(build.run).toContain('tauri build --config "$internalConfig"');
    expect(internalText).not.toContain('secrets.');
  });
});
