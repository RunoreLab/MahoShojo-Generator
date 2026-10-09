'use client';

import { useCallback, useEffect, useRef } from 'react';

/** 浏览器页中未能持久化的工作：原生关闭提示 + 普通链接离开确认。
 * 不添加 history 哨兵或改写 Next router；程序式导航可显式调用返回的 confirmLeave。
 */
export function useUnsavedPageGuard(
  isDirty: () => boolean,
  message = '当前内容尚未保存。确认放弃本页未保存的内容并离开？原有存档和已保存的数据卡不会删除。',
  canConfirmLeave?: () => boolean,
): () => boolean {
  const current = useRef({ isDirty, message, canConfirmLeave });
  current.current = { isDirty, message, canConfirmLeave };
  const confirmLeave = useCallback(() => !current.current.isDirty()
    || ((current.current.canConfirmLeave?.() ?? true) && window.confirm(current.current.message)), []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!current.current.isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
      let next: URL;
      try { next = new URL(anchor.href, window.location.href); } catch { return; }
      if (!['http:', 'https:'].includes(next.protocol)) return;
      const here = window.location;
      if (next.origin === here.origin && next.pathname === here.pathname && next.search === here.search) return;
      if (!confirmLeave()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
    };
  }, [confirmLeave]);
  return confirmLeave;
}
