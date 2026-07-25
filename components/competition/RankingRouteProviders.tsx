'use client';

import { RankingPage } from '@/components/ranking/RankingPage';
import { QueryRouteProviders } from '@/components/competition/QueryRouteProviders';

export function RankingRouteProviders() {
  return (
    <QueryRouteProviders>
      <RankingPage />
    </QueryRouteProviders>
  );
}
