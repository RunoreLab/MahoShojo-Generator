import type { Metadata } from 'next';
import { Suspense } from 'react';

import { EncyclopediaIndexPage } from '@/components/encyclopedia/EncyclopediaIndexPage';

export const metadata: Metadata = {
  title: '百科 - MahoShojo Generator',
  description: '查看站内使用说明、规则、故障排查与进阶内容',
};

export default function EncyclopediaRoute() {
  return (
    <Suspense
      fallback={
        <div className="magic-background-white">
          <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-4 text-sm text-gray-500 sm:px-6 lg:px-10">
            正在加载百科目录...
          </div>
        </div>
      }
    >
      <EncyclopediaIndexPage />
    </Suspense>
  );
}
