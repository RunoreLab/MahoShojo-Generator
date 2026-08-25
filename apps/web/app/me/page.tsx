import type { Metadata } from 'next';
import { Suspense } from 'react';

import { MeRouteProviders } from '@/components/me/MeRouteProviders';

export const metadata: Metadata = {
  title: '个人页 - MahoShojo Generator',
  description: '查看战报记录、PVP 战绩与个人设置',
};

export default function MeRoute() {
  return (
    <Suspense fallback={null}>
      <MeRouteProviders />
    </Suspense>
  );
}
