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

type TopBarMessagesRenderState = {
  ownerUserId: number | null;
  enabled: boolean;
  unreadTotal: number;
  loading: boolean;
  error: string | null;
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

const createTopBarMessagesRenderState = (
  userId: number | null,
  enabled: boolean,
): TopBarMessagesRenderState => {
  const snapshot = getTopBarMessagesStateSnapshot(userId, enabled);
  return {
    ownerUserId: userId,
    enabled,
    unreadTotal: snapshot.unreadTotal,
    loading: snapshot.loading,
    error: snapshot.error,
  };
};

export const resolveTopBarMessagesStateForRender = (
  state: TopBarMessagesRenderState,
  userId: number | null,
  enabled: boolean,
): TopBarMessagesRenderState => {
  if (state.ownerUserId === userId && state.enabled === enabled) {
    return state;
  }
  return createTopBarMessagesRenderState(userId, enabled);
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
  const [state, setState] = useState<TopBarMessagesRenderState>(() =>
    createTopBarMessagesRenderState(userId, enabled),
  );
  const renderState = resolveTopBarMessagesStateForRender(state, userId, enabled);

  useEffect(() => {
    setState(createTopBarMessagesRenderState(userId, enabled));
  }, [enabled, userId]);

  useEffect(() => {
    if (!enabled || !userId) {
      setState(createTopBarMessagesRenderState(userId, enabled));
      return;
    }

    let cancelled = false;
    const updateState = (patch: Partial<TopBarMessagesRenderState>) => {
      setState((current) => {
        if (current.ownerUserId !== userId || current.enabled !== enabled) {
          return current;
        }
        return { ...current, ...patch };
      });
    };

    const applyCached = (next: CachedSummary) => {
      memoryCache.set(userId, next);
      writeSessionCache(userId, next);
      if (!cancelled) {
        updateState({ unreadTotal: next.unreadTotal });
      }
    };

    const refresh = async () => {
      updateState({ loading: true });
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
          updateState({ error: null });
        }
      } catch {
        if (!cancelled) {
          updateState({ error: '消息摘要加载失败' });
        }
      } finally {
        if (!cancelled) {
          updateState({ loading: false });
        }
      }
    };

    void (async () => {
      const nextCached = readCachedSummary(userId);
      if (nextCached) {
        updateState({ unreadTotal: nextCached.unreadTotal });
        if (isCacheFresh(nextCached)) {
          updateState({ loading: false });
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
    unreadTotal: renderState.unreadTotal,
    loading: renderState.loading,
    error: renderState.error,
    refresh: async () => {
      if (!enabled || !userId) {
        setState(createTopBarMessagesRenderState(userId, enabled));
        return;
      }

      setState((current) => {
        if (current.ownerUserId !== userId || current.enabled !== enabled) {
          return current;
        }
        return { ...current, loading: true };
      });
      const response = await authStorage.fetch('/api/messages/summary', {
        method: 'GET',
        cache: 'no-store',
      });
      if (!response.ok) {
        setState((current) => {
          if (current.ownerUserId !== userId || current.enabled !== enabled) {
            return current;
          }
          return { ...current, error: '消息摘要加载失败', loading: false };
        });
        return;
      }
      const payload = (await response.json().catch(() => null)) as MessagesSummaryResponse | null;
      const nextCache = {
        unreadTotal: normalizeUnreadTotal(payload?.unreadTotal),
        fetchedAt: Date.now(),
      };
      memoryCache.set(userId, nextCache);
      writeSessionCache(userId, nextCache);
      setState((current) => {
        if (current.ownerUserId !== userId || current.enabled !== enabled) {
          return current;
        }
        return {
          ...current,
          unreadTotal: nextCache.unreadTotal,
          error: null,
          loading: false,
        };
      });
    },
  };
}
