/**
 * Fragment 滚动。
 *
 * ## 为什么共享层自己滚，而不是交给两个框架
 *
 * 理由不是"某个 router 有 bug"，而是两条更结构性的原因：
 *
 * 1. **正文是异步到达的。** 百科正文由客户端 `fetch` 取回，因此首屏绘制时目标 heading 的 `id`
 *    还不存在于 DOM。浏览器在 load 时的原生 fragment 滚动与 router 的挂载后滚动都会打空；
 *    `ready` 必须是一个真实的输入依赖。
 * 2. **两个宿主的路由模型不同。** Desktop 用 hash history（`/#/encyclopedia/foo#heading`），
 *    Web 用 App Router 路径（`/encyclopedia/foo#heading`）。同一段滚动逻辑要吃两种来源的 hash，
 *    而 `window.location.hash` 在 Desktop 上等于整个 `#/route#anchor`，不能直接喂给
 *    `querySelector`。让宿主把 hash 作为 prop 传进来，共享层就不需要知道任何路由细节。
 *
 * 找不到目标时**不报错**：指向不存在节点的链接是死链，用户看到的是"没跳过去"，而抛错会变成白屏。
 */

import { useEffect } from 'react';

import { decodeFragmentId } from './text/index';

export interface HashScrollTargetOptions {
  /** 正文是否已渲染。`false` 时不做任何事，等它变成 `true` 再滚。 */
  readonly ready: boolean;
  /**
   * 当前 fragment，含或不含 `#` 均可。
   *
   * 由宿主注入：Web 传路由 hash（`useLocationHash`）；Desktop 的 TanStack 解析结果
   * 没有 `hash` 字段，传的是 `getRouteFragmentFromHashHistory(router.state.location.href)`
   * 从路由 href 里切出的 fragment。
   */
  readonly hash?: string | undefined;
  /**
   * 顶栏高度，单位 px；滚动时留出这段偏移，避免目标被顶栏盖住。
   *
   * 读的是 CSS 变量而不是写死的数值：两个宿主的壳高度不同，而这个 token 已经在共源主题里
   * （`--global-topbar-height`）。
   */
  readonly offsetVariable?: string;
  /** 测试可注入的滚动实现。生产留空即可。 */
  readonly scrollTo?: (top: number) => void;
  /** 测试可注入的取节点实现。生产留空即可。 */
  readonly findTarget?: (id: string) => HTMLElement | null;
}

const DEFAULT_OFFSET_VARIABLE = '--global-topbar-height';

const readOffset = (variable: string): number => {
  if (typeof window === 'undefined') return 0;
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(variable);
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const useHashScrollTarget = ({
  ready,
  hash,
  offsetVariable = DEFAULT_OFFSET_VARIABLE,
  scrollTo,
  findTarget,
}: HashScrollTargetOptions): void => {
  useEffect(() => {
    if (!ready) return;

    const id = decodeFragmentId(hash ?? '');
    if (id === '') return;

    // 正文由 fetch 到达后交给 React 渲染，effect 与 DOM 更新之间的时序在不同宿主并不相同。
    // 延后一帧再找节点，是唯一不依赖具体调度细节的做法。
    const frame = requestAnimationFrame(() => {
      const target = findTarget ? findTarget(id) : document.getElementById(id);
      if (!target) return;

      const top = target.getBoundingClientRect().top + window.scrollY - readOffset(offsetVariable);
      if (scrollTo) {
        scrollTo(top);
        return;
      }
      window.scrollTo({ top, behavior: 'smooth' });
    });

    return () => cancelAnimationFrame(frame);
  }, [findTarget, hash, offsetVariable, ready, scrollTo]);
};