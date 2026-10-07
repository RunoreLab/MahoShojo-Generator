'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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
import { authStorage } from '@/lib/auth';
import { dispatchMessagesUpdatedEvent } from '@/lib/messages/events';
import { useAuth } from '@/lib/useAuth';
import type { MessageFilter, MessageListDto, MessageSummaryDto } from '@/lib/messages/types';

// 纯状态函数已上移至 `@mahoshojo/ui-web/messages`（D5.1d-1）；保留同名
// 再导出是为了既有测试与消费方的 import 路径不变。
export {
  getMessagesPageEmptyStateCopy,
  getMessagesPageRequestFilter,
  isMessagesPageStateForViewer,
  reconcileMessagesPageStateForAuth,
  resolveMessagesPageDataRequests,
  shouldApplyMessagesLoadMore,
};
export type { MessagesPageState };

export function MessagesPage({
  initialStateOverride,
}: {
  initialStateOverride?: Partial<MessagesPageState>;
}) {
  const auth = useAuth();
  const router = useRouter();
  const isStaticOverride = initialStateOverride != null;
  const effectiveIsAuthenticated = initialStateOverride?.isAuthenticated ?? auth.isAuthenticated;
  const effectiveUserId = isStaticOverride ? null : auth.user?.id ?? null;
  const [state, setState] = useState<MessagesPageState>(() => ({
    ...createMessagesPageState(effectiveIsAuthenticated),
    ...initialStateOverride,
  }));
  const pageDataRequestIdRef = useRef(0);
  const currentFilterRef = useRef(state.filter);
  const effectiveUserIdRef = useRef<number | null>(effectiveUserId);
  const stateOwnerUserIdRef = useRef<number | null>(effectiveUserId);
  effectiveUserIdRef.current = effectiveUserId;

  useEffect(() => {
    currentFilterRef.current = state.filter;
  }, [state.filter]);

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = effectiveIsAuthenticated ? await authStorage.fetch(path, init) : await fetch(path, init);
    if (!response.ok) {
      throw new Error(`${path}:${response.status}`);
    }
    return (await response.json()) as T;
  }, [effectiveIsAuthenticated]);

  const loadPageData = useCallback(async (filter: MessageFilter) => {
    const requestId = pageDataRequestIdRef.current + 1;
    pageDataRequestIdRef.current = requestId;
    const requestFilter = getMessagesPageRequestFilter(filter, effectiveIsAuthenticated);
    const requestUserId = effectiveUserId;

    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const params = new URLSearchParams({ filter: requestFilter, limit: '20' });
      const [listResult, summaryResult] = await Promise.allSettled([
        request<MessageListDto>(`/api/messages?${params.toString()}`),
        effectiveIsAuthenticated ? request<MessageSummaryDto>('/api/messages/summary') : Promise.resolve(null),
      ]);
      const { listPayload, summaryPayload } = resolveMessagesPageDataRequests({
        isAuthenticated: effectiveIsAuthenticated,
        listResult,
        summaryResult,
      });

      if (pageDataRequestIdRef.current !== requestId || effectiveUserIdRef.current !== requestUserId) {
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
    } catch {
      if (pageDataRequestIdRef.current !== requestId || effectiveUserIdRef.current !== requestUserId) {
        return;
      }
      setState((current) => ({ ...current, loading: false, error: '消息加载失败，请稍后重试。' }));
    }
  }, [effectiveIsAuthenticated, effectiveUserId, request]);

  useEffect(() => {
    if (isStaticOverride) {
      return;
    }

    pageDataRequestIdRef.current += 1;
    const previousUserId = stateOwnerUserIdRef.current;
    stateOwnerUserIdRef.current = effectiveUserId;
    setState((current) =>
      reconcileMessagesPageStateForAuth(
        current,
        auth.isAuthenticated,
        previousUserId !== effectiveUserId,
      ),
    );
  }, [auth.isAuthenticated, effectiveUserId, isStaticOverride]);

  useEffect(() => {
    if (isStaticOverride) {
      return;
    }

    void loadPageData(state.filter).catch(() => undefined);
  }, [effectiveIsAuthenticated, effectiveUserId, isStaticOverride, loadPageData, state.filter]);

  const handleFilterChange = (filter: MessageFilter) => {
    pageDataRequestIdRef.current += 1;
    const requestFilter = getMessagesPageRequestFilter(filter, effectiveIsAuthenticated);
    setState((current) => ({
      ...current,
      filter: requestFilter,
      loading: isStaticOverride ? current.loading : true,
      nextCursor: null,
    }));
  };

  const handleMarkAllRead = async () => {
    if (!effectiveIsAuthenticated || isStaticOverride) {
      return;
    }

    const response = await authStorage.fetch('/api/messages/read-all', { method: 'POST' });
    if (!response.ok) {
      return;
    }

    dispatchMessagesUpdatedEvent();
    await loadPageData(currentFilterRef.current);
  };

  const handleMarkRead = async (id: string) => {
    if (isStaticOverride) {
      return;
    }

    const response = await authStorage.fetch('/api/messages/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    });
    if (!response.ok) {
      return;
    }

    dispatchMessagesUpdatedEvent();
    await loadPageData(currentFilterRef.current);
  };

  const handleLoadMore = async () => {
    if (isStaticOverride || !state.nextCursor) {
      return;
    }

    const requestFilter = getMessagesPageRequestFilter(state.filter, effectiveIsAuthenticated);
    const requestCursor = state.nextCursor;
    const requestId = pageDataRequestIdRef.current;
    const requestUserId = effectiveUserId;
    const params = new URLSearchParams({
      filter: requestFilter,
      limit: '20',
      cursor: requestCursor,
    });
    const response = effectiveIsAuthenticated
      ? await authStorage.fetch(`/api/messages?${params.toString()}`)
      : await fetch(`/api/messages?${params.toString()}`);
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as MessageListDto;
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
  };

  const isStateForCurrentViewer = isMessagesPageStateForViewer(stateOwnerUserIdRef.current, effectiveUserId);
  const visibleAppliedFilter = isStateForCurrentViewer
    ? state.appliedFilter
    : getMessagesPageRequestFilter(state.filter, effectiveIsAuthenticated);
  const visibleMessages = isStateForCurrentViewer ? state.messages : [];
  const visibleNextCursor = isStateForCurrentViewer ? state.nextCursor : null;
  const visibleSummary = isStateForCurrentViewer ? state.summary : null;
  const visibleLoading = isStateForCurrentViewer ? state.loading : true;
  const emptyStateCopy = getMessagesPageEmptyStateCopy(visibleAppliedFilter, effectiveIsAuthenticated);

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
        <Link
          href="/character-manager"
          className="inline-flex rounded-full bg-pink-600 px-4 py-2 text-sm font-semibold text-white"
        >
          登录查看定向消息
        </Link>
      }
      onFilterChange={handleFilterChange}
      onMarkAllRead={() => void handleMarkAllRead()}
      onMarkRead={(id) => void handleMarkRead(id)}
      onLoadMore={() => void handleLoadMore()}
      onNavigate={(href) => router.push(href)}
    />
  );
}