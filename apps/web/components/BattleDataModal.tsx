'use client';

// Web 薄适配（D5.0e）：实现已迁入 @mahoshojo/ui-web/card-library，
// 本文件只负责装配 Web 运行地宿主并保持原有 props 面不变。

import { CardLibraryModal, type CardLibraryModalProps } from '@mahoshojo/ui-web/card-library';
import { useWebCardLibraryHost } from '@/lib/card-library-host';

export type BattleDataModalProps = Omit<CardLibraryModalProps, 'host'>;

export default function BattleDataModal(props: BattleDataModalProps) {
  const host = useWebCardLibraryHost();
  return <CardLibraryModal host={host} {...props} />;
}
