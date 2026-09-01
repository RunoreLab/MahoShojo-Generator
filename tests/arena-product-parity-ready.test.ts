import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const packagePath = resolve(repositoryRoot, 'package.json');
const scriptPath = resolve(repositoryRoot, 'scripts/verify-arena-product-parity-ready.mjs');

describe('GMR-10Q repeatable READY verification entrypoint', () => {
  it('把 READY 绑定到完整 CI、真实 Redis verifier 与工作树检查', () => {
    expect(existsSync(scriptPath), '缺少 GMR-10Q READY 可重复验证脚本').toBe(true);
    const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(packageManifest.scripts?.['verify:arena-product-parity-ready']).toBe(
      'node scripts/verify-arena-product-parity-ready.mjs',
    );

    const source = readFileSync(scriptPath, 'utf8');
    for (const requiredPath of [
      'scripts/check-arena-product-parity.mjs',
      'scripts/verify-arena-product-parity-redis.mjs',
    ]) {
      expect(source, `READY verifier 未绑定 ${requiredPath}`).toContain(requiredPath);
    }
    expect(source).toContain('--require-ready');
    expect(source).toContain('ci:verify');
    expect(source).toContain('git');
    expect(source).toContain('diff');
    expect(source).toContain('--check');
  });

  it('Redis 入口只连接 loopback，并执行 room、generation 与进程恢复三条真实 verifier', () => {
    const redisScriptPath = resolve(
      repositoryRoot,
      'scripts/verify-arena-product-parity-redis.mjs',
    );
    expect(existsSync(redisScriptPath)).toBe(true);
    const source = readFileSync(redisScriptPath, 'utf8');

    expect(source).toContain('127.0.0.1');
    expect(source).toContain('verify:room-redis');
    expect(source).toContain('verify:room-generation-redis');
    expect(source).toContain('verify:room-generation-process-recovery');
    expect(source).toContain('ROOM_REDIS_VERIFY=true');
    expect(source).toContain('ROOM_GENERATION_REDIS_VERIFY=true');
    expect(source).toContain('ROOM_GENERATION_PROCESS_VERIFY=true');
  });
});
