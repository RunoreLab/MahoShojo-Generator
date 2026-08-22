import { z } from 'zod';

import { ArenaContractError, ArenaErrorCodeSchema } from './errors';
import {
  MAX_CONTROL_FRAME_BYTES,
  MAX_CONTROL_MESSAGE_BYTES,
  MAX_PENDING_PROPOSALS_PER_MEMBER,
  MAX_ROOM_MEMBERS,
  MAX_STORY_BATCH_BYTES,
  MAX_STORY_FRAME_BYTES,
} from './limits';
import {
  ArenaProposalSchema,
  ArenaProposalStatusSchema,
} from './proposals';
import { ArenaRoomSharedConfigSchema } from './shared-config';
import {
  DisplayNameSchema,
  IsoTimestampSchema,
  OpaqueKeySchema,
  ParticipantUserIdsSchema,
  WireReasonSchema,
} from './primitives';
import {
  PROTOCOL_VERSION,
  ROOM_SNAPSHOT_SCHEMA_VERSION,
  isSupportedProtocolVersion,
} from './versions';
import {
  decodeRawJson,
  jsonUtf8ByteLength,
  rawUtf8ByteLength,
  type RawWireInput,
  utf8ByteLimitedStringSchema,
} from './wire-size';

export const RoomRevisionSchema = z.number().int().nonnegative();
export type RoomRevision = z.infer<typeof RoomRevisionSchema>;

/** Reconnect-only cursor; wire event envelopes use flat fields instead. */
export const RoomControlCursorSchema = z
  .object({
    roomEpoch: OpaqueKeySchema,
    controlSeq: z.number().int().nonnegative(),
  })
  .strict();
export type RoomControlCursor = z.infer<typeof RoomControlCursorSchema>;

/** Reconnect-only story cursor; story event envelopes use flat fields instead. */
export const StoryStreamCursorSchema = z
  .object({
    generationId: OpaqueKeySchema,
    chunkSeq: z.number().int().nonnegative(),
  })
  .strict();
export type StoryStreamCursor = z.infer<typeof StoryStreamCursorSchema>;

export const RoomMemberRoleSchema = z.enum(['host', 'member']);
export const RoomMembershipStateSchema = z.enum(['active', 'revoked']);

export const RoomMemberSchema = z
  .object({
    userId: OpaqueKeySchema,
    role: RoomMemberRoleSchema,
    displayName: DisplayNameSchema,
    membershipState: RoomMembershipStateSchema,
    joinedAt: IsoTimestampSchema.optional(),
  })
  .strict();
export type RoomMember = z.infer<typeof RoomMemberSchema>;

export const RoomConnectionSchema = z
  .object({
    connectionId: OpaqueKeySchema,
    userId: OpaqueKeySchema,
    connectedAt: IsoTimestampSchema,
    lastSeenAt: IsoTimestampSchema.optional(),
  })
  .strict();
export type RoomConnection = z.infer<typeof RoomConnectionSchema>;

export const GenerationStateSchema = z.enum(['starting', 'running', 'completed', 'failed', 'cancelled']);
export type GenerationState = z.infer<typeof GenerationStateSchema>;

export const GenerationMirrorSchema = z
  .object({
    generationRequestId: OpaqueKeySchema,
    generationId: OpaqueKeySchema,
    attempt: z.number().int().min(1),
    state: GenerationStateSchema,
    configRevision: RoomRevisionSchema,
    snapshotDigest: OpaqueKeySchema,
    collaborativeInfluence: z.boolean(),
    participantUserIds: ParticipantUserIdsSchema,
    startedAt: IsoTimestampSchema,
    finishedAt: IsoTimestampSchema.optional(),
  })
  .strict();
export type GenerationMirror = z.infer<typeof GenerationMirrorSchema>;

export const ArenaRoomSnapshotSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    schemaVersion: z.literal(ROOM_SNAPSHOT_SCHEMA_VERSION),
    roomId: OpaqueKeySchema,
    roomEpoch: OpaqueKeySchema,
    controlSeq: z.number().int().nonnegative(),
    revision: RoomRevisionSchema,
    sharedConfig: ArenaRoomSharedConfigSchema,
    members: z.array(RoomMemberSchema).max(MAX_ROOM_MEMBERS),
    proposals: z.array(ArenaProposalSchema).max(MAX_ROOM_MEMBERS * MAX_PENDING_PROPOSALS_PER_MEMBER).default([]),
    activeGeneration: GenerationMirrorSchema.nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const memberIds = snapshot.members.map((member) => member.userId);
    const activeHostCount = snapshot.members.filter((member) => member.role === 'host' && member.membershipState === 'active').length;
    if (new Set(memberIds).size !== memberIds.length) {
      context.addIssue({ code: 'custom', path: ['members'], message: 'member userId values must be unique' });
    }
    if (activeHostCount !== 1) {
      context.addIssue({ code: 'custom', path: ['members'], message: 'snapshot must contain exactly one active host' });
    }

    const pendingByMember = new Map<string, number>();
    const proposalIds = new Set<string>();
    snapshot.proposals.forEach((proposal) => {
      if (proposalIds.has(proposal.proposalId)) {
        context.addIssue({ code: 'custom', path: ['proposals'], message: 'proposalId values must be unique' });
      }
      proposalIds.add(proposal.proposalId);
      if (proposal.roomId !== snapshot.roomId) {
        context.addIssue({ code: 'custom', path: ['proposals'], message: 'proposal roomId must match snapshot roomId' });
      }
      if (!memberIds.includes(proposal.authorUserId)) {
        context.addIssue({ code: 'custom', path: ['proposals'], message: 'proposal authorUserId must reference a room member' });
      }
      if (proposal.status === 'accepted' || proposal.status === 'rejected' || proposal.status === 'withdrawn' || proposal.status === 'stale') return;
      const nextCount = (pendingByMember.get(proposal.authorUserId) ?? 0) + 1;
      pendingByMember.set(proposal.authorUserId, nextCount);
      if (nextCount > MAX_PENDING_PROPOSALS_PER_MEMBER) {
        context.addIssue({ code: 'custom', path: ['proposals'], message: 'pending proposals per member exceed the safety limit' });
      }
    });
  });
export type ArenaRoomSnapshot = z.infer<typeof ArenaRoomSnapshotSchema>;

const ControlEventBaseSchema = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  roomId: OpaqueKeySchema,
  roomEpoch: OpaqueKeySchema,
  controlSeq: z.number().int().nonnegative(),
  timestamp: IsoTimestampSchema,
};

export const RoomMemberEventPayloadSchema = z
  .object({
    member: RoomMemberSchema,
  })
  .strict();

const GenerationEventPayloadSchema = z
  .object({
    generationRequestId: OpaqueKeySchema,
    generationId: OpaqueKeySchema,
    attempt: z.number().int().min(1),
    configRevision: RoomRevisionSchema,
    snapshotDigest: OpaqueKeySchema,
    collaborativeInfluence: z.boolean(),
    participantUserIds: ParticipantUserIdsSchema,
  })
  .strict();

const GenerationCompletedPayloadSchema = GenerationEventPayloadSchema.extend({
  generationRecordId: OpaqueKeySchema,
}).strict();

const GenerationFailedPayloadSchema = GenerationEventPayloadSchema.extend({
  errorCode: ArenaErrorCodeSchema,
}).strict();

const StoryDeltaTextSchema = utf8ByteLimitedStringSchema(MAX_STORY_BATCH_BYTES);

export const RoomEventSchema = z.discriminatedUnion('type', [
  z.object({ ...ControlEventBaseSchema, type: z.literal('room.snapshot'), payload: ArenaRoomSnapshotSchema }).strict(),
  z.object({ ...ControlEventBaseSchema, type: z.literal('room.member.joined'), payload: RoomMemberEventPayloadSchema }).strict(),
  z.object({ ...ControlEventBaseSchema, type: z.literal('room.member.left'), payload: RoomMemberEventPayloadSchema }).strict(),
  z.object({ ...ControlEventBaseSchema, type: z.literal('room.host.offline'), payload: RoomMemberEventPayloadSchema }).strict(),
  z.object({ ...ControlEventBaseSchema, type: z.literal('room.host.online'), payload: RoomMemberEventPayloadSchema }).strict(),
  z.object({
    ...ControlEventBaseSchema,
    type: z.literal('room.config.updated'),
    payload: z.object({ revision: RoomRevisionSchema, sharedConfig: ArenaRoomSharedConfigSchema }).strict(),
  }).strict(),
  z.object({ ...ControlEventBaseSchema, type: z.literal('proposal.submitted'), payload: z.object({ proposal: ArenaProposalSchema }).strict() }).strict(),
  z.object({ ...ControlEventBaseSchema, type: z.literal('proposal.updated'), payload: z.object({ proposal: ArenaProposalSchema }).strict() }).strict(),
  z.object({
    ...ControlEventBaseSchema,
    type: z.literal('proposal.resolved'),
    payload: z.object({ proposalId: OpaqueKeySchema, status: ArenaProposalStatusSchema }).strict(),
  }).strict(),
  z.object({ ...ControlEventBaseSchema, type: z.literal('generation.started'), payload: GenerationEventPayloadSchema }).strict(),
  z.object({ ...ControlEventBaseSchema, type: z.literal('generation.completed'), payload: GenerationCompletedPayloadSchema }).strict(),
  z.object({ ...ControlEventBaseSchema, type: z.literal('generation.failed'), payload: GenerationFailedPayloadSchema }).strict(),
  z.object({
    ...ControlEventBaseSchema,
    type: z.literal('room.closing'),
    payload: z.object({ reason: WireReasonSchema.optional() }).strict(),
  }).strict(),
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('story.delta'),
    roomId: OpaqueKeySchema,
    roomEpoch: OpaqueKeySchema,
    /** Runtime allocates a fresh generationId for every attempt. */
    generationId: OpaqueKeySchema,
    chunkSeq: z.number().int().nonnegative(),
    timestamp: IsoTimestampSchema,
    payload: z.object({ delta: StoryDeltaTextSchema }).strict(),
  }).strict(),
]).superRefine((event, context) => {
  const frameLimit = event.type === 'story.delta' ? MAX_STORY_FRAME_BYTES : MAX_CONTROL_FRAME_BYTES;
  if (jsonUtf8ByteLength(event) > frameLimit) {
    context.addIssue({ code: 'custom', path: [], message: 'payload-too-large' });
  }

  if (event.type === 'room.snapshot') {
    if (event.payload.roomId !== event.roomId) {
      context.addIssue({ code: 'custom', path: ['payload', 'roomId'], message: 'snapshot roomId must match event roomId' });
    }
    if (event.payload.roomEpoch !== event.roomEpoch) {
      context.addIssue({ code: 'custom', path: ['payload', 'roomEpoch'], message: 'snapshot roomEpoch must match event roomEpoch' });
    }
    if (event.payload.controlSeq !== event.controlSeq) {
      context.addIssue({ code: 'custom', path: ['payload', 'controlSeq'], message: 'snapshot controlSeq must match event controlSeq' });
    }
  }

  if ((event.type === 'proposal.submitted' || event.type === 'proposal.updated') && event.payload.proposal.roomId !== event.roomId) {
    context.addIssue({ code: 'custom', path: ['payload', 'proposal', 'roomId'], message: 'proposal roomId must match event roomId' });
  }
});
export type RoomEvent = z.infer<typeof RoomEventSchema>;
export type ControlRoomEvent = Exclude<RoomEvent, { type: 'story.delta' }>;
/**
 * Room runtime allocates generationId uniquely for each generation attempt and
 * accepts story chunks only when it matches activeGeneration.generationId.
 * Multiplayer-core/Room state-machine tests own that runtime invariant.
 */
export type StoryDeltaEvent = Extract<RoomEvent, { type: 'story.delta' }>;

/** Canonical event schema; the envelope alias remains for wire-oriented callers. */
export const RoomEventEnvelopeSchema = RoomEventSchema;
export type RoomEventEnvelope = RoomEvent;

const frameLimitForEvent = (input: unknown): number => {
  if (input && typeof input === 'object' && !Array.isArray(input) && (input as { type?: unknown }).type === 'story.delta') {
    return MAX_STORY_FRAME_BYTES;
  }
  return MAX_CONTROL_FRAME_BYTES;
};

const parseWithContractError = <T>(parse: () => T, message: string): T => {
  try {
    return parse();
  } catch (error) {
    throw new ArenaContractError('validation-failed', message, undefined, error);
  }
};

export const parseArenaRoomSnapshot = (input: unknown): ArenaRoomSnapshot =>
  parseWithContractError(() => ArenaRoomSnapshotSchema.parse(input), 'invalid Arena room snapshot');

/**
 * Parses a canonical serialized object. It cannot account for bytes discarded
 * by a prior JSON decoder; use parseRoomEventFrame for raw wire input.
 */
export const parseRoomEvent = (input: unknown): RoomEvent => {
  if (jsonUtf8ByteLength(input) > frameLimitForEvent(input)) {
    throw new ArenaContractError('payload-too-large');
  }
  return parseWithContractError(() => RoomEventSchema.parse(input), 'invalid Arena room event');
};

export const serializedByteLength = (input: unknown): number => jsonUtf8ByteLength(input);

export const isControlMessageWithinLimit = (input: unknown): boolean =>
  serializedByteLength(input) <= MAX_CONTROL_MESSAGE_BYTES;

export const parseControlMessage = (input: unknown): ControlRoomEvent => {
  if (input && typeof input === 'object' && !Array.isArray(input) && (input as { type?: unknown }).type === 'story.delta') {
    throw new ArenaContractError('invalid-message', 'story.delta is not a control message');
  }
  if (serializedByteLength(input) > MAX_CONTROL_FRAME_BYTES) {
    throw new ArenaContractError('payload-too-large');
  }
  const parsed = parseRoomEvent(input);
  if (parsed.type === 'story.delta') {
    throw new ArenaContractError('invalid-message', 'story.delta is not a control message');
  }
  return parsed;
};

export const parseStoryEvent = (input: unknown): StoryDeltaEvent => {
  if (input && typeof input === 'object' && !Array.isArray(input) && (input as { type?: unknown }).type !== 'story.delta') {
    throw new ArenaContractError('invalid-message', 'control event is not a story event');
  }
  const parsed = parseRoomEvent(input);
  if (parsed.type !== 'story.delta') {
    throw new ArenaContractError('invalid-message', 'control event is not a story event');
  }
  return parsed;
};

const MAX_GENERAL_FRAME_BYTES = Math.max(MAX_CONTROL_FRAME_BYTES, MAX_STORY_FRAME_BYTES);

/** Parses a raw JSON room frame, enforcing raw bytes before JSON decoding. */
export const parseRoomEventFrame = (input: RawWireInput): RoomEvent => {
  if (rawUtf8ByteLength(input) > MAX_GENERAL_FRAME_BYTES) {
    throw new ArenaContractError('payload-too-large');
  }
  return parseRoomEvent(decodeRawJson(input));
};

/** Parses only a raw control frame; story.delta is rejected as invalid-message. */
export const parseControlMessageFrame = (input: RawWireInput): ControlRoomEvent => {
  if (rawUtf8ByteLength(input) > MAX_CONTROL_FRAME_BYTES) {
    throw new ArenaContractError('payload-too-large');
  }
  return parseControlMessage(decodeRawJson(input));
};

/** Parses only a raw story.delta frame, whose generationId is attempt-unique. */
export const parseStoryEventFrame = (input: RawWireInput): StoryDeltaEvent => {
  if (rawUtf8ByteLength(input) > MAX_STORY_FRAME_BYTES) {
    throw new ArenaContractError('payload-too-large');
  }
  return parseStoryEvent(decodeRawJson(input));
};

export const isStoryBatchWithinLimit = (input: unknown): boolean =>
  serializedByteLength(input) <= MAX_STORY_BATCH_BYTES;

export const isStoryFrameWithinLimit = (input: unknown): boolean =>
  serializedByteLength(input) <= MAX_STORY_FRAME_BYTES;

export const isSupportedRoomEventProtocol = (input: unknown): boolean => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const protocolVersion = (input as { protocolVersion?: unknown }).protocolVersion;
  return typeof protocolVersion === 'number' && isSupportedProtocolVersion(protocolVersion);
};
