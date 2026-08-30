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
    'HTTP://127.0.0.1:8787',
    'HtTp://router.service.internal',
  ])('拒绝任意客户端 chunk 的内部 endpoint %s', (endpoint) => {
    const result = runCheckerFiles({
      'routing.js': routingBundle(),
      'leaked.js': `const fallback="${endpoint}"`,
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain('internal endpoint');
  });

  it.each([
    ['credential', 'https://user:bundle-secret@example.com', 'bundle-secret'],
    ['query', 'https://example.com?token=bundle-secret', 'bundle-secret'],
    ['fragment', 'https://example.com#bundle-secret', 'bundle-secret'],
    ['path + query', 'https://example.com/path?token=bundle-secret', 'bundle-secret'],
    ['nested path + fragment', 'https://example.com/a/b#bundle-secret', 'bundle-secret'],
    [
      'path + port + encoded query',
      'https://example.com:8443/a;b?token=bundle%2Dsecret',
      'bundle%2Dsecret',
    ],
    [
      'punctuated path + encoded fragment',
      'https://example.com/a,b(c)}#bundle%2Dsecret',
      'bundle%2Dsecret',
    ],
    [
      'IPv6 + port + path + query',
      'https://[2001:db8::1]:8443/a?token=bundle-secret',
      'bundle-secret',
    ],
    [
      'protocol-relative path + query',
      '//example.com/path?token=bundle-secret',
      'bundle-secret',
    ],
  ])('拒绝客户端 chunk 的 %s URL 且不回显值', (_label, endpoint, marker) => {
    const result = runCheckerFiles({
      'routing.js': routingBundle(),
      'leaked.js': `const fallback="${endpoint}"`,
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain('credential/query/fragment URL');
    expect(output).not.toContain(marker);
  });

  it('拒绝协议相对 internal endpoint 且不回显 path', () => {
    const result = runCheckerFiles({
      'routing.js': routingBundle(),
      'leaked.js': 'const fallback="//router.service.internal/private/bundle-secret"',
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain('internal endpoint');
    expect(output).not.toContain('bundle-secret');
  });

  it('接受不含 metadata 的公开 path URL', () => {
    const result = runCheckerFiles({
      'routing.js': routingBundle(),
      'public.js': 'const docs="https://docs.example.com/a;b,c(d)}"',
    });

    expect(result.status).toBe(0);
  });

  it.each([
    ['provider referral', 'https://api.kourichat.com/register?aff=public'],
    ['provider referral on explicit default port', 'https://api.kourichat.com:443/register?aff=public'],
    ['provider fragment', 'https://chatboxai.app/zh/#pricing'],
    [
      'community invite',
      'https://qm.qq.com/cgi-bin/qm/qr?k=public&jump_from=webapi&authKey=public',
    ],
    ['analytics script', 'https://www.googletagmanager.com/gtag/js?id=public'],
    [
      'framework docs',
      'https://nextjs.org/docs/app/api-reference/functions/use-search-params#updating-searchparams',
    ],
  ])('接受已登记的公开 %s URL metadata shape', (_label, endpoint) => {
    const result = runCheckerFiles({
      'routing.js': routingBundle(),
      'public.js': `const publicLink="${endpoint}"`,
    });

    expect(result.status).toBe(0);
  });

  it('公开 URL metadata allowlist 对额外 query key fail closed', () => {
    const result = runCheckerFiles({
      'routing.js': routingBundle(),
      'leaked.js': [
        'const fallback="https://qm.qq.com/cgi-bin/qm/qr',
        '?k=public&jump_from=webapi&authKey=public&token=bundle-secret"',
      ].join(''),
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain('credential/query/fragment URL');
    expect(output).not.toContain('bundle-secret');
  });

  it.each([1, 8443])(
    '公开 URL metadata allowlist 对非默认 HTTPS 端口 %i fail closed',
    (port) => {
      const result = runCheckerFiles({
        'routing.js': routingBundle(),
        'leaked.js': `const fallback="https://api.kourichat.com:${port}/register?aff=public"`,
      });

      expect(result.status).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'credential/query/fragment URL',
      );
    },
  );

  it('只豁免框架 URL parser 与 location fallback 的精确 synthetic origin', () => {
    const result = runCheckerFiles({
      'routing.js': routingBundle(),
      'main-framework.js': 'new URL("/", "http://n")',
      'polyfills-framework.js': [
        'new URL("/", "https://a");',
        'new URL("https://a/c%20d?a=1&c=3");',
      ].join(''),
      'snapdom.js': 'location&&location.href?location.href:"http://localhost/"',
    });

    expect(result.status).toBe(0);
  });

  it('不把 URL parser 的动态 IPv6 模板误判为静态 endpoint', () => {
    const result = runCheckerFiles({
      'routing.js': routingBundle(),
      'url-parser.js': 'const origin=`http://[${value}]`',
    });

    expect(result.status).toBe(0);
  });

  it('缺少完整 client-preflight routing projection 时 fail closed', () => {
    const result = runChecker('https://homura.colanns.me;/api/health/ready');

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain('routing projection');
  });
});
