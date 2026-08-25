import type { Metadata } from 'next';

import { DetailsPage } from '@/components/creation/DetailsPage';

export const metadata: Metadata = {
  title: '魔法少女调查问卷 ~ 奇妙妖精大调查',
  description: '回答问卷，生成您的专属魔法少女',
};

export default function DetailsRoute() {
  return <DetailsPage />;
}
