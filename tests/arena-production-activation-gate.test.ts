import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const workflow = readFileSync(path.join(repositoryRoot, '.github/workflows/hono-deploy.yml'), 'utf8');
const manifest = JSON.parse(readFileSync(
  path.join(repositoryRoot, 'config/arena-production-activation-gate.json'),
  'utf8',
)) as Record<string, unknown>;

describe('GMR-11 production activation gate', () => {
  it('keeps the current review state unapproved and fails closed for enabled releases', () => {
    expect(manifest).toMatchObject({ goal: 'GMR-11', reviewStatus: 'READY' });
    const result = spawnSync(process.execPath, [
      'scripts/check-arena-production-activation.mjs',
      '--require-approved',
      '--commit',
      'a'.repeat(40),
    ], { cwd: repositoryRoot, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/GMR-11.*未批准|review.*not approved/iu);
  });

  it('binds an enabled workflow dispatch to the reviewed commit before release build', () => {
    const approvalStep = workflow.indexOf('- name: Require GMR-11 production activation approval');
    const releaseBuild = workflow.indexOf('- name: Build single-file server');

    expect(approvalStep).toBeGreaterThan(-1);
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' && inputs.arena_multiplayer == 'enabled'");
    expect(workflow).toContain('pnpm run check:arena-production-activation -- --require-approved --commit "$GITHUB_SHA"');
    expect(approvalStep).toBeLessThan(releaseBuild);
  });
});
