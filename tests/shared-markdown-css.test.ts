/**
 * 共享 Markdown 样式真的进入两端产物，而且只有一份所有者。
 *
 * ## 这条测试守的是什么
 *
 * `packages/ui-web/src/markdown/markdown.css` 从 D3.0 起是 KaTeX CSS 的**唯一**所有者。此前
 * `apps/web/app/layout.tsx` 直接 `import 'katex/dist/katex.min.css'`，而 Desktop 端根本没有第二条
 * 路径去拿这份 CSS——共享组件因此会在 Desktop 上渲染出没有公式样式的数学内容，而 Web 侧看起来完全
 * 正常。
 *
 * 反方向的失败同样静默：如果 app 侧保留自己的 KaTeX import，同一份字体会被以两个不同 base 各发射
 * 一次（KaTeX 的 CSS 用相对 `url()` 引用 `fonts/KaTeX_*.woff2`，不同 base 就是两份文件），体积翻倍
 * 且没有任何构建报错。
 *
 * 放在仓库根而不是 `packages/ui-web/tests`，理由与 `tests/shared-theme-build-output.test.ts` 相同：
 * 它读的是两个 app 的样式表与产物，验的是**仓库**的性质。放进包里会让 `ui-web` 的测试去读 app 目录，
 * 那既是越界的依赖方向，也会让 `MONO-005-SHARED-UI-RUNTIME` 命中它自己。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const WEB_LAYOUT = path.join(REPO_ROOT, 'apps', 'web', 'app', 'layout.tsx');
const WEB_GLOBALS_CSS = path.join(REPO_ROOT, 'apps', 'web', 'styles', 'globals.css');
const DESKTOP_ENTRY = path.join(REPO_ROOT, 'apps', 'desktop', 'src', 'main.tsx');
const DESKTOP_GLOBALS_CSS = path.join(REPO_ROOT, 'apps', 'desktop', 'src', 'styles', 'globals.css');
const SHARED_MARKDOWN_CSS = path.join(REPO_ROOT, 'packages', 'ui-web', 'src', 'markdown', 'markdown.css');
const DESKTOP_DIST = path.join(REPO_ROOT, 'apps', 'desktop', 'dist');

/** 两个 app 各自引用共享 Markdown 样式入口的那一行。 */
const SHARED_MARKDOWN_IMPORT = '@mahoshojo/ui-web/markdown.css';

const readDesktopBuiltCss = (): string | null => {
  if (!existsSync(DESKTOP_DIST)) return null;
  const assetDirectory = path.join(DESKTOP_DIST, 'assets');
  if (!existsSync(assetDirectory)) return null;
  const cssFiles = readdirSync(assetDirectory).filter((name) => name.endsWith('.css'));
  if (cssFiles.length === 0) return null;
  return cssFiles.map((name) => readFileSync(path.join(assetDirectory, name), 'utf8')).join('\n');
};

describe('KaTeX stylesheet has a single owner', () => {
  it('is imported from the shared stylesheet, not from an app', () => {
    expect(readFileSync(SHARED_MARKDOWN_CSS, 'utf8')).toContain(
      '@import "katex/dist/katex.min.css";',
    );

    // app 侧直接 import 会让同一份字体以两个 base 各发射一次。
    expect(readFileSync(WEB_LAYOUT, 'utf8')).not.toContain('katex/dist/katex.min.css');
    expect(readFileSync(WEB_GLOBALS_CSS, 'utf8')).not.toContain('katex/dist/katex.min.css');
    expect(readFileSync(DESKTOP_GLOBALS_CSS, 'utf8')).not.toContain('katex/dist/katex.min.css');
  });

  it('does not copy the KaTeX distribution by hand', () => {
    // 官方要求 fonts/ 必须与 CSS 同级；手工拷贝是在依赖这条隐式契约。
    const webPublic = path.join(REPO_ROOT, 'apps', 'web', 'public');
    expect(existsSync(path.join(webPublic, 'fonts'))).toBe(false);
    expect(existsSync(path.join(REPO_ROOT, 'apps', 'desktop', 'public', 'fonts'))).toBe(false);
  });
});

describe('both runtimes pull the shared Markdown stylesheet', () => {
  it('is reachable from the Web layout', () => {
    expect(readFileSync(WEB_LAYOUT, 'utf8')).toContain(SHARED_MARKDOWN_IMPORT);
  });

  it('is reachable from the Desktop entry', () => {
    const entry = readFileSync(DESKTOP_ENTRY, 'utf8');
    expect(entry).toContain("import './styles/globals.css';");
    expect(readFileSync(DESKTOP_GLOBALS_CSS, 'utf8')).toContain(SHARED_MARKDOWN_IMPORT);
  });
});

describe('shared Markdown styles reach the Desktop production stylesheet', () => {
  it('compiles the KaTeX rules into the built CSS', () => {
    const css = readDesktopBuiltCss();

    // 需要先构建一次。跳过而不是伪造：一条会因为构建顺序而随机跳过的断言等于没有断言；
    // desktop-ci 的 `Verify desktop frontend` 步骤会在真实构建之后跑这条，因此那里不会跳过。
    if (css === null) {
      expect(
        existsSync(DESKTOP_DIST),
        'apps/desktop/dist 不存在。请先运行 `pnpm --filter @mahoshojo/desktop run build` 再运行本测试。',
      ).toBe(false);
      return;
    }

    expect(css).toContain('.katex');
  });
});