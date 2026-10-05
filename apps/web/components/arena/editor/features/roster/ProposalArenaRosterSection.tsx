'use client';

import { useState } from 'react';

import { ArenaRoomReferenceDetailsDialog } from '@/components/arena/multiplayer/ArenaRoomReferenceDetailsDialog';

import { ArenaRosterSection } from './ArenaRosterSection';
import { useProposalRosterSectionModel } from './useProposalRosterSection';
import type { ArenaRoomReferenceDetailsRequest } from '@/lib/arena-room/reference-presentation';

/**
 * Proposal 工作台的“已选角色 / 分队”区块入口：
 * adapter 从 ArenaEditorSessionProvider 上下文读取 room-proposal session；
 * 详情弹窗仅覆盖预设/在线公开引用，host-local stub 无详情入口。
 */
export function ProposalArenaRosterSection({
  disabled,
  onActionError,
}: Readonly<{
  disabled: boolean;
  onActionError(message: string): void;
}>) {
  const [detailsRequest, setDetailsRequest] = useState<ArenaRoomReferenceDetailsRequest | null>(null);
  const model = useProposalRosterSectionModel({
    disabled,
    onActionError,
    onRequestDetails: setDetailsRequest,
  });
  return (
    <>
      <ArenaRosterSection model={model} emptyLabel="房间配置没有角色" />
      <ArenaRoomReferenceDetailsDialog
        request={detailsRequest}
        onClose={() => setDetailsRequest(null)}
      />
    </>
  );
}
