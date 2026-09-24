'use client';

import { ArenaWebPackageSection } from './ArenaWebPackageSection';
import { useProposalWebPackageSectionModel } from './useProposalWebPackageSection';

/**
 * Proposal 工作台的 Web 包区块入口：
 * adapter 从 ArenaEditorSessionProvider 上下文读取 room-proposal session；
 * 仅暴露 builtin 预设，不暴露本地 ZIP 导入。
 */
export function ProposalArenaWebPackageSection({
  disabled,
  onActionError,
}: Readonly<{
  disabled: boolean;
  onActionError(message: string): void;
}>) {
  const model = useProposalWebPackageSectionModel({ disabled, onActionError });
  return <ArenaWebPackageSection model={model} />;
}
