import {
  ArenaRoomPublishConfigRequestSchema,
  OpaqueKeySchema,
  type ArenaRoomPublishConfigRequest,
} from '@mahoshojo/contracts/arena-room';
import {
  projectArenaRoomSnapshotForViewer,
  type ArenaRoomAuthorityState,
  type ArenaRoomTransitionFailure,
} from '@mahoshojo/multiplayer-core';

import {
  ArenaDataCardRefVerifierError,
  type ArenaDataCardRefVerifier,
} from './arena-data-card-ref-verifier';
import {
  ArenaRoomPresetRefVerifierError,
  verifyArenaRoomSharedConfigPresetRefs,
  verifyArenaRoomSharedConfigRefs,
} from './arena-room-shared-config-refs';
import type { ArenaRoomGenerationPresetResolver } from './room-generation-preset-registry';
import type {
  ArenaRoomMembershipService,
  ArenaRoomSessionView,
  ResolvedArenaRoomMembership,
} from './room-membership-service';

export type ArenaRoomConfigErrorCode =
  | 'ROOM_CONFIG_FRAME_TOO_LARGE'
  | 'ROOM_CONFIG_INPUT_INVALID'
  | 'ROOM_EPOCH_STALE'
  | 'ROOM_OPERATION_UNKNOWN'
  | 'ROOM_PERMISSION_DENIED'
  | 'ROOM_REFERENCE_DENIED'
  | 'ROOM_REFERENCE_STALE'
  | 'ROOM_REFERENCE_UNAVAILABLE'
  | 'ROOM_REVISION_STALE'
  | 'ROOM_TRANSITION_DENIED';

export class ArenaRoomConfigError extends Error {
  constructor(readonly code: ArenaRoomConfigErrorCode) {
    super(code);
    this.name = 'ArenaRoomConfigError';
  }
}

export type ArenaRoomConfigService = {
  publish(input: {
    readonly roomId: string;
    readonly accountUserId: number;
    readonly request: ArenaRoomPublishConfigRequest | unknown;
  }): Promise<ArenaRoomSessionView>;
};

export type ArenaRoomConfigServiceOptions = {
  readonly memberships: Pick<ArenaRoomMembershipService, 'resolveActiveByAccount'>;
  readonly references?: ArenaDataCardRefVerifier;
  readonly presets?: Pick<ArenaRoomGenerationPresetResolver, 'resolve'>;
  readonly now?: () => string;
};

const fail = (code: ArenaRoomConfigErrorCode): never => {
  throw new ArenaRoomConfigError(code);
};

const validAccountUserId = (value: number): boolean => (
  Number.isSafeInteger(value) && value > 0
);

const sessionView = (
  membership: ResolvedArenaRoomMembership,
  state: ArenaRoomAuthorityState,
): ArenaRoomSessionView => ({
  roomId: state.snapshot.roomId,
  roomEpoch: state.snapshot.roomEpoch,
  member: structuredClone(membership.member),
  snapshot: projectArenaRoomSnapshotForViewer(state.snapshot, membership.member.userId),
});

const monotonicTimestamp = (now: () => string, state: ArenaRoomAuthorityState): string => {
  const supplied = Date.parse(now());
  const current = Date.parse(state.lifecycle.updatedAt);
  if (!Number.isFinite(supplied)) return fail('ROOM_CONFIG_INPUT_INVALID');
  return new Date(Math.max(supplied, current)).toISOString();
};

const mapTransitionFailure = (failure: ArenaRoomTransitionFailure): never => {
  switch (failure.reason) {
    case 'room-epoch-mismatch': return fail('ROOM_EPOCH_STALE');
    case 'room-revision-mismatch': return fail('ROOM_REVISION_STALE');
    case 'room-control-seq-mismatch': return fail('ROOM_REVISION_STALE');
    case 'host-required':
    case 'member-not-active': return fail('ROOM_PERMISSION_DENIED');
    case 'invalid-command':
    case 'invalid-state': return fail('ROOM_CONFIG_INPUT_INVALID');
    case 'room-snapshot-too-large': return fail('ROOM_CONFIG_FRAME_TOO_LARGE');
    default: return fail('ROOM_TRANSITION_DENIED');
  }
};

const mapReferenceError = (error: unknown): never => {
  if (!(error instanceof ArenaDataCardRefVerifierError)) throw error;
  switch (error.code) {
    case 'ARENA_DATA_CARD_REF_VERSION_MISMATCH': return fail('ROOM_REFERENCE_STALE');
    case 'ARENA_DATA_CARD_REF_NOT_READABLE': return fail('ROOM_REFERENCE_DENIED');
    case 'ARENA_DATA_CARD_REF_INPUT_INVALID': return fail('ROOM_CONFIG_INPUT_INVALID');
    default: return fail('ROOM_REFERENCE_UNAVAILABLE');
  }
};

const mapPresetReferenceError = (error: unknown): never => {
  if (!(error instanceof ArenaRoomPresetRefVerifierError)) throw error;
  switch (error.code) {
    case 'ARENA_ROOM_PRESET_REF_INPUT_INVALID': return fail('ROOM_CONFIG_INPUT_INVALID');
    case 'ARENA_ROOM_PRESET_REF_NOT_FOUND':
    case 'ARENA_ROOM_PRESET_REF_VERSION_MISMATCH': return fail('ROOM_REFERENCE_STALE');
    default: return fail('ROOM_REFERENCE_UNAVAILABLE');
  }
};

export const createArenaRoomConfigService = (
  options: ArenaRoomConfigServiceOptions,
): ArenaRoomConfigService => {
  const now = options.now ?? (() => new Date().toISOString());

  return Object.freeze({
    async publish(input) {
      const roomId = OpaqueKeySchema.safeParse(input.roomId);
      const request = ArenaRoomPublishConfigRequestSchema.safeParse(input.request);
      if (!roomId.success || !validAccountUserId(input.accountUserId) || !request.success) {
        return fail('ROOM_CONFIG_INPUT_INVALID');
      }
      const membership = await options.memberships.resolveActiveByAccount({
        roomId: roomId.data,
        accountUserId: input.accountUserId,
      });
      const current = membership.state;
      if (current.snapshot.roomEpoch !== request.data.expectedRoomEpoch) {
        return fail('ROOM_EPOCH_STALE');
      }
      if (current.snapshot.revision !== request.data.expectedRevision) {
        return fail('ROOM_REVISION_STALE');
      }
      if (current.snapshot.controlSeq !== request.data.expectedControlSeq) {
        return fail('ROOM_REVISION_STALE');
      }
      if (membership.member.role !== 'host' || membership.member.membershipState !== 'active') {
        return fail('ROOM_PERMISSION_DENIED');
      }
      try {
        await verifyArenaRoomSharedConfigRefs({
          references: options.references,
          sharedConfig: request.data.sharedConfig,
          hostAccountUserId: membership.accountUserId,
        });
      } catch (error) {
        mapReferenceError(error);
      }
      try {
        await verifyArenaRoomSharedConfigPresetRefs({
          presets: options.presets,
          sharedConfig: request.data.sharedConfig,
        });
      } catch (error) {
        mapPresetReferenceError(error);
      }
      let result;
      try {
        result = await membership.actor.execute({
          authority: {
            kind: 'authenticated-user',
            actorUserId: membership.member.userId,
            accountUserId: membership.accountUserId,
          },
          command: {
            type: 'publish-config',
            expectedRoomEpoch: request.data.expectedRoomEpoch,
            expectedRevision: request.data.expectedRevision,
            expectedControlSeq: request.data.expectedControlSeq,
            sharedConfig: request.data.sharedConfig,
            timestamp: monotonicTimestamp(now, current),
          },
        });
      } catch {
        return fail('ROOM_OPERATION_UNKNOWN');
      }
      if (!result.ok) return mapTransitionFailure(result);
      return sessionView(membership, result.nextState);
    },
  });
};
