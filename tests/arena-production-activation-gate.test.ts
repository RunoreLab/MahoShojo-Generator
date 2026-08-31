import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const workflow = readFileSync(path.join(repositoryRoot, '.github/workflows/hono-deploy.yml'), 'utf8');
const manifest = JSON.parse(readFileSync(
  path.join(repositoryRoot, 'config/arena-production-activation-gate.json'),
  'utf8',
)) as Record<string, unknown>;

const run = (command: string, args: string[], cwd: string) => spawnSync(command, args, {
  cwd,
  encoding: 'utf8',
});

const git = (cwd: string, ...args: string[]) => {
  const result = run('git', args, cwd);
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
};

describe('GMR-11 production activation gate', () => {
  it('keeps the current review state unapproved and the package command fails closed', () => {
    expect(manifest).toMatchObject({
      goal: 'GMR-11',
      reviewStatus: 'READY',
      reviewedCommit: null,
      reviewedSourceDigest: null,
      approvedAt: null,
      approvalEvidence: null,
    });
    const head = git(repositoryRoot, 'rev-parse', 'HEAD');
    const result = run('pnpm', [
      'run',
      'check:arena-production-activation',
      '--require-approved',
      '--commit',
      head,
    ], repositoryRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/GMR-11.*未批准|review.*not approved/iu);
    expect(result.stderr).not.toMatch(/未知参数|unknown argument/iu);
  });

  it('accepts a manifest-only approval commit and rejects later tracked source changes', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'arena-activation-gate-'));
    try {
      mkdirSync(path.join(tempRoot, 'scripts'), { recursive: true });
      mkdirSync(path.join(tempRoot, 'config'), { recursive: true });
      mkdirSync(path.join(tempRoot, 'docs', 'reviews'), { recursive: true });
      mkdirSync(path.join(tempRoot, 'docs', 'plans'), { recursive: true });
      copyFileSync(
        path.join(repositoryRoot, 'scripts/check-arena-production-activation.mjs'),
        path.join(tempRoot, 'scripts/check-arena-production-activation.mjs'),
      );
      writeFileSync(path.join(tempRoot, 'app.txt'), 'reviewed source\n');
      writeFileSync(
        path.join(tempRoot, 'docs/reviews/gmr-11.md'),
        [
          '---',
          'review: GMR-11-PRODUCTION-ACTIVATION',
          'decision: APPROVED',
          'reviewer: github:gate-test-reviewer',
          'approvedAt: 2026-09-01T00:00:00.000Z',
          '---',
          'GMR-11-PRODUCTION-ACTIVATION: APPROVED',
          '',
          '# GMR-11 独立 production readiness 审查',
          '',
        ].join('\n'),
      );
      writeFileSync(
        path.join(tempRoot, 'docs/reviews/multiline-marker.md'),
        [
          '---',
          'review: GMR-11-PRODUCTION-ACTIVATION',
          'decision: APPROVED',
          'reviewer: github:gate-test-reviewer',
          'approvedAt: 2026-09-01T00:00:00.000Z',
          '---',
          'GMR-11-PRODUCTION-ACTIVATION:',
          'APPROVED',
          '',
        ].join('\n'),
      );
      writeFileSync(
        path.join(tempRoot, 'docs/plans/gmr-11-plan.md'),
        '# GMR-11 计划\n\n```text\nGMR-11-PRODUCTION-ACTIVATION: APPROVED\n```\n',
      );
      writeFileSync(
        path.join(tempRoot, 'docs/reviews/placeholder-reviewer.md'),
        [
          '---',
          'review: GMR-11-PRODUCTION-ACTIVATION',
          'decision: APPROVED',
          'reviewer: <independent-reviewer>',
          'approvedAt: 2026-09-01T00:00:00.000Z',
          '---',
          'GMR-11-PRODUCTION-ACTIVATION: APPROVED',
          '',
        ].join('\n'),
      );
      writeFileSync(
        path.join(tempRoot, 'docs/reviews/duplicate-reviewer.md'),
        [
          '---',
          'review: GMR-11-PRODUCTION-ACTIVATION',
          'decision: APPROVED',
          'reviewer: github:gate-test-reviewer',
          'reviewer: github:second-reviewer',
          'approvedAt: 2026-09-01T00:00:00.000Z',
          '---',
          'GMR-11-PRODUCTION-ACTIVATION: APPROVED',
          '',
        ].join('\n'),
      );
      writeFileSync(
        path.join(tempRoot, 'config/arena-production-activation-gate.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          goal: 'GMR-11',
          reviewStatus: 'READY',
          reviewedCommit: null,
          reviewedSourceDigest: null,
          approvedAt: null,
          approvalEvidence: null,
        }, null, 2)}\n`,
      );

      git(tempRoot, 'init', '--quiet');
      git(tempRoot, 'add', '.');
      git(
        tempRoot,
        '-c',
        'user.name=Gate Test',
        '-c',
        'user.email=gate-test@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'reviewed source',
      );
      const reviewedCommit = git(tempRoot, 'rev-parse', 'HEAD');
      const digestResult = run(process.execPath, [
        'scripts/check-arena-production-activation.mjs',
        '--print-source-digest',
        '--commit',
        reviewedCommit,
      ], tempRoot);
      expect(digestResult.status, digestResult.stderr).toBe(0);
      const reviewedSourceDigest = digestResult.stdout.trim();
      expect(reviewedSourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);

      const manifestPath = path.join(tempRoot, 'config/arena-production-activation-gate.json');
      const approvedManifest = {
          schemaVersion: 1,
          goal: 'GMR-11',
          reviewStatus: 'APPROVED',
          reviewedCommit,
          reviewedSourceDigest,
          approvedAt: '2026-09-01T00:00:00.000Z',
          approvalEvidence: 'docs/reviews/gmr-11.md',
      };
      const writeManifest = (value: Record<string, unknown>) => {
        writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
      };
      const commitManifest = (value: Record<string, unknown>, message: string) => {
        writeManifest(value);
        git(tempRoot, 'add', 'config/arena-production-activation-gate.json');
        git(
          tempRoot,
          '-c',
          'user.name=Gate Test',
          '-c',
          'user.email=gate-test@example.invalid',
          '-c',
          'commit.gpgsign=false',
          'commit',
          '--quiet',
          '-m',
          message,
        );
        return git(tempRoot, 'rev-parse', 'HEAD');
      };

      writeManifest(approvedManifest);
      git(tempRoot, 'add', 'config/arena-production-activation-gate.json');
      git(
        tempRoot,
        '-c',
        'user.name=Gate Test',
        '-c',
        'user.email=gate-test@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'approve reviewed source',
      );
      const approvalCommit = git(tempRoot, 'rev-parse', 'HEAD');
      const approved = run(process.execPath, [
        'scripts/check-arena-production-activation.mjs',
        '--require-approved',
        '--commit',
        approvalCommit,
      ], tempRoot);
      expect(approved.status, approved.stderr).toBe(0);
      expect(approved.stdout).toMatch(/"status":"PASS"/u);

      writeManifest({ ...approvedManifest, reviewStatus: 'READY' });
      const dirtyManifest = run(process.execPath, [
        'scripts/check-arena-production-activation.mjs',
        '--require-approved',
        '--commit',
        approvalCommit,
      ], tempRoot);
      expect(dirtyManifest.status).toBe(1);
      expect(dirtyManifest.stderr).toMatch(/工作区.*未提交|dirty worktree/iu);
      writeManifest(approvedManifest);

      const evidencePath = path.join(tempRoot, 'docs/reviews/gmr-11.md');
      const validEvidence = readFileSync(evidencePath, 'utf8');
      writeFileSync(evidencePath, `${validEvidence}\n未提交篡改\n`);
      const dirtyEvidence = run(process.execPath, [
        'scripts/check-arena-production-activation.mjs',
        '--require-approved',
        '--commit',
        approvalCommit,
      ], tempRoot);
      expect(dirtyEvidence.status).toBe(1);
      expect(dirtyEvidence.stderr).toMatch(/工作区.*未提交|dirty worktree/iu);
      writeFileSync(evidencePath, validEvidence);

      const planEvidenceCommit = commitManifest({
        ...approvedManifest,
        approvalEvidence: 'docs/plans/gmr-11-plan.md',
      }, 'reject plan as approval evidence');
      const planEvidence = run(process.execPath, [
        'scripts/check-arena-production-activation.mjs',
        '--require-approved',
        '--commit',
        planEvidenceCommit,
      ], tempRoot);
      expect(planEvidence.status).toBe(1);
      expect(planEvidence.stderr).toMatch(/docs\/reviews/iu);

      const multilineEvidenceCommit = commitManifest({
        ...approvedManifest,
        approvalEvidence: 'docs/reviews/multiline-marker.md',
      }, 'reject multiline marker');
      const multilineEvidence = run(process.execPath, [
        'scripts/check-arena-production-activation.mjs',
        '--require-approved',
        '--commit',
        multilineEvidenceCommit,
      ], tempRoot);
      expect(multilineEvidence.status).toBe(1);
      expect(multilineEvidence.stderr).toMatch(/批准标记|approval marker/iu);

      const placeholderReviewerCommit = commitManifest({
        ...approvedManifest,
        approvalEvidence: 'docs/reviews/placeholder-reviewer.md',
      }, 'reject placeholder reviewer');
      const placeholderReviewer = run(process.execPath, [
        'scripts/check-arena-production-activation.mjs',
        '--require-approved',
        '--commit',
        placeholderReviewerCommit,
      ], tempRoot);
      expect(placeholderReviewer.status).toBe(1);
      expect(placeholderReviewer.stderr).toMatch(/reviewer/iu);

      const duplicateReviewerCommit = commitManifest({
        ...approvedManifest,
        approvalEvidence: 'docs/reviews/duplicate-reviewer.md',
      }, 'reject duplicate reviewer');
      const duplicateReviewer = run(process.execPath, [
        'scripts/check-arena-production-activation.mjs',
        '--require-approved',
        '--commit',
        duplicateReviewerCommit,
      ], tempRoot);
      expect(duplicateReviewer.status).toBe(1);
      expect(duplicateReviewer.stderr).toMatch(/front matter|重复字段|duplicate/iu);

      const nonCanonicalTimeCommit = commitManifest({
        ...approvedManifest,
        approvedAt: '2026-09-01 00:00:00Z',
      }, 'reject non-canonical approval time');
      const nonCanonicalTime = run(process.execPath, [
        'scripts/check-arena-production-activation.mjs',
        '--require-approved',
        '--commit',
        nonCanonicalTimeCommit,
      ], tempRoot);
      expect(nonCanonicalTime.status).toBe(1);
      expect(nonCanonicalTime.stderr).toMatch(/approvedAt/u);

      commitManifest(approvedManifest, 'restore valid approval');

      writeFileSync(path.join(tempRoot, 'app.txt'), 'unreviewed source change\n');
      git(tempRoot, 'add', 'app.txt');
      git(
        tempRoot,
        '-c',
        'user.name=Gate Test',
        '-c',
        'user.email=gate-test@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'change source after approval',
      );
      const changedCommit = git(tempRoot, 'rev-parse', 'HEAD');
      const changed = run(process.execPath, [
        'scripts/check-arena-production-activation.mjs',
        '--require-approved',
        '--commit',
        changedCommit,
      ], tempRoot);
      expect(changed.status).toBe(1);
      expect(changed.stderr).toMatch(/源码树摘要|source digest/iu);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('binds an enabled workflow dispatch to the reviewed commit before release build', () => {
    const approvalStep = workflow.indexOf('- name: Require GMR-11 production activation approval');
    const releaseBuild = workflow.indexOf('- name: Build single-file server');

    expect(workflow).toMatch(/uses: actions\/checkout@v6\s+with:\s+fetch-depth: 0/u);
    expect(approvalStep).toBeGreaterThan(-1);
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' && inputs.arena_multiplayer == 'enabled'");
    expect(workflow).toContain('pnpm run check:arena-production-activation --require-approved --commit "$GITHUB_SHA"');
    expect(workflow).not.toContain('check:arena-production-activation -- --require-approved');
    expect(approvalStep).toBeLessThan(releaseBuild);
  });
});
