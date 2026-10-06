import type { Metadata } from 'next';
import { Suspense } from 'react';

import { WebEncyclopediaIndex } from '@/components/encyclopedia/WebEncyclopediaViews';
import { EncyclopediaPageFrame } from '@mahoshojo/ui-web/encyclopedia-frame';

export const metadata: Metadata = {
  title: '百科 - MahoShojo Generator',
  description: '查看站内使用说明、规则、故障排查与进阶内容',
};

export default function EncyclopediaRoute() {
  return (
    <Suspense
      fallback={
        // 骨架直接渲染共源 frame 本体：`encyclopedia-views` 桶出口挂有 hook，RSC 不能
        // 经它取组件，因此给无 hook 的 frame 单独开 `./encyclopedia-frame` 子路径——
        // 手写一份同构 class 会让骨架漂移再次变成静默回归。
        <EncyclopediaPageFrame
          header={<h1 className="text-xl font-bold text-gray-900">百科</h1>}
        >
          <div className="text-sm text-gray-500">正在加载百科目录...</div>
        </EncyclopediaPageFrame>
      }
    >
      <WebEncyclopediaIndex />
    </Suspense>
  );
}