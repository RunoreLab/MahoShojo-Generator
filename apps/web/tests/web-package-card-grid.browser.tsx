/**
 * Web 包卡片网格的真实浏览器回归。
 *
 * jsdom 没有布局也没有命中测试，因此"按钮热区互相遮挡"和"描述被挤到只剩几个字"
 * 这两类缺陷在单测里结构性不可见。这里用真实 Chromium + 真实 Tailwind 产物把
 * 组件渲染成静态标记，直接量盒模型与命中结果。
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { WebPackageCardGrid } from '@/components/arena/editor/features/web-package/WebPackageCardGrid';
import { BUILTIN_WEB_PACKAGE_PRESETS } from '@mahoshojo/web-package';

const APP_ROOT = path.resolve(__dirname, '..');
const GLOBALS_CSS = path.join(APP_ROOT, 'styles/globals.css');

/**
 * 编译仓库真实的 Tailwind 产物。手写等价 CSS 会在类名变动时静默漂移，
 * 那等于给回归测试开了个后门。`postcss` 不是 apps/web 的直接依赖，因此从
 * `@tailwindcss/postcss` 自己的依赖树里解析，不写死版本号。
 */
const compileAppCss = async (): Promise<string> => {
  const requireFromApp = createRequire(path.join(APP_ROOT, 'package.json'));
  const pluginPath = requireFromApp.resolve('@tailwindcss/postcss');
  const postcss = createRequire(pluginPath)('postcss') as typeof import('postcss');
  const plugin = (await import(pluginPath)).default as never;
  const result = await postcss([plugin as never]).process(fs.readFileSync(GLOBALS_CSS, 'utf8'), { from: GLOBALS_CSS });
  return result.css;
};

const PRESET_DESCRIPTION = BUILTIN_WEB_PACKAGE_PRESETS[0]!.description;
const BUILTIN = {
  digest: BUILTIN_WEB_PACKAGE_PRESETS[0]!.packageRef.digest,
  title: BUILTIN_WEB_PACKAGE_PRESETS[0]!.title,
  summary: PRESET_DESCRIPTION,
  identity: `${BUILTIN_WEB_PACKAGE_PRESETS[0]!.packageRef.id}@${BUILTIN_WEB_PACKAGE_PRESETS[0]!.packageRef.version}`,
  source: 'builtin' as const,
};
const LOCAL = {
  digest: `sha256:${'b'.repeat(64)}`,
  title: '我的阅读器',
  summary: 'local.side@1.0.0',
  identity: 'local.side@1.0.0',
  source: 'local' as const,
};

const renderGrid = (): string => [
  // 内置预设页签：没有删除入口，末位按钮是「下载」。
  renderToStaticMarkup(
    <WebPackageCardGrid
      items={[BUILTIN]}
      selectedDigest={null}
      emptyHint="没有匹配的内置 Web 包预设。"
      onSelect={() => {}}
      onDownload={() => {}}
      onViewDetails={() => {}}
    />,
  ),
  // 本地库页签：多一个删除入口，末位按钮是「删除」。
  renderToStaticMarkup(
    <WebPackageCardGrid
      items={[LOCAL]}
      selectedDigest={null}
      emptyHint="还没有本地 Web 包。"
      onSelect={() => {}}
      onDownload={() => {}}
      onDelete={() => {}}
      deletable={(item) => !item.sessionOnly}
      onViewDetails={() => {}}
    />,
  ),
].join('');

let browser: Browser;
let page: Page;
let css: string;

beforeAll(async () => {
  const engine = process.env.WEB_PACKAGE_BROWSER ?? 'chromium';
  if (engine !== 'chromium') {
    throw new Error(`卡片网格回归目前只在 chromium 下验证，收到 ${engine}`);
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  css = await compileAppCss();
}, 120_000);

afterAll(async () => { await browser?.close(); });

const openGrid = async (): Promise<void> => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  // max-w-5xl 与 WebPackagePickerModal 保持一致。
  await page.setContent(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style></head>`
    + `<body class="p-4"><div class="mx-auto max-w-5xl space-y-6">${renderGrid()}</div></body></html>`,
  );
};

type MeasuredAction = { label: string; width: number; height: number; hitBy: string | null };
type MeasuredCard = { title: string; cardWidth: number; summaryWidth: number; summaryClipped: boolean; actions: MeasuredAction[] };

const measure = (): Promise<MeasuredCard[]> => page.evaluate(() => [...document
  .querySelectorAll<HTMLElement>('[aria-label^="选择 Web 包"], [aria-label^="取消选择 Web 包"]')]
  .map((select) => {
    const card = select.closest('div.rounded-xl') as HTMLElement;
    const summary = select.children[1] as HTMLElement;
    return {
      title: (select.getAttribute('aria-label') ?? '').replace(/^(选择|取消选择) Web 包：/u, ''),
      cardWidth: card.getBoundingClientRect().width,
      summaryWidth: summary.getBoundingClientRect().width,
      // line-clamp 或单行截断都会让内容盒超出可见盒。
      summaryClipped: summary.scrollHeight > summary.clientHeight + 1
        || summary.scrollWidth > summary.clientWidth + 1,
      actions: [...card.querySelectorAll<HTMLButtonElement>('button[title]')].map((button) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {
          label: (button.getAttribute('title') ?? '').split('：')[0]!,
          width: rect.width,
          height: rect.height,
          hitBy: hit?.closest('button')?.getAttribute('title')?.split('：')[0] ?? null,
        };
      }),
    };
  }));

describe('WebPackageCardGrid 在真实浏览器下的命中与排版', () => {
  it('每个动作按钮的点击都落在自己身上，不被同一行的兄弟按钮吞掉', async () => {
    await openGrid();
    const cards = await measure();

    expect(cards.map((card) => card.title)).toEqual([BUILTIN.title, LOCAL.title]);
    // 内置预设末尾是「下载」，本地库末尾是「删除」——修复前这两个会吞掉整行，
    // 于是本地库的详情/下载触发删除、内置预设的详情触发下载。
    expect(cards[0]!.actions.map((action) => action.label))
      .toEqual(['查看 Web 包详情', '下载 Web 包 ZIP']);
    expect(cards[1]!.actions.map((action) => action.label))
      .toEqual(['查看 Web 包详情', '下载 Web 包 ZIP', '从本地库删除']);

    for (const card of cards) {
      for (const action of card.actions) {
        expect({ label: action.label, hitBy: action.hitBy }).toEqual({ label: action.label, hitBy: action.label });
      }
    }
  });

  it('Playwright 的真实点击能命中各自的动作，不会被拦截重试', async () => {
    await openGrid();
    for (const title of ['查看 Web 包详情：竞技场新闻', '下载 Web 包 ZIP：竞技场新闻', '查看 Web 包详情：我的阅读器', '下载 Web 包 ZIP：我的阅读器', '从本地库删除：我的阅读器']) {
      // Playwright 在点击前会做可命中性检查，被别的元素挡住会直接超时失败。
      await page.locator(`button[title="${title}"]`).click({ timeout: 5_000 });
    }
  });

  it('描述拿得到足够宽度，预设描述不再被截成个位数', async () => {
    await openGrid();
    const cards = await measure();
    const preset = cards[0]!;

    // 动作按钮曾经无条件吃掉 120px（pr-[7.5rem]），文本盒只剩 101px ≈ 8 个汉字。
    expect(preset.summaryWidth).toBeGreaterThan(preset.cardWidth * 0.6);
    expect(preset.summaryClipped).toBe(false);
    // 断言用的是仓库里真实的预设描述，不是随手编的短句。
    expect(PRESET_DESCRIPTION.length).toBeGreaterThan(30);
  });

  it('动作按钮达到 44px 触摸目标', async () => {
    await openGrid();
    for (const card of await measure()) {
      for (const action of card.actions) {
        expect({ label: action.label, width: action.width, height: action.height })
          .toEqual({ label: action.label, width: expect.any(Number), height: expect.any(Number) });
        expect(action.width).toBeGreaterThanOrEqual(44);
        expect(action.height).toBeGreaterThanOrEqual(44);
      }
    }
  });
});
