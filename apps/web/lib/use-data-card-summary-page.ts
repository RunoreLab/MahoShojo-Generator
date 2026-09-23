import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataCardSummary, DataCardSummaryQueryInput } from '@mahoshojo/contracts/data-cards';
import { getDataCardSummaryPage } from '@/lib/data-card-list-client';

export function useDataCardSummaryPage(source: 'my' | 'favorites', ownerId: number | null, enabled: boolean, query: DataCardSummaryQueryInput) {
  const [cards, setCards] = useState<DataCardSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [stats, setStats] = useState<{ private: number; public: number; pending: number } | undefined>();
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const latest = useRef(0);
  const queryKey = JSON.stringify(query);
  // 记录当前展示数据所属的查询；只有同一查询的刷新失败才允许保留 stale 数据。
  const loadedQueryKeyRef = useRef<string | null>(null);
  const reload = useCallback(() => setRefresh((value) => value + 1), []);
  const clearLoadedResult = useCallback(() => {
    setCards([]); setTotal(0); setHasLoaded(false); setStats(undefined);
  }, []);
  useEffect(() => {
    loadedQueryKeyRef.current = null;
    clearLoadedResult();
    setStatus('idle'); setError(null);
  }, [ownerId, source, clearLoadedResult]);
  useEffect(() => {
    if (!enabled || ownerId === null) return;
    const requestKey = `${source}|${ownerId}|${queryKey}`;
    if (loadedQueryKeyRef.current !== requestKey) {
      // 翻页/搜索/筛选变化：旧查询结果不得冒充新查询结果。
      loadedQueryKeyRef.current = null;
      clearLoadedResult();
    }
    const controller = new AbortController();
    const request = ++latest.current;
    setStatus('loading');
    setError(null);
    void getDataCardSummaryPage(source, JSON.parse(queryKey), controller.signal).then((result) => {
      if (controller.signal.aborted || request !== latest.current) return;
      loadedQueryKeyRef.current = requestKey;
      setCards(result.cards); setTotal(result.total); setHasLoaded(true); setStats(result.stats); setStatus('success');
    }).catch((cause) => {
      if (controller.signal.aborted || request !== latest.current) return;
      if (loadedQueryKeyRef.current !== requestKey) {
        loadedQueryKeyRef.current = null;
        clearLoadedResult();
      }
      const timedOut = cause instanceof Error && ['TimeoutError', 'AbortError'].includes(cause.name);
      setError(timedOut ? '加载超时，请重试' : cause instanceof Error ? cause.message : '数据卡加载失败，请重试');
      setStatus('error');
      console.warn('data-card-list-failed', { source, category: timedOut ? 'timeout' : 'request', status: cause?.status });
    });
    return () => { controller.abort(); latest.current += 1; };
  }, [source, ownerId, enabled, queryKey, refresh, clearLoadedResult]);
  useEffect(() => {
    if (!enabled || status !== 'error') return;
    window.addEventListener('online', reload, { once: true });
    return () => window.removeEventListener('online', reload);
  }, [enabled, status, reload]);
  return { cards, setCards, total, stats, hasLoaded, status, loading: status === 'loading', error, reload };
}
