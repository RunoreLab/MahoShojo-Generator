import type { MouseEvent } from 'react';

/**
 * 百科内部链接的点击拦截规则：只接管「普通主键点击」。
 *
 * `defaultPrevented`、非主键（中/右键）与 Ctrl/Cmd/Shift/Alt 修饰键点击一律交回运行时
 * 的原生锚点语义——Web 上是新标签页/新窗口，Desktop 的 hash history 上是等价的原生
 * 导航。这与 `GlobalTopBar` 的 Web adapter 是同一套规则：共源前这些位置是 next/link，
 * 它在这些情况下从不执行客户端导航，接管它们是一次行为回归（D5.1 百科 UI compatibility
 * 收口）。
 */
export const shouldInterceptInternalLinkClick = (event: MouseEvent<HTMLAnchorElement>): boolean =>
  !event.defaultPrevented &&
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;
