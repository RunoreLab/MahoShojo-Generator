import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataCardSummary, DataCardSummaryPage, DataCardSummaryQueryInput } from '@mahoshojo/contracts/data-cards';

export type CardLibrarySummarySource = 'my' | 'favorites';

/**
 * 「我的 / 收藏」摘要分页的取数器由宿主注入：Web 走 `/api/*` fetch，Desktop 走
 * 固定路由 IPC。返回值必须已经过 `DataCardSummaryPageSchema` 校验。
 */
export type CardLibrarySummaryPageFetcher = (
  source: CardLibrarySummarySource,
  query: DataCardSummaryQueryInput,
  signal: AbortSignal,
) => Promise<DataCardSummaryPage>;

interface SummaryPageView {
  /** 本视图数据所属的查询标识：`source|ownerId|queryKey`。 */
  key: string;
  status: 'idle' | 'loading' | 'success' | 'error';
  cards: DataCardSummary[];
  total: number;
  hasLoaded: boolean;
  stats: { private: number; public: number; pending: number } | undefined;
  error: string | null;
}

const IDLE_VIEW: SummaryPageView = {
  key: '',
  status: 'idle',
  cards: [],
  total: 0,
  hasLoaded: false,
  stats: undefined,
  error: null,
};

export function useCardLibrarySummaryPage(
  fetchSummaryPage: CardLibrarySummaryPageFetcher,
  source: 'my' | 'favorites',
  ownerId: number | null,
  enabled: boolean,
  query: DataCardSummaryQueryInput,
) {
  const queryKey = JSON.stringify(query);
  const requestKey = ownerId === null ? null : `${source}|${ownerId}|${queryKey}`;
  /**
   * 视图按请求键持有：渲染只投影「键与当前请求一致」的那一份。
   * 账号切换（ownerId 变化）让旧键视图立即失配——不用等 effect 清理，
   * 迟到的旧账号写入也无法落进新视图（D5.0e-r1 账号隔离）。
   */
  const [view, setView] = useState<SummaryPageView>(IDLE_VIEW);
  const [refresh, setRefresh] = useState(0);
  const latest = useRef(0);
  const reload = useCallback(() => setRefresh((value) => value + 1), []);

  const current = view.key === requestKey ? view : IDLE_VIEW;

  /**
   * 暴露给调用方的列表就地更新（收藏计数增减等）。键校验发生在 setState
   * 的 updater 内：即使 closure 里的 requestKey 已过期，写也只会落在
   * 与捕获键相同的视图上，绝不可能把旧账号的列表改动投影到新账号。
   */
  const setCards = useCallback(
    (updater: (cards: DataCardSummary[]) => DataCardSummary[]) => {
      setView((prev) => (prev.key === requestKey ? { ...prev, cards: updater(prev.cards) } : prev));
    },
    [requestKey],
  );

  useEffect(() => {
    if (!enabled || requestKey === null) return;
    const controller = new AbortController();
    const request = ++latest.current;
    // 同键刷新保留已有数据（stale-while-revalidate）；换键则以空视图起步。
    setView((prev) => prev.key === requestKey
      ? { ...prev, status: 'loading', error: null }
      : { ...IDLE_VIEW, key: requestKey, status: 'loading' });
    void fetchSummaryPage(source, JSON.parse(queryKey), controller.signal).then((result) => {
      if (controller.signal.aborted || request !== latest.current) return;
      setView((prev) => prev.key === requestKey
        ? {
            ...prev,
            status: 'success',
            cards: result.cards,
            total: result.total,
            hasLoaded: true,
            stats: result.stats,
            error: null,
          }
        : prev);
    }).catch((cause) => {
      if (controller.signal.aborted || request !== latest.current) return;
      const timedOut = cause instanceof Error && ['TimeoutError', 'AbortError'].includes(cause.name);
      const message = timedOut
        ? '加载超时，请重试'
        : cause instanceof Error
          ? cause.message
          : '数据卡加载失败，请重试';
      setView((prev) => {
        if (prev.key !== requestKey) return prev;
        // 同查询的刷新失败保留 stale 数据；尚无成功结果的查询失败则清空，不拿旧键数据充数。
        const keepStale = prev.hasLoaded;
        return {
          ...prev,
          status: 'error',
          error: message,
          ...(keepStale ? {} : { cards: [], total: 0, stats: undefined }),
        };
      });
      console.warn('data-card-list-failed', {
        source,
        category: timedOut ? 'timeout' : 'request',
        status: (cause as { status?: number } | null)?.status,
      });
    });
    return () => { controller.abort(); latest.current += 1; };
  }, [fetchSummaryPage, source, requestKey, enabled, queryKey, refresh]);

  useEffect(() => {
    if (!enabled || current.status !== 'error') return;
    window.addEventListener('online', reload, { once: true });
    return () => window.removeEventListener('online', reload);
  }, [enabled, current.status, reload]);

  return {
    cards: current.cards,
    setCards,
    total: current.total,
    stats: current.stats,
    hasLoaded: current.hasLoaded,
    status: current.status,
    loading: current.status === 'loading',
    error: current.error,
    reload,
  };
}
