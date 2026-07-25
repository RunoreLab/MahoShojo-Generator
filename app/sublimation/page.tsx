import type { Metadata } from 'next';

import { AppRouteAdapterProvider } from '@/components/competition/AppRouteAdapterProvider';
import { SublimationPage } from '@/components/competition/SublimationPage';

export const metadata: Metadata = {
  title: '成长升华 - MahoShojo Generator',
  description: '根据角色的历战记录，生成一个全新的成长后形态！',
};

export default function SublimationRoute() {
  return (
    <AppRouteAdapterProvider>
      <SublimationPage />
    </AppRouteAdapterProvider>
  );
}
