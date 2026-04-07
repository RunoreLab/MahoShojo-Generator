import { useEffect, useState } from 'react';

import { authStorage } from '@/lib/auth';

const TOPBAR_MESSAGES_CACHE_KEY = 'topbar_messages_summary_v1';
const TOPBAR_MESSAGES_REFRESH_INTERVAL_MS = 90_000;
const TOPBAR_MESSAGES_UPDATED_EVENT = 'mahoshojo:messages-updated';

type MessagesSummaryResponse = {
  unreadTotal?: unknown;
};

type CachedSummary = {
  unreadTotal: number;
  fetchedAt: number;
};

const memoryCache = new Map<number, CachedSummary>();

const canUseWindow = (): boolean => typeof window !== 'undefined';

const normalizeUnreadTotal = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;

export const getTopBarMessagesCacheKey = (userId: number): string => `${TOPBAR_MESSAGES_CACHE_KEY}:${userId}`;

const readSessionCache = (userId: number): CachedSummary | null => {
  if (!canUseWindow()) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(getTopBarMessagesCacheKey(userId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<CachedSummary>;
    if (typeof parsed.unreadTotal !== 'number' || typeof parsed.fetchedAt !== 'number') {
      return null;
    }
    return parsed as CachedSummary;
  } catch {
    return null;
  }
};

const writeSessionCache = (userId: number, value: CachedSummary) => {
  if (!canUseWindow()) {
    return;
  }

  try {
    window.sessionStorage.setItem(getTopBarMessagesCacheKey(userId), JSON.stringify(value));
  } catch {
    // ignore sessionStorage quota or access errors
  }
};

const readCachedSummary = (userId: number): CachedSummary | null => {
  const memoryValue = memoryCache.get(userId);
  if (memoryValue) {
    return memoryValue;
  }

  const cached = readSessionCache(userId);
  if (cached) {
    memoryCache.set(userId, cached);
  }
  return cached;
};

const isCacheFresh = (cached: CachedSummary | null): boolean =>
  cached !== null && Date.now() - cached.fetchedAt < TOPBAR_MESSAGES_REFRESH_INTERVAL_MS;

export const getTopBarMessagesStateSnapshot = (
  userId: number | null,
  enabled: boolean,
): { unreadTotal: number; loading: boolean; error: string | null } => {
  const cached = enabled && userId ? readCachedSummary(userId) : null;
  return {
    unreadTotal: cached?.unreadTotal ?? 0,
    loading: Boolean(enabled && userId && !isCacheFresh(cached)),
    error: null,
  };
};

export const setTopBarMessagesMemoryCacheForTests = (userId: number, value: CachedSummary) => {
  memoryCache.set(userId, value);
};

export const clearTopBarMessagesMemoryCacheForTests = () => {
  memoryCache.clear();
};

export function useTopBarMessages(userId: number | null, enabled: boolean): {
  unreadTotal: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const snapshot = getTopBarMessagesStateSnapshot(userId, enabled);
  const [unreadTotal, setUnreadTotal] = useState<number>(snapshot.unreadTotal);
  const [loading, setLoading] = useState<boolean>(snapshot.loading);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextSnapshot = getTopBarMessagesStateSnapshot(userId, enabled);
    setUnreadTotal(nextSnapshot.unreadTotal);
    setLoading(nextSnapshot.loading);
    setError(nextSnapshot.error);
  }, [enabled, userId]);

  useEffect(() => {
    if (!enabled || !userId) {
      setUnreadTotal(0);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const applyCached = (next: CachedSummary) => {
      memoryCache.set(userId, next);
      writeSessionCache(userId, next);
      if (!cancelled) {
        setUnreadTotal(next.unreadTotal);
      }
    };

    const refresh = async () => {
      setLoading(true);
      try {
        const response = await authStorage.fetch('/api/messages/summary', {
          method: 'GET',
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error(`summary:${response.status}`);
        }
        const payload = (await response.json().catch(() => null)) as MessagesSummaryResponse | null;
        applyCached({
          unreadTotal: normalizeUnreadTotal(payload?.unreadTotal),
          fetchedAt: Date.now(),
        });
        if (!cancelled) {
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError('消息摘要加载失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void (async () => {
      const nextCached = readCachedSummary(userId);
      if (nextCached) {
        setUnreadTotal(nextCached.unreadTotal);
        if (isCacheFresh(nextCached)) {
          setLoading(false);
          return;
        }
      }

      await refresh();
    })();

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || isCacheFresh(readCachedSummary(userId))) {
        return;
      }
      void refresh();
    };

    const handleMessagesUpdated = () => {
      void refresh();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener(TOPBAR_MESSAGES_UPDATED_EVENT, handleMessagesUpdated);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener(TOPBAR_MESSAGES_UPDATED_EVENT, handleMessagesUpdated);
    };
  }, [enabled, userId]);

  return {
    unreadTotal,
    loading,
    error,
    refresh: async () => {
      if (!enabled || !userId) {
        setUnreadTotal(0);
        setLoading(false);
        setError(null);
        return;
      }

      const response = await authStorage.fetch('/api/messages/summary', {
        method: 'GET',
        cache: 'no-store',
      });
      if (!response.ok) {
        setError('消息摘要加载失败');
        return;
      }
      const payload = (await response.json().catch(() => null)) as MessagesSummaryResponse | null;
      const nextCache = {
        unreadTotal: normalizeUnreadTotal(payload?.unreadTotal),
        fetchedAt: Date.now(),
      };
      memoryCache.set(userId, nextCache);
      writeSessionCache(userId, nextCache);
      setUnreadTotal(nextCache.unreadTotal);
      setError(null);
      setLoading(false);
    },
  };
}
