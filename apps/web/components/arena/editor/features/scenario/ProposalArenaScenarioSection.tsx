'use client';

import { ArenaScenarioSection } from './ArenaScenarioSection';
import { useProposalScenarioSectionModel } from './useProposalScenarioSection';

/**
 * Proposal 工作台的“情景设置”区块入口：
 * adapter 从 ArenaEditorSessionProvider 上下文读取 room-proposal session；
 * 在线库 Modal 仍由工作台持有，这里只接收打开回调。
 */
export function ProposalArenaScenarioSection({
  disabled,
  onActionError,
  onOpenMainModal,
  onOpenAuxModal,
}: Readonly<{
  disabled: boolean;
  onActionError(message: string): void;
  onOpenMainModal(): void;
  onOpenAuxModal(): void;
}>) {
  const model = useProposalScenarioSectionModel({
    disabled,
    onActionError,
    onOpenMainModal,
    onOpenAuxModal,
  });
  return <ArenaScenarioSection model={model} />;
}
