import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();

describe('repository CI workflow', () => {
  it('在 pull request 与平台重整分支上执行统一 verification，并且不包含部署动作', () => {
    const workflowPath = path.join(repositoryRoot, '.github/workflows/ci.yml');
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('refactor/platform-rearchitecture');
    expect(workflow).toContain('run: pnpm run ci:verify');
    expect(workflow).not.toContain('wrangler deploy');
    expect(workflow).not.toContain('scp ');
    expect(workflow).not.toContain('ssh ');
  });
});
