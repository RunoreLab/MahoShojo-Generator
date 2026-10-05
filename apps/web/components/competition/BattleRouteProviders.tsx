'use client';

import { BattleLitePage } from '@/components/arena-lite/BattleLitePage';
import { ArenaPersistedStateBoundary } from '@/components/arena/ArenaPersistedStateBoundary';
import { QueryRouteProviders } from '@/components/competition/QueryRouteProviders';

export function BattleRouteProviders() {
  return (
    <QueryRouteProviders>
      <ArenaPersistedStateBoundary>
        <BattleLitePage />
      </ArenaPersistedStateBoundary>
    </QueryRouteProviders>
  );
}
