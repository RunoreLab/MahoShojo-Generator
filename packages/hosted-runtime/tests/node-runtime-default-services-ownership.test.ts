import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { build } from 'esbuild';
import { afterEach } from 'vitest';

import {
  configureDefaultNodeHostedD1ClientResolver,
  getDefaultNodeHostedD1Client,
} from '../src/node-runtime/default-services';
import type { NodeDataD1Client } from '../src/node-runtime/data-ports';

const ROOT_DIRECTORY = path.resolve(import.meta.dirname, '../../..');
const PACKAGE_DIRECTORY = path.join(ROOT_DIRECTORY, 'packages/hosted-runtime');
const ENTRY = './src/node-runtime/default-services.ts';

afterEach(() => {
  configureDefaultNodeHostedD1ClientResolver(null);
});

describe('default Hosted services ownership', () => {
  test('manifest 暴露唯一 Node composition 入口', () => {
    const manifest = JSON.parse(readFileSync(
      path.join(PACKAGE_DIRECTORY, 'package.json'),
      'utf8',
    )) as { exports: Record<string, unknown> };
    expect(manifest.exports['./node-runtime/default-services']).toEqual({
      types: ENTRY,
      import: ENTRY,
      default: ENTRY,
    });
    expect(existsSync(path.join(PACKAGE_DIRECTORY, ENTRY))).toBe(true);
  });

  test('10 个 root Hosted modules 仅保留 runtime 配置与 package compatibility re-export', () => {
    for (const wrapper of [
      'lib/hosted-api/generate-free.ts',
      'lib/hosted-api/generate-free-stream.ts',
      'lib/hosted-api/generate-scenario.ts',
      'lib/hosted-api/generate-scenario-stream.ts',
      'lib/hosted-api/generate-canshou.ts',
      'lib/hosted-api/generate-canshou-stream.ts',
      'lib/hosted-api/generate-magical-girl.ts',
      'lib/hosted-api/generate-game-card.ts',
      'lib/hosted-api/generate-creator.ts',
      'lib/hosted-api/generate-creator-stream.ts',
    ]) {
      const source = readFileSync(path.join(ROOT_DIRECTORY, wrapper), 'utf8');
      expect(source).toContain('@mahoshojo/hosted-runtime/node-runtime/default-services');
      expect(source).toContain("./configure-node-runtime");
      expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(10);
    }
  });

  test('已创建的 default services 可由 runtime adapter 注入 D1 binding resolver', () => {
    const d1Client = { prepare: () => ({}) } as unknown as NodeDataD1Client;
    configureDefaultNodeHostedD1ClientResolver(() => d1Client);

    expect(getDefaultNodeHostedD1Client()).toBe(d1Client);
  });

  test('默认 Node composition 的完整生产闭包仅来自 packages', async () => {
    const result = await build({
      absWorkingDir: ROOT_DIRECTORY,
      entryPoints: [path.join(PACKAGE_DIRECTORY, ENTRY)],
      bundle: true,
      write: false,
      metafile: true,
      packages: 'external',
      logLevel: 'silent',
      platform: 'node',
      tsconfig: path.join(PACKAGE_DIRECTORY, 'tsconfig.json'),
    });
    const localInputs = Object.keys(result.metafile?.inputs ?? {})
      .map((candidate) => path.isAbsolute(candidate)
        ? candidate
        : path.resolve(ROOT_DIRECTORY, candidate))
      .filter(existsSync)
      .map((candidate) => path.relative(ROOT_DIRECTORY, candidate).split(path.sep).join('/'));
    expect(localInputs).not.toEqual([]);
    expect(localInputs.every((candidate) => candidate.startsWith('packages/'))).toBe(true);
  });

  test('默认 Node composition 只使用服务器权威敏感词检查入口', () => {
    const source = readFileSync(path.join(PACKAGE_DIRECTORY, ENTRY), 'utf8');
    expect(source).toContain("import { quickCheckForServer } from './sensitive-word-filter';");
    expect(source).not.toMatch(/\bquickCheck\(/u);
    expect(source.match(/\bquickCheckForServer\b/gu)).toHaveLength(3);
  });
});
