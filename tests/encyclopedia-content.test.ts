/**
 * 百科正文内容本身的一致性。
 *
 * ## 为什么放在仓库根，而且不 import 共源包
 *
 * 它读的是 `content/encyclopedia/`——**产品内容权威**，既不属于 Web 也不属于 Desktop。跨 app 的集成
 * 测试在本仓库本来就有固定位置：根 `tests/`（`tests/shared-theme-build-output.test.ts` 同样是因为这个
 * 理由留在根目录，而不是塞进 `ui-web`）。
 *
 * 它也不 import `@mahoshojo/ui-web`：根包没有把 workspace 包声明为依赖，为了读一份数据而新增一条
 * 安装边不划算。更重要的是，本测试**故意**从文件名推导 slug 而不是从目录读——这样它与
 * `scripts/generate-encyclopedia-content.mjs` 的目录校验相互独立：脚本证明「目录条目 ↔ 正文文件」双向
 * 完整，本测试证明「每篇正文都能以自身文件名被寻址，且站内互链全部指向真实文件」。
 *
 * ## 编号约定
 *
 * `/encyclopedia/<slug>` 是条目页路径，`/encyclopedia/<slug>.md` 是正文 URL。两者共用同一个 slug，
 * 该不变量由同步脚本强制；因此这里从文件名推导 slug 是安全的。
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { generate } from '../scripts/generate-encyclopedia-content.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const CONTENT_DIR = path.join(REPO_ROOT, 'content', 'encyclopedia');

/**
 * 两端首屏都会渲染的品牌资源。
 *
 * Desktop 首期**不**打包 13 个功能入口的资源（它们在本地运行时全部不可用，因此根本不会被渲染），
 * 所以这里断言的是交集而不是全集：把未渲染的资源塞进安装包只会让应用多带 1.4MB 读不到的文件。
 * 逐 app 的资源清单由 `content/sync-manifest.json` 记录并由同步脚本的 `--check` 把关。
 */
const SHARED_BRAND_ASSETS = ['logo.svg', 'logo-white.svg', 'encyclopedia.svg'] as const;

const TARGETS = [
  { app: 'apps/web', label: 'Web' },
  { app: 'apps/desktop', label: 'Desktop' },
] as const;

const listContentFiles = async () =>
  (await readdir(CONTENT_DIR)).filter((name) => name.endsWith('.md')).sort();

const slugOf = (file) => file.slice(0, -'.md'.length);

describe('encyclopedia content authority', () => {
  it('resolves every in-encyclopedia cross-link to a real entry', async () => {
    const known = new Set((await listContentFiles()).map(slugOf));
    const broken: string[] = [];

    for (const file of await listContentFiles()) {
      const body = await readFile(path.join(CONTENT_DIR, file), 'utf8');
      for (const match of body.matchAll(/\/encyclopedia\/[a-z0-9-]+/g)) {
        if (!known.has(match[0].slice('/encyclopedia/'.length))) {
          broken.push(`${file} -> ${match[0]}`);
        }
      }
    }

    // 这类错误在运行时表现为一个点了没反应的链接，而且不会让任何构建失败。
    expect(broken).toEqual([]);
  });

  it('gives every article a leading level-1 heading', async () => {
    // 不是格式洁癖：条目页在正文前有一个自己的 <h1>，而正文是否再带一个 H1 决定了
    // `stripLeadingMatchingTitle` 会不会剥掉它。缺 H1 的文章会带着重复标题渲染，且这条约定无从判断。
    const withoutHeading: string[] = [];
    for (const file of await listContentFiles()) {
      const body = (await readFile(path.join(CONTENT_DIR, file), 'utf8')).replace(/\r\n/g, '\n');
      if (!/^#\s+\S/m.test(body)) withoutHeading.push(file);
    }
    expect(withoutHeading).toEqual([]);
  });

  it('keeps a non-trivial number of articles', async () => {
    // 上面所有断言都是「content/ 与两个副本彼此一致」，因此 content/ 本身被清空时它们全都会通过。
    // 这条是那个缺口的下界守卫。这里写的是**下界**而不是精确条目数：精确数字会在每次正常增删
    // 内容时变成一条必须手工改的假失败（本仓库已经因为这类会自己腐烂的门禁做过收敛）。
    expect((await listContentFiles()).length).toBeGreaterThan(20);
  });
});

const temporaryRoots: string[] = [];
afterEach(async () => {
  for (const directory of temporaryRoots.splice(0)) await rm(directory, { recursive: true, force: true });
});
const freshRoot = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mahoshojo-content-'));
  temporaryRoots.push(directory);
  return directory;
};

describe('generated content from a clean output root', () => {
  it('validates source without requiring or writing generated copies', async () => {
    const outputRoot = await freshRoot();
    await generate({ check: true, outputRoot });
    expect(await readdir(outputRoot)).toEqual([]);
    // Exercises the CLI entrypoint on Windows as well as POSIX; a silent no-op is a failure.
    const output = execFileSync(process.execPath, ['scripts/generate-encyclopedia-content.mjs', '--check'], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(output).toContain('content/ 源校验通过');
  });

  it('generates both runtimes byte-for-byte, prunes stale content and preserves unrelated files', async () => {
    const outputRoot = await freshRoot();
    await generate({ outputRoot });
    for (const { app } of TARGETS) {
      const publicRoot = path.join(outputRoot, app, 'public');
      expect((await readdir(path.join(publicRoot, 'encyclopedia'))).sort()).toEqual(await listContentFiles());
      for (const file of await listContentFiles()) {
        expect(await readFile(path.join(publicRoot, 'encyclopedia', file))).toEqual(await readFile(path.join(CONTENT_DIR, file)));
      }
      for (const asset of SHARED_BRAND_ASSETS) {
        expect(await readFile(path.join(publicRoot, asset))).toEqual(await readFile(path.join(REPO_ROOT, 'content/brand', asset)));
      }
    }
    const desktop = path.join(outputRoot, 'apps/desktop/public');
    expect(await readdir(desktop)).not.toContain('arena-card-white.webp');
    await writeFile(path.join(desktop, 'keep.txt'), 'unrelated');
    await writeFile(path.join(desktop, 'encyclopedia/stale.md'), 'retired');
    await writeFile(path.join(desktop, 'logo.svg'), 'drift');
    await expect(generate({ outputRoot, checkOutput: true })).rejects.toThrow('不同步');
    await generate({ outputRoot });
    await generate({ outputRoot, checkOutput: true });
    expect(await readFile(path.join(desktop, 'keep.txt'), 'utf8')).toBe('unrelated');
    expect(await readdir(path.join(desktop, 'encyclopedia'))).not.toContain('stale.md');
  });

  it('only writes the selected runtime', async () => {
    for (const target of ['web', 'desktop']) {
      const outputRoot = await freshRoot();
      await generate({ outputRoot, target });
      expect(await readdir(path.join(outputRoot, 'apps'))).toEqual([target]);
    }
    await expect(generate({ target: 'typo' })).rejects.toThrow('未知同步目标');
  });
});
