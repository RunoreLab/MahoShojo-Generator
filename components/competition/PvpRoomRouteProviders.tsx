'use client';

import { PvpRoomPage } from '@/components/pvp/PvpRoomPage';
import { QueryRouteProviders } from '@/components/competition/QueryRouteProviders';

export function PvpRoomRouteProviders() {
  return (
    <QueryRouteProviders>
      <PvpRoomPage />
    </QueryRouteProviders>
  );
}
