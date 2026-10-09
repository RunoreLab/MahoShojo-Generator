// 模态层可能因刷新、路由切换或异步操作而非顺序退出。
// 只在第一层进入时记录宿主原值，最后一层退出时归还，避免恢复别层的 hidden 快照。
const activeLocks = new Set<symbol>();
let originalOverflow = '';

export const acquireBodyScrollLock = (): (() => void) => {
  const id = Symbol('body-scroll-lock');
  if (activeLocks.size === 0) originalOverflow = document.body.style.overflow;
  activeLocks.add(id);
  document.body.style.overflow = 'hidden';

  return () => {
    if (activeLocks.delete(id) && activeLocks.size === 0) {
      document.body.style.overflow = originalOverflow;
    }
  };
};
