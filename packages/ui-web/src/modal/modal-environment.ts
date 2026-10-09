// 仅供 BaseModal 与 CardLibraryModal 共用：滚动锁及非顺序关闭的返回焦点。
// 不负责初始焦点、Tab 或 Escape；是否归还焦点仍由各消费者判断。
const activeLayers = new Map<symbol, readonly HTMLElement[]>();
let originalOverflow = '';

export const acquireModalEnvironment = (fallbackFocus: HTMLElement | null = null) => {
  const id = Symbol('modal-environment');
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const parentTargets = [...activeLayers.values()].at(-1) ?? [];
  // 每层保留进入时的返回链：中间层先卸载，也不会丢失更早的存活入口。
  const targets = [...new Set([previousFocus, fallbackFocus, ...parentTargets]
    .filter((target): target is HTMLElement => target !== null))];
  if (activeLayers.size === 0) originalOverflow = document.body.style.overflow;
  activeLayers.set(id, targets);
  document.body.style.overflow = 'hidden';

  return {
    releaseScroll: () => {
      if (activeLayers.delete(id) && activeLayers.size === 0) {
        document.body.style.overflow = originalOverflow;
      }
    },
    restoreFocus: () => {
      for (const target of targets) {
        if (target === document.body || !document.contains(target)) continue;
        target.focus();
        if (document.activeElement === target) return;
      }
    },
  };
};
