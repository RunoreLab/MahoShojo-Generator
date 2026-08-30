'use client';

import { useEffect } from 'react';

import { ArenaPage } from '@/components/arena/ArenaPage';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import { QueryRouteProviders } from '@/components/competition/QueryRouteProviders';
import { arenaMultiplayerConfig } from '@/config/arena-multiplayer';

export function ArenaRouteProviders() {
  return (
    <QueryRouteProviders>
      <ArenaPage multiplayer={arenaMultiplayerConfig} />
    </QueryRouteProviders>
  );
}

export function ArenaStreamRouteProviders() {
  useEffect(() => {
    useBattleStore.getState().setGenerationMode('stream');
  }, []);

  return (
    <QueryRouteProviders>
      <ArenaPage multiplayer={{ enabled: false, origin: arenaMultiplayerConfig.origin }} />
    </QueryRouteProviders>
  );
}
