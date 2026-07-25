import type { Metadata } from 'next';

import { PvpRouteProviders } from '@/components/competition/PvpRouteProviders';

export const metadata: Metadata = {
  title: 'PVP 大厅 - MahoShojo Generator',
  description: '创建、浏览或快速匹配 PVP 房间。',
};

export default function PvpRoute() {
  return <PvpRouteProviders />;
}
