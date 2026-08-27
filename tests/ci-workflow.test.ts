import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();

describe('repository CI workflow', () => {
  it('在 pull request 与平台重整分支上执行统一 verification，并且不包含部署动作', () => {
    const workflowPath = path.join(repositoryRoot, '.github/workflows/ci.yml');
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = readFileSync(workflowPath, 'utf8');
    const verifyJobStart = workflow.indexOf('\n  verify:');
    expect(verifyJobStart).toBeGreaterThanOrEqual(0);
    const verifyJob = workflow.slice(verifyJobStart);
    const repositoryGate = verifyJob.indexOf('- name: Verify repository');
    const roomRedisGate = verifyJob.indexOf('- name: Verify Room Redis checkpoint');
    const roomRestartGate = verifyJob.indexOf('- name: Verify Room Redis restart recovery');
    const redisGate = verifyJob.indexOf('- name: Verify Hosted DR Redis empty drill');

    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('refactor/platform-rearchitecture');
    expect(verifyJob).toContain('services:');
    expect(verifyJob).toContain('image: redis:7-alpine');
    expect(repositoryGate).toBeGreaterThanOrEqual(0);
    expect(roomRedisGate).toBeGreaterThan(repositoryGate);
    expect(roomRestartGate).toBeGreaterThan(roomRedisGate);
    expect(redisGate).toBeGreaterThan(roomRestartGate);
    expect(verifyJob.slice(repositoryGate, roomRedisGate)).toContain('run: pnpm run ci:verify');
    expect(verifyJob.slice(roomRedisGate, roomRestartGate)).toContain('REDIS_URL: redis://127.0.0.1:6379');
    expect(verifyJob.slice(roomRedisGate, roomRestartGate)).toContain('run: pnpm --filter @mahoshojo/api run verify:room-redis');
    const restartStep = verifyJob.slice(roomRestartGate, redisGate);
    expect(restartStep).toContain('docker run');
    expect(restartStep).toContain('docker restart');
    expect(restartStep).toContain('ROOM_REDIS_VERIFY_PHASE=write');
    expect(restartStep).toContain('ROOM_REDIS_VERIFY_PHASE=read');
    expect(verifyJob.slice(redisGate)).toContain('REDIS_URL: redis://127.0.0.1:6379/15');
    expect(verifyJob.slice(redisGate)).toContain('run: pnpm run verify:hosted-dr:redis');
    expect(workflow).not.toContain('wrangler deploy');
    expect(workflow).not.toContain('scp ');
    expect(workflow).not.toContain('ssh ');
  });
});
