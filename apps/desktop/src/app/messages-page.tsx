// Desktop `/messages`：消息中心页面控制器（D5.1d-1）。
//
// 视图骨架与 Web 共源（`MessagesPageView`）；本文件只做宿主侧的四件事：
// 取数（`cloud_messages_request` 固定路由而不是 fetch）、竞态归属
// （requestId + userId 双闸，与 Web 同一组纯函数）、已读分发（写回顶栏
// 摘要缓存而不是 `dispatchMessagesUpdatedEvent`）、链接策略（产品路径走
// hash-history，站外走 `openContent` 确认 + native 校验）。
//
// 诚实性口径与 Web 一致：加载失败给「请稍后重试」而不是空列表；无身份只
// 拉公开全站消息；会话被拒（Required 路由 401 native 已清凭据，或登录态
// 响应回 `isAuthenticated:false`）触发一次 `refresh()` 收束会话投影，
// 不假装数据是空。

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from '@tanstack/react-router';
import {
  createMessagesPageState,
  getMessagesPageEmptyStateCopy,
  getMessagesPageRequestFilter,
  isMessagesPageStateForViewer,
  MessagesPageView,
  reconcileMessagesPageStateForAuth,
  resolveMessagesPageDataRequests,
  shouldApplyMessagesLoadMore,
  type MessagesPageState,
} from '@mahoshojo/ui-web/messages';
import type { MessageFilter } from '@mahoshojo/contracts/messages';

import { useDesktopCloudSession } from '../features/account/use-desktop-cloud-session';
import { useExternalLinks } from '../features/external-links/external-links-provider';
import {
  isMessagesSessionRejected,
  listMessages,
  markAllMessagesRead,
  markMessagesRead,
  readMessagesSummary,
} from '../features/messages/messages-api';
import { refreshMessagesSummary } from '../features/messages/topbar-messages';
import { navigateByProductHref, resolveInternalHrefForHashHistory } from './hash-history-fragment';

const MESSAGES_PAGE_LIMIT = 20;

export function DesktopMessages() {
  const router = useRouter();
  const { state: cloudSession, store: sessionStore } = useDesktopCloudSession();
  const { openContent } = useExternalLinks();

  // 与 Web 同源的控制器状态机：`account` 即「本机认识谁」——匿名时只
  // 拉公开全站；userId 是状态归属键，换号时旧账号数据不跨身份可见。
  const account = cloudSession.account;
  const effectiveIsAuthenticated = account !== null;
  const effectiveUserId = account?.userId ?? null;
  const [state, setState] = useState<MessagesPageState>(() =>
    createMessagesPageState(effectiveIsAuthenticated),
  );
  const pageDataRequestIdRef = useRef(0);
  const currentFilterRef = useRef(state.filter);
  const effectiveUserIdRef = useRef<number | null>(effectiveUserId);
  const stateOwnerUserIdRef = useRef<number | null>(effectiveUserId);
  effectiveUserIdRef.current = effectiveUserId;

  useEffect(() => {
    currentFilterRef.current = state.filter;
  }, [state.filter]);

  const loadPageData = useCallback(
    async (filter: MessageFilter) => {
      const requestId = pageDataRequestIdRef.current + 1;
      pageDataRequestIdRef.current = requestId;
      const requestFilter = getMessagesPageRequestFilter(filter, effectiveIsAuthenticated);
      const requestUserId = effectiveUserId;

      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        const [listResult, summaryResult] = await Promise.allSettled([
          listMessages(invoke, {
            filter: requestFilter,
            limit: MESSAGES_PAGE_LIMIT,
            expectAuthenticated: effectiveIsAuthenticated,
          }),
          effectiveIsAuthenticated
            ? readMessagesSummary(invoke)
            : Promise.resolve(null),
        ]);
        // 会话被拒属于页面级失败：summary 的拒收不能被「按无摘要渲染」的
        // 产品语义吞掉，先于 resolve 抛出、统一走下面的收束分支。
        if (
          summaryResult.status === 'rejected' &&
          isMessagesSessionRejected(summaryResult.reason)
        ) {
          throw summaryResult.reason;
        }
        const { listPayload, summaryPayload } = resolveMessagesPageDataRequests({
          isAuthenticated: effectiveIsAuthenticated,
          listResult,
          summaryResult,
        });

        if (
          pageDataRequestIdRef.current !== requestId ||
          effectiveUserIdRef.current !== requestUserId
        ) {
          return;
        }

        stateOwnerUserIdRef.current = requestUserId;
        setState((current) => ({
          ...current,
          isAuthenticated: effectiveIsAuthenticated,
          filter: requestFilter,
          appliedFilter: listPayload.appliedFilter,
          messages: listPayload.messages,
          nextCursor: listPayload.nextCursor,
          loading: false,
          summary: summaryPayload,
          error: null,
        }));
      } catch (cause) {
        if (
          pageDataRequestIdRef.current !== requestId ||
          effectiveUserIdRef.current !== requestUserId
        ) {
          return;
        }
        // 会话被拒（401 native 已清凭据，或登录态响应回匿名身份）：上报
        // 一次让 store 收束投影，其余错误按「消息加载失败」诚实呈现——
        // 绝不把失败伪装成空列表。
        if (isMessagesSessionRejected(cause)) {
          void sessionStore.refresh();
        }
        setState((current) => ({
          ...current,
          loading: false,
          error: '消息加载失败，请稍后重试。',
        }));
      }
    },
    [effectiveIsAuthenticated, effectiveUserId, sessionStore],
  );

  useEffect(() => {
    pageDataRequestIdRef.current += 1;
    const previousUserId = stateOwnerUserIdRef.current;
    stateOwnerUserIdRef.current = effectiveUserId;
    setState((current) =>
      reconcileMessagesPageStateForAuth(
        current,
        effectiveIsAuthenticated,
        previousUserId !== effectiveUserId,
      ),
    );
  }, [effectiveIsAuthenticated, effectiveUserId]);

  useEffect(() => {
    void loadPageData(state.filter).catch(() => undefined);
  }, [effectiveIsAuthenticated, effectiveUserId, loadPageData, state.filter]);

  /** 已读写回：列表重拉 + 顶栏摘要缓存同步失效后取新（替代 Web 的事件总线）。 */
  const resyncAfterRead = useCallback(async () => {
    const userId = effectiveUserIdRef.current;
    if (userId !== null) {
      await refreshMessagesSummary(userId, invoke, () => void sessionStore.refresh());
    }
    await loadPageData(currentFilterRef.current);
  }, [loadPageData, sessionStore]);

  const handleFilterChange = (filter: MessageFilter) => {
    pageDataRequestIdRef.current += 1;
    const requestFilter = getMessagesPageRequestFilter(filter, effectiveIsAuthenticated);
    setState((current) => ({
      ...current,
      filter: requestFilter,
      loading: true,
      nextCursor: null,
    }));
  };

  const handleMarkAllRead = async () => {
    if (!effectiveIsAuthenticated) return;
    try {
      await markAllMessagesRead(invoke);
    } catch (cause) {
      // 已读被拒同样收束会话投影；其余失败保持现状、可重试。
      if (isMessagesSessionRejected(cause)) void sessionStore.refresh();
      return;
    }
    await resyncAfterRead();
  };

  const handleMarkRead = async (id: string) => {
    try {
      await markMessagesRead(invoke, [id]);
    } catch (cause) {
      if (isMessagesSessionRejected(cause)) void sessionStore.refresh();
      return;
    }
    await resyncAfterRead();
  };

  const handleLoadMore = async () => {
    if (!state.nextCursor) return;

    const requestFilter = getMessagesPageRequestFilter(state.filter, effectiveIsAuthenticated);
    const requestCursor = state.nextCursor;
    const requestId = pageDataRequestIdRef.current;
    const requestUserId = effectiveUserId;
    try {
      const payload = await listMessages(invoke, {
        filter: requestFilter,
        limit: MESSAGES_PAGE_LIMIT,
        cursor: requestCursor,
        expectAuthenticated: effectiveIsAuthenticated,
      });
      setState((current) => {
        if (
          pageDataRequestIdRef.current !== requestId ||
          effectiveUserIdRef.current !== requestUserId ||
          !shouldApplyMessagesLoadMore(current, { filter: requestFilter, cursor: requestCursor })
        ) {
          return current;
        }

        stateOwnerUserIdRef.current = requestUserId;
        return {
          ...current,
          appliedFilter: payload.appliedFilter,
          messages: [...current.messages, ...payload.messages],
          nextCursor: payload.nextCursor,
        };
      });
    } catch (cause) {
      // 加载更多失败保持现状（与 Web 同：静默、可再点）；
      // 只有会话被拒值得额外收束一次投影。
      if (isMessagesSessionRejected(cause)) void sessionStore.refresh();
    }
  };

  const isStateForCurrentViewer = isMessagesPageStateForViewer(
    stateOwnerUserIdRef.current,
    effectiveUserId,
  );
  const visibleAppliedFilter = isStateForCurrentViewer
    ? state.appliedFilter
    : getMessagesPageRequestFilter(state.filter, effectiveIsAuthenticated);
  const visibleMessages = isStateForCurrentViewer ? state.messages : [];
  const visibleNextCursor = isStateForCurrentViewer ? state.nextCursor : null;
  const visibleSummary = isStateForCurrentViewer ? state.summary : null;
  const visibleLoading = isStateForCurrentViewer ? state.loading : true;
  const emptyStateCopy = getMessagesPageEmptyStateCopy(
    visibleAppliedFilter,
    effectiveIsAuthenticated,
  );

  return (
    <MessagesPageView
      isAuthenticated={effectiveIsAuthenticated}
      appliedFilter={visibleAppliedFilter}
      messages={visibleMessages}
      nextCursor={visibleNextCursor}
      loading={visibleLoading}
      summary={visibleSummary}
      error={state.error}
      emptyStateCopy={emptyStateCopy}
      anonymousCta={
        <button
          type="button"
          onClick={() => void sessionStore.requestAuth()}
          className="inline-flex rounded-full bg-pink-600 px-4 py-2 text-sm font-semibold text-white"
        >
          登录查看定向消息
        </button>
      }
      onFilterChange={handleFilterChange}
      onMarkAllRead={() => void handleMarkAllRead()}
      onMarkRead={(id) => void handleMarkRead(id)}
      onLoadMore={() => void handleLoadMore()}
      onNavigate={(href) => navigateByProductHref(router, href)}
      onNavigateExternal={openContent}
      resolveInternalHref={resolveInternalHrefForHashHistory}
    />
  );
}
