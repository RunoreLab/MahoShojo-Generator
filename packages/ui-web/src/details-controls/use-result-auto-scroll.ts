import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import {
  isReducedMotionActive,
  readStoredResultAutoScrollEnabled,
} from '../device-preferences/index';

const scrollResultIfBelowViewport = (element: HTMLElement | null): void => {
  if (!element || !readStoredResultAutoScrollEnabled()) return;
  if (element.getBoundingClientRect().top <= window.innerHeight) return;
  element.scrollIntoView({ behavior: isReducedMotionActive() ? 'auto' : 'smooth', block: 'start' });
};

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
  options: { restored?: boolean } = {},
): void => {
  const scrolledForSession = useRef(false);
  useEffect(() => {
    if (!hasResult) {
      scrolledForSession.current = false;
      return;
    }
    if (options.restored) return;
    if (!readStoredResultAutoScrollEnabled()) {
      // 用户显式关闭则不滚动，也不占用会话闩锁——重新开启后对下一次
      // 新结果会话正常生效（当前已出现的结果不回溯滚动）。
      return;
    }
    if (scrolledForSession.current) return;
    scrolledForSession.current = true;
    scrollResultIfBelowViewport(targetRef.current);
  }, [targetRef, hasResult, options.restored]);
};

/**
 * 请求绑定的结果通知契约。begin 在已有生成意图获准后调用，返回的通知函数
 * 只在该请求首次产生可预览正文/卡片时调用；不在恢复、加载历史或仅有占位时调用。
 * 这是滚动的一次性闩锁，不管理请求生命周期。宿主仍负责请求取消和结果归属。
 * 使用同一个请求对象贯穿流式/最终结果；新请求使旧回调失效，AbortSignal
 * 使取消后迟到的结果失效。notify.cancel()只撤销定位，供失败时预览被移除的宿主使用。
 * 通知后的 DOM commit 才测量结果位置。
 */
export const useGeneratedResultAutoScroll = (targetRef: RefObject<HTMLElement | null>) => {
  const active = useRef<{ request: object; signal?: AbortSignal; notified: boolean; cancelled: boolean } | null>(null);
  const [preview, setPreview] = useState<object | null>(null);
  const begin = useCallback((request: object, signal?: AbortSignal) => {
    const session = active.current?.request === request
      ? active.current
      : { request, signal, notified: false, cancelled: false };
    active.current = session;
    const notify = () => {
      if (active.current !== session || session.signal?.aborted || session.cancelled || session.notified) return;
      session.notified = true;
      setPreview(session);
    };
    return Object.assign(notify, { cancel: () => { session.cancelled = true; } });
  }, []);
  useEffect(() => {
    if (!preview || active.current !== preview || active.current.signal?.aborted || active.current.cancelled) return;
    scrollResultIfBelowViewport(targetRef.current);
  }, [preview, targetRef]);
  useEffect(() => () => { active.current = null; }, []);
  return begin;
};
