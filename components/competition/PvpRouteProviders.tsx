'use client';

import { PvpLobbyPage } from '@/components/pvp/PvpLobbyPage';
import { QueryRouteProviders } from '@/components/competition/QueryRouteProviders';

export function PvpRouteProviders() {
  return (
    <QueryRouteProviders>
      <PvpLobbyPage />
    </QueryRouteProviders>
  );
}
