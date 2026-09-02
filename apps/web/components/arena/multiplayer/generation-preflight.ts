import type { ArenaProposal } from '@mahoshojo/contracts/arena-room';

import type { ArenaRoomHostReconciliationState } from './useArenaRoomHostReconciliation';

export const pendingProposalFingerprint = (
  proposals: readonly ArenaProposal[],
): string => JSON.stringify(proposals
  .map((proposal) => `${proposal.proposalId}:${proposal.updatedAt ?? proposal.createdAt}`)
  .sort());

export const canAutoPublishArenaRoomHostDraft = (input: Readonly<{
  pendingProposalCount: number;
  reconciliationKind: ArenaRoomHostReconciliationState['kind'];
  workspaceAllows: boolean;
}>): boolean => (
  input.pendingProposalCount === 0
  && (input.reconciliationKind === 'idle' || input.reconciliationKind === 'synced')
  && input.workspaceAllows
);
