import {
  ArenaErrorCodeSchema,
  ArenaProposalSchema,
  ArenaRoomSharedConfigSchema,
  ArenaRoomSnapshotSchema,
  IsoTimestampSchema,
  MAX_PROPOSAL_CHANGES,
  OpaqueKeySchema,
  ParticipantUserIdsSchema,
  RoomMemberSchema,
  RoomRevisionSchema,
  WireReasonSchema,
  type ArenaErrorCode,
  type ArenaRoomSnapshot,
  type ControlRoomEvent,
} from '@mahoshojo/contracts/arena-room';
import { z } from 'zod';

import { ArenaMultiplayerCoreError } from './errors';

export const ArenaRoomLifecycleSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('open'),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  }).strict(),
  z.object({
    status: z.literal('closed'),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    closedAt: IsoTimestampSchema,
    closeReason: WireReasonSchema.optional(),
  }).strict(),
]);
export type ArenaRoomLifecycle = z.infer<typeof ArenaRoomLifecycleSchema>;

export const ArenaRoomAuthorityStateSchema = z.object({
  lifecycle: ArenaRoomLifecycleSchema,
  snapshot: ArenaRoomSnapshotSchema,
}).strict();
export type ArenaRoomAuthorityState = z.infer<typeof ArenaRoomAuthorityStateSchema>;

export interface ArenaRoomCheckpointPredecessor {
  readonly roomId: string;
  readonly roomEpoch: string;
  readonly revision: number;
  readonly controlSeq: number;
}

const expectedEpoch = {
  expectedRoomEpoch: OpaqueKeySchema,
};

const actorCommand = {
  actorUserId: OpaqueKeySchema,
  ...expectedEpoch,
  timestamp: IsoTimestampSchema,
};

export const CreateArenaRoomCommandSchema = z.object({
  type: z.literal('create'),
  roomId: OpaqueKeySchema,
  roomEpoch: OpaqueKeySchema,
  host: RoomMemberSchema,
  sharedConfig: ArenaRoomSharedConfigSchema,
  timestamp: IsoTimestampSchema,
}).strict();

export const JoinArenaRoomMemberCommandSchema = z.object({
  type: z.literal('join-member'),
  ...actorCommand,
  member: RoomMemberSchema,
}).strict();

export const LeaveArenaRoomMemberCommandSchema = z.object({
  type: z.literal('leave-member'),
  ...actorCommand,
}).strict();

export const KickArenaRoomMemberCommandSchema = z.object({
  type: z.literal('kick-member'),
  ...actorCommand,
  targetUserId: OpaqueKeySchema,
}).strict();

export const CloseArenaRoomCommandSchema = z.object({
  type: z.literal('close'),
  ...actorCommand,
  reason: WireReasonSchema.optional(),
}).strict();

export const PublishArenaRoomConfigCommandSchema = z.object({
  type: z.literal('publish-config'),
  ...actorCommand,
  expectedRevision: RoomRevisionSchema,
  sharedConfig: ArenaRoomSharedConfigSchema,
}).strict();

export const SubmitArenaRoomProposalCommandSchema = z.object({
  type: z.literal('submit-proposal'),
  ...actorCommand,
  proposal: ArenaProposalSchema,
}).strict();

export const ResolveArenaRoomProposalCommandSchema = z.object({
  type: z.literal('resolve-proposal'),
  ...actorCommand,
  proposalId: OpaqueKeySchema,
  resolution: z.enum(['accept-selected', 'reject']),
  selectedChangeIds: z.array(OpaqueKeySchema).max(MAX_PROPOSAL_CHANGES).optional(),
}).strict().superRefine((command, context) => {
  if (command.resolution === 'reject' && command.selectedChangeIds !== undefined) {
    context.addIssue({ code: 'custom', path: ['selectedChangeIds'], message: 'reject cannot select changes' });
  }
});

export const WithdrawArenaRoomProposalCommandSchema = z.object({
  type: z.literal('withdraw-proposal'),
  ...actorCommand,
  proposalId: OpaqueKeySchema,
}).strict();

export const ReserveArenaRoomGenerationCommandSchema = z.object({
  type: z.literal('reserve-generation'),
  ...actorCommand,
  expectedRevision: RoomRevisionSchema,
  generationRequestId: OpaqueKeySchema,
  generationId: OpaqueKeySchema,
  attempt: z.number().int().min(1),
  snapshotDigest: OpaqueKeySchema,
  collaborativeInfluence: z.boolean(),
  participantUserIds: ParticipantUserIdsSchema,
}).strict();

export const MirrorArenaRoomGenerationCommandSchema = z.object({
  type: z.literal('mirror-generation'),
  ...expectedEpoch,
  generationRequestId: OpaqueKeySchema,
  generationId: OpaqueKeySchema,
  attempt: z.number().int().min(1),
  state: z.enum(['running', 'completed', 'failed', 'cancelled']),
  generationRecordId: OpaqueKeySchema.optional(),
  errorCode: ArenaErrorCodeSchema.optional(),
  timestamp: IsoTimestampSchema,
}).strict().superRefine((command, context) => {
  if (command.state === 'completed' && command.generationRecordId === undefined) {
    context.addIssue({ code: 'custom', path: ['generationRecordId'], message: 'completed requires generationRecordId' });
  }
  if (command.state !== 'completed' && command.generationRecordId !== undefined) {
    context.addIssue({ code: 'custom', path: ['generationRecordId'], message: 'generationRecordId is completed-only' });
  }
  if (command.state === 'failed' && command.errorCode === undefined) {
    context.addIssue({ code: 'custom', path: ['errorCode'], message: 'failed requires errorCode' });
  }
  if (command.state !== 'failed' && command.errorCode !== undefined) {
    context.addIssue({ code: 'custom', path: ['errorCode'], message: 'errorCode is failed-only' });
  }
});

export const ArenaRoomCommandSchema = z.union([
  CreateArenaRoomCommandSchema,
  JoinArenaRoomMemberCommandSchema,
  LeaveArenaRoomMemberCommandSchema,
  KickArenaRoomMemberCommandSchema,
  CloseArenaRoomCommandSchema,
  PublishArenaRoomConfigCommandSchema,
  SubmitArenaRoomProposalCommandSchema,
  ResolveArenaRoomProposalCommandSchema,
  WithdrawArenaRoomProposalCommandSchema,
  ReserveArenaRoomGenerationCommandSchema,
  MirrorArenaRoomGenerationCommandSchema,
]);
/**
 * Server-normalized command contract. `actorUserId` and participant identities
 * MUST be injected by an authenticated server adapter, never trusted from a
 * client frame. This is intentionally not part of the public Room wire schema.
 */
export type ArenaRoomCommand = z.infer<typeof ArenaRoomCommandSchema>;

export type ArenaRoomTransitionFailureReason =
  | 'invalid-state'
  | 'invalid-command'
  | 'state-required'
  | 'state-already-exists'
  | 'room-epoch-mismatch'
  | 'room-revision-mismatch'
  | 'room-closed'
  | 'host-required'
  | 'member-required'
  | 'member-not-active'
  | 'member-limit-reached'
  | 'member-id-conflict'
  | 'proposal-id-conflict'
  | 'proposal-not-found'
  | 'proposal-not-submitted'
  | 'proposal-author-required'
  | 'proposal-selection-invalid'
  | 'proposal-conflict'
  | 'generation-active'
  | 'generation-request-conflict'
  | 'generation-identity-mismatch'
  | 'generation-attempt-mismatch'
  | 'generation-transition-invalid';

export interface ArenaRoomTransitionFailure {
  readonly ok: false;
  readonly code: ArenaErrorCode;
  readonly reason: ArenaRoomTransitionFailureReason;
}

export interface ArenaRoomTransitionSuccess {
  readonly ok: true;
  readonly kind: 'applied' | 'idempotent';
  readonly predecessor: ArenaRoomCheckpointPredecessor | null;
  readonly nextState: ArenaRoomAuthorityState;
  readonly events: readonly ControlRoomEvent[];
}

export type ArenaRoomTransitionResult = ArenaRoomTransitionSuccess | ArenaRoomTransitionFailure;

export const parseArenaRoomAuthorityState = (input: unknown): ArenaRoomAuthorityState => {
  const parsed = ArenaRoomAuthorityStateSchema.safeParse(input);
  if (!parsed.success) {
    throw new ArenaMultiplayerCoreError('invalid-input', 'invalid Arena Room authority state');
  }
  return parsed.data;
};

export const checkpointPredecessorOf = (
  state: ArenaRoomAuthorityState,
): ArenaRoomCheckpointPredecessor => ({
  roomId: state.snapshot.roomId,
  roomEpoch: state.snapshot.roomEpoch,
  revision: state.snapshot.revision,
  controlSeq: state.snapshot.controlSeq,
});

export const transitionFailure = (
  code: ArenaErrorCode,
  reason: ArenaRoomTransitionFailureReason,
): ArenaRoomTransitionFailure => ({ ok: false, code, reason });

export const transitionSuccess = (input: {
  readonly kind: ArenaRoomTransitionSuccess['kind'];
  readonly predecessor: ArenaRoomCheckpointPredecessor | null;
  readonly nextState: ArenaRoomAuthorityState;
  readonly events?: readonly ControlRoomEvent[];
}): ArenaRoomTransitionSuccess => ({
  ok: true,
  kind: input.kind,
  predecessor: input.predecessor,
  nextState: input.nextState,
  events: input.events ?? [],
});

export const parseAuthoritySnapshot = (snapshot: unknown): ArenaRoomSnapshot => ArenaRoomSnapshotSchema.parse(snapshot);
