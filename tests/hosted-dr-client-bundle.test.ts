import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const checker = path.join(
  repositoryRoot,
  'apps/web/scripts/check-hosted-dr-client-bundle.mjs',
);

const runCheckerFiles = (sources: Record<string, string>) => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'hosted-dr-client-bundle-'));
  const staticRoot = path.join(temporaryRoot, 'static', 'chunks');
  mkdirSync(staticRoot, { recursive: true });
  for (const [fileName, source] of Object.entries(sources)) {
    writeFileSync(path.join(staticRoot, fileName), source, 'utf8');
  }
  const result = spawnSync(process.execPath, [checker, '--dir', path.dirname(staticRoot)], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  rmSync(temporaryRoot, { recursive: true, force: true });
  return result;
};

const runChecker = (source: string) => runCheckerFiles({ 'client.js': source });

const routingBundle = (extra = '') => [
  'https://homura.colanns.me',
  'https://mahoshojo.colanns.me',
  '/api/health/ready',
  '/api/hosted/dr-readiness',
  extra,
].join(';');

describe('Hosted DR client bundle safety gate', () => {
  it('Next 与 OpenNext production build 都执行 bundle safety gate', () => {
    const packageJson = JSON.parse(readFileSync(
      path.join(repositoryRoot, 'apps/web/package.json'),
      'utf8',
    )) as { scripts: Record<string, string> };

    expect(packageJson.scripts['build:next']).toContain(
      'check-hosted-dr-client-bundle.mjs --dir .next/static',
    );
    expect(packageJson.scripts['build:cf']).toContain(
      'check-hosted-dr-client-bundle.mjs --dir .open-next/assets/_next/static',
    );
  });

  it('接受只包含公开 routing projection 的客户端 chunk', () => {
    const result = runChecker(routingBundle());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Hosted DR client bundle safety OK');
  });

  it('拒绝客户端静态产物中的 manifest secret/binding 名称', () => {
    const result = runChecker(`${routingBundle()};SIGNATURE_SECRET_KEY`);

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain('SIGNATURE_SECRET_KEY');
  });

  it('拒绝 Hosted routing chunk 投影 manifest binding 名称', () => {
    const result = runChecker(`${routingBundle()};"DB"`);

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain('binding DB');
  });

  it('拒绝 Hosted routing chunk 中未加引号的 manifest binding 标识符', () => {
    const result = runChecker(`${routingBundle()};const bindings={DB:1}`);

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain('binding DB');
  });

  it('拒绝被拆分到非 routing chunk 的 manifest binding 标识符', () => {
    const result = runCheckerFiles({
      'routing.js': routingBundle(),
      'leaked.js': 'const hiddenBinding=DB',
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain('binding DB');
  });

  it('拒绝 Hosted routing chunk 中的 internal endpoint', () => {
    const result = runChecker(`${routingBundle()};https://router.service.internal`);

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain('internal endpoint');
  });

  it('拒绝被拆分到非 routing chunk 的 internal endpoint', () => {
    const result = runCheckerFiles({
      'routing.js': routingBundle(),
      'leaked.js': 'const fallback="https://router.service.internal"',
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain('internal endpoint');
  });

  it('拒绝被拆分到非 routing chunk 的 IP endpoint', () => {
    const result = runCheckerFiles({
      'routing.js': routingBundle(),
      'leaked.js': 'const fallback="http://10.0.0.8:8787"',
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain('internal endpoint');
  });

  it.each([
    'https://router.service.internal.',
    'http://127.0.0.1.',
    'http://localhost:8787',
    'https://router.service.local',
  ])('拒绝任意客户端 chunk 的内部 endpoint %s', (endpoint) => {
    const result = runCheckerFiles({
      'routing.js': routingBundle(),
      'leaked.js': `const fallback="${endpoint}"`,
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain('internal endpoint');
  });

  it('只豁免框架 URL parser 与 location fallback 的精确 synthetic origin', () => {
    const result = runCheckerFiles({
      'routing.js': routingBundle(),
      'main-framework.js': 'new URL("/", "http://n")',
      'polyfills-framework.js': 'new URL("/", "https://a")',
      'snapdom.js': 'location&&location.href?location.href:"http://localhost/"',
    });

    expect(result.status).toBe(0);
  });

  it('缺少完整 client-preflight routing projection 时 fail closed', () => {
    const result = runChecker('https://homura.colanns.me;/api/health/ready');

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain('routing projection');
  });
});
