// 共享模态层的视口滚动锁及非顺序关闭的返回焦点。
// 不负责初始焦点、Tab 或 Escape；是否归还焦点仍由各消费者判断。
const activeLayers = new Map<symbol, readonly HTMLElement[]>();
let releaseViewportScroll: (() => void) | null = null;

const SCROLL_PROPERTIES = new Set([
  'overflow', 'overflow-x', 'overflow-y',
  'overscroll-behavior', 'overscroll-behavior-x', 'overscroll-behavior-y',
]);

const lockScroll = (element: HTMLElement) => {
  const { style } = element;
  // 保留 shorthand/longhand 的声明次序和 !important；不覆写宿主的其他样式。
  const previous = Array.from(style)
    .filter((property) => SCROLL_PROPERTIES.has(property))
    .map((property) => [property, style.getPropertyValue(property), style.getPropertyPriority(property)] as const);
  const clear = () => { for (const property of SCROLL_PROPERTIES) style.removeProperty(property); };
  clear();
  style.setProperty('overflow', 'hidden');
  style.setProperty('overscroll-behavior', 'none');
  return () => {
    clear();
    for (const [property, value, priority] of previous) style.setProperty(property, value, priority);
  };
};

const lockViewportScroll = () => {
  // CSS Overflow §3.3：body 的 overflow 只在 html 双轴均 visible 时传播到视口。
  // Web 宿主设置了 html overflow-x:hidden，故必须同时锁根；不能只锁 body。
  // 不固定/移动页面，也不拦截 touchmove，让内容区保留原生触屏与键盘滚动。
  const restoreRoot = lockScroll(document.documentElement);
  const restoreBody = lockScroll(document.body);
  return () => { restoreBody(); restoreRoot(); };
};

export const acquireModalEnvironment = (fallbackFocus: HTMLElement | null = null) => {
  const id = Symbol('modal-environment');
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const parentTargets = [...activeLayers.values()].at(-1) ?? [];
  // 每层保留进入时的返回链：中间层先卸载，也不会丢失更早的存活入口。
  const targets = [...new Set([previousFocus, fallbackFocus, ...parentTargets]
    .filter((target): target is HTMLElement => target !== null))];
  if (activeLayers.size === 0) releaseViewportScroll = lockViewportScroll();
  activeLayers.set(id, targets);

  return {
    releaseScroll: () => {
      if (activeLayers.delete(id) && activeLayers.size === 0) {
        releaseViewportScroll?.();
        releaseViewportScroll = null;
      }
    },
    restoreFocus: () => {
      for (const target of targets) {
        if (target === document.body || !document.contains(target)) continue;
        target.focus({ preventScroll: true });
        if (document.activeElement === target) return;
      }
    },
  };
};
