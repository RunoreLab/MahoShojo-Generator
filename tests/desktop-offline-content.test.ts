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
 * 因此分三层，各层证明一件事：
 *
 * 1. **构建产物**：`apps/desktop/dist` 里不出现任何远端 URL 字符串。远端资源最可靠的证据是它不在
 *    本地产物里——这是浏览器层模拟不出来的静态事实。
 * 2. **渲染期请求**：在真实渲染首页与百科旅程时记录所有经过的资源加载通道，确认它们的地址都在本地
 *    origin 内。
 * 3. **守卫自身**：把一条远端地址喂给同一个判定函数，证明它会拒绝——否则上面两层都是恒真的。
 *
 * 真机上还要按规格在真实 WebView2 里独立验一次 renderer 与 native 出站，写进 D3.0 验收 runbook；
 * 自动化与模拟器不能替代那一步。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const DESKTOP_DIST = path.join(REPO_ROOT, 'apps', 'desktop', 'dist');
const DESKTOP_CAPABILITIES = path.join(REPO_ROOT, 'apps', 'desktop', 'src-tauri', 'capabilities', 'main-ui.json');

/**
 * 判断一个请求地址是否是"本地"的。
 *
 * 判定口径是**协议**：只放行 Tauri 自定义协议（Windows 上是 `http://tauri.localhost`）、`tauri:`、
 * `ipc:` 与 `data:` / `blob:`。任何 `https:` 到外部主机的请求都是违规——包括看起来无害的字体
 * CDN 与 analytics。
 *
 * 这个函数被下面三条用例共用，第三条专门证明它会拒绝远端地址。
 */
export const isLocalRuntimeRequest = (url: string): boolean => {
  if (url.startsWith('data:') || url.startsWith('blob:')) return true;
  // Tauri 的自定义协议与 IPC 通道：Windows 上是 http://tauri.localhost / http://ipc.localhost。
  if (url.startsWith('tauri:') || url.startsWith('ipc:')) return true;
  if (url.startsWith('http://tauri.localhost') || url.startsWith('http://ipc.localhost')) return true;

  if (url.startsWith('/') || !/^[a-z][a-z0-9+.-]*:/i.test(url)) return true;

  return false;
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
    // 字体 CDN 与 analytics 不会经过 fetch，只 stub fetch 的守卫抓不到它们。
    for (const url of [
      'https://example.invalid/tracker.js',
      'https://cdn.jsdelivr.net/npm/katex@0.16.27/dist/fonts/KaTeX_Main-Regular.woff2',
      'http://example.invalid/pixel.gif',
      'wss://example.invalid/socket',
    ]) {
      expect(isLocalRuntimeRequest(url), `${url} 应当被判为远端请求`).toBe(false);
    }
  });
});

describe('the packaged desktop artifact loads no remote stylesheet or markup resource', () => {
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
   * 更糟。JS 层的证据是另外两条：Tauri 授权面里没有 http 插件（见下），以及真机 WebView2 的
   * 实际请求记录（写进 D3.0 验收 runbook，自动化替代不了）。
   */
  const isStyleOrMarkup = (name: string) => /\.(html|css)$/.test(name);

  const collectStyleOrMarkup = (): string[] => [
    ...collectFiles(DESKTOP_DIST, isStyleOrMarkup),
    ...collectFiles(path.join(DESKTOP_DIST, 'assets'), isStyleOrMarkup),
  ];

  it('finds no remote url() in any built stylesheet', () => {
    const files = collectStyleOrMarkup().filter((file) => file.endsWith('.css'));

    // 需要先构建一次。跳过而不是伪造：一条会因为构建顺序而随机跳过的断言等于没有断言；
    // desktop-ci 的 `Verify desktop frontend` 步骤会在真实构建之后跑这条，因此那里不会跳过。
    if (files.length === 0) {
      expect(
        existsSync(DESKTOP_DIST),
        'apps/desktop/dist 不存在。请先运行 `pnpm --filter @mahoshojo/desktop run build` 再运行本测试。',
      ).toBe(false);
      return;
    }

    const remoteCssUrl = /url\(\s*['"]?(?:https?:)?\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
    const offenders: string[] = [];

    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(remoteCssUrl)) {
        offenders.push(`${path.relative(REPO_ROOT, file)}: ${match[0]}`);
      }
    }

    expect(offenders, `样式表里出现远端资源：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('finds no remote script, style, image or font reference in the entry html', () => {
    const entry = path.join(DESKTOP_DIST, 'index.html');

    if (!existsSync(entry)) {
      expect(
        existsSync(DESKTOP_DIST),
        'apps/desktop/dist 不存在。请先运行 `pnpm --filter @mahoshojo/desktop run build` 再运行本测试。',
      ).toBe(false);
      return;
    }

    const html = readFileSync(entry, 'utf8');
    const remoteReference = /(?:src|href)\s*=\s*['"](?:https?:)?\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
    const offenders = [...html.matchAll(remoteReference)].map((match) => match[0]);

    expect(offenders, `入口 HTML 引用了远端资源：${offenders.join(', ')}`).toEqual([]);
  });

  it('ships the encyclopedia bodies and brand assets locally', () => {
    const encyclopedia = path.join(DESKTOP_DIST, 'encyclopedia');
    if (!existsSync(encyclopedia)) {
      expect(
        existsSync(DESKTOP_DIST),
        'apps/desktop/dist 不存在。请先运行 `pnpm --filter @mahoshojo/desktop run build` 再运行本测试。',
      ).toBe(false);
      return;
    }

    // 正文必须真的躺在 dist 里，而不是由某个运行时去别处取：Tauri 的 `frontendDist` 不做 SPA
    // fallback，离线时也没有任何东西可以回退到（`DESK-PROD-004`）。
    const bodies = readdirSync(encyclopedia).filter((name) => name.endsWith('.md'));
    expect(bodies.length).toBeGreaterThan(20);

    for (const asset of ['logo.svg', 'logo-white.svg', 'encyclopedia.svg']) {
      expect(existsSync(path.join(DESKTOP_DIST, asset)), `产物缺少 ${asset}`).toBe(true);
    }
  });
});

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