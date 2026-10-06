// @vitest-environment jsdom
/**
 * D2.5b 路由选型验证。
 *
 * 这条测试是 `PLAN-desktop-client-v1` §D2.5b 要求的「验证结果」的**可执行形式**：结论不是注释，
 * 而是一组在当前锁定版本上跑过的断言。计划要求把实际版本与采纳/否决原因写进该节，本文件提供那段
 * 记录所依据的事实。
 *
 * ## 它到底在验证什么
 *
 * 候选是当前正式版 `@tanstack/react-router` + `createHashHistory`；选型理由与风险记在
 * `src/app/router.ts`。真正不确定的不是「TanStack Router 能不能用」，而是四件事：
 *
 * 1. **hash history 的 URL 形状。** Tauri 用自定义协议提供产物且不做 SPA fallback，路径必须落在 `#`
 *    之后，否则任何刷新或深链都打不开页面。
 * 2. **返回/前进是否真的往返。** 这是 D2.5b 的退出门禁之一。
 * 3. **同页 query 变化与中文/尾斜杠路径是否被正确归一。** 共源导航依赖
 *    `getTopbarCanonicalPathname`；路由器若给出另一种形状，两端高亮就会不一致。
 * 4. **`@tanstack/history` 的 blocker 一致性修复是否已在发布包内。** 调研记录了一个临近仓库对
 *    `1.162.4` 的本地补丁，处理「无有效 history delta 或 delta 为零」的回退边界，并记录上游
 *    PR #8264 已合并。合并不等于已发布包含修复，发布日期同样不能代替验证——因此这里既读发布包源码
 *    确认修复面存在，也直接压那几条边界行为。
 *
 * ## jsdom 的两个已知限制（不是被测对象的缺陷）
 *
 * - **traversal 很慢。** `history.back()` 派发的 `popstate` 在 jsdom 里要过 100ms 量级的宏任务才到；
 *   只等微任务会得到「返回没生效」的假象。`settle()` 因此给足 120ms。真实 WebView 没有这个延迟。
 * - **traversal 只在同一 document 内有效。** 因此 `back()` 的断言都在单个 router 实例内完成。
 *
 * ## 仍然开放的部分
 *
 * 本文件跑在 jsdom，**不是**真实 Tauri WebView。原生窗口关闭（`onCloseRequested`）、真实 DPI/字体、
 * 以及真实 raw IPC 都不在此覆盖内。D2.5b 的真机门禁因此仍然开放，不得因为本文件通过就记为 PASS。
 */

import { act } from 'react';
import {
  RouterProvider,
  createHashHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useBlocker,
  useRouter,
} from '@tanstack/react-router';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getRouteFragmentFromHashHistory } from '../src/app/hash-history-fragment';
import { createDesktopRouter } from '../src/app/router';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // jsdom 没有布局或滚动实现；本文件只验证路由状态，滚动由真实 WebView 验收。
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.location.hash = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/**
 * 推进到导航稳定态。
 *
 * 必须等**宏任务**：jsdom 的 `history.go()` 异步派发 `popstate`，只 `await Promise.resolve()` 的写法
 * 会让 `back()` / `forward()` 的断言落在事件之前，症状是「返回没生效」——一个会被误判成路由器缺陷
 * 的测试假象。120ms 是实测余量，不是随手写的数字。
 */
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await Promise.resolve();
  });
};

/** 挂载 provider。**必须挂载**——router 在 mount 时才订阅 history，卸载状态下 back() 不会被观察到。 */
const mount = async () => {
  const router = createDesktopRouter();
  await router.load();
  act(() => {
    root.render(<RouterProvider router={router} />);
  });
  await settle();
  return router;
};

/**
 * 当前渲染的页面 testid。
 *
 * 选择器必须锚在 `page-` 前缀上：壳的外框自带 `data-testid="product-shell"`，而
 * `querySelector('[data-testid]')` 会先命中它，于是所有页面断言都会变成「期望 page-home、实得
 * product-shell」——一条恒失败但看不出原因的断言。
 */
const pageTestId = (): string | null | undefined =>
  container.querySelector('[data-testid^="page-"]')?.getAttribute('data-testid');

/**
 * 共源百科视图的 testid。
 *
 * 它们由 `@mahoshojo/ui-web/encyclopedia` 提供，用的是自己的命名而不是 Desktop 的 `page-` 前缀——
 * 共享组件不该采用某个 app 的测试约定。因此这里按前缀分别取，而不是让 `pageTestId` 兼管。
 */
const encyclopediaTestId = (): string | null | undefined =>
  container.querySelector('[data-testid^="encyclopedia-"]')?.getAttribute('data-testid');

describe('desktop router keeps the product path inside the hash', () => {
  it('never writes the product path before the hash', async () => {
    const router = createDesktopRouter();
    await router.load();

    await act(async () => {
      await router.navigate({ to: '/local-library' });
    });
    await settle();

    // 这是选 hash history 的全部理由：Tauri 的自定义协议不做 SPA fallback，路径落在 `#` 之前
    // 意味着刷新或深链会打不开页面。必须断言，而不是靠注释声明。
    expect(window.location.hash).toBe('#/local-library');
    expect(window.location.pathname).toBe('/');
  });

  it('renders the matching route for each delivered path', async () => {
    const router = await mount();
    expect(pageTestId()).toBe('page-home');
    const home = container.querySelector('[data-testid="page-home"]')!;
    const hrefs = [...home.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href'));

    // 共源首页目录在 hide 策略下只渲染已交付入口：/details 与 /character-manager
    // 可点；/canshou、/battle 等 Web-only 或未交付路径整条不出现（DESK-PROD-001）。
    // hash-history 宿主的 <a href> 一律是 `#/产品路径`——裸 `/path` 会让复制链接与
    // 脚本失败后的原生跳转落在 Tauri 自定义协议伺服不了的路径上。
    expect(home.querySelector('[data-testid="home-feature-grid"]')).not.toBeNull();
    // TopBar logo 用 favicon 圆形标志（双端产品对齐决策）；页面骨架与 Web 同构——
    // `magic-background* > .container > .card` 共源 class 提供渐变底与白色限宽卡。
    expect(container.querySelector('img[src="/favicon.svg"]')).not.toBeNull();
    // DESK-PARITY-002：品牌由顶栏 favicon 承担，`brand={null}` 使壳不再渲染默认
    // 文字品牌「MahoShojo Generator」（顶栏/favicon 自身的 'MahoShojo' 不含该串）。
    expect(container.querySelector('[data-testid="product-shell"]')?.textContent).not.toContain(
      'MahoShojo Generator',
    );
    expect(home.classList.contains('magic-background-white')).toBe(true);
    expect(home.querySelector(':scope > .container > .card')).not.toBeNull();
    expect(home.textContent).toContain('欢迎来到魔法国度！选择一个项目开始玩耍吧！');
    expect(hrefs).toContain('#/details');
    expect(hrefs).toContain('#/character-manager');
    expect(hrefs).toContain('#/encyclopedia');
    expect(hrefs).toContain('#/local-library');
    expect(hrefs).toContain('#/settings');
    expect(hrefs).not.toContain('/battle');
    expect(hrefs).not.toContain('/canshou');
    // 页脚站外链接经 onNavigateExternal 渲染为真实 <a href>（点击被拦截走
    // open_external_url），而不是不可点的占位。
    expect(hrefs.some((href) => href?.startsWith('https://'))).toBe(true);
    expect(home.textContent).not.toContain('PVP');

    for (const [to, expected] of [
      ['/details', 'page-details'],
      ['/character-manager', 'page-character-manager'],
      ['/local-library', 'page-local-library'],
      ['/settings', 'page-settings'],
    ] as const) {
      await act(async () => {
        await router.navigate({ to });
      });
      await settle();
      expect(pageTestId(), `${to} 应当渲染 ${expected}`).toBe(expected);
    }

    // 卡片页与 Web 同构：`magic-background* > .container > .card` 共源骨架
    // （DESK-PARITY：白色限宽容器）。裸 section 的百科/本地库不在此约束内——
    // Web 对应页面同样不套 card。
    for (const [to, expected, backgroundClass] of [
      ['/details', 'page-details', 'magic-background'],
      ['/character-manager', 'page-character-manager', 'magic-background-white'],
    ] as const) {
      await act(async () => {
        await router.navigate({ to });
      });
      await settle();
      const page = container.querySelector(`[data-testid="${expected}"]`)!;
      expect(
        page.classList.contains(backgroundClass),
        `${to} 应当使用 ${backgroundClass} 页面骨架`,
      ).toBe(true);
      expect(page.querySelector(':scope > .container > .card')).not.toBeNull();
    }

    for (const [to, expected] of [
      ['/encyclopedia', 'encyclopedia-index'],
      ['/encyclopedia/site-guide', 'encyclopedia-entry'],
    ] as const) {
      await act(async () => {
        await router.navigate({ to });
      });
      await settle();
      expect(encyclopediaTestId(), `${to} 应当渲染 ${expected}`).toBe(expected);
    }
  });
});

/**
 * 百科锚点在 hash history 下的形状。
 *
 * 路由与 fragment 共处同一个 `#`：`/#/encyclopedia/site-guide#角色生成`。因此条目页**不能**读
 * `window.location.hash`——在 Desktop 上那个值等于整个 `#/route#anchor`，直接喂给 `getElementById`
 * 只会落空。共享层因此要求宿主注入 `router.state.location.hash`，这里断言注入的是**后半段**。
 */
describe('encyclopedia anchors under hash history', () => {
  it('keeps the fragment behind the route inside the hash', async () => {
    const router = await mount();

    await act(async () => {
      await router.navigate({ to: '/encyclopedia/site-guide', hash: '角色生成' });
    });
    await settle();

    // 浏览器把 CJK fragment 写成 percent-encoded，这是 URL 的正常形态；解码由共享层负责。
    expect(window.location.hash).toBe('#/encyclopedia/site-guide#%E8%A7%92%E8%89%B2%E7%94%9F%E6%88%90');
    expect(window.location.pathname).toBe('/');
    expect(getRouteFragmentFromHashHistory(router.state.location.href)).toBe(
      '%E8%A7%92%E8%89%B2%E7%94%9F%E6%88%90',
    );
  });

  it('changes only the fragment when staying on the same entry', async () => {
    // 「已经在同一篇条目时只改变 hash」是 D3.0 的验收项：它不能触发一次新的正文取回。
    const router = await mount();

    await act(async () => {
      await router.navigate({ to: '/encyclopedia/site-guide', hash: 'battle' });
    });
    await settle();
    expect(router.state.location.pathname).toBe('/encyclopedia/site-guide');

    await act(async () => {
      await router.navigate({ to: '/encyclopedia/site-guide', hash: 'scoring' });
    });
    await settle();

    expect(window.location.hash).toBe('#/encyclopedia/site-guide#scoring');
    expect(router.state.location.pathname).toBe('/encyclopedia/site-guide');
    expect(getRouteFragmentFromHashHistory(router.state.location.href)).toBe('scoring');
  });
});

/**
 * 百科目录的 `?q`/`?c` 与 `<a href>` 在 hash history 下的口径。
 *
 * 两件事都必须成立才算「可分享」：筛选写回地址栏、以及地址栏恢复筛选。前者依赖宿主把
 * 共源视图回传的 `/encyclopedia?q=x` 拆成 `to + search`——整个字符串塞进 `to` 会被当成
 * pathname，query 无声丢失。后者依赖路由 `validateSearch` 把 q/c 保留给页面。
 */
describe('encyclopedia index filter and links under hash history', () => {
  const typeSearch = async (value: string): Promise<void> => {
    const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索百科条目"]');
    expect(input, '找不到百科搜索框').not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();
  };

  it('restores ?q and ?c from the route search', async () => {
    const router = await mount();
    await act(async () => {
      await router.navigate({ to: '/encyclopedia', search: { q: '限流', c: 'troubleshooting' } });
    });
    await settle();

    const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索百科条目"]');
    expect(input?.value).toBe('限流');
    // 分类筛选已恢复：故障排查高亮，结果只剩该分类里匹配「限流」的条目。
    // aria-pressed 的选择器必须锚在百科区块内——顶栏主题菜单也用 aria-pressed。
    const index = container.querySelector('[data-testid="encyclopedia-index"]')!;
    const activeCategory = index.querySelector('button[aria-pressed="true"]');
    expect(activeCategory?.textContent).toContain('故障排查');
    expect(container.textContent).toContain('429');
    expect(container.querySelector('a[href="#/encyclopedia/rate-limit-429"]')).not.toBeNull();
    // 不在筛选内的条目不渲染。
    expect(container.querySelector('a[href="#/encyclopedia/site-guide"]')).toBeNull();
  });

  it('writes filter changes back to the hash route query', async () => {
    const router = await mount();
    await act(async () => {
      await router.navigate({ to: '/encyclopedia' });
    });
    await settle();

    await typeSearch('限流');
    // 产品路径留在 # 之后，query 以真实 search 形式进入地址栏而不是拼进 pathname。
    expect(router.state.location.pathname).toBe('/encyclopedia');
    expect(router.state.location.search).toEqual({ q: '限流' });
    expect(window.location.hash).toContain('/encyclopedia?');
    expect(window.location.hash).toContain('q=');

    const categoryButton = [...container.querySelectorAll('button[aria-pressed]')].find((button) =>
      button.textContent?.includes('故障排查'),
    );
    expect(categoryButton, '找不到故障排查分类按钮').not.toBeUndefined();
    await act(async () => {
      categoryButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(router.state.location.search).toEqual({ q: '限流', c: 'troubleshooting' });
    expect(window.location.hash).toContain('c=troubleshooting');
  });

  it('renders runtime hrefs as #/… on index cards and entry chrome', async () => {
    const router = await mount();
    await act(async () => {
      await router.navigate({ to: '/encyclopedia' });
    });
    await settle();

    const indexHrefs = [...container.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href'));
    // 卡片与返回首页都必须是 `#/` 形态——裸 `/path` 的复制链接会落在伺服不了的路径上。
    expect(indexHrefs.some((href) => href === '#/encyclopedia/site-guide')).toBe(true);
    expect(indexHrefs).toContain('#/');
    expect(indexHrefs.filter((href) => href?.startsWith('/') && !href.startsWith('//'))).toEqual([]);

    await act(async () => {
      await router.navigate({ to: '/encyclopedia/site-guide' });
    });
    await settle();

    const entryHrefs = [...container.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href'));
    // 条目页 chrome（「返回百科目录」、侧栏条目）同样走 #/ 解析。
    expect(entryHrefs).toContain('#/encyclopedia');
    expect(entryHrefs.filter((href) => href?.startsWith('/') && !href.startsWith('//'))).toEqual([]);
  });

  it('renders the shared not-found state for an unknown slug', async () => {
    const router = await mount();
    await act(async () => {
      await router.navigate({ to: '/encyclopedia/does-not-exist' });
    });
    await settle();

    expect(encyclopediaTestId()).toBe('encyclopedia-entry');
    expect(container.textContent).toContain('未找到条目');
    expect(container.textContent).toContain('该百科条目不存在');
    // 未知 slug 的返回入口仍然可用且是 #/ 形态。
    expect(container.querySelector('a[href="#/encyclopedia"]')).not.toBeNull();
  });

  it('normalizes a JSON-parseable ?q back into a keyword', async () => {
    // `parseSearch` 把 `?q=429` 物化成 number 429——「429」「true」都是真实关键词，
    // `validateSearch` 必须归一回字符串而不是整条丢弃（D5.1-P2-r1）。
    window.location.hash = '#/encyclopedia?q=429';
    await mount();

    // `location.search` 是 parseSearch 的原始产物（number）；validateSearch 的归一结果
    // 落在路由 match 上——页面经 `useSearch` 读到的是后者，也就是输入框里的 '429'。
    const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索百科条目"]');
    expect(input?.value).toBe('429');
  });

  it('writes ?q in the web-compatible raw form without JSON quoting', async () => {
    // 默认 stringify 会给字符串值套 JSON 引号（`?q=%22429%22`），与 Web 的 `?q=429`
    // 双向失真；自定义 stringifySearch 必须让两端 URL 可互贴（D5.1-P2-r1）。
    const router = await mount();
    await act(async () => {
      await router.navigate({ to: '/encyclopedia' });
    });
    await settle();

    await typeSearch('429');
    expect(window.location.hash).toContain('q=429');
    expect(window.location.hash).not.toContain('%22');
    // 同一条 URL 读回来时（reload/分享粘贴），number 会被归一回关键词文本。
    const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索百科条目"]');
    expect(input?.value).toBe('429');
  });

  it('syncs the filter input on same-page back/forward and keeps typing out of the history stack', async () => {
    const router = await mount();
    await act(async () => {
      await router.navigate({ to: '/encyclopedia' });
    });
    await settle();

    // 两条不同的筛选状态入栈（直接 navigate 是 push——用户分享的链接语义）。
    await act(async () => {
      await router.navigate({ to: '/encyclopedia', search: { q: '甲' } });
    });
    await settle();
    await act(async () => {
      await router.navigate({ to: '/encyclopedia', search: { q: '乙' } });
    });
    await settle();
    const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索百科条目"]');
    expect(input?.value).toBe('乙');

    // back：URL 回到 ?q=甲，筛选框必须跟上——此前 useState(initial) 只在挂载时生效。
    await act(async () => {
      router.history.back();
    });
    await settle();
    expect(router.state.location.search).toEqual({ q: '甲' });
    expect(input?.value).toBe('甲');

    // 组件内输入写回用 replace：不产生新历史条目，forward 仍是 ?q=乙。
    await typeSearch('丙');
    expect(router.state.location.search).toEqual({ q: '丙' });
    await act(async () => {
      router.history.forward();
    });
    await settle();
    expect(router.state.location.search).toEqual({ q: '乙' });
    expect(input?.value).toBe('乙');
  });
});

describe('back/forward round trip on the locked version', () => {
  it('returns and advances across delivered paths', async () => {
    const router = await mount();

    await act(async () => {
      await router.navigate({ to: '/local-library' });
      await router.navigate({ to: '/settings' });
    });
    await settle();
    expect(router.state.location.pathname).toBe('/settings');

    await act(async () => {
      router.history.back();
    });
    await settle();
    // URL、router 状态与 DOM 三者必须同时到位。少断言其中任何一个，都会让「地址栏变了但页面没换」
    // 这种最典型的假通过溜过去。
    expect(window.location.hash).toBe('#/local-library');
    expect(router.state.location.pathname).toBe('/local-library');
    expect(pageTestId()).toBe('page-local-library');

    await act(async () => {
      router.history.forward();
    });
    await settle();
    expect(window.location.hash).toBe('#/settings');
    expect(router.state.location.pathname).toBe('/settings');
    expect(pageTestId()).toBe('page-settings');
  });

  it('leaves the location uncorrupted when traversal has nowhere to go', async () => {
    const router = await mount();

    await act(async () => {
      await router.navigate({ to: '/settings' });
    });
    await settle();

    // 断言「未损坏」而不是「停在某个具体路径」：jsdom 的 session history 在同一个测试文件的多个
    // 用例之间是共享的，因此这里 `back()` 越界时会落到**前一个用例**留下的条目上，那是合法行为。
    // 真正需要守住的不变量是：越界 traversal 不会把应用推进一个非路由状态。
    await act(async () => {
      router.history.back();
      router.history.back();
      router.history.back();
      router.history.back();
    });
    await settle();

    const landed = router.state.location.pathname;
    expect(['', '/', '/settings', '/local-library']).toContain(landed);
    // 越界之后应用仍然可用：能再次导航到一个已知页面。仅仅「没抛异常」不足以说明没损坏。
    await act(async () => {
      await router.navigate({ to: '/local-library' });
    });
    await settle();
    expect(router.state.location.pathname).toBe('/local-library');
    expect(pageTestId()).toBe('page-local-library');
  });

  it('clamps out-of-range traversal on a history whose stack this test owns', async () => {
    // 上面那条受 jsdom 共享 document 限制，只能验「未损坏」。这条用 memory history 把整条栈握在
    // 测试手里，于是「无有效 delta」与「delta 为零」这两类边界可以被**确定性地**断言——这正是
    // 调研里记录的临近仓库补丁所针对的形状。
    const history = createMemoryHistory({ initialEntries: ['/'] });

    expect(history.location.pathname).toBe('/');
    expect(history.length).toBe(1);

    history.push('/local-library');
    history.push('/settings');
    expect(history.location.pathname).toBe('/settings');
    expect(history.length).toBe(3);

    history.back();
    expect(history.location.pathname).toBe('/local-library');
    history.forward();
    expect(history.location.pathname).toBe('/settings');

    // 越界：不再后退，也不前进。
    history.forward();
    expect(history.location.pathname).toBe('/settings');
    history.back();
    history.back();
    history.back();
    expect(history.location.pathname).toBe('/');
    // 停在栈底时再退一次必须仍然是栈底，而不是越界或变成 undefined。
    history.back();
    expect(history.location.pathname).toBe('/');
    expect(history.location.href).toBe('/');

    // delta 为零只约束位置与历史栈不变，不把依赖的通知次数固化为产品契约。
    const before = { ...history.location };
    history.go(0);
    expect(history.location.pathname).toBe('/');
    expect(history.location.href).toBe('/');
    expect(history.location).toEqual(before);
    expect(history.length).toBe(3);
  });

  // hash history 的 go(0) 会委托 document reload；jsdom 不实现它，不能在这里证明刷新恢复。
  // memory history 的位置/栈契约见上，真实刷新恢复留在 D2.5c 真机验收。
});

describe('query, unicode paths and normalization', () => {
  it('keeps a same-path query change on the same path', async () => {
    const router = await mount();

    await act(async () => {
      await router.navigate({ to: '/local-library', search: { filter: 'a' } });
    });
    await settle();
    expect(window.location.hash).toContain('/local-library');
    expect(window.location.hash).toContain('filter=a');

    await act(async () => {
      await router.navigate({ to: '/local-library', search: { filter: 'b' } });
    });
    await settle();
    expect(router.state.location.pathname).toBe('/local-library');
    expect(router.state.location.search).toEqual({ filter: 'b' });
  });
});

describe('navigation blocking on hash history', () => {
  /**
   * 用**一次性的 routeTree** 验证 blocker 原语，而不是往已交付的 `routeTree` 里塞一条假路由。
   *
   * 这样做的理由是「不得为测试污染生产路由表」：`/local-library` 与 `/settings` 的存在理由是它们
   * 对应真实页面，加一条只为测试存在的路由会让 `DELIVERED_ROUTES` 与实际能力快照失配。而 blocker 走
   * 的是 router + hook，与具体路由定义无关，因此用局部 routeTree 测的是同一条代码路径。
   */
  const createGuardedRouter = async (dirty: boolean) => {
    const Guarded = () => {
      const { proceed, reset, status } = useBlocker({
        shouldBlockFn: () => dirty,
        withResolver: true,
      });

      return (
        <section data-testid="page-guarded">
          <span data-testid="blocker-status">{status}</span>
          <button type="button" data-testid="proceed" onClick={proceed}>继续</button>
          <button type="button" data-testid="reset" onClick={reset}>取消</button>
        </section>
      );
    };

    const GuardedRoot = () => {
      const router = useRouter();
      return (
        <>
          <button type="button" data-testid="leave" onClick={() => router.navigate({ to: '/settings' })}>
            离开
          </button>
          <Guarded />
        </>
      );
    };

    const guardedRootRoute = createRootRoute({ component: GuardedRoot });
    const guardedRoute = createRoute({
      getParentRoute: () => guardedRootRoute,
      path: '/guarded',
      component: () => <span data-testid="page-guarded-route" />,
    });
    const settingsRoute = createRoute({
      getParentRoute: () => guardedRootRoute,
      path: '/settings',
      component: () => <span data-testid="page-settings" />,
    });

    const router = createRouter({
      routeTree: guardedRootRoute.addChildren([guardedRoute, settingsRoute]),
      history: createHashHistory(),
      defaultPreload: false,
    });
    await router.load();
    act(() => {
      root.render(<RouterProvider router={router} />);
    });
    await settle();
    return router;
  };

  const clickAndSettle = async (testId: string): Promise<void> => {
    const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    expect(button, `找不到按钮 ${testId}`).not.toBeNull();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await settle();
  };

  it('blocks a guarded navigation and cancelling leaves URL and page untouched', async () => {
    const router = await createGuardedRouter(true);
    await act(async () => {
      await router.navigate({ to: '/guarded' });
    });
    await settle();
    expect(window.location.hash).toBe('#/guarded');

    await clickAndSettle('leave');

    // 阻止生效：URL 与 router 状态都还在原处。对照组在下一条测试里给出。
    expect(container.querySelector('[data-testid="blocker-status"]')?.textContent).toBe('blocked');
    expect(router.state.location.pathname).toBe('/guarded');
    expect(window.location.hash).toBe('#/guarded');

    // 取消：仍不离开。`DESK-PROD-008` 要求「拒绝离开后 URL 与页面一致」。
    await clickAndSettle('reset');
    expect(router.state.location.pathname).toBe('/guarded');
    expect(window.location.hash).toBe('#/guarded');
  });

  it('lets the user proceed past the guard explicitly', async () => {
    const router = await createGuardedRouter(true);
    await act(async () => {
      await router.navigate({ to: '/guarded' });
    });
    await settle();

    await clickAndSettle('leave');
    await clickAndSettle('proceed');

    expect(router.state.location.pathname).toBe('/settings');
    expect(window.location.hash).toBe('#/settings');
  });

  it('does not block when the guard reports nothing pending', async () => {
    // 对照组：dirty=false 时同一次点击必须成功。没有这条，上一条的「被阻止」可能只是因为点击
    // 根本没生效，而不是 blocker 起作用。
    const router = await createGuardedRouter(false);
    await act(async () => {
      await router.navigate({ to: '/guarded' });
    });
    await settle();

    await clickAndSettle('leave');

    expect(router.state.location.pathname).toBe('/settings');
  });
});

describe('router isolation', () => {
  it('gives each instance its own history so windows cannot leak URL state', async () => {
    const first = await mount();
    const second = createDesktopRouter();
    await second.load();

    await act(async () => {
      await first.navigate({ to: '/settings' });
    });
    await settle();

    // 共享导航把当前路径当普通字符串传入、由宿主归一。若 router 实例之间共享 history，
    // 两个窗口会互相改写 URL——桌面多窗口是后续可能形态，这条现在就该成立。
    expect(first.state.location.pathname).toBe('/settings');
    expect(second.state.location.pathname).toBe('/');
  });
});
