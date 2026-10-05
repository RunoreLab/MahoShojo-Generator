'use client';

import { useEffect, useState, type ReactNode } from 'react';

import type { BattleStoreState } from './types';
import { useBattleStore } from './stores/useBattleStore';
import { useNarrativeHistoryStore } from './stores/useNarrativeHistoryStore';

type HydrationStatus = 'hydrating' | 'ready' | 'error';

interface ArenaPersistedStateBoundaryProps {
  children: ReactNode;
  hydrateBattleStore?: boolean;
  hydrateNarrativeHistoryStore?: boolean;
  generationModeAfterHydration?: BattleStoreState['generationMode'];
}

const hydrateBattleStoreIfNeeded = async (): Promise<boolean> => {
  if (!useBattleStore.persist.hasHydrated()) {
    await useBattleStore.persist.rehydrate();
  }
  return useBattleStore.persist.hasHydrated();
};

const hydrateNarrativeHistoryStoreIfNeeded = async (): Promise<boolean> => {
  if (!useNarrativeHistoryStore.persist.hasHydrated()) {
    await useNarrativeHistoryStore.persist.rehydrate();
  }
  return useNarrativeHistoryStore.persist.hasHydrated();
};

export function ArenaPersistedStateBoundary({
  children,
  hydrateBattleStore = true,
  hydrateNarrativeHistoryStore = true,
  generationModeAfterHydration,
}: ArenaPersistedStateBoundaryProps) {
  const [status, setStatus] = useState<HydrationStatus>('hydrating');

  useEffect(() => {
    let active = true;
    const needsBattleStore = hydrateBattleStore || generationModeAfterHydration !== undefined;

    const restore = async () => {
      const [battleStoreReady, narrativeHistoryStoreReady] = await Promise.all([
        needsBattleStore ? hydrateBattleStoreIfNeeded() : true,
        hydrateNarrativeHistoryStore ? hydrateNarrativeHistoryStoreIfNeeded() : true,
      ]);

      if (!active) return;
      if (!battleStoreReady || !narrativeHistoryStoreReady) {
        setStatus('error');
        return;
      }

      if (generationModeAfterHydration !== undefined) {
        useBattleStore.getState().setGenerationMode(generationModeAfterHydration);
      }
      setStatus('ready');
    };

    setStatus('hydrating');
    void restore();

    return () => {
      active = false;
    };
  }, [generationModeAfterHydration, hydrateBattleStore, hydrateNarrativeHistoryStore]);

  if (status === 'error') {
    return (
      <div className="mx-auto flex min-h-[40vh] max-w-3xl items-center justify-center px-6 text-center" role="alert">
        本地竞技场设置恢复失败，请刷新页面后重试。
      </div>
    );
  }

  if (status !== 'ready') {
    return (
      <div
        aria-live="polite"
        className="mx-auto flex min-h-[40vh] max-w-3xl items-center justify-center px-6 text-center"
        role="status"
      >
        正在恢复本地设置…
      </div>
    );
  }

  return children;
}
