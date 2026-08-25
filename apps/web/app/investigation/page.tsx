import type { Metadata } from 'next';

import { InvestigationPage } from '@/components/investigation/InvestigationPage';

export const metadata: Metadata = {
  title: '调查院 - MahoShojo Generator',
  description: '公开数据卡众查与当前案件处理入口。',
};

export default function InvestigationRoute() {
  return <InvestigationPage />;
}
