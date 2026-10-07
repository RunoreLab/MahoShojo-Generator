import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SettingsRouteProviders } from '@/components/settings/SettingsRouteProviders';

export const metadata: Metadata = {
  title: '设置 - MahoShojo Generator',
  description: '账号、外观与生成偏好设置',
};

export default function SettingsRoute() {
  return (
    <Suspense fallback={null}>
      <SettingsRouteProviders />
    </Suspense>
  );
}
