'use client';

// Web 薄适配（D5.0e）：卡片块实现已迁入 @mahoshojo/ui-web/card-library，
// 这里注入 Web 的链接/标记/剪贴板/统计上报端口，保持既有 props 面不变。

import type { ComponentProps } from 'react';
import { DataCard as SharedDataCard } from '@mahoshojo/ui-web/card-library';
import { webCardTilePlatform } from '@/lib/card-tile-platform';

export type DataCardProps = Omit<ComponentProps<typeof SharedDataCard>, 'platform'>;

export default function DataCard(props: DataCardProps) {
  return <SharedDataCard platform={webCardTilePlatform} {...props} />;
}
