import { useCallback, useEffect, useRef } from 'react';

type UseChatAutoScrollOptions = {
  enabled?: boolean;
  autoScrollKey?: string | number | null;
  anchorMessageId?: string | null;
  behavior?: ScrollBehavior;
  threshold?: number;
};

export function useChatAutoScroll(options: UseChatAutoScrollOptions) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const rafRef = useRef<number | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (typeof window === 'undefined') return;
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const el = bottomRef.current;
      if (!el) return;
      el.scrollIntoView({ behavior, block: 'end' });
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const threshold = typeof options.threshold === 'number' ? options.threshold : 96;
    const updateStickiness = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
      const height = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
      stickToBottomRef.current = height - (scrollTop + viewport) < threshold;
    };
    updateStickiness();
    window.addEventListener('scroll', updateStickiness, { passive: true });
    return () => window.removeEventListener('scroll', updateStickiness);
  }, [options.threshold]);

  useEffect(() => {
    if (!options.enabled) return;
    if (!stickToBottomRef.current) return;
    scrollToBottom(options.behavior ?? 'auto');
  }, [options.autoScrollKey, options.enabled, options.behavior, scrollToBottom]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const anchor = options.anchorMessageId ? String(options.anchorMessageId) : '';
    if (!anchor) return;
    const el = document.getElementById(`magic-tea-party-message-${anchor}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [options.anchorMessageId]);

  useEffect(() => () => {
    if (typeof window === 'undefined') return;
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  return { bottomRef, scrollToBottom };
}
