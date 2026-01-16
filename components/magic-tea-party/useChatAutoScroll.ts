import { useCallback, useEffect, useRef, useState } from 'react';

type UseChatAutoScrollOptions = {
  enabled?: boolean;
  autoScrollKey?: string | number | null;
  anchorMessageId?: string | null;
  behavior?: ScrollBehavior;
  threshold?: number;
  mode?: 'window' | 'container';
};

export function useChatAutoScroll(options: UseChatAutoScrollOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const rafRef = useRef<number | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (typeof window === 'undefined') return;
    stickToBottomRef.current = true;
    setIsAtBottom(true);
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
    const mode = options.mode ?? 'container';
    const updateStickiness = () => {
      if (mode === 'window') {
        const scrollTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
        const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
        const height = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
        const isBottom = height - (scrollTop + viewport) < threshold;
        stickToBottomRef.current = isBottom;
        setIsAtBottom(isBottom);
        return;
      }

      const el = containerRef.current;
      if (!el) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const isBottom = distance < threshold;
      stickToBottomRef.current = isBottom;
      setIsAtBottom(isBottom);
    };
    updateStickiness();
    if (mode === 'window') {
      window.addEventListener('scroll', updateStickiness, { passive: true });
      return () => window.removeEventListener('scroll', updateStickiness);
    }
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateStickiness, { passive: true });
    return () => el.removeEventListener('scroll', updateStickiness);
  }, [options.threshold, options.mode]);

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
    stickToBottomRef.current = false;
    setIsAtBottom(false);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [options.anchorMessageId]);

  useEffect(() => () => {
    if (typeof window === 'undefined') return;
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  return { containerRef, bottomRef, isAtBottom, scrollToBottom };
}
