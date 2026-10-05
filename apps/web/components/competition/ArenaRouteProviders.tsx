'use client';

import { ArenaPage } from '@/components/arena/ArenaPage';
import { ArenaPersistedStateBoundary } from '@/components/arena/ArenaPersistedStateBoundary';
import { QueryRouteProviders } from '@/components/competition/QueryRouteProviders';
import { arenaMultiplayerConfig } from '@/config/arena-multiplayer';

export function ArenaRouteProviders() {
  return (
    <QueryRouteProviders>
      <ArenaPersistedStateBoundary>
        <ArenaPage multiplayer={arenaMultiplayerConfig} />
      </ArenaPersistedStateBoundary>
    </QueryRouteProviders>
  );
}

export function ArenaStreamRouteProviders() {
  return (
    <QueryRouteProviders>
      <ArenaPersistedStateBoundary generationModeAfterHydration="stream">
        <ArenaPage multiplayer={{ enabled: false, origin: arenaMultiplayerConfig.origin }} />
      </ArenaPersistedStateBoundary>
    </QueryRouteProviders>
  );
}
