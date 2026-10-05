import { useEffect, useRef, type RefObject } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * 结果出现时的单次自动滚动（/details 问卷页）。
 *
 * - 仅当结果区块整体仍位于视口下方（用户完全看不到）时定位过去；
 *   已部分可见、完全可见或已滚过结果——用户正在主动观看，不打断。
 * - 同一结果会话只滚一次：结果清空后再次出现才算新会话，流式
 *   增量更新不重复拉扯视口。
 * - 尊重 prefers-reduced-motion：命中时退化为瞬时滚动（MDN 建议）。
 */
export const useResultAutoScroll = (
  targetRef: RefObject<HTMLElement | null>,
  hasResult: boolean,
): void => {
  const scrolledForSession = useRef(false);
  useEffect(() => {
    if (!hasResult) {
      scrolledForSession.current = false;
      return;
    }
    if (scrolledForSession.current) return;
    scrolledForSession.current = true;
    const element = targetRef.current;
    if (!element) return;
    if (element.getBoundingClientRect().top <= window.innerHeight) return;
    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia(REDUCED_MOTION_QUERY).matches;
    element.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  }, [targetRef, hasResult]);
};
