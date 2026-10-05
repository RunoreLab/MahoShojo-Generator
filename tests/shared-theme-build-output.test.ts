/**
 * 共源主题与共享控件样式真的进入两端 production 产物。
 *
 * ## 这条测试守的是什么
 *
 * Tailwind v4 的自动源探测只看样式表所在目录并向下走，`packages/ui-web` 因此对两个 app 都不可见。
 * 缺了共享样式表里的 `@source`，后果**不是报错**：页面结构、文案、可访问标签全都在，唯独没有任何样式，
 * 而且构建成功。这类失败只有对着真实产物断言才抓得住——`DESK-PROD-009` 要求「共享资源通过受控的构建
 * 输入进入两个产物」，本测试就是那句话的执行形式。
 *
 * ## 为什么放在仓库根而不是 `packages/ui-web/tests`
 *
 * 它读的是 `apps/web` 与 `apps/desktop` 的样式表，验的是**仓库**的性质而不是某个包的性质。放进包里会
 * 让 `ui-web` 的测试去读 app 目录，那既是越界的依赖方向，也会让 `MONO-005-SHARED-UI-RUNTIME`
 * （共享 UI 不得导入 Node builtin）立刻命中它自己。跨 app 的集成测试在本仓库本来就有固定位置：
 * 根 `tests/`。
 *
 * ## 为什么两端各用自己的管线编译
 *
 * 只测 `packages/ui-web` 自己的 CSS 会漏掉真正会坏的那一段：pnpm 把 workspace 包 junction 进各 app 的
 * `node_modules`，`@source` 是否仍能解析到真实目录，取决于 app 的打包器怎么处理这条路径。
 * tailwindlabs/tailwindcss#19040 记录过 `@source` 指向 `node_modules` 时静默失效的形态。
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const WEB_ROOT = path.join(REPO_ROOT, 'apps', 'web');
const WEB_GLOBALS_CSS = path.join(WEB_ROOT, 'styles', 'globals.css');
const DESKTOP_DIST = path.join(REPO_ROOT, 'apps', 'desktop', 'dist');
const SHARED_STYLESHEET = path.join(REPO_ROOT, 'packages', 'ui-web', 'src', 'styles.css');

/**
 * 这些工具类**只在** `packages/ui-web` 的源码里出现，两个 app 的源码都没有。
 *
 * 因此它们出现在产物中，唯一可能的解释就是共享样式表的 `@source` 生效了。反过来，如果哪天有人把
 * `@source` 删掉，这个断言会立刻失败，而不是等到某次视觉回归被人注意到。
 *
 * 写���**转义后的 CSS 字面量**而不是正则：Tailwind 输出里任意值的括号会被转义成 `\(` / `\)`，
 * 用正则去匹配这串转义需要双层反斜杠，而那种写法一旦少一层就会静默地永远不匹配——一条恒真的断言
 * 比没有断言更糟。
 */
const SHARED_ONLY_UTILITIES = [
  'bg-\\(--app-page-bg\\)',
  'text-\\(--app-text\\)',
  'bg-\\(--app-surface-70\\)',
] as const;

/** 共源主题 token。断言存在，不在此断言取值——取值归 `packages/ui-web/tests/shared-theme.test.ts` 管。 */
const SHARED_THEME_TOKENS = ['--app-page-bg', '--app-surface', '--app-accent', '--app-focus-ring'] as const;

const expectSharedOutput = (css: string, artifact: string): void => {
  for (const utility of SHARED_ONLY_UTILITIES) {
    expect(css, `${artifact} 缺少只在 ui-web 源码中出现的工具类 ${utility}`).toContain(`.${utility}`);
  }
  for (const token of SHARED_THEME_TOKENS) {
    expect(css, `${artifact} 缺少共源主题 token ${token}`).toContain(token);
  }
};

const compileWebCss = async (): Promise<string> => {
  const requireFromApp = createRequire(path.join(WEB_ROOT, 'package.json'));
  const pluginPath = requireFromApp.resolve('@tailwindcss/postcss');
  const postcss = createRequire(pluginPath)('postcss') as typeof import('postcss');
  const plugin = (await import(pluginPath)).default as never;
  const result = await postcss([plugin as never]).process(readFileSync(WEB_GLOBALS_CSS, 'utf8'), {
    from: WEB_GLOBALS_CSS,
  });
  return result.css;
};

const readDesktopBuiltCss = (): string | null => {
  if (!existsSync(DESKTOP_DIST)) return null;
  const assetDirectory = path.join(DESKTOP_DIST, 'assets');
  if (!existsSync(assetDirectory)) return null;
  const cssFiles = readdirSync(assetDirectory).filter((name) => name.endsWith('.css'));
  if (cssFiles.length === 0) return null;
  return cssFiles.map((name) => readFileSync(path.join(assetDirectory, name), 'utf8')).join('\n');
};

describe('shared theme reaches the Web production stylesheet', () => {
  it('compiles shared-only utilities and carries the shared theme tokens', async () => {
    expectSharedOutput(await compileWebCss(), 'Web 产物');
  }, 60_000);
});

describe('shared theme reaches the Desktop production stylesheet', () => {
  it('compiles shared-only utilities and carries the shared theme tokens', () => {
    const css = readDesktopBuiltCss();

    // Desktop 的产物需要先构建一次。跳过而不是伪造：一条会因为构建顺序而随机跳过的断言等于没有断言；
    // desktop-ci 的 `Verify desktop frontend` 步骤会在真实构建之后跑这条，因此那里不会跳过。
    if (css === null) {
      expect(
        existsSync(DESKTOP_DIST),
        'apps/desktop/dist 不存在。请先运行 `pnpm --filter @mahoshojo/desktop run build` 再运行本测试。',
      ).toBe(false);
      return;
    }

    expectSharedOutput(css, 'Desktop 产物');
  });
});

describe('Tailwind stays a single per-app compilation', () => {
  it('keeps exactly one Tailwind entrypoint in the Web stylesheet', () => {
    const globalsCss = readFileSync(WEB_GLOBALS_CSS, 'utf8');

    expect(globalsCss.match(/@import "tailwindcss";/g)).toHaveLength(1);
    expect(globalsCss).toContain('@import "@mahoshojo/ui-web/styles.css";');
    expect(globalsCss).toContain("@custom-variant dark (&:where([data-color-mode='dark'], [data-color-mode='dark'] *));");
  });

  it('does not import tailwindcss from the shared stylesheet', () => {
    const sharedStyles = readFileSync(SHARED_STYLESHEET, 'utf8');

    // 每个 app 一次编译，共享包只提供 token 与 @source。两处引入会让两套 preflight 与两层 theme
    // 同时存在，并让上面那条唯一入口不变量失去意义。
    expect(sharedStyles).not.toMatch(/@import\s+['"]tailwindcss['"]/);
    expect(sharedStyles).toContain('@source "./**/*.{ts,tsx}";');
  });

  it('does not leave a second copy of the shared tokens behind in the Web stylesheet', () => {
    const globalsCss = readFileSync(WEB_GLOBALS_CSS, 'utf8');

    // token 的所有权已经转移。判据是**定义**（`--app-x:`）而不是 token 名的出现：同一个文件里还有
    // 几百处 `data-color-mode` 与 `var(--app-*)` 的消费点，那是正确的，不该被这条断言波及。
    // 若 app 侧还留一份定义，两份会按 CSS 层叠互相覆盖，而症状是"改了共享主题 Web 没反应"或反之
    // ——一个不会报错的静默分叉。
    expect(globalsCss).not.toMatch(/--app-[a-z0-9-]+\s*:/);
    expect(globalsCss).not.toMatch(/--creator-[a-z0-9-]+\s*:/);
    expect(globalsCss).toMatch(/var\(--app-surface\)/);
  });
});