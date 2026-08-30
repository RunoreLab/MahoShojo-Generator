import type { Metadata } from 'next';

import { TachiePage } from '@/components/tachie/TachiePage';

export const metadata: Metadata = {
  title: '立绘生成 - MahoShojo Generator',
};

export default function TachieRoute() {
  return <TachiePage />;
}
