import type { Metadata } from 'next';

import { CanshouPage } from '@/components/creation/CanshouPage';

export const metadata: Metadata = {
  title: '残兽生成器 - 间界残兽前进基地',
};

export default function CanshouRoute() {
  return <CanshouPage />;
}
