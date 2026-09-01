import {
  ArenaProposalSchema,
  ArenaProposalIdSchema,
  ArenaRoomProposalResolveRequestSchema,
  ArenaRoomProposalSubmitRequestSchema,
  ArenaRoomProposalWithdrawRequestSchema,
  type ArenaProposal,
  type ArenaProposalChange,
  type ArenaRoomProposalMutationResult,
  type ArenaRoomProposalMutationStatus,
  type DataCardRef,
} from '@mahoshojo/contracts/arena-room';
import {
  applyArenaProposal,
  type ArenaRoomAuthorityState,
  type ArenaRoomTransitionFailure,
  type ArenaRoomTransitionSuccess,
} from '@mahoshojo/multiplayer-core';

import {
  ArenaDataCardRefVerifierError,
  type ArenaDataCardRefVerifier,
} from './arena-data-card-ref-verifier';
import {
  ArenaRoomPresetRefVerifierError,
  canonicalArenaRoomSharedConfigRefs,
  verifyArenaRoomPresetRefs,
  verifyArenaRoomSharedConfigPresetRefs,
} from './arena-room-shared-config-refs';
import type { ArenaRoomGenerationPresetResolver } from './room-generation-preset-registry';
import type {
  ArenaRoomMembershipService,
  ResolvedArenaRoomMembership,
} from './room-membership-service';

export type ArenaRoomProposalErrorCode =
  | 'ROOM_CONFIG_FRAME_TOO_LARGE'
  | 'ROOM_EPOCH_STALE'
  | 'ROOM_OPERATION_UNKNOWN'
  | 'ROOM_PERMISSION_DENIED'
  | 'ROOM_PROPOSAL_CONFLICT'
  | 'ROOM_PROPOSAL_INPUT_INVALID'
  | 'ROOM_PROPOSAL_NOT_FOUND'
  | 'ROOM_PROPOSAL_PENDING_LIMIT_REACHED'
  | 'ROOM_REFERENCE_DENIED'
  | 'ROOM_REFERENCE_STALE'
  | 'ROOM_REFERENCE_UNAVAILABLE'
  | 'ROOM_REVISION_STALE'
  | 'ROOM_TRANSITION_DENIED';

export class ArenaRoomProposalError extends Error {
  constructor(readonly code: ArenaRoomProposalErrorCode) {
    super(code);
    this.name = 'ArenaRoomProposalError';
  }
}

export type ArenaRoomProposalMutationView = {
  readonly roomId: string;
  readonly roomEpoch: string;
  readonly controlSeq: number;
  readonly revision: number;
  readonly proposalId: string;
  readonly status: ArenaRoomProposalMutationStatus;
  readonly result: ArenaRoomProposalMutationResult;
};

export type ArenaRoomProposalService = {
  submit(input: {
    readonly roomId: string;
    readonly accountUserId: number;
    readonly request: unknown;
  }): Promise<ArenaRoomProposalMutationView>;
  resolve(input: {
    readonly roomId: string;
    readonly proposalId: string;
    readonly accountUserId: number;
    readonly request: unknown;
  }): Promise<ArenaRoomProposalMutationView>;
  withdraw(input: {
    readonly roomId: string;
    readonly proposalId: string;
    readonly accountUserId: number;
    readonly request: unknown;
  }): Promise<ArenaRoomProposalMutationView>;
};

export type ArenaRoomProposalServiceOptions = {
  readonly memberships: Pick<ArenaRoomMembershipService, 'resolveActiveByAccount'>;
  readonly references: ArenaDataCardRefVerifier;
  readonly presets?: Pick<ArenaRoomGenerationPresetResolver, 'resolve'>;
  readonly now?: () => string;
};

const fail = (code: ArenaRoomProposalErrorCode): never => {
  throw new ArenaRoomProposalError(code);
};

const validAccountUserId = (value: number): boolean => (
  Number.isSafeInteger(value) && value > 0
);

const parsePath = (value: string): string => {
  const parsed = ArenaProposalIdSchema.safeParse(value);
  if (!parsed.success || parsed.data !== value) return fail('ROOM_PROPOSAL_INPUT_INVALID');
  return parsed.data;
};

const monotonicTimestamp = (now: () => string, state: ArenaRoomAuthorityState): string => {
  const supplied = now();
  const suppliedTime = Date.parse(supplied);
  const updatedTime = Date.parse(state.lifecycle.updatedAt);
  if (!Number.isFinite(suppliedTime)) return fail('ROOM_PROPOSAL_INPUT_INVALID');
  return suppliedTime < updatedTime ? state.lifecycle.updatedAt : new Date(suppliedTime).toISOString();
};

const authority = (membership: ResolvedArenaRoomMembership) => ({
  kind: 'authenticated-user' as const,
  actorUserId: membership.member.userId,
  accountUserId: membership.accountUserId,
});

const sameIntent = (existing: ArenaProposal, intent: {
  readonly roomId: string;
  readonly authorUserId: string;
  readonly proposalId: string;
  readonly baseRevision: number;
  readonly changes: readonly ArenaProposalChange[];
}): boolean => (
  existing.proposalVersion === 1
  && existing.roomId === intent.roomId
  && existing.authorUserId === intent.authorUserId
  && existing.proposalId === intent.proposalId
  && existing.baseRevision === intent.baseRevision
  && existing.status === 'submitted'
  && JSON.stringify(existing.changes) === JSON.stringify(intent.changes)
);

const mutationView = (
  state: ArenaRoomAuthorityState,
  proposalId: string,
  status: ArenaRoomProposalMutationStatus,
  result: ArenaRoomProposalMutationResult,
): ArenaRoomProposalMutationView => ({
  roomId: state.snapshot.roomId,
  roomEpoch: state.snapshot.roomEpoch,
  controlSeq: state.snapshot.controlSeq,
  revision: state.snapshot.revision,
  proposalId,
  status,
  result,
});

const mapTransitionFailure = (failure: ArenaRoomTransitionFailure): never => {
  switch (failure.reason) {
    case 'room-epoch-mismatch': return fail('ROOM_EPOCH_STALE');
    case 'room-revision-mismatch': return fail('ROOM_REVISION_STALE');
    case 'host-required':
    case 'member-required':
    case 'proposal-author-required': return fail('ROOM_PERMISSION_DENIED');
    case 'proposal-not-found': return fail('ROOM_PROPOSAL_NOT_FOUND');
    case 'proposal-conflict':
    case 'proposal-id-conflict':
    case 'proposal-not-submitted':
    case 'proposal-selection-invalid': return fail('ROOM_PROPOSAL_CONFLICT');
    case 'proposal-pending-limit-reached':
      return fail('ROOM_PROPOSAL_PENDING_LIMIT_REACHED');
    case 'room-snapshot-too-large': return fail('ROOM_CONFIG_FRAME_TOO_LARGE');
    case 'invalid-command':
    case 'invalid-state': return fail('ROOM_PROPOSAL_INPUT_INVALID');
    default: return fail('ROOM_TRANSITION_DENIED');
  }
};

const mapReferenceError = (error: unknown): never => {
  if (!(error instanceof ArenaDataCardRefVerifierError)) throw error;
  switch (error.code) {
    case 'ARENA_DATA_CARD_REF_VERSION_MISMATCH': return fail('ROOM_REFERENCE_STALE');
    case 'ARENA_DATA_CARD_REF_NOT_READABLE': return fail('ROOM_REFERENCE_DENIED');
    case 'ARENA_DATA_CARD_REF_INPUT_INVALID': return fail('ROOM_PROPOSAL_INPUT_INVALID');
    default: return fail('ROOM_REFERENCE_UNAVAILABLE');
  }
};

const uniqueRefs = (refs: readonly DataCardRef[]): readonly DataCardRef[] => {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const identity = JSON.stringify([ref.id, ref.kind, ref.versionToken]);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

const presetChange = (change: ArenaProposalChange): boolean => (
  ('key' in change && typeof change.key === 'string' && change.key.startsWith('preset:'))
);

const introducedRefs = (changes: readonly ArenaProposalChange[]): readonly DataCardRef[] => (
  uniqueRefs(changes.flatMap((change) => {
    if (presetChange(change)) return [];
    switch (change.type) {
      case 'addCombatant':
      case 'addAuxScenario':
      case 'addMaterial': return [change.ref];
      case 'setScenario': return change.ref === null ? [] : [change.ref];
      default: return [];
    }
  }))
);

const introducedPresetRefs = (changes: readonly ArenaProposalChange[]): readonly DataCardRef[] => (
  uniqueRefs(changes.flatMap((change) => {
    if (!presetChange(change)) return [];
    switch (change.type) {
      case 'addCombatant':
      case 'addAuxScenario': return [change.ref];
      case 'setScenario': return change.ref === null ? [] : [change.ref];
      default: return [];
    }
  }))
);

const mapPresetReferenceError = (error: unknown): never => {
  if (!(error instanceof ArenaRoomPresetRefVerifierError)) throw error;
  switch (error.code) {
    case 'ARENA_ROOM_PRESET_REF_INPUT_INVALID': return fail('ROOM_PROPOSAL_INPUT_INVALID');
    case 'ARENA_ROOM_PRESET_REF_NOT_FOUND':
    case 'ARENA_ROOM_PRESET_REF_VERSION_MISMATCH': return fail('ROOM_REFERENCE_STALE');
    default: return fail('ROOM_REFERENCE_UNAVAILABLE');
  }
};

const hostAccountUserId = (state: ArenaRoomAuthorityState): number => {
  const host = state.memberAuthority.find((record) => (
    record.member.role === 'host' && record.member.membershipState === 'active'
  ));
  if (!host) return fail('ROOM_TRANSITION_DENIED');
  return host.accountUserId;
};

const requireEpoch = (state: ArenaRoomAuthorityState, expectedRoomEpoch: string): void => {
  if (state.snapshot.roomEpoch !== expectedRoomEpoch) fail('ROOM_EPOCH_STALE');
};

const requireRevision = (state: ArenaRoomAuthorityState, expectedRevision: number): void => {
  if (state.snapshot.revision !== expectedRevision) fail('ROOM_REVISION_STALE');
};

const executeOnce = async (
  membership: ResolvedArenaRoomMembership,
  command: unknown,
): Promise<ArenaRoomTransitionSuccess> => {
  let result;
  try {
    result = await membership.actor.execute({ authority: authority(membership), command });
  } catch {
    // A failed Redis acknowledgement can mean either committed or not committed.
    // Non-idempotent Proposal mutations are never replayed automatically.
    return fail('ROOM_OPERATION_UNKNOWN');
  }
  if (!result.ok) return mapTransitionFailure(result);
  return result;
};

const verifyRefs = async (
  references: ArenaDataCardRefVerifier,
  input: { readonly refs: readonly DataCardRef[]; readonly hostAccountUserId: number },
): Promise<void> => {
  if (input.refs.length === 0) return;
  try {
    await references.verify(input);
  } catch (error) {
    mapReferenceError(error);
  }
};

export const createArenaRoomProposalService = (
  options: ArenaRoomProposalServiceOptions,
): ArenaRoomProposalService => {
  const now = options.now ?? (() => new Date().toISOString());

  const resolveMembership = async (
    roomIdInput: string,
    accountUserId: number,
  ): Promise<ResolvedArenaRoomMembership> => {
    const roomId = parsePath(roomIdInput);
    if (!validAccountUserId(accountUserId)) return fail('ROOM_PROPOSAL_INPUT_INVALID');
    return options.memberships.resolveActiveByAccount({ roomId, accountUserId });
  };

  return Object.freeze({
    async submit(input) {
      const request = ArenaRoomProposalSubmitRequestSchema.safeParse(input.request);
      if (!request.success) return fail('ROOM_PROPOSAL_INPUT_INVALID');
      const membership = await resolveMembership(input.roomId, input.accountUserId);
      requireEpoch(membership.state, request.data.expectedRoomEpoch);
      if (membership.member.role !== 'member') return fail('ROOM_PERMISSION_DENIED');

      const intent = {
        roomId: membership.state.snapshot.roomId,
        authorUserId: membership.member.userId,
        proposalId: request.data.proposalId,
        baseRevision: request.data.baseRevision,
        changes: request.data.changes,
      };
      const existing = membership.state.snapshot.proposals.find((proposal) => (
        proposal.proposalId === request.data.proposalId
      ));
      if (existing) {
        if (!sameIntent(existing, intent)) return fail('ROOM_PROPOSAL_CONFLICT');
        return mutationView(membership.state, existing.proposalId, 'submitted', 'idempotent');
      }
      if (membership.state.terminalProposalIds.includes(request.data.proposalId)) {
        return fail('ROOM_PROPOSAL_CONFLICT');
      }

      await verifyRefs(options.references, {
        refs: introducedRefs(request.data.changes),
        hostAccountUserId: hostAccountUserId(membership.state),
      });
      try {
        await verifyArenaRoomPresetRefs({
          presets: options.presets,
          refs: introducedPresetRefs(request.data.changes),
        });
      } catch (error) {
        mapPresetReferenceError(error);
      }
      const timestamp = monotonicTimestamp(now, membership.state);
      const proposal = ArenaProposalSchema.parse({
        proposalVersion: 1,
        proposalId: request.data.proposalId,
        roomId: membership.state.snapshot.roomId,
        authorUserId: membership.member.userId,
        baseRevision: request.data.baseRevision,
        status: 'submitted',
        changes: request.data.changes,
        createdAt: timestamp,
      });

      let transition: ArenaRoomTransitionSuccess;
      try {
        transition = await executeOnce(membership, {
          type: 'submit-proposal',
          expectedRoomEpoch: request.data.expectedRoomEpoch,
          proposal,
          timestamp,
        });
      } catch (error) {
        if (!(error instanceof ArenaRoomProposalError) || error.code !== 'ROOM_PROPOSAL_CONFLICT') {
          throw error;
        }
        const current = membership.actor.getSnapshot();
        const raced = current?.snapshot.proposals.find((item) => item.proposalId === proposal.proposalId);
        if (current && raced && sameIntent(raced, intent)) {
          return mutationView(current, proposal.proposalId, 'submitted', 'idempotent');
        }
        throw error;
      }
      return mutationView(transition.nextState, proposal.proposalId, 'submitted', transition.kind);
    },

    async resolve(input) {
      const proposalId = parsePath(input.proposalId);
      const request = ArenaRoomProposalResolveRequestSchema.safeParse(input.request);
      if (!request.success) return fail('ROOM_PROPOSAL_INPUT_INVALID');
      const membership = await resolveMembership(input.roomId, input.accountUserId);
      requireEpoch(membership.state, request.data.expectedRoomEpoch);
      requireRevision(membership.state, request.data.expectedRevision);
      if (membership.member.role !== 'host') return fail('ROOM_PERMISSION_DENIED');
      const proposal = membership.state.snapshot.proposals.find((item) => item.proposalId === proposalId);
      if (!proposal) {
        return membership.state.terminalProposalIds.includes(proposalId)
          ? fail('ROOM_PROPOSAL_CONFLICT')
          : fail('ROOM_PROPOSAL_NOT_FOUND');
      }

      if (request.data.resolution === 'accept-selected') {
        const applied = applyArenaProposal({
          roomId: membership.state.snapshot.roomId,
          config: membership.state.snapshot.sharedConfig,
          revision: membership.state.snapshot.revision,
        }, proposal, request.data.selectedChangeIds);
        if (applied.status === 'rejected') return fail('ROOM_PROPOSAL_CONFLICT');
        await verifyRefs(options.references, {
          refs: canonicalArenaRoomSharedConfigRefs(applied.config),
          hostAccountUserId: membership.accountUserId,
        });
        try {
          await verifyArenaRoomSharedConfigPresetRefs({
            presets: options.presets,
            sharedConfig: applied.config,
          });
        } catch (error) {
          mapPresetReferenceError(error);
        }
      }

      const timestamp = monotonicTimestamp(now, membership.state);
      const transition = await executeOnce(membership, {
        type: 'resolve-proposal',
        expectedRoomEpoch: request.data.expectedRoomEpoch,
        expectedRevision: request.data.expectedRevision,
        proposalId,
        resolution: request.data.resolution,
        ...(request.data.selectedChangeIds === undefined
          ? {}
          : { selectedChangeIds: request.data.selectedChangeIds }),
        timestamp,
      });
      const event = transition.events.find((item) => (
        item.type === 'proposal.resolved' && item.payload.proposalId === proposalId
      ));
      if (!event || event.type !== 'proposal.resolved') return fail('ROOM_TRANSITION_DENIED');
      return mutationView(transition.nextState, proposalId, event.payload.status, transition.kind);
    },

    async withdraw(input) {
      const proposalId = parsePath(input.proposalId);
      const request = ArenaRoomProposalWithdrawRequestSchema.safeParse(input.request);
      if (!request.success) return fail('ROOM_PROPOSAL_INPUT_INVALID');
      const membership = await resolveMembership(input.roomId, input.accountUserId);
      requireEpoch(membership.state, request.data.expectedRoomEpoch);
      if (membership.member.role !== 'member') return fail('ROOM_PERMISSION_DENIED');
      const proposal = membership.state.snapshot.proposals.find((item) => item.proposalId === proposalId);
      if (!proposal) {
        return fail('ROOM_PROPOSAL_NOT_FOUND');
      }
      if (proposal.authorUserId !== membership.member.userId) {
        return fail('ROOM_PROPOSAL_NOT_FOUND');
      }

      const timestamp = monotonicTimestamp(now, membership.state);
      const transition = await executeOnce(membership, {
        type: 'withdraw-proposal',
        expectedRoomEpoch: request.data.expectedRoomEpoch,
        proposalId,
        timestamp,
      });
      const event = transition.events.find((item) => (
        item.type === 'proposal.resolved' && item.payload.proposalId === proposalId
      ));
      if (!event || event.type !== 'proposal.resolved') return fail('ROOM_TRANSITION_DENIED');
      return mutationView(transition.nextState, proposalId, event.payload.status, transition.kind);
    },
  });
};
