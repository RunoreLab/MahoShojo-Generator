import { z } from './zod';

import { ARENA_ROOM_HTTP_ERROR_CODES } from './arena-error-taxonomy';

import {
  ArenaRoomSnapshotSchema,
  GenerationMirrorSchema,
  GenerationStateSchema,
  RoomMemberSchema,
  RoomRevisionSchema,
} from './protocol';
import {
  BattleModeSchema,
  DataCardKindSchema,
  DisplayNameSchema,
  GlobalGuidanceSchema,
  GuidanceSchema,
  HostLocalObjectKeySchema,
  IsoTimestampSchema,
  LanguageSchema,
  OpaqueKeySchema,
  StableObjectKeySchema,
  WireErrorMessageSchema,
  WireReasonSchema,
} from './primitives';
import {
  ArenaProposalIdSchema,
  ArenaProposalChangesSchema,
  ResolvedArenaProposalStatusSchema,
} from './proposals';
import {
  MAX_ARENA_REFERENCE_ITEMS,
  MAX_COMBATANTS,
  MAX_PROPOSAL_CHANGES,
} from './limits';
import { SafeJsonValueSchema } from './json-value';
import { BattleReportAdjudicationResultSchema } from './battle-report-render-snapshot';
import {
  RoomDirectoryTitleSchema,
  RoomDirectoryVisibilitySchema,
} from './room-directory';
import { ArenaRoomSharedConfigSchema } from './shared-config';
import { PROTOCOL_VERSION } from './versions';
import {
  ARENA_ROOM_WEBSOCKET_PROTOCOL,
  ARENA_ROOM_WEBSOCKET_PATH,
  RoomReconnectCursorSchema,
} from './websocket-transport';

export const ARENA_ROOM_HTTP_BASE_PATH = '/api/arena/rooms/v1';
export const ARENA_ROOM_HTTP_ROUTES = Object.freeze({
  collection: ARENA_ROOM_HTTP_BASE_PATH,
  join: `${ARENA_ROOM_HTTP_BASE_PATH}/:roomId/join`,
  session: `${ARENA_ROOM_HTTP_BASE_PATH}/:roomId/session`,
  ticket: `${ARENA_ROOM_HTTP_BASE_PATH}/:roomId/ticket`,
  leave: `${ARENA_ROOM_HTTP_BASE_PATH}/:roomId/leave`,
  close: `${ARENA_ROOM_HTTP_BASE_PATH}/:roomId/close`,
  config: `${ARENA_ROOM_HTTP_BASE_PATH}/:roomId/config`,
  proposals: `${ARENA_ROOM_HTTP_BASE_PATH}/:roomId/proposals`,
  proposalResolve: `${ARENA_ROOM_HTTP_BASE_PATH}/:roomId/proposals/:proposalId/resolve`,
  proposalWithdraw: `${ARENA_ROOM_HTTP_BASE_PATH}/:roomId/proposals/:proposalId/withdraw`,
  generations: `${ARENA_ROOM_HTTP_BASE_PATH}/:roomId/generations`,
  generation: `${ARENA_ROOM_HTTP_BASE_PATH}/:roomId/generations/:generationId`,
  generationCancel: `${ARENA_ROOM_HTTP_BASE_PATH}/:roomId/generations/:generationId/cancel`,
  memberKick: `${ARENA_ROOM_HTTP_BASE_PATH}/:roomId/members/:targetUserId/kick`,
});

export const MAX_ARENA_ROOM_HTTP_TICKET_BYTES = 4_096;
export const MAX_ARENA_ROOM_GENERATION_START_BYTES = 12 * 1_024 * 1_024;
export const MAX_ARENA_ROOM_GENERATION_MARKDOWN_LENGTH = 12 * 1_024 * 1_024;
export const MAX_ARENA_ROOM_GENERATION_HISTORY_ITEMS = 64;

export const ArenaGenerationRequestIdSchema = z.string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u);

export const ArenaRoomCreationRequestIdSchema = z.string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u);

export const ArenaRoomCreateRequestSchema = z.object({
  creationRequestId: ArenaRoomCreationRequestIdSchema,
  displayName: DisplayNameSchema,
  directory: z.object({
    title: RoomDirectoryTitleSchema,
    visibility: RoomDirectoryVisibilitySchema,
  }).strict(),
  sharedConfig: ArenaRoomSharedConfigSchema,
}).strict();

export const ArenaRoomJoinRequestSchema = z.object({
  displayName: DisplayNameSchema,
}).strict();

export const ArenaRoomTicketRequestSchema = z.object({
  reconnect: RoomReconnectCursorSchema.optional(),
}).strict();

export const ArenaRoomEpochMutationRequestSchema = z.object({
  expectedRoomEpoch: OpaqueKeySchema,
}).strict();

export const ArenaRoomMemberKickRequestSchema = z.object({
  expectedRoomEpoch: OpaqueKeySchema,
}).strict();

export const ArenaRoomGenerationCancelRequestSchema = z.object({
  expectedRoomEpoch: OpaqueKeySchema,
}).strict();

export const ArenaRoomPublishConfigRequestSchema = z.object({
  expectedRoomEpoch: OpaqueKeySchema,
  expectedRevision: RoomRevisionSchema,
  expectedControlSeq: z.number().int().nonnegative().optional(),
  sharedConfig: ArenaRoomSharedConfigSchema,
}).strict();

/** Client intent only; authority/provenance fields are injected by the server. */
export const ArenaRoomProposalSubmitRequestSchema = z.object({
  proposalId: ArenaProposalIdSchema,
  expectedRoomEpoch: OpaqueKeySchema,
  baseRevision: RoomRevisionSchema,
  changes: ArenaProposalChangesSchema,
}).strict();

export const ArenaRoomProposalResolveRequestSchema = z.object({
  expectedRoomEpoch: OpaqueKeySchema,
  expectedRevision: RoomRevisionSchema,
  resolution: z.enum(['accept-selected', 'reject']),
  selectedChangeIds: z.array(OpaqueKeySchema).max(MAX_PROPOSAL_CHANGES).optional(),
}).strict().superRefine((request, context) => {
  if (request.resolution === 'reject' && request.selectedChangeIds !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['selectedChangeIds'],
      message: 'reject cannot select changes',
    });
  }
});

export const ArenaRoomProposalWithdrawRequestSchema = z.object({
  expectedRoomEpoch: OpaqueKeySchema,
}).strict();

export const MAX_ARENA_ROOM_HOST_LOCAL_PAYLOADS = (
  MAX_COMBATANTS + MAX_ARENA_REFERENCE_ITEMS + 1
);

const SafeJsonObjectSchema = SafeJsonValueSchema.refine(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  { message: 'payload must be a plain JSON object' },
);

export const ArenaRoomHostLocalPayloadSchema = z.object({
  key: HostLocalObjectKeySchema,
  kind: DataCardKindSchema,
  payload: SafeJsonObjectSchema,
}).strict();

/**
 * Only request-scoped host runtime/local/deferred fields are accepted here.
 * Every Room-shared semantic is rebuilt from the frozen Shared Config.
 */
export const ArenaRoomHostRuntimeGenerationSchema = z.object({
  arenaFreeRankingEnabled: z.boolean().optional(),
  customProvider: SafeJsonValueSchema.optional(),
  isDowngrade: z.boolean().optional(),
  narrativeHistory: SafeJsonValueSchema.optional(),
  adjudicationEvents: SafeJsonValueSchema.optional(),
  questionnaireSelections: SafeJsonValueSchema.optional(),
  questionnaires: SafeJsonValueSchema.optional(),
}).strict();

/** Request-scoped payloads MUST NOT enter Room durable/wire state. */
export const ArenaRoomGenerationStartRequestSchema = z.object({
  expectedRoomEpoch: OpaqueKeySchema,
  expectedRevision: RoomRevisionSchema,
  expectedControlSeq: z.number().int().nonnegative().optional(),
  generationRequestId: ArenaGenerationRequestIdSchema,
  sharedConfig: ArenaRoomSharedConfigSchema,
  hostLocalPayloads: z.array(ArenaRoomHostLocalPayloadSchema)
    .max(MAX_ARENA_ROOM_HOST_LOCAL_PAYLOADS),
  generation: ArenaRoomHostRuntimeGenerationSchema,
}).strict().superRefine((request, context) => {
  const keys = request.hostLocalPayloads.map((entry) => entry.key);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({
      code: 'custom',
      path: ['hostLocalPayloads'],
      message: 'host-local payload keys must be unique',
    });
  }
});

export const ArenaRoomGenerationProjectionStatusSchema = z.enum([
  'reserved',
  'running',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
  'producer_lost',
]);

export const ArenaRoomGenerationHistoryItemSchema = z.object({
  generationId: OpaqueKeySchema,
  state: GenerationStateSchema,
  configRevision: RoomRevisionSchema,
  collaborativeInfluence: z.boolean(),
  startedAt: IsoTimestampSchema,
  finishedAt: IsoTimestampSchema.optional(),
}).strict();

export const ArenaRoomGenerationHistoryResponseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  roomId: OpaqueKeySchema,
  roomEpoch: OpaqueKeySchema,
  items: z.array(ArenaRoomGenerationHistoryItemSchema)
    .max(MAX_ARENA_ROOM_GENERATION_HISTORY_ITEMS),
}).strict();

const ArenaRoomGenerationUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  cachedTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
}).strict();

export const ArenaRoomGenerationResultSchema = z.object({
  version: z.literal(1),
  format: z.literal('stream-markdown'),
  reporterInfo: z.object({
    name: z.string().max(300),
    publication: z.string().max(300),
  }).strict().optional(),
  mode: BattleModeSchema,
  scenarioDisplayName: DisplayNameSchema.optional(),
  sharedGuidance: GlobalGuidanceSchema.optional(),
  characterGuidances: z.array(z.object({
    combatantKey: StableObjectKeySchema,
    displayName: DisplayNameSchema,
    guidance: GuidanceSchema,
  }).strict()).max(MAX_COMBATANTS).optional(),
  language: LanguageSchema.optional(),
  storyLength: z.string().trim().min(1).max(32).optional(),
  adjudicationResults: z.array(BattleReportAdjudicationResultSchema).max(2_100).optional(),
  narrativeHistoryReadCount: z.number().int().nonnegative().max(1_000_000).optional(),
  report: z.object({
    headline: z.string().max(300).optional(),
    winner: z.string().max(300).optional(),
  }).strict().optional(),
  ai: z.object({
    model: z.string().max(256).optional(),
    usage: ArenaRoomGenerationUsageSchema.optional(),
  }).strict().optional(),
  combatantUpdates: z.array(z.object({
    combatantKey: StableObjectKeySchema,
    displayName: DisplayNameSchema,
    impact: z.string().max(2_000).optional(),
    currentStateSummary: z.string().max(2_000).optional(),
  }).strict()).max(MAX_COMBATANTS).optional(),
}).strict();

export const ArenaRoomGenerationHistoryViewResponseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  roomId: OpaqueKeySchema,
  roomEpoch: OpaqueKeySchema,
  generation: ArenaRoomGenerationHistoryItemSchema.extend({ state: z.literal('completed') }),
  status: z.literal('completed'),
  contentStatus: z.enum(['available', 'expired', 'not-archived']),
  markdown: z.string().max(MAX_ARENA_ROOM_GENERATION_MARKDOWN_LENGTH),
  result: ArenaRoomGenerationResultSchema.optional(),
}).strict().superRefine((response, context) => {
  if (response.contentStatus === 'available' && response.result === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['result'],
      message: 'available completed history must include a room-safe result',
    });
  }
  if (response.contentStatus !== 'available' && response.result !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['result'],
      message: 'unavailable historical content cannot expose a result',
    });
  }
  if (response.contentStatus !== 'available' && response.markdown !== '') {
    context.addIssue({
      code: 'custom',
      path: ['markdown'],
      message: 'unavailable historical content cannot expose markdown',
    });
  }
});

export const ArenaRoomGenerationViewResponseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  roomId: OpaqueKeySchema,
  roomEpoch: OpaqueKeySchema,
  generation: GenerationMirrorSchema,
  status: ArenaRoomGenerationProjectionStatusSchema,
  markdown: z.string().max(MAX_ARENA_ROOM_GENERATION_MARKDOWN_LENGTH),
  nextChunkSeq: z.number().int().nonnegative(),
  finalAuthoritative: z.boolean(),
  generationRecordId: OpaqueKeySchema.optional(),
  result: ArenaRoomGenerationResultSchema.optional(),
  errorCode: WireReasonSchema.optional(),
}).strict().superRefine((response, context) => {
  const expectedMirrorState = (() => {
    switch (response.status) {
      case 'reserved': return 'starting' as const;
      case 'running':
      case 'finalizing': return 'running' as const;
      case 'completed': return 'completed' as const;
      case 'failed':
      case 'producer_lost': return 'failed' as const;
      case 'cancelled': return 'cancelled' as const;
    }
  })();
  if (response.generation.state !== expectedMirrorState) {
    context.addIssue({
      code: 'custom',
      path: ['generation', 'state'],
      message: 'generation mirror state must match authoritative projection status',
    });
  }
  if (response.status === 'completed') {
    if (
      !response.finalAuthoritative
      || response.generationRecordId === undefined
      || response.result === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['finalAuthoritative'],
        message: 'completed projection must identify authoritative final content',
      });
    }
  } else if (
    response.finalAuthoritative
    || response.generationRecordId !== undefined
    || response.result !== undefined
  ) {
    context.addIssue({
      code: 'custom',
      path: ['generationRecordId'],
      message: 'only completed projection may expose an authoritative generation record',
    });
  }
  const requiresError = response.status === 'failed' || response.status === 'producer_lost';
  if (requiresError !== (response.errorCode !== undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['errorCode'],
      message: 'failed projection must expose exactly one stable error code',
    });
  }
});

export const ArenaRoomSessionResponseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  roomId: OpaqueKeySchema,
  roomEpoch: OpaqueKeySchema,
  self: RoomMemberSchema,
  snapshot: ArenaRoomSnapshotSchema,
}).strict().superRefine((response, context) => {
  if (response.snapshot.roomId !== response.roomId) {
    context.addIssue({
      code: 'custom',
      path: ['snapshot', 'roomId'],
      message: 'snapshot roomId must match response roomId',
    });
  }
  if (response.snapshot.roomEpoch !== response.roomEpoch) {
    context.addIssue({
      code: 'custom',
      path: ['snapshot', 'roomEpoch'],
      message: 'snapshot roomEpoch must match response roomEpoch',
    });
  }
  const current = response.snapshot.members.find((member) => member.userId === response.self.userId);
  if (!current || current.membershipState !== 'active' || !RoomMemberSchema.safeParse(current).success) {
    context.addIssue({
      code: 'custom',
      path: ['self'],
      message: 'self must reference an active snapshot member',
    });
    return;
  }
  if (JSON.stringify(current) !== JSON.stringify(response.self)) {
    context.addIssue({
      code: 'custom',
      path: ['self'],
      message: 'self must match the current snapshot member',
    });
  }
});

export const ArenaRoomTicketResponseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  ticket: z.string().trim().min(1).max(MAX_ARENA_ROOM_HTTP_TICKET_BYTES),
  expiresInSeconds: z.number().int().min(1).max(60),
  websocket: z.object({
    path: z.literal(ARENA_ROOM_WEBSOCKET_PATH),
    protocol: z.literal(ARENA_ROOM_WEBSOCKET_PROTOCOL),
  }).strict(),
}).strict();

export const ArenaRoomLeaveResponseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  roomId: OpaqueKeySchema,
  outcome: z.enum(['left', 'closed']),
}).strict();

export const ArenaRoomProposalMutationStatusSchema = z.union([
  z.literal('submitted'),
  ResolvedArenaProposalStatusSchema,
]);

export const ArenaRoomProposalMutationResultSchema = z.enum(['applied', 'idempotent']);

export const ArenaRoomProposalMutationResponseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  roomId: OpaqueKeySchema,
  roomEpoch: OpaqueKeySchema,
  controlSeq: z.number().int().nonnegative(),
  revision: RoomRevisionSchema,
  proposalId: ArenaProposalIdSchema,
  status: ArenaRoomProposalMutationStatusSchema,
  result: ArenaRoomProposalMutationResultSchema,
}).strict();

export const ArenaRoomHttpErrorCodeSchema = z.enum(ARENA_ROOM_HTTP_ERROR_CODES);

export const ArenaRoomHttpErrorResponseSchema = z.object({
  code: ArenaRoomHttpErrorCodeSchema,
  error: WireErrorMessageSchema,
  retryAfterSeconds: z.number().int().positive().optional(),
}).strict();

export type ArenaRoomCreateRequest = z.infer<typeof ArenaRoomCreateRequestSchema>;
export type ArenaRoomJoinRequest = z.infer<typeof ArenaRoomJoinRequestSchema>;
export type ArenaRoomTicketRequest = z.infer<typeof ArenaRoomTicketRequestSchema>;
export type ArenaRoomEpochMutationRequest = z.infer<typeof ArenaRoomEpochMutationRequestSchema>;
export type ArenaRoomMemberKickRequest = z.infer<typeof ArenaRoomMemberKickRequestSchema>;
export type ArenaRoomGenerationCancelRequest = z.infer<
  typeof ArenaRoomGenerationCancelRequestSchema
>;
export type ArenaRoomPublishConfigRequest = z.infer<
  typeof ArenaRoomPublishConfigRequestSchema
>;
export type ArenaRoomProposalSubmitRequest = z.infer<typeof ArenaRoomProposalSubmitRequestSchema>;
export type ArenaRoomProposalResolveRequest = z.infer<typeof ArenaRoomProposalResolveRequestSchema>;
export type ArenaRoomProposalWithdrawRequest = z.infer<typeof ArenaRoomProposalWithdrawRequestSchema>;
export type ArenaRoomGenerationStartRequest = z.infer<typeof ArenaRoomGenerationStartRequestSchema>;
export type ArenaRoomHostLocalPayload = z.infer<typeof ArenaRoomHostLocalPayloadSchema>;
export type ArenaRoomHostRuntimeGeneration = z.infer<
  typeof ArenaRoomHostRuntimeGenerationSchema
>;
export type ArenaRoomGenerationProjectionStatus = z.infer<
  typeof ArenaRoomGenerationProjectionStatusSchema
>;
export type ArenaRoomGenerationHistoryItem = z.infer<
  typeof ArenaRoomGenerationHistoryItemSchema
>;
export type ArenaRoomGenerationHistoryResponse = z.infer<
  typeof ArenaRoomGenerationHistoryResponseSchema
>;
export type ArenaRoomGenerationHistoryViewResponse = z.infer<
  typeof ArenaRoomGenerationHistoryViewResponseSchema
>;
export type ArenaRoomGenerationViewResponse = z.infer<
  typeof ArenaRoomGenerationViewResponseSchema
>;
export type ArenaRoomGenerationResult = z.infer<typeof ArenaRoomGenerationResultSchema>;
export type ArenaRoomSessionResponse = z.infer<typeof ArenaRoomSessionResponseSchema>;
export type ArenaRoomTicketResponse = z.infer<typeof ArenaRoomTicketResponseSchema>;
export type ArenaRoomLeaveResponse = z.infer<typeof ArenaRoomLeaveResponseSchema>;
export type ArenaRoomProposalMutationStatus = z.infer<typeof ArenaRoomProposalMutationStatusSchema>;
export type ArenaRoomProposalMutationResult = z.infer<typeof ArenaRoomProposalMutationResultSchema>;
export type ArenaRoomProposalMutationResponse = z.infer<typeof ArenaRoomProposalMutationResponseSchema>;
export type ArenaRoomHttpErrorResponse = z.infer<typeof ArenaRoomHttpErrorResponseSchema>;
