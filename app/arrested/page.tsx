import type { Metadata } from 'next';

import { AppRouteAdapterProvider } from '@/components/competition/AppRouteAdapterProvider';
import { ArrestedPage } from '@/components/competition/ArrestedPage';

export const metadata: Metadata = {
  title: '调查院正在出动 - 魔法国度调查院',
  description: '魔法国度调查院逮捕令',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function ArrestedRoute() {
  return (
    <AppRouteAdapterProvider>
      <ArrestedPage />
    </AppRouteAdapterProvider>
  );
}
