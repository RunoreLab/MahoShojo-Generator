'use client';

import { BattleLitePage } from '@/components/arena-lite/BattleLitePage';
import { QueryRouteProviders } from '@/components/competition/QueryRouteProviders';

export function BattleRouteProviders() {
  return (
    <QueryRouteProviders>
      <BattleLitePage />
    </QueryRouteProviders>
  );
}
