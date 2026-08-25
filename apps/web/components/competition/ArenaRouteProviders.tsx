'use client';

import { useEffect } from 'react';

import { ArenaPage } from '@/components/arena/ArenaPage';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import { QueryRouteProviders } from '@/components/competition/QueryRouteProviders';

export function ArenaRouteProviders() {
  return (
    <QueryRouteProviders>
      <ArenaPage />
    </QueryRouteProviders>
  );
}

export function ArenaStreamRouteProviders() {
  useEffect(() => {
    useBattleStore.getState().setGenerationMode('stream');
  }, []);

  return (
    <QueryRouteProviders>
      <ArenaPage />
    </QueryRouteProviders>
  );
}
