import type { Metadata } from 'next';

import { RankingRouteProviders } from '@/components/competition/RankingRouteProviders';

export const metadata: Metadata = {
  title: '排位排行榜 - MahoShojo Generator',
};

export default function RankingRoute() {
  return <RankingRouteProviders />;
}
