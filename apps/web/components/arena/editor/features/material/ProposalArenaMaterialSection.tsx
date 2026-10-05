'use client';

import { ArenaMaterialSection } from './ArenaMaterialSection';
import { useProposalMaterialSectionModel } from './useProposalMaterialSection';

/**
 * Proposal 工作台的“素材注入”区块入口：
 * adapter 从 ArenaEditorSessionProvider 上下文读取 room-proposal session；
 * 在线数据卡 Modal 仍由工作台持有，这里只接收打开回调。
 */
export function ProposalArenaMaterialSection({
  disabled,
  onActionError,
  onOpenModal,
}: Readonly<{
  disabled: boolean;
  onActionError(message: string): void;
  onOpenModal(): void;
}>) {
  const model = useProposalMaterialSectionModel({
    disabled,
    onActionError,
    onOpenModal,
  });
  return <ArenaMaterialSection model={model} />;
}
