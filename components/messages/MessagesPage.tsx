import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { MessageCard } from '@/components/messages/MessageCard';
import { MessageFilters } from '@/components/messages/MessageFilters';
import { authStorage } from '@/lib/auth';
import { useAuth } from '@/lib/useAuth';
import type { MessageFilter, MessageListDto, MessagePreviewDto, MessageSummaryDto } from '@/lib/messages/types';

export type MessagesPageState = {
  isAuthenticated: boolean;
  filter: MessageFilter;
  appliedFilter: MessageFilter;
  messages: MessagePreviewDto[];
  nextCursor: string | null;
  loading: boolean;
  summary: MessageSummaryDto | null;
  error?: string | null;
};

const MESSAGES_UPDATED_EVENT = 'mahoshojo:messages-updated';

const createDefaultState = (isAuthenticated: boolean): MessagesPageState => ({
  isAuthenticated,
  filter: 'all',
  appliedFilter: isAuthenticated ? 'all' : 'site',
  messages: [],
  nextCursor: null,
  loading: true,
  summary: null,
  error: null,
});

export const getMessagesPageRequestFilter = (filter: MessageFilter, isAuthenticated: boolean): MessageFilter => {
  if (isAuthenticated) {
    return filter;
  }
  return filter === 'direct' || filter === 'unread' ? 'site' : filter;
};

export const reconcileMessagesPageStateForAuth = (
  current: MessagesPageState,
  isAuthenticated: boolean,
  forceViewStateReset = false,
): MessagesPageState => {
  if (isAuthenticated) {
    return {
      ...current,
      isAuthenticated: true,
      messages: forceViewStateReset ? [] : current.messages,
      nextCursor: forceViewStateReset ? null : current.nextCursor,
      summary: forceViewStateReset ? null : current.summary,
      error: forceViewStateReset ? null : current.error,
    };
  }

  const filter = getMessagesPageRequestFilter(current.filter, false);
  return {
    ...current,
    isAuthenticated: false,
    filter,
    appliedFilter: filter === 'all' ? 'site' : filter,
    messages: current.isAuthenticated ? [] : current.messages,
    nextCursor: current.isAuthenticated ? null : current.nextCursor,
    summary: null,
    error: null,
  };
};

export const shouldApplyMessagesLoadMore = (
  current: MessagesPageState,
  request: { filter: MessageFilter; cursor: string },
): boolean => current.filter === request.filter && current.nextCursor === request.cursor;

export const isMessagesPageStateForViewer = (
  stateOwnerUserId: number | null,
  effectiveUserId: number | null,
): boolean => stateOwnerUserId === effectiveUserId;

export const getMessagesPageEmptyStateCopy = (filter: MessageFilter, isAuthenticated: boolean): string => {
  if (!isAuthenticated) {
    return '暂无全站通知';
  }
  if (filter === 'unread') {
    return '没有未读消息';
  }
  if (filter === 'site') {
    return '暂无全站通知';
  }
  if (filter === 'direct') {
    return '暂无定向消息';
  }
  return '暂无消息';
};

export function MessagesPage({
  initialStateOverride,
}: {
  initialStateOverride?: Partial<MessagesPageState>;
}) {
  const auth = useAuth();
  const isStaticOverride = initialStateOverride != null;
  const effectiveIsAuthenticated = initialStateOverride?.isAuthenticated ?? auth.isAuthenticated;
  const effectiveUserId = isStaticOverride ? null : auth.user?.id ?? null;
  const [state, setState] = useState<MessagesPageState>(() => ({
    ...createDefaultState(effectiveIsAuthenticated),
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
      const listPayload = await request<MessageListDto>(`/api/messages?${params.toString()}`);
      const summaryPayload = effectiveIsAuthenticated ? await request<MessageSummaryDto>('/api/messages/summary') : null;

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

    window.dispatchEvent(new CustomEvent(MESSAGES_UPDATED_EVENT));
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

    window.dispatchEvent(new CustomEvent(MESSAGES_UPDATED_EVENT));
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

  const emptyDescription = effectiveIsAuthenticated
    ? '这里会显示全站通知与定向消息。'
    : '登录后可查看定向通知；当前仅显示公开的全站通知。';
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(244,114,182,0.18),_transparent_38%),linear-gradient(180deg,_#fff8fb_0%,_#f8fafc_42%,_#eef2ff_100%)] px-4 py-8 text-gray-900 dark:bg-[radial-gradient(circle_at_top,_rgba(244,114,182,0.12),_transparent_32%),linear-gradient(180deg,_#020617_0%,_#111827_48%,_#0f172a_100%)] dark:text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <section className="rounded-[32px] border border-white/70 bg-white/85 p-6 shadow-xl backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/75">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-pink-600 dark:text-pink-300">Messages</p>
              <h1 className="mt-2 text-3xl font-bold">消息中心</h1>
              <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-slate-300">{emptyDescription}</p>
            </div>
            {effectiveIsAuthenticated && visibleSummary ? (
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-2xl bg-pink-50 px-4 py-3 dark:bg-pink-500/10">
                  <div className="text-xs text-gray-500 dark:text-slate-400">未读</div>
                  <div className="text-xl font-semibold">{visibleSummary.unreadTotal}</div>
                </div>
                <div className="rounded-2xl bg-white/70 px-4 py-3 dark:bg-slate-900/80">
                  <div className="text-xs text-gray-500 dark:text-slate-400">全站</div>
                  <div className="text-xl font-semibold">{visibleSummary.siteUnread}</div>
                </div>
                <div className="rounded-2xl bg-white/70 px-4 py-3 dark:bg-slate-900/80">
                  <div className="text-xs text-gray-500 dark:text-slate-400">定向</div>
                  <div className="text-xl font-semibold">{visibleSummary.directUnread}</div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <MessageFilters
              activeFilter={visibleAppliedFilter}
              isAuthenticated={effectiveIsAuthenticated}
              onChange={handleFilterChange}
            />
            {effectiveIsAuthenticated ? (
              <button
                type="button"
                onClick={() => void handleMarkAllRead()}
                className="inline-flex rounded-full border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-semibold text-pink-700 dark:border-pink-400/40 dark:bg-pink-500/10 dark:text-pink-200"
              >
                全部已读
              </button>
            ) : (
              <Link
                href="/character-manager"
                className="inline-flex rounded-full bg-pink-600 px-4 py-2 text-sm font-semibold text-white"
              >
                登录查看定向消息
              </Link>
            )}
          </div>
        </section>

        {state.error ? (
          <section className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-200">
            {state.error}
          </section>
        ) : null}

        <section className="grid gap-4">
          {visibleMessages.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              canMarkRead={message.scope === 'user' && message.isRead === false}
              onMarkRead={() => void handleMarkRead(message.id)}
            />
          ))}

          {!visibleLoading && visibleMessages.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/70 bg-white/70 px-6 py-10 text-center text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-400">
              {emptyStateCopy}
            </div>
          ) : null}

          {visibleNextCursor ? (
            <button
              type="button"
              onClick={() => void handleLoadMore()}
              className="mx-auto inline-flex rounded-full border border-gray-300 bg-white/80 px-5 py-2.5 text-sm font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200"
            >
              加载更多
            </button>
          ) : null}
        </section>
      </div>
    </main>
  );
}
