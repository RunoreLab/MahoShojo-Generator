import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();

describe('repository CI workflow', () => {
  it('在 pull request 与平台重整分支上执行统一 verification，不重复 preview 门禁或专项演练', () => {
    const workflowPath = path.join(repositoryRoot, '.github/workflows/ci.yml');
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = readFileSync(workflowPath, 'utf8');
    const verifyJobStart = workflow.indexOf('\n  verify:');
    expect(verifyJobStart).toBeGreaterThanOrEqual(0);
    const verifyJob = workflow.slice(verifyJobStart);
    const repositoryGate = verifyJob.indexOf('- name: Verify repository');

    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('refactor/platform-rearchitecture');
    expect(workflow).not.toContain('      - preview');
    expect(repositoryGate).toBeGreaterThanOrEqual(0);
    expect(verifyJob.slice(repositoryGate)).toContain('run: pnpm run ci:verify');
    expect(verifyJob).not.toContain('services:');
    expect(verifyJob).not.toContain('image: redis:7-alpine');
    expect(verifyJob).not.toContain('Verify Room Redis');
    expect(verifyJob).not.toContain('Verify Room generation');
    expect(verifyJob).not.toContain('Verify Hosted DR Redis empty drill');
    expect(verifyJob).not.toContain('verify:hosted-dr:redis');
    expect(workflow).not.toContain('wrangler deploy');
    expect(workflow).not.toContain('scp ');
    expect(workflow).not.toContain('ssh ');
  });
});
