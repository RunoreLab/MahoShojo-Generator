'use client';

import { ArenaRosterSection } from './ArenaRosterSection';
import { useProposalRosterSectionModel } from './useProposalRosterSection';

/**
 * Proposal 工作台的“已选角色 / 分队”区块入口：
 * adapter 从 ArenaEditorSessionProvider 上下文读取 room-proposal session。
 */
export function ProposalArenaRosterSection({
  disabled,
  onActionError,
}: Readonly<{
  disabled: boolean;
  onActionError(message: string): void;
}>) {
  const model = useProposalRosterSectionModel({ disabled, onActionError });
  return <ArenaRosterSection model={model} emptyLabel="房间配置没有角色" />;
}
