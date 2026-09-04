import {
  ArenaErrorCodeSchema,
  ArenaProposalChangeSchema,
  ArenaProposalSchema,
  ArenaRoomSharedConfigSchema,
  ArenaRoomSnapshotSchema,
  DisplayNameSchema,
  GENERATION_BRIDGE_VERSION,
  GenerationBridgeScopeSchema,
  GenerationMirrorSchema,
  IsoTimestampSchema,
  MAX_PROPOSAL_CHANGES,
  OpaqueKeySchema,
  RoomMemberSchema,
  RoomEventSchema,
  RoomRevisionSchema,
  WireReasonSchema,
  type ArenaErrorCode,
  type ArenaRoomSnapshot,
  type ControlRoomEvent,
} from '@mahoshojo/contracts/arena-room';
import { z } from './zod';

import { ArenaMultiplayerCoreError } from './errors';
import { collaborativeChangeTarget, hasCollaborativeChangeEffect } from './provenance';

export const ARENA_ROOM_AUTHORITY_STATE_VERSION = 2 as const;

export const ArenaRoomLifecycleDeadlinesSchema = z.object({
  hostOfflineDeadline: IsoTimestampSchema.nullable(),
  roomIdleDeadline: IsoTimestampSchema.nullable(),
}).strict();
export type ArenaRoomLifecycleDeadlines = z.infer<typeof ArenaRoomLifecycleDeadlinesSchema>;

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

export const MAX_ROOM_MEMBER_AUTHORITY_RECORDS = 64;
export const MAX_ROOM_GENERATION_RECORDS = 64;
export const MAX_ROOM_PROPOSAL_TOMBSTONES = 256;
export const MAX_ROOM_COLLABORATIVE_CHANGES = 256;

export const CanonicalSnapshotDigestSchema = z.string()
  .regex(/^sha256:[0-9a-f]{64}$/u, 'must be a lowercase SHA-256 digest');

/**
 * Server-only membership tombstone. `revocationReason` distinguishes a
 * voluntary leave (`left`, rejoinable) from a host kick (`kicked`, fenced for
 * the room lifetime). Records revoked before this field existed carry no
 * reason and stay fail-closed: they can never be reactivated. The public
 * `RoomMember.membershipState` intentionally remains two-state.
 */
export const ArenaRoomMemberAuthorityRecordSchema = z.object({
  accountUserId: z.number().int().positive(),
  member: RoomMemberSchema,
  revocationReason: z.enum(['left', 'kicked']).optional(),
}).strict().superRefine((record, context) => {
  if (record.member.membershipState === 'active' && record.revocationReason !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['revocationReason'],
      message: 'active member authority must not carry a revocation reason',
    });
  }
});
export type ArenaRoomMemberAuthorityRecord = z.infer<typeof ArenaRoomMemberAuthorityRecordSchema>;

export const ArenaRoomGenerationRecordSchema = z.object({
  mirror: GenerationMirrorSchema,
  /**
   * Safe digest of the server-normalized generation semantic payload. Optional
   * only so checkpoints created before GMR-09 remediation remain readable;
   * such legacy records are never eligible for a historical provider retry.
   */
  generationPayloadDigest: CanonicalSnapshotDigestSchema.optional(),
  generationRecordId: OpaqueKeySchema.optional(),
  errorCode: ArenaErrorCodeSchema.optional(),
}).strict().superRefine((record, context) => {
  if (!CanonicalSnapshotDigestSchema.safeParse(record.mirror.snapshotDigest).success) {
    context.addIssue({
      code: 'custom',
      path: ['mirror', 'snapshotDigest'],
      message: 'authority generation records require a canonical snapshot digest',
    });
  }
  if (record.mirror.state === 'completed' && record.generationRecordId === undefined) {
    context.addIssue({ code: 'custom', path: ['generationRecordId'], message: 'completed requires generationRecordId' });
  }
  if (record.mirror.state !== 'completed' && record.generationRecordId !== undefined) {
    context.addIssue({ code: 'custom', path: ['generationRecordId'], message: 'generationRecordId is completed-only' });
  }
  if (record.mirror.state === 'failed' && record.errorCode === undefined) {
    context.addIssue({ code: 'custom', path: ['errorCode'], message: 'failed requires errorCode' });
  }
  if (record.mirror.state !== 'failed' && record.errorCode !== undefined) {
    context.addIssue({ code: 'custom', path: ['errorCode'], message: 'errorCode is failed-only' });
  }
});
export type ArenaRoomGenerationRecord = z.infer<typeof ArenaRoomGenerationRecordSchema>;

export const ArenaRoomAuthorityStateSchema = z.object({
  authorityStateVersion: z.literal(ARENA_ROOM_AUTHORITY_STATE_VERSION),
  lifecycle: ArenaRoomLifecycleSchema,
  deadlines: ArenaRoomLifecycleDeadlinesSchema,
  snapshot: ArenaRoomSnapshotSchema,
  memberAuthority: z.array(ArenaRoomMemberAuthorityRecordSchema)
    .max(MAX_ROOM_MEMBER_AUTHORITY_RECORDS),
  generationLedger: z.array(ArenaRoomGenerationRecordSchema)
    .max(MAX_ROOM_GENERATION_RECORDS),
  terminalProposalIds: z.array(OpaqueKeySchema)
    .max(MAX_ROOM_PROPOSAL_TOMBSTONES),
  collaborativeChanges: z.array(ArenaProposalChangeSchema)
    .max(MAX_ROOM_COLLABORATIVE_CHANGES),
}).strict().superRefine((state, context) => {
  const memberUserIds = state.memberAuthority.map((entry) => entry.member.userId);
  const accountUserIds = state.memberAuthority.map((entry) => entry.accountUserId);
  if (new Set(memberUserIds).size !== memberUserIds.length) {
    context.addIssue({ code: 'custom', path: ['memberAuthority'], message: 'member authority user IDs must be unique' });
  }
  if (new Set(accountUserIds).size !== accountUserIds.length) {
    context.addIssue({ code: 'custom', path: ['memberAuthority'], message: 'member authority account IDs must be unique' });
  }
  const activeAuthority = state.memberAuthority.filter((entry) => entry.member.membershipState === 'active');
  if (activeAuthority.length !== state.snapshot.members.length
    || state.snapshot.members.some((member) => {
      const authority = activeAuthority.find((entry) => entry.member.userId === member.userId);
      return !authority || JSON.stringify(authority.member) !== JSON.stringify(member);
    })) {
    context.addIssue({ code: 'custom', path: ['memberAuthority'], message: 'active member authority must match the public snapshot' });
  }
  const requestIds = state.generationLedger.map((entry) => entry.mirror.generationRequestId);
  const generationIds = state.generationLedger.map((entry) => entry.mirror.generationId);
  if (new Set(requestIds).size !== requestIds.length) {
    context.addIssue({ code: 'custom', path: ['generationLedger'], message: 'generation request IDs must be unique' });
  }
  if (new Set(generationIds).size !== generationIds.length) {
    context.addIssue({ code: 'custom', path: ['generationLedger'], message: 'generation IDs must be unique' });
  }
  if (state.snapshot.activeGeneration !== null) {
    const activeRecord = state.generationLedger.find((entry) => (
      entry.mirror.generationRequestId === state.snapshot.activeGeneration?.generationRequestId
    ));
    if (!activeRecord || JSON.stringify(activeRecord.mirror) !== JSON.stringify(state.snapshot.activeGeneration)) {
      context.addIssue({ code: 'custom', path: ['generationLedger'], message: 'active generation must match its authority record' });
    }
  }
  if (new Set(state.terminalProposalIds).size !== state.terminalProposalIds.length) {
    context.addIssue({ code: 'custom', path: ['terminalProposalIds'], message: 'terminal proposal IDs must be unique' });
  }
  const storedProposalIds = new Set(state.snapshot.proposals.map((proposal) => proposal.proposalId));
  if (state.snapshot.proposals.some((proposal) => proposal.status !== 'submitted')) {
    context.addIssue({
      code: 'custom',
      path: ['snapshot', 'proposals'],
      message: 'authority checkpoints may only retain submitted proposals',
    });
  }
  if (state.terminalProposalIds.some((proposalId) => storedProposalIds.has(proposalId))) {
    context.addIssue({
      code: 'custom',
      path: ['terminalProposalIds'],
      message: 'terminal proposal IDs must not remain in the public snapshot',
    });
  }
  if (!RoomEventSchema.safeParse({
    protocolVersion: state.snapshot.protocolVersion,
    roomId: state.snapshot.roomId,
    roomEpoch: state.snapshot.roomEpoch,
    type: 'room.snapshot',
    controlSeq: state.snapshot.controlSeq,
    timestamp: state.lifecycle.updatedAt,
    payload: state.snapshot,
  }).success) {
    context.addIssue({
      code: 'custom',
      path: ['snapshot'],
      message: 'authority snapshot must fit one valid control frame',
    });
  }
  state.collaborativeChanges.forEach((change, index) => {
    if (!hasCollaborativeChangeEffect(state.snapshot.sharedConfig, change)) {
      context.addIssue({
        code: 'custom',
        path: ['collaborativeChanges', index],
        message: 'collaborative provenance must still affect the current config',
      });
    }
  });
  const collaborativeTargets = state.collaborativeChanges.map(collaborativeChangeTarget);
  if (new Set(collaborativeTargets).size !== collaborativeTargets.length) {
    context.addIssue({ code: 'custom', path: ['collaborativeChanges'], message: 'collaborative provenance targets must be unique' });
  }
});
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

const epochCommand = {
  ...expectedEpoch,
  timestamp: IsoTimestampSchema,
};

export const ArenaRoomUserAuthorityContextSchema = z.object({
  kind: z.literal('authenticated-user'),
  actorUserId: OpaqueKeySchema,
  accountUserId: z.number().int().positive(),
}).strict();

export const ArenaRoomGenerationReservationScopeSchema = z.object({
  roomId: OpaqueKeySchema,
  roomEpoch: OpaqueKeySchema,
  configRevision: RoomRevisionSchema,
  generationRequestId: OpaqueKeySchema,
  generationId: OpaqueKeySchema,
  attempt: z.number().int().min(1),
  snapshotDigest: CanonicalSnapshotDigestSchema,
  generationPayloadDigest: CanonicalSnapshotDigestSchema,
  expiresAt: IsoTimestampSchema,
}).strict();

export const ArenaRoomGenerationReservationContextSchema = z.object({
  kind: z.literal('generation-reserver'),
  actorUserId: OpaqueKeySchema,
  accountUserId: z.number().int().positive(),
  scope: ArenaRoomGenerationReservationScopeSchema,
}).strict();

export const ArenaRoomGenerationPublisherScopeSchema = GenerationBridgeScopeSchema.extend({
  roomEpoch: OpaqueKeySchema,
});

export const ArenaRoomGenerationPublisherContextSchema = z.object({
  kind: z.literal('generation-publisher'),
  scope: ArenaRoomGenerationPublisherScopeSchema,
}).strict();

export const ArenaRoomRecoveryAuthorityContextSchema = z.object({
  kind: z.literal('room-recovery'),
  scope: z.object({
    roomId: OpaqueKeySchema,
    previousRoomEpoch: OpaqueKeySchema,
    nextRoomEpoch: OpaqueKeySchema,
    absentPresenceDeadlines: ArenaRoomLifecycleDeadlinesSchema,
    timestamp: IsoTimestampSchema,
  }).strict(),
}).strict();

export const ArenaRoomPresenceAuthorityContextSchema = z.object({
  kind: z.literal('room-presence'),
  scope: z.object({
    roomId: OpaqueKeySchema,
    roomEpoch: OpaqueKeySchema,
    deadlines: ArenaRoomLifecycleDeadlinesSchema,
    timestamp: IsoTimestampSchema,
  }).strict(),
}).strict();

export const ArenaRoomDeadlineCloseAuthorityContextSchema = z.object({
  kind: z.literal('room-deadline-closer'),
  scope: z.object({
    roomId: OpaqueKeySchema,
    roomEpoch: OpaqueKeySchema,
    deadlineKind: z.enum(['host-offline', 'room-idle']),
    deadline: IsoTimestampSchema,
  }).strict(),
}).strict();

export const ArenaRoomQuotaCloseAuthorityContextSchema = z.object({
  kind: z.literal('room-quota-closer'),
  scope: z.object({
    roomId: OpaqueKeySchema,
    roomEpoch: OpaqueKeySchema,
    timestamp: IsoTimestampSchema,
    reason: z.literal('room-incarnation-limit'),
  }).strict(),
}).strict();

export const ArenaRoomAuthorityContextSchema = z.discriminatedUnion('kind', [
  ArenaRoomUserAuthorityContextSchema,
  ArenaRoomGenerationReservationContextSchema,
  ArenaRoomGenerationPublisherContextSchema,
  ArenaRoomRecoveryAuthorityContextSchema,
  ArenaRoomPresenceAuthorityContextSchema,
  ArenaRoomDeadlineCloseAuthorityContextSchema,
  ArenaRoomQuotaCloseAuthorityContextSchema,
]);
/**
 * Trusted server capability, supplied separately from any client command. A
 * WSS/HTTP adapter MUST construct it only after authentication/authorization;
 * the generation-publisher variant MUST never be selectable by a client frame.
 */
export type ArenaRoomAuthorityContext = z.infer<typeof ArenaRoomAuthorityContextSchema>;

type GenerationReservationCapabilityInput = z.input<typeof ArenaRoomGenerationReservationScopeSchema> & {
  readonly actorUserId: string;
  readonly accountUserId: number;
};

type GenerationPublisherCapabilityInput = Omit<z.input<typeof ArenaRoomGenerationPublisherScopeSchema>, 'bridgeVersion'>;

const generationReservationCapabilities = new WeakSet<object>();
const generationPublisherCapabilities = new WeakSet<object>();
const roomRecoveryCapabilities = new WeakSet<object>();
const roomPresenceCapabilities = new WeakSet<object>();
const roomDeadlineCloseCapabilities = new WeakSet<object>();
const roomQuotaCloseCapabilities = new WeakSet<object>();

/** Issues an in-process capability that cannot survive wire serialization. */
export const issueArenaRoomGenerationReservationAuthority = (
  input: GenerationReservationCapabilityInput,
): Extract<ArenaRoomAuthorityContext, { kind: 'generation-reserver' }> => {
  const { actorUserId, accountUserId, ...scope } = input;
  const parsed = ArenaRoomGenerationReservationContextSchema.parse({
    kind: 'generation-reserver',
    actorUserId,
    accountUserId,
    scope,
  });
  const capability = Object.freeze({ ...parsed, scope: Object.freeze(parsed.scope) });
  generationReservationCapabilities.add(capability);
  return capability;
};

/** Issues a request-scoped Generation Bridge capability for a trusted adapter. */
export const issueArenaRoomGenerationPublisherAuthority = (
  input: GenerationPublisherCapabilityInput,
): Extract<ArenaRoomAuthorityContext, { kind: 'generation-publisher' }> => {
  const parsed = ArenaRoomGenerationPublisherContextSchema.parse({
    kind: 'generation-publisher',
    scope: { bridgeVersion: GENERATION_BRIDGE_VERSION, ...input },
  });
  const capability = Object.freeze({ ...parsed, scope: Object.freeze(parsed.scope) });
  generationPublisherCapabilities.add(capability);
  return capability;
};

/** Issues an in-process capability for one exact RoomActor epoch rollover. */
export const issueArenaRoomRecoveryAuthority = (
  input: z.input<typeof ArenaRoomRecoveryAuthorityContextSchema>['scope'],
): Extract<ArenaRoomAuthorityContext, { kind: 'room-recovery' }> => {
  const parsed = ArenaRoomRecoveryAuthorityContextSchema.parse({
    kind: 'room-recovery',
    scope: input,
  });
  const capability = Object.freeze({ ...parsed, scope: Object.freeze(parsed.scope) });
  roomRecoveryCapabilities.add(capability);
  return capability;
};

/** Issues an in-process capability for one exact durable presence projection. */
export const issueArenaRoomPresenceAuthority = (
  input: z.input<typeof ArenaRoomPresenceAuthorityContextSchema>['scope'],
): Extract<ArenaRoomAuthorityContext, { kind: 'room-presence' }> => {
  const parsed = ArenaRoomPresenceAuthorityContextSchema.parse({
    kind: 'room-presence',
    scope: input,
  });
  const capability = Object.freeze({
    ...parsed,
    scope: Object.freeze({
      ...parsed.scope,
      deadlines: Object.freeze(parsed.scope.deadlines),
    }),
  });
  roomPresenceCapabilities.add(capability);
  return capability;
};

/** Issues an in-process capability for one exact, already-persisted deadline. */
export const issueArenaRoomDeadlineCloseAuthority = (
  input: z.input<typeof ArenaRoomDeadlineCloseAuthorityContextSchema>['scope'],
): Extract<ArenaRoomAuthorityContext, { kind: 'room-deadline-closer' }> => {
  const parsed = ArenaRoomDeadlineCloseAuthorityContextSchema.parse({
    kind: 'room-deadline-closer',
    scope: input,
  });
  const capability = Object.freeze({ ...parsed, scope: Object.freeze(parsed.scope) });
  roomDeadlineCloseCapabilities.add(capability);
  return capability;
};

/** Issues an in-process capability for the runtime-mandated exact-fence quota close. */
export const issueArenaRoomQuotaCloseAuthority = (
  input: z.input<typeof ArenaRoomQuotaCloseAuthorityContextSchema>['scope'],
): Extract<ArenaRoomAuthorityContext, { kind: 'room-quota-closer' }> => {
  const parsed = ArenaRoomQuotaCloseAuthorityContextSchema.parse({
    kind: 'room-quota-closer',
    scope: input,
  });
  const capability = Object.freeze({ ...parsed, scope: Object.freeze(parsed.scope) });
  roomQuotaCloseCapabilities.add(capability);
  return capability;
};

export const parseArenaRoomAuthorityContext = (input: unknown): ArenaRoomAuthorityContext | null => {
  const parsed = ArenaRoomAuthorityContextSchema.safeParse(input);
  if (!parsed.success) return null;
  if (parsed.data.kind === 'authenticated-user') return parsed.data;
  if (typeof input !== 'object' || input === null) return null;
  if (parsed.data.kind === 'generation-reserver') {
    return generationReservationCapabilities.has(input) ? parsed.data : null;
  }
  if (parsed.data.kind === 'generation-publisher') {
    return generationPublisherCapabilities.has(input) ? parsed.data : null;
  }
  if (parsed.data.kind === 'room-recovery') {
    return roomRecoveryCapabilities.has(input) ? parsed.data : null;
  }
  if (parsed.data.kind === 'room-presence') {
    return roomPresenceCapabilities.has(input) ? parsed.data : null;
  }
  if (parsed.data.kind === 'room-deadline-closer') {
    return roomDeadlineCloseCapabilities.has(input) ? parsed.data : null;
  }
  return roomQuotaCloseCapabilities.has(input) ? parsed.data : null;
};

export const ArenaRoomTrustedTimeSchema = z.object({
  kind: z.literal('trusted-server-time'),
  now: IsoTimestampSchema,
}).strict();
export type ArenaRoomTrustedTime = z.infer<typeof ArenaRoomTrustedTimeSchema>;

const trustedTimeCapabilities = new WeakSet<object>();

/** Adapter-issued server time; client frames must never be parsed into it. */
export const issueArenaRoomTrustedTime = (input: { readonly now: string }): ArenaRoomTrustedTime => {
  const capability = Object.freeze(ArenaRoomTrustedTimeSchema.parse({
    kind: 'trusted-server-time',
    now: input.now,
  }));
  trustedTimeCapabilities.add(capability);
  return capability;
};

export const parseArenaRoomTrustedTime = (input: unknown): ArenaRoomTrustedTime | null => {
  const parsed = ArenaRoomTrustedTimeSchema.safeParse(input);
  if (!parsed.success || typeof input !== 'object' || input === null) return null;
  return trustedTimeCapabilities.has(input) ? parsed.data : null;
};

export const CreateArenaRoomCommandSchema = z.object({
  type: z.literal('create'),
  roomId: OpaqueKeySchema,
  roomEpoch: OpaqueKeySchema,
  host: RoomMemberSchema,
  sharedConfig: ArenaRoomSharedConfigSchema,
  deadlines: ArenaRoomLifecycleDeadlinesSchema,
  timestamp: IsoTimestampSchema,
}).strict();

export const JoinArenaRoomMemberCommandSchema = z.object({
  type: z.literal('join-member'),
  ...epochCommand,
  member: RoomMemberSchema,
}).strict();

export const LeaveArenaRoomMemberCommandSchema = z.object({
  type: z.literal('leave-member'),
  ...epochCommand,
}).strict();

/**
 * Server-normalized reactivation of a voluntarily-left membership. Identity
 * binding is derived from the existing authority record (same member userId),
 * never from the command; the command only supplies the fresh displayName.
 */
export const RejoinArenaRoomMemberCommandSchema = z.object({
  type: z.literal('rejoin-member'),
  ...epochCommand,
  displayName: DisplayNameSchema,
}).strict();

export const KickArenaRoomMemberCommandSchema = z.object({
  type: z.literal('kick-member'),
  ...epochCommand,
  targetUserId: OpaqueKeySchema,
}).strict();

export const CloseArenaRoomCommandSchema = z.object({
  type: z.literal('close'),
  ...epochCommand,
  reason: WireReasonSchema.optional(),
}).strict();

export const RecoverArenaRoomCommandSchema = z.object({
  type: z.literal('recover'),
  ...epochCommand,
  nextRoomEpoch: OpaqueKeySchema,
  absentPresenceDeadlines: ArenaRoomLifecycleDeadlinesSchema,
}).strict();

export const SyncArenaRoomPresenceCommandSchema = z.object({
  type: z.literal('sync-presence'),
  ...epochCommand,
  deadlines: ArenaRoomLifecycleDeadlinesSchema,
}).strict();

export const PublishArenaRoomConfigCommandSchema = z.object({
  type: z.literal('publish-config'),
  ...epochCommand,
  expectedRevision: RoomRevisionSchema,
  expectedControlSeq: z.number().int().nonnegative(),
  sharedConfig: ArenaRoomSharedConfigSchema,
}).strict();

export const SubmitArenaRoomProposalCommandSchema = z.object({
  type: z.literal('submit-proposal'),
  ...epochCommand,
  proposal: ArenaProposalSchema,
}).strict();

export const ResolveArenaRoomProposalCommandSchema = z.object({
  type: z.literal('resolve-proposal'),
  ...epochCommand,
  // Diagnostic only: the authoritative apply re-runs the staged typed
  // expectedBase merge on the latest state inside one atomic transition, so a
  //Proposal merged after unrelated revisions is still safe. Keeping the field
  // optional preserves older request payloads for diagnostics.
  expectedRevision: RoomRevisionSchema.optional(),
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
  ...epochCommand,
  proposalId: OpaqueKeySchema,
}).strict();

export const ReserveArenaRoomGenerationCommandSchema = z.object({
  type: z.literal('reserve-generation'),
  ...epochCommand,
  expectedRevision: RoomRevisionSchema,
  expectedControlSeq: z.number().int().nonnegative(),
  generationRequestId: OpaqueKeySchema,
  generationId: OpaqueKeySchema,
  attempt: z.number().int().min(1),
  generationPayloadDigest: CanonicalSnapshotDigestSchema,
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
  RejoinArenaRoomMemberCommandSchema,
  LeaveArenaRoomMemberCommandSchema,
  KickArenaRoomMemberCommandSchema,
  CloseArenaRoomCommandSchema,
  RecoverArenaRoomCommandSchema,
  SyncArenaRoomPresenceCommandSchema,
  PublishArenaRoomConfigCommandSchema,
  SubmitArenaRoomProposalCommandSchema,
  ResolveArenaRoomProposalCommandSchema,
  WithdrawArenaRoomProposalCommandSchema,
  ReserveArenaRoomGenerationCommandSchema,
  MirrorArenaRoomGenerationCommandSchema,
]);
/**
 * Server-normalized internal command contract. Actor identity/capability is a
 * separate ArenaRoomAuthorityContext and participant/provenance fields are
 * derived from authority state. This is not the public Room wire schema.
 */
export type ArenaRoomCommand = z.infer<typeof ArenaRoomCommandSchema>;

export const ARENA_ROOM_TRANSITION_FAILURE_REASONS = [
  'invalid-state',
  'invalid-command',
  'invalid-authority-context',
  'state-required',
  'state-already-exists',
  'room-epoch-mismatch',
  'room-epoch-reuse',
  'room-revision-mismatch',
  'room-control-seq-mismatch',
  'room-closed',
  'host-required',
  'member-required',
  'member-not-active',
  'member-limit-reached',
  'member-history-limit-reached',
  'member-id-conflict',
  'proposal-id-conflict',
  'proposal-pending-limit-reached',
  'proposal-history-limit-reached',
  'proposal-not-found',
  'proposal-not-submitted',
  'proposal-author-required',
  'proposal-selection-invalid',
  'proposal-conflict',
  'generation-active',
  'generation-history-limit-reached',
  'generation-request-conflict',
  'generation-id-conflict',
  'generation-identity-mismatch',
  'generation-attempt-mismatch',
  'generation-transition-invalid',
  'generation-terminal-conflict',
  'authority-scope-mismatch',
  'authority-scope-expired',
  'deadline-not-reached',
  'invalid-trusted-time',
  'command-timestamp-mismatch',
  'command-timestamp-regression',
  'collaborative-history-limit-reached',
  'room-snapshot-too-large',
] as const;
export type ArenaRoomTransitionFailureReason = (
  typeof ARENA_ROOM_TRANSITION_FAILURE_REASONS
)[number];

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

/**
 * Development-Gate v1 checkpoints predate durable presence deadlines. Migrating
 * an open room installs an already-due deadline so recovery terminates it
 * fail-closed instead of inventing presence after a process boundary.
 */
export const migrateArenaRoomAuthorityStateV1 = (
  input: unknown,
): ArenaRoomAuthorityState | null => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const legacy = input as Record<string, unknown>;
  if (legacy.authorityStateVersion !== 1 || 'deadlines' in legacy) return null;
  const lifecycle = legacy.lifecycle;
  if (typeof lifecycle !== 'object' || lifecycle === null || Array.isArray(lifecycle)) return null;
  const lifecycleRecord = lifecycle as Record<string, unknown>;
  const updatedAt = lifecycleRecord.updatedAt;
  if (typeof updatedAt !== 'string') return null;
  const open = lifecycleRecord.status === 'open';
  const parsed = ArenaRoomAuthorityStateSchema.safeParse({
    ...legacy,
    authorityStateVersion: ARENA_ROOM_AUTHORITY_STATE_VERSION,
    deadlines: {
      hostOfflineDeadline: open ? updatedAt : null,
      roomIdleDeadline: open ? updatedAt : null,
    },
  });
  return parsed.success ? parsed.data : null;
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

export const parseAuthoritySnapshot = (snapshot: unknown): ArenaRoomSnapshot => ArenaRoomSnapshotSchema.parse(snapshot);
