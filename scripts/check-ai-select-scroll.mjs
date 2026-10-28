#!/usr/bin/env node
/**
 * 共享模型选择器真实浏览器滚动回归。显式本地运行，不请求模型/API。
 * node scripts/check-ai-select-scroll.mjs [--browser chromium|webkit] [--channel msedge]
 * 复用仓库已安装的 Playwright/esbuild/Tailwind，不下载浏览器或新增依赖。
 * 证据写入 .tmp/ai-select-scroll/report.json；不等同 Tauri 或真实触屏验收。
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps/web');
const requireWeb = createRequire(path.join(WEB, 'package.json'));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const browserName = option('browser', 'chromium');
assert(['chromium', 'webkit'].includes(browserName), 'Use chromium or webkit');
const channel = option('channel', process.platform === 'win32' ? 'msedge' : undefined);
const OUT = path.join(ROOT, '.tmp/ai-select-scroll');
await mkdir(OUT, { recursive: true });

const bundle = await build({
  absWorkingDir: ROOT,
  entryPoints: [path.join(ROOT, 'packages/ui-web/tests/browser/ai-select-scroll.tsx')],
  outfile: path.join(OUT, 'app.js'), bundle: true, write: false,
  platform: 'browser', format: 'esm', jsx: 'automatic', target: ['chrome111'],
  define: { 'process.env.NODE_ENV': '"development"' }, metafile: true,
});
const pluginPath = requireWeb.resolve('@tailwindcss/postcss');
const postcss = createRequire(pluginPath)('postcss');
const css = await postcss([requireWeb('@tailwindcss/postcss')()]).process(
  '@import "tailwindcss";\n@source "../../../packages/ui-web/src";\n@source "../../../packages/ui-web/tests/browser";\n@import "@mahoshojo/ui-web/styles.css";',
  { from: path.join(WEB, 'styles/ai-select-scroll.css') },
);
const files = new Map([
  ['/app.js', { body: bundle.outputFiles[0].contents, type: 'text/javascript' }],
  ['/app.css', { body: css.css, type: 'text/css' }],
  ['/', { body: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>滚动回归</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>', type: 'text/html' }],
]);
for (const [url, file] of files) if (url !== '/') await writeFile(path.join(OUT, url.slice(1)), file.body);
await writeFile(path.join(OUT, 'build-inputs.json'), JSON.stringify(Object.keys(bundle.metafile.inputs), null, 2));

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const file = files.get(url.pathname);
  if (request.method !== 'GET' || !file || request.headers.cookie || request.headers.authorization) {
    response.writeHead(403).end('Fixture only'); return;
  }
  response.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'no-store' }).end(file.body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = { status: 'running', scope: 'Real shared component, synthetic rerender/report growth; not Next routing, live generation, touch hardware or Tauri', browserName, platform: process.platform, cases: [] };
let browser;
const coordinates = page => page.evaluate(() => ({
  page: scrollY,
  ancestor: document.querySelector('[data-testid="ancestor"]')?.scrollTop ?? 0,
}));
const noAncestorMovement = async (page, expected, label) => {
  const actual = await coordinates(page);
  assert(Math.abs(actual.page - expected.page) <= 1, `${label}: page ${expected.page} -> ${actual.page}`);
  assert(Math.abs(actual.ancestor - expected.ancestor) <= 1, `${label}: ancestor ${expected.ancestor} -> ${actual.ancestor}`);
};
const touchSwipe = async (session, x, y, distance) => {
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 8; step += 1) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - distance * step / 8 }] });
    await new Promise(resolve => setTimeout(resolve, 24));
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
try {
  const playwright = requireWeb('playwright');
  browser = await playwright[browserName].launch({ headless: true, ...(browserName === 'chromium' && channel ? { channel } : {}) });
  report.browserVersion = browser.version();
  for (const width of [375, 1280]) for (const mode of ['light', 'dark']) for (const nested of [false, true]) {
    const name = `${width}-${mode}-${nested ? 'nested' : 'page'}`;
    const touch = width === 375 && browserName === 'chromium';
    const context = await browser.newContext({ viewport: { width, height: 812 }, colorScheme: mode, serviceWorkers: 'block', ...(touch ? { hasTouch: true, isMobile: true } : {}) });
    const errors = [], blocked = [];
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { blocked.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => errors.push(String(error)));
    try {
      await page.goto(`${origin}/${nested ? '?nested' : ''}`);
      await page.evaluate(value => { document.documentElement.dataset.colorMode = value; }, mode);
      const trigger = page.getByRole('combobox');
      await trigger.waitFor();
      await page.getByTestId('stream').click();
      await page.evaluate(() => {
        const trigger = document.querySelector('[role="combobox"]');
        scrollTo(0, scrollY + trigger.getBoundingClientRect().top - 220);
      });
      await trigger.click();
      const menu = page.locator('.battle-lite-select-menu');
      await menu.waitFor();
      const opened = await coordinates(page);
      const initialMenu = await menu.evaluate(element => element.scrollTop);
      assert(initialMenu > 0, `${name}: selected middle option was not exposed on open`);

      // 用户把页面向下滑动，此后多轮宿主更新与内容增长都不得拉回页面/菜单。
      const userScrolled = await page.evaluate(() => {
        scrollBy(0, 700);
        return { page: scrollY, ancestor: document.querySelector('[data-testid="ancestor"]')?.scrollTop ?? 0 };
      });
      assert(userScrolled.page > opened.page + 100, `${name}: page did not scroll`);
      const revision = await page.getByTestId('revision').textContent();
      await page.waitForFunction(value => Number(document.querySelector('[data-testid="revision"]').textContent) >= Number(value) + 5, revision);
      await noAncestorMovement(page, userScrolled, `${name} rerender/growth`);
      assert.equal(await menu.evaluate(element => element.scrollTop), initialMenu, `${name}: rerender moved menu`);
      const touchSession = touch ? await context.newCDPSession(page) : null;
      if (touchSession) {
        await touchSwipe(touchSession, width - 6, 600, 160);
        await page.waitForTimeout(300);
        const outsideTouch = await coordinates(page);
        assert(outsideTouch.page > userScrolled.page + 50, `${name}: outside touch did not scroll page`);
        await page.waitForTimeout(300);
        await noAncestorMovement(page, outsideTouch, `${name} outside touch/rerender`);
      }

      // 还原到可操作视野，检查键盘只定位菜单；Home/End 与方向键都覆盖。
      await page.evaluate(value => scrollTo(0, value), opened.page);
      await trigger.focus();
      const beforeKeys = await coordinates(page);
      for (const key of ['End', 'Home', 'ArrowDown', 'ArrowUp']) {
        await trigger.press(key);
        await noAncestorMovement(page, beforeKeys, `${name} ${key}`);
        const visible = await page.evaluate(() => {
          const trigger = document.querySelector('[role="combobox"]');
          const item = document.getElementById(trigger.getAttribute('aria-activedescendant'));
          const menu = document.querySelector('.battle-lite-select-menu');
          const itemRect = item.getBoundingClientRect(), menuRect = menu.getBoundingClientRect();
          return itemRect.top >= menuRect.top - 1 && itemRect.bottom <= menuRect.bottom + 1;
        });
        assert(visible, `${name}: ${key} active option is clipped`);
      }

      // 菜单中部滚轮应实际滚动菜单，而非仅仅把页面锁住。
      await menu.evaluate(element => { element.scrollTop = 0; });
      await menu.hover();
      const beforeInterior = await coordinates(page);
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(180);
      assert((await menu.evaluate(element => element.scrollTop)) > 20, `${name}: inner wheel did not scroll menu`);
      await noAncestorMovement(page, beforeInterior, `${name} inner wheel`);
      if (touchSession) {
        await menu.evaluate(element => { element.scrollTop = 0; });
        const box = await menu.boundingBox();
        await touchSwipe(touchSession, box.x + box.width / 2, box.y + box.height - 12, Math.min(120, box.height - 24));
        await page.waitForTimeout(300);
        assert((await menu.evaluate(element => element.scrollTop)) > 20, `${name}: inside touch did not scroll menu`);
        await noAncestorMovement(page, beforeInterior, `${name} inside touch`);
      }

      // hover 只高亮；菜单边缘的滚轮不得串到页面或嵌套祖先。
      await menu.evaluate(element => { element.scrollTop = 15; });
      const firstVisible = menu.getByRole('option').nth(1);
      await firstVisible.hover();
      assert.equal(await menu.evaluate(element => element.scrollTop), 15, `${name}: hover moved menu`);
      await menu.hover();
      await menu.evaluate(element => { element.scrollTop = element.scrollHeight; });
      const beforeWheel = await coordinates(page);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(180);
      await noAncestorMovement(page, beforeWheel, `${name} bottom wheel`);
      await menu.evaluate(element => { element.scrollTop = 0; });
      await page.mouse.wheel(0, -600);
      await page.waitForTimeout(180);
      await noAncestorMovement(page, beforeWheel, `${name} top wheel`);
      await trigger.press('Escape');
      await menu.waitFor({ state: 'detached' });
      await page.mouse.move(width - 8, 500);
      const closed = await coordinates(page);
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(180);
      assert((await coordinates(page)).page > closed.page + 100, `${name}: page locked after close`);

      // 页面底部触发器应向上展开，键盘仍只滚动菜单。
      await page.evaluate(() => {
        const trigger = document.querySelector('[role="combobox"]');
        scrollTo(0, scrollY + trigger.getBoundingClientRect().bottom - innerHeight + 24);
      });
      await trigger.click();
      assert((await menu.getAttribute('class')).includes('bottom-full'), `${name}: did not open upward`);
      const upward = await coordinates(page);
      await trigger.press('End');
      await noAncestorMovement(page, upward, `${name} upward End`);
      assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      report.cases.push({ name, status: 'passed', opened, userScrolled, initialMenu, touchEmulation: touch, errors, blocked });
    } finally { await context.close(); }
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack ?? error); process.exitCode = 1;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ status: report.status, cases: report.cases.length, report: path.join(OUT, 'report.json'), error: report.error }, null, 2));
