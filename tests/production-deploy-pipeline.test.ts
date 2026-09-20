import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = (name: string) => parse(readFileSync(resolve('.github/workflows', name), 'utf8'));
const hono = workflow('hono-deploy.yml');
const build = workflow('cloudflare-build.yml');
const publish = workflow('production-release.yml');
const emergency = workflow('cloudflare-deploy.yml');
const ci = workflow('ci.yml');
const temporary: string[] = [];
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), 'maho-pipeline-'));
  temporary.push(directory);
  return directory;
};
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('production deployment pipeline', () => {
  it('prepares three jobs concurrently, but waits for all before publishing', () => {
    for (const job of [hono.jobs.verify, hono.jobs.build, hono.jobs['build-web']]) expect(job.needs).toBeUndefined();
    expect(hono.jobs.verify.uses).toBe('./.github/workflows/ci.yml');
    expect(hono.jobs.verify.with.skip_build).toBe(true);
    expect(hono.jobs.release.needs).toEqual(['verify', 'build', 'build-web']);
    expect(hono.jobs.release.if).toBe("github.ref == 'refs/heads/feature/v0.2.0_Battle_Growth_MahoShojo'");
    expect(hono.jobs.release.uses).toBe('./.github/workflows/production-release.yml');
    expect(hono.jobs.build.steps.some((step: { run?: string }) => step.run === 'pnpm --filter @mahoshojo/api run build')).toBe(true);
    expect(hono.on.push.branches).toEqual(['feature/v0.2.0_Battle_Growth_MahoShojo']);
    expect(emergency.on.push).toBeUndefined();
  });

  it('keeps complete PR/manual verification and all production tests/lint', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
    expect(ci.on.workflow_call.inputs.skip_build.default).toBe(false);
    expect(ci.jobs.verify.steps.find((step: { name?: string }) => step.name === 'Verify repository').run).toBe('pnpm run ci:verify');
    expect(scripts['ci:verify']).toContain('workspace:verify');
    expect(scripts['workspace:verify']).toBe('pnpm run workspace:checks && pnpm run workspace:build');
    expect(scripts['ci:verify:checks']).toBe('pnpm run workspace:checks && pnpm run test:repo && pnpm run lint:repo');
    for (const command of ['check:workspace:boundaries', 'check:admin-boundary', 'check:arena-room-origins', 'check:arena-room-presets', 'workspace:test', 'workspace:lint']) expect(scripts['workspace:checks']).toContain(command);
    expect(scripts['workspace:checks']).not.toContain('workspace:build');
  });

  it('locks the whole release call including emergency Web-only publishing, without cancelling deployments', () => {
    expect(hono.concurrency).toBeUndefined();
    expect(emergency.concurrency).toBeUndefined();
    expect(publish.concurrency).toBeUndefined();
    for (const caller of [hono, emergency]) {
      expect(caller.jobs.release.concurrency).toEqual({ group: 'hono-production', 'cancel-in-progress': false });
      expect(caller.permissions.actions).toBe('read');
    }
    expect(hono.jobs.build.concurrency['cancel-in-progress']).toBe(true);
    expect(build.jobs.build.concurrency['cancel-in-progress']).toBe(true);
    expect(ci.concurrency).toBeUndefined();
    expect(ci.jobs.verify.concurrency['cancel-in-progress']).toBe(true);
    expect(publish.jobs['deploy-hono'].needs).toBe('candidate');
    expect(publish.jobs['deploy-web'].needs).toEqual(['candidate', 'deploy-hono']);
    expect(publish.jobs['deploy-web'].if).toContain("needs.deploy-hono.result == 'success'");
    expect(publish.jobs['deploy-web'].if).toContain("inputs.web_only && needs.deploy-hono.result == 'skipped'");
    expect(publish.jobs['deploy-web'].if).toContain("needs.candidate.outputs.current == 'true'");
    expect(publish.jobs['deploy-web'].if).toContain('!cancelled()');
  });

  it('binds both artifacts to this build and deploys Web without a second build', () => {
    expect(hono.jobs.release.with.hono_artifact_id).toBe('${{ needs.build.outputs.artifact_id }}');
    expect(hono.jobs.release.with.web_artifact_id).toBe('${{ needs.build-web.outputs.artifact_id }}');
    expect(hono.jobs.release.with.web_bundle_sha256).toBe('${{ needs.build-web.outputs.bundle_sha256 }}');
    expect(hono.jobs.build.outputs.artifact_digest).toBe('${{ steps.bundle.outputs.artifact-digest }}');
    expect(build.jobs.build.environment).toBe('production');
    const buildStep = build.jobs.build.steps.find((step: { name?: string }) => step.name === 'Build Cloudflare bundle');
    expect(buildStep.env.NEXT_PUBLIC_HOSTED_API_ENVIRONMENT).toBe('production');
    expect(buildStep.env.NEXT_PUBLIC_ARENA_MULTIPLAYER_ENABLED).toBe("${{ inputs.arena_multiplayer_enabled && 'true' || 'false' }}");
    expect(buildStep.run).toContain('run build:cf');
    const deploySteps = publish.jobs['deploy-web'].steps;
    expect(JSON.stringify(deploySteps)).not.toContain('run build');
    expect(deploySteps.find((step: { uses?: string }) => step.uses === 'actions/download-artifact@v5').with['artifact-ids']).toBe('${{ inputs.web_artifact_id }}');
    expect(deploySteps.find((step: { name?: string }) => step.name === 'Deploy production without rebuilding').run).toContain('wrangler deploy --config wrangler.jsonc --env production --keep-vars');
    const pull = publish.jobs['deploy-hono'].steps.find((step: { name?: string }) => step.name === 'Pull release on VPS');
    expect(pull.env.ARTIFACT_ID).toBe('${{ inputs.hono_artifact_id }}');
    expect(pull.env.GITHUB_TOKEN).toBe('${{ github.token }}');
    expect(JSON.stringify(publish)).not.toContain('scp ');
  });

  it('emergency entrypoint only builds disabled multiplayer and uses the shared publisher', () => {
    expect(emergency.on.workflow_dispatch.inputs.confirm_disable_multiplayer.options).toEqual(['disable']);
    expect(emergency.jobs.build.with.arena_multiplayer_enabled).toBe(false);
    expect(emergency.jobs.release.with.web_only).toBe(true);
    expect(emergency.jobs.release.uses).toBe(hono.jobs.release.uses);
  });

  it.each([
    ['current head', false, 'push', '', 'a', 0, 'a', 0, 'true'],
    ['superseded head', false, 'push', '', 'b', 0, 'a', 0, 'false'],
    ['head lookup failed', false, 'push', '', '', 1, 'a', 1, ''],
    ['explicit emergency', true, 'workflow_dispatch', 'disable', 'b', 0, 'a', 0, 'true'],
    ['unconfirmed emergency', true, 'workflow_dispatch', '', 'a', 0, 'a', 1, ''],
    ['push cannot bypass head check', true, 'push', 'disable', 'a', 0, 'a', 1, ''],
  ])('candidate decision executes safely: %s', (_label, webOnly, event, confirm, tip, gitExit, sha, status, current) => {
    const directory = fixture();
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nprintf "%s\\trefs/heads/production\\n" "$TEST_TIP"\nexit "$TEST_GIT_EXIT"\n');
    chmodSync(join(bin, 'git'), 0o755);
    const output = join(directory, 'output');
    const step = publish.jobs.candidate.steps.find((item: { id?: string }) => item.id === 'head');
    const result = spawnSync('bash', ['-c', step.run], {
      cwd: directory, encoding: 'utf8',
      env: { ...process.env, PATH: bin + ':' + process.env.PATH, WEB_ONLY: String(webOnly), EVENT_NAME: String(event), CONFIRM_DISABLE: String(confirm), TEST_TIP: String(tip), TEST_GIT_EXIT: String(gitExit), GITHUB_SHA: String(sha), GITHUB_REF: 'refs/heads/production', GITHUB_OUTPUT: output },
    });
    expect(result.status, result.stderr).toBe(status);
    expect(existsSync(output) ? readFileSync(output, 'utf8').trim() : '').toBe(current ? 'current=' + current : '');
  });

  it('restores hidden files and symlinks; digest mismatch stops extraction', () => {
    const source = fixture();
    const target = fixture();
    const openNext = join(source, 'apps/web/.open-next');
    mkdirSync(openNext, { recursive: true });
    writeFileSync(join(openNext, 'worker.js'), 'export default {};');
    writeFileSync(join(openNext, '.hidden'), 'cache');
    symlinkSync('worker.js', join(openNext, 'relative-link'));
    const output = join(source, 'output');
    const pack = build.jobs.build.steps.find((step: { id?: string }) => step.id === 'bundle').run;
    const packed = spawnSync('bash', ['-c', pack], { cwd: source, env: { ...process.env, GITHUB_OUTPUT: output }, encoding: 'utf8' });
    expect(packed.status, packed.stderr).toBe(0);
    const digest = readFileSync(output, 'utf8').trim().split('=')[1];
    mkdirSync(join(target, 'artifact'));
    mkdirSync(join(target, 'apps/web'), { recursive: true });
    copyFileSync(join(source, 'web-bundle.tar.gz'), join(target, 'artifact/web-bundle.tar.gz'));
    const unpack = publish.jobs['deploy-web'].steps.find((step: { name?: string }) => step.name === 'Verify and unpack Web build').run;
    const execute = (sha: string) => spawnSync('bash', ['-c', unpack], { cwd: target, env: { ...process.env, WEB_BUNDLE_SHA256: sha }, encoding: 'utf8' });
    expect(execute('0'.repeat(64)).status).not.toBe(0);
    expect(existsSync(join(target, 'apps/web/.open-next'))).toBe(false);
    const restored = execute(digest);
    expect(restored.status, restored.stderr).toBe(0);
    expect(readFileSync(join(target, 'apps/web/.open-next/.hidden'), 'utf8')).toBe('cache');
    expect(readFileSync(join(target, 'apps/web/.open-next/relative-link'), 'utf8')).toBe('export default {};');
  });
});
