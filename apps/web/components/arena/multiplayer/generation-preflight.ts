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
