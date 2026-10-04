/**
 * Desktop 本地旅程不发起源站请求（`DESK-PROD-004`）。
 *
 * ## 这条测试守的是什么
 *
 * 规格明确要求「**同时观测 renderer 与 native 网络出口，覆盖 fetch/XHR、WebSocket/EventSource、
 * 图片/样式/脚本资源请求，不只 stub 一个 fetch**」，并且「测试守卫自身需有负向验证」。
 *
 * 这里刻意**不在 jsdom 里模拟六种网络 API**。那会造出一个很大的测试网络栈，而且仍然覆盖不到 CSS
 * `url()`、字体与脚本这些由浏览器自己发起的资源请求——而那恰恰是最容易漏掉远端资源的地方
 * （一张远程背景图不会经过 `fetch`）。
 *
 * 自动化检查两件事：
 *
 * 1. **构建产物**：检查 `apps/desktop/dist` 的 CSS/HTML 资源引用与百科文件完整性；
 *    不把 JS 常量中的远端 URL 当成实际请求，也不声称静态检查覆盖运行期出站。
 * 2. **守卫自身**：把本地与远端地址喂给同一个 origin 判定函数，证明它接受和拒绝的边界正确。
 *
 * 本文件不模拟运行期网络 API。真机上还要按规格在真实 WebView2 里独立观测 renderer 与 native
 * 出站，写进 D3.0 验收 runbook；自动化与模拟器不能替代那一步。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const DESKTOP_DIST = path.join(REPO_ROOT, 'apps', 'desktop', 'dist');
const SOURCE_ENCYCLOPEDIA = path.join(REPO_ROOT, 'content', 'encyclopedia');
const DESKTOP_CAPABILITIES = path.join(REPO_ROOT, 'apps', 'desktop', 'src-tauri', 'capabilities', 'main-ui.json');
const REQUIRE_DESKTOP_DIST = process.env.DESKTOP_OFFLINE_CONTENT_REQUIRE_DIST === '1';

/**
 * 判断一个请求地址是否是"本地"的。
 *
 * 判定口径是**协议**：只放行 Tauri 自定义协议（Windows 上是 `http://tauri.localhost`）、`tauri:`、
 * `ipc:` 与 `data:` / `blob:`。任何 `https:` 到外部主机的请求都是违规——包括看起来无害的字体
 * CDN 与 analytics。
 *
 * 这个函数用于资源引用检查，并由独立的本地/远端用例验证。
 */
export const isLocalRuntimeRequest = (url: string): boolean => {
  let parsed: URL;
  try {
    // Relative paths resolve against the packaged app origin. This also correctly treats `//host/path`
    // as an origin-relative URL instead of mistaking its leading slash for a local path.
    parsed = new URL(url, 'http://tauri.localhost');
  } catch {
    return false;
  }

  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return true;
  // Tauri's custom protocols have opaque origins, so allow only their expected localhost host.
  if ((parsed.protocol === 'tauri:' || parsed.protocol === 'ipc:') && parsed.hostname === 'localhost') return true;

  // Compare parsed origins, not string prefixes: `tauri.localhost.evil.example` is a remote host.
  return parsed.origin === 'http://tauri.localhost' || parsed.origin === 'http://ipc.localhost';
};

const collectFiles = (directory: string, predicate: (name: string) => boolean): string[] => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter(predicate)
    .map((name) => path.join(directory, name));
};

describe('the local-request guard actually rejects remote origins', () => {
  it('accepts the addresses a packaged desktop app legitimately uses', () => {
    for (const url of [
      '/encyclopedia/site-guide.md',
      '/questionnaires/presets/magical-girl-default.json',
      '/assets/index-abc.css',
      './relative.js',
      'data:image/svg+xml;base64,AAA',
      'blob:tauri://localhost/1234',
      'tauri://localhost/',
      'ipc://localhost',
      'http://tauri.localhost/assets/index.js',
      'http://ipc.localhost',
    ]) {
      expect(isLocalRuntimeRequest(url), `${url} 应当被判定为本地请求`).toBe(true);
    }
  });

  it('rejects remote origins, including the innocuous-looking ones', () => {
    // Include protocol-relative and lookalike origins: string-prefix checks must not treat either as local.
    for (const url of [
      'https://example.invalid/tracker.js',
      'https://cdn.jsdelivr.net/npm/katex@0.16.27/dist/fonts/KaTeX_Main-Regular.woff2',
      'http://example.invalid/pixel.gif',
      'wss://example.invalid/socket',
      '//cdn.example.invalid/tracker.js',
      'http://tauri.localhost.evil.example/assets/index.js',
      'http://ipc.localhost.evil.example',
      'ipc://attacker.example/socket',
    ]) {
      expect(isLocalRuntimeRequest(url), `${url} 应当被判为远端请求`).toBe(false);
    }
  });
});

describe.skipIf(!REQUIRE_DESKTOP_DIST && !existsSync(DESKTOP_DIST))(
  'the packaged desktop artifact loads no remote stylesheet or markup resource',
  () => {
    /**
     * CSS 与 HTML 里的 URL **就是**资源引用。
     *
     * 这是"本地产物"最可靠的可静态证明形式：一张远程背景图或一份远程样式表一定会在这两个文件里留下
     * `url(...)` / `src=` / `href=`，而浏览器会自己去取它，不经过 `fetch`。
     *
     * ## 为什么不扫 JS
     *
     * 扫了会得到一串误报，而这个误报会逼人做错事。产物里的 JS 合法地包含：
     * JSON Schema 的 `$schema` 标识串、依赖包的项目主页、以及 Direct AI 的默认端点
     * （`127.0.0.1:11434` 之类）。它们是**代码常量**，不是浏览器会自动发起的资源请求。
     *
     * 把它们当成违规去"修"，意味着要么删掉真实需要的常量，要么把这条断言放宽到恒真——两个都比没有
     * 更糟。JS 层的边界仍需真机 WebView2 实际请求记录（见 D3.0 验收 runbook）。
     */
    const isStyleOrMarkup = (name: string) => /\.(html|css)$/.test(name);

    const collectStyleOrMarkup = (): string[] => [
      ...collectFiles(DESKTOP_DIST, isStyleOrMarkup),
      ...collectFiles(path.join(DESKTOP_DIST, 'assets'), isStyleOrMarkup),
    ];

    it('finds no remote url() in any built stylesheet', () => {
      const files = collectStyleOrMarkup().filter((file) => file.endsWith('.css'));
      expect(files.length, '构建产物中应至少有一份 CSS').toBeGreaterThan(0);

      const cssUrl = /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi;
      const offenders: string[] = [];

      for (const file of files) {
        for (const match of readFileSync(file, 'utf8').matchAll(cssUrl)) {
          const resource = match[2];
          if (!isLocalRuntimeRequest(resource)) {
            offenders.push(`${path.relative(REPO_ROOT, file)}: ${resource}`);
          }
        }
      }

      expect(offenders, `样式表里出现远端资源：\n${offenders.join('\n')}`).toEqual([]);
    });

    it('finds no remote script, style, image or font reference in the entry html', () => {
      const entry = path.join(DESKTOP_DIST, 'index.html');
      expect(existsSync(entry), 'apps/desktop/dist/index.html 必须存在').toBe(true);

      const html = readFileSync(entry, 'utf8');
      const resourceReference = /(?:src|href)\s*=\s*(['"])(.*?)\1/gi;
      const offenders = [...html.matchAll(resourceReference)]
        .map((match) => match[2])
        .filter((resource) => !isLocalRuntimeRequest(resource));

      expect(offenders, `入口 HTML 引用了远端资源：${offenders.join(', ')}`).toEqual([]);
    });

    it('ships the encyclopedia bodies and brand assets locally', () => {
      const encyclopedia = path.join(DESKTOP_DIST, 'encyclopedia');
      expect(existsSync(encyclopedia), 'apps/desktop/dist/encyclopedia 必须存在').toBe(true);

      // 正文必须真的躺在 dist 里，而不是由某个运行时去别处取：Tauri 的 `frontendDist` 不做 SPA
      // fallback，离线时也没有任何东西可以回退到（`DESK-PROD-004`）。
      const expectedBodies = readdirSync(SOURCE_ENCYCLOPEDIA).filter((name) => name.endsWith('.md')).sort();
      const actualBodies = readdirSync(encyclopedia).filter((name) => name.endsWith('.md')).sort();
      expect(actualBodies).toEqual(expectedBodies);
      for (const body of expectedBodies) {
        expect(readFileSync(path.join(encyclopedia, body)), `${body} 应与 content/ 逐字节一致`).toEqual(
          readFileSync(path.join(SOURCE_ENCYCLOPEDIA, body)),
        );
      }

      for (const asset of ['logo.svg', 'logo-white.svg', 'encyclopedia.svg', 'questionnaire-logo.svg']) {
        expect(existsSync(path.join(DESKTOP_DIST, asset)), `产物缺少 ${asset}`).toBe(true);
      }
    });

    it('ships the default questionnaire and its logo from the shared content authority', () => {
      const relative = 'questionnaires/presets/magical-girl-default.json';
      const bundled = readFileSync(path.join(DESKTOP_DIST, relative));
      expect(bundled).toEqual(readFileSync(path.join(REPO_ROOT, 'content', relative)));
      const questionnaire = JSON.parse(bundled.toString('utf8'));
      expect(questionnaire.questions).toHaveLength(16);
      expect(isLocalRuntimeRequest(questionnaire.logoUrl)).toBe(true);
      expect(readFileSync(path.join(DESKTOP_DIST, questionnaire.logoUrl)))
        .toEqual(readFileSync(path.join(REPO_ROOT, 'content/brand', questionnaire.logoUrl)));
      // 花名经 domain 静态打包，不再为 Desktop 提供第二份 public 资产。
      expect(existsSync(path.join(DESKTOP_DIST, 'flowers.json'))).toBe(false);
    });
  },
);

describe('the desktop capability surface stays minimal', () => {
  it('grants no plugin and no filesystem permission', () => {
    const capabilities = JSON.parse(readFileSync(DESKTOP_CAPABILITIES, 'utf8')) as {
      permissions: string[];
    };

    // 百科正文与品牌资源走 `frontendDist`，不需要 fs 插件就能读到（`D3.0-1`）。给本地静态资源
    // 引入 fs 权限，等于用一条 native 能力去换一件 Tauri 已经免费提供的事。
    expect(capabilities.permissions.some((permission) => permission.startsWith('fs:'))).toBe(false);
    expect(capabilities.permissions.some((permission) => permission.startsWith('http:'))).toBe(false);
    expect(capabilities.permissions.some((permission) => permission.includes('shell'))).toBe(false);
    expect(capabilities.permissions.some((permission) => permission.includes('opener'))).toBe(false);
  });
});
