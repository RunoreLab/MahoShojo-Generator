import { useEffect, useRef, type RefObject } from 'react';

import {
  isReducedMotionActive,
  readStoredResultAutoScrollEnabled,
} from '../device-preferences/index';

/**
 * 结果出现时的单次自动滚动（/details 问卷页）。
 *
 * - 仅当结果区块整体仍位于视口下方（用户完全看不到）时定位过去；
 *   已部分可见、完全可见或已滚过结果——用户正在主动观看，不打断。
 * - 同一结果会话只滚一次：结果清空后再次出现才算新会话，流式
 *   增量更新不重复拉扯视口。
 * - 尊重减少动效：读 `data-motion` 根标记（系统偏好与用户在设置页
 *   选择「减少」都经它表达），命中时退化为瞬时滚动（MDN 建议）。
 * - 尊重「结果自动定位」设备偏好（DESK-SET-007）：关闭后完全不滚动；
 *   在滚动决策点即时读取，改完无需刷新即对下一次结果生效。
 *
 * 自 `apps/web/lib/use-result-auto-scroll.ts` 上移：行为本身与宿主无关，
 * Web/Desktop 共用同一实现（DESK-PARITY-004）。
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
    if (!readStoredResultAutoScrollEnabled()) {
      // 用户显式关闭则不滚动，也不占用会话闩锁——重新开启后对下一次
      // 新结果会话正常生效（当前已出现的结果不回溯滚动）。
      return;
    }
    if (scrolledForSession.current) return;
    scrolledForSession.current = true;
    const element = targetRef.current;
    if (!element) return;
    if (element.getBoundingClientRect().top <= window.innerHeight) return;
    element.scrollIntoView({
      behavior: isReducedMotionActive() ? 'auto' : 'smooth',
      block: 'start',
    });
  }, [targetRef, hasResult]);
};
