// 顶栏消息摘要：userId → `{unreadTotal, hasCrowdReviewPending}` 的进程级缓存
//（D5.1d-1，对齐 Web `useTopBarMessages` 的语义）。
//
// - 摘要是「有身份后的后台刷新」：只在 `account` 存在时发起（Required 路由，
//   无本地凭据 fail-closed），不进入启动关键路径；失败保留上一份已知摘要，
//   不伪造未读数；
// - 按 userId 缓存而不是按「当前登录态」：换账号自然取不同键；
// - 90s 内视为新鲜，挂载与窗口重新可见时只补过期项——没有轮询；
// - 失效由会话边界驱动（登出/新登录成功 → `invalidateMessagesSummary`）：
//   世代号前进让迟到响应自然过期；在途请求也登记世代——旧世代不挡新
//   请求、结算只清自己的槽；本地已读操作由页面显式
//   `refreshMessagesSummary` 收口（写后必有一次真读取），不另建事件总线；
// - 会话被拒（native 401 已清凭据，或响应回 `isAuthenticated:false` 的
//   匿名身份）经 `onSessionRejected` 上报一次——宿主触发 `refresh`
//   统一收束会话投影。

import { useEffect, useSyncExternalStore } from 'react';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

import type { DesktopCloudAccountSummary } from '@mahoshojo/contracts/desktop-cloud';
import type { MessageSummaryDto } from '@mahoshojo/contracts/messages';

import type { InvokeFn } from '../../platform/cloud-bridge';
import { isMessagesSessionRejected, readMessagesSummary } from './messages-api';

/** 与 Web `TOPBAR_MESSAGES_REFRESH_INTERVAL_MS` 同值：90 秒内视为新鲜。 */
export const MESSAGES_SUMMARY_REFRESH_INTERVAL_MS = 90_000;

/** 顶栏投影：共享 TopBar 只需要未读总数与众查提示两个字段。 */
export interface TopbarMessagesProjection {
  readonly unreadTotal: number;
  readonly hasCrowdReviewPending: boolean;
}

export interface MessagesSummaryEntry {
  readonly summary: MessageSummaryDto;
  readonly fetchedAt: number;
  /**
   * 顶栏投影的稳定引用：同一份 summary 期间引用不变
   * （`useSyncExternalStore` 以引用相等判断快照是否变化）。
   */
  readonly topbar: TopbarMessagesProjection;
}

const EMPTY_PROJECTION: TopbarMessagesProjection = {
  unreadTotal: 0,
  hasCrowdReviewPending: false,
};

/**
 * 在途请求按世代登记（d-1-r1）。裸 `Set<userId>` 会让旧世代的在途请求
 * 挡住新世代：快速重登后旧响应被世代闸丢弃、新请求又从未发出，摘要会
 * 空白到下一次挂载/可见性刷新。登记世代 + token 后：同世代幂等、跨世代
 * 放行，旧请求结算时只清自己的槽。
 */
interface InflightSummaryFetch {
  readonly generation: number;
  readonly token: object;
  readonly promise: Promise<void>;
}

const entries = new Map<number, MessagesSummaryEntry>();
const inflight = new Map<number, InflightSummaryFetch>();
const generations = new Map<number, number>();
const listeners = new Set<() => void>();

const notify = (): void => listeners.forEach((listener) => listener());

export const subscribeTopbarMessages = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getMessagesSummaryEntry = (userId: number | null): MessagesSummaryEntry | null =>
  userId === null ? null : (entries.get(userId) ?? null);

export const getTopbarMessagesProjection = (userId: number | null): TopbarMessagesProjection =>
  getMessagesSummaryEntry(userId)?.topbar ?? EMPTY_PROJECTION;

const isFresh = (entry: MessagesSummaryEntry | null | undefined): boolean =>
  entry != null && Date.now() - entry.fetchedAt < MESSAGES_SUMMARY_REFRESH_INTERVAL_MS;

/**
 * 失效某账号的消息摘要（登出/新登录成功等会话边界调用）。
 * 已发出的请求不中断：世代号前进一格，迟到响应结算时自然被丢弃。
 */
export const invalidateMessagesSummary = (userId: number): void => {
  generations.set(userId, (generations.get(userId) ?? 0) + 1);
  if (entries.delete(userId)) notify();
};

/** Web 同款归一：非有限/负数未读按 0 处理，crowdReview 只认严格 true。 */
const toTopbarProjection = (summary: MessageSummaryDto): TopbarMessagesProjection => ({
  unreadTotal:
    Number.isFinite(summary.unreadTotal) && summary.unreadTotal > 0
      ? Math.trunc(summary.unreadTotal)
      : 0,
  hasCrowdReviewPending: summary.hasCrowdReviewPending === true,
});

const startSummaryFetch = (
  userId: number,
  invoke: InvokeFn,
  onSessionRejected?: () => void,
): InflightSummaryFetch => {
  const generation = generations.get(userId) ?? 0;
  const entry: InflightSummaryFetch = {
    generation,
    token: {},
    promise: (async () => {
      try {
        const summary = await readMessagesSummary(invoke);
        // 世代闸：登出/换号竞态下达的响应整份丢弃——摘要不携带 userId，
        // 归属判断完全靠世代（与头像面同一策略）。
        if ((generations.get(userId) ?? 0) !== generation) return;
        entries.set(userId, {
          summary,
          fetchedAt: Date.now(),
          topbar: toTopbarProjection(summary),
        });
        notify();
      } catch (cause: unknown) {
        // 摘要失败保留上一份已知数据；只有会话被拒值得上报收束
        // （单次、有界——refresh 本身 single-flight）。
        if (isMessagesSessionRejected(cause)) {
          onSessionRejected?.();
        }
      }
    })(),
  };
  inflight.set(userId, entry);
  // token 闸：只清自己的槽——旧世代请求结算时不得误删新请求的登记。
  void entry.promise.finally(() => {
    if (inflight.get(userId)?.token === entry.token) {
      inflight.delete(userId);
    }
  });
  return entry;
};

/** 过期才取（同世代 single-flight、幂等）；90s 内的重复挂载零网络。 */
export const ensureMessagesSummary = (
  userId: number,
  invoke: InvokeFn = tauriInvoke,
  onSessionRejected?: () => void,
): void => {
  if (isFresh(entries.get(userId))) return;
  const generation = generations.get(userId) ?? 0;
  const current = inflight.get(userId);
  // 旧世代在途请求不挡路：它的响应注定被世代闸丢弃，等它等于无人取数。
  if (current !== undefined && current.generation === generation) return;
  void startSummaryFetch(userId, invoke, onSessionRejected);
};

/**
 * 强制取一次：本地已读操作与显式刷新的收口点。
 *
 * 「写后读取」是硬语义：同世代在途请求可能读的是 pre-mutation 状态，
 * 只等它结算不算刷新——必须在其后再取一次；晚于本次调用发起的新请求
 * （另一处 refresh/ensure）天然满足写后语义，直接搭车。
 */
export const refreshMessagesSummary = async (
  userId: number,
  invoke: InvokeFn = tauriInvoke,
  onSessionRejected?: () => void,
): Promise<void> => {
  const generation = generations.get(userId) ?? 0;
  const current = inflight.get(userId);
  if (current !== undefined && current.generation === generation) {
    await current.promise;
  }
  const latest = inflight.get(userId);
  const latestGeneration = generations.get(userId) ?? 0;
  if (latest !== undefined && latest !== current && latest.generation === latestGeneration) {
    await latest.promise;
    return;
  }
  await startSummaryFetch(userId, invoke, onSessionRejected).promise;
};

/** 仅供测试：清空摘要缓存、世代与在途标记。 */
export const resetMessagesSummaryForTests = (): void => {
  entries.clear();
  inflight.clear();
  generations.clear();
};

/**
 * 顶栏消息摘要 hook：`account` 存在即后台取一份（90s 新鲜度 + 窗口重新
 * 可见时补过期），返回共享 `ProductTopBar.messages` 需要的投影。
 */
export const useTopbarMessages = (
  account: DesktopCloudAccountSummary | null,
  options?: {
    readonly invoke?: InvokeFn;
    readonly onSessionRejected?: () => void;
  },
): TopbarMessagesProjection => {
  const userId = account?.userId ?? null;
  const invoke = options?.invoke ?? tauriInvoke;
  const onSessionRejected = options?.onSessionRejected;
  const topbar = useSyncExternalStore(subscribeTopbarMessages, () =>
    getTopbarMessagesProjection(userId),
  );
  useEffect(() => {
    if (userId === null) return;
    ensureMessagesSummary(userId, invoke, onSessionRejected);
    const handleVisibility = () => {
      // 窗口重新可见时补过期项；90s 内的重复触发在 ensure 内被新鲜度拦掉。
      if (document.visibilityState === 'visible') {
        ensureMessagesSummary(userId, invoke, onSessionRejected);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [userId, invoke, onSessionRejected]);
  return topbar;
};
