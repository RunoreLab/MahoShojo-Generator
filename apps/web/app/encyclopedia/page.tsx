import type { Metadata } from 'next';
import { Suspense } from 'react';

import { WebEncyclopediaIndex } from '@/components/encyclopedia/WebEncyclopediaViews';

export const metadata: Metadata = {
  title: '百科 - MahoShojo Generator',
  description: '查看站内使用说明、规则、故障排查与进阶内容',
};

export default function EncyclopediaRoute() {
  return (
    <Suspense
      fallback={
        // 骨架与共享 `EncyclopediaPageFrame` 同构：hydrate 时不再发生「限宽→全宽」的
        // layout shift（RSC 不能经 encyclopedia-views 入口拿到组件，这里按同一套类手写）。
        <div className="magic-background-white">
          <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-4 sm:px-6 lg:px-10">
            <div className="rounded-2xl bg-white/95 px-6 py-6 text-sm text-gray-500 shadow-[0_20px_40px_rgba(0,0,0,0.10)] ring-1 ring-white/50 backdrop-blur sm:px-8">
              正在加载百科目录...
            </div>
          </div>
        </div>
      }
    >
      <WebEncyclopediaIndex />
    </Suspense>
  );
}