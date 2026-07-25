import type { Metadata } from 'next';

import { BadgeManagerPage } from '@/components/badge/BadgeManagerPage';

export const metadata: Metadata = {
  title: '徽章管理 - MahoShojo Generator',
};

export default function BadgeManagerRoute() {
  return <BadgeManagerPage />;
}
