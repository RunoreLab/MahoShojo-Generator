import type { ArenaProposal } from '@mahoshojo/contracts/arena-room';

import type { ArenaRoomHostReconciliationState } from './useArenaRoomHostReconciliation';

export const pendingProposalFingerprint = (
  proposals: readonly ArenaProposal[],
): string => JSON.stringify(proposals
  .map((proposal) => `${proposal.proposalId}:${proposal.updatedAt ?? proposal.createdAt}`)
  .sort());

type ArenaRoomGenerationFenceAuthority = Readonly<{
  roomId: string;
  roomEpoch: string;
  ownerUserId: string;
  revision: number;
}>;

export const isArenaRoomGenerationFenceCurrent = (input: Readonly<{
  expectedAuthority: ArenaRoomGenerationFenceAuthority;
  currentAuthority: ArenaRoomGenerationFenceAuthority | null;
  proposals: readonly ArenaProposal[];
  proposalFingerprint: string;
}>): boolean => Boolean(
  input.currentAuthority
  && input.currentAuthority.roomId === input.expectedAuthority.roomId
  && input.currentAuthority.roomEpoch === input.expectedAuthority.roomEpoch
  && input.currentAuthority.ownerUserId === input.expectedAuthority.ownerUserId
  && input.currentAuthority.revision === input.expectedAuthority.revision
  && pendingProposalFingerprint(input.proposals) === input.proposalFingerprint
);

export const canAutoPublishArenaRoomHostDraft = (input: Readonly<{
  pendingProposalCount: number;
  reconciliationKind: ArenaRoomHostReconciliationState['kind'];
  workspaceAllows: boolean;
}>): boolean => (
  input.pendingProposalCount === 0
  && (input.reconciliationKind === 'idle' || input.reconciliationKind === 'synced')
  && input.workspaceAllows
);

export const ARENA_ROOM_GENERATION_SYNC_GATE_MESSAGE = '房间配置正在同步，请等待同步完成后再开始生成。';

/**
 * reconciliation 尚未落定（synchronizing）时，本地 working copy 既不代表房间
 * 权威、也可能即将被覆盖；此时禁止生成 preflight 的任何发布方向，避免用
 * stale/空本地配置覆盖刚接受的提案。
 */
export const isArenaRoomGenerationSyncSettled = (
  reconciliationKind: ArenaRoomHostReconciliationState['kind'],
): boolean => reconciliationKind !== 'synchronizing';
