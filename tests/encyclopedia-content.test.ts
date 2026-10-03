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

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

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

/** `/encyclopedia/<slug>` —— 条目页路径，也是正文里互链使用的形式。 */
const entryPath = (slug) => `/encyclopedia/${slug}`;

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

describe('encyclopedia content reaches both service roots', () => {
  it('serves the whole encyclopedia from Web', async () => {
    const served = (await readdir(path.join(REPO_ROOT, 'apps/web/public/encyclopedia')))
      .filter((name) => name.endsWith('.md'))
      .sort();
    expect(served).toEqual(await listContentFiles());
  });

  it('serves the whole encyclopedia from Desktop', async () => {
    // Desktop 从 D3.0 起必须在**没有账号、没有模型配置、项目服务器不可达**时仍能读到百科正文
    // （`DESK-PROD-004`）。Tauri 的 `frontendDist` 不做 SPA fallback，所以正文必须真的躺在
    // `apps/desktop/public/` 里，而不是由某个运行时去别处取。这一层断言「文件在且集合一致」；
    // 逐字节一致性由同步脚本的 `--check` 负责。
    const served = (await readdir(path.join(REPO_ROOT, 'apps/desktop/public/encyclopedia')))
      .filter((name) => name.endsWith('.md'))
      .sort();
    expect(served).toEqual(await listContentFiles());
  });

  it('ships the brand assets both runtimes render', async () => {
    // D3.0 的首页与百科页会渲染 logo 与百科标识。Desktop 此前根本没有这些文件，
    // 「共用一个外观」并不证明离线启动达成——资源必须在产物里。
    for (const { app, label } of TARGETS) {
      for (const asset of SHARED_BRAND_ASSETS) {
        const bytes = await readFile(path.join(REPO_ROOT, app, 'public', asset)).catch(() => null);
        expect(bytes, `${label} 缺少 ${asset}`).not.toBeNull();
        expect(bytes!.length, `${label} 的 ${asset} 是空文件`).toBeGreaterThan(0);
      }
    }
  });

  it('gives every article the same bytes in both service roots', async () => {
    // 只比文件名不比内容是不够的：一次手改 `apps/web/public` 就能让两个 app 的百科内容分叉，
    // 而这种分叉在开发机上完全看不出来。
    for (const file of await listContentFiles()) {
      const web = await readFile(path.join(REPO_ROOT, 'apps/web/public/encyclopedia', file));
      const desktop = await readFile(path.join(REPO_ROOT, 'apps/desktop/public/encyclopedia', file));
      expect(desktop.equals(web), `${file} 在两个服务根里内容不同`).toBe(true);
    }
  });
});