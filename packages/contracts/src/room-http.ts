import { z } from 'zod';

import { ArenaRoomSnapshotSchema, RoomMemberSchema, RoomRevisionSchema } from './protocol';
import { DisplayNameSchema, OpaqueKeySchema, WireErrorMessageSchema } from './primitives';
import {
  ArenaProposalChangesSchema,
  ResolvedArenaProposalStatusSchema,
} from './proposals';
import { MAX_PROPOSAL_CHANGES } from './limits';
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
  proposals: `${ARENA_ROOM_HTTP_BASE_PATH}/:roomId/proposals`,
  proposalResolve: `${ARENA_ROOM_HTTP_BASE_PATH}/:roomId/proposals/:proposalId/resolve`,
  proposalWithdraw: `${ARENA_ROOM_HTTP_BASE_PATH}/:roomId/proposals/:proposalId/withdraw`,
});

export const MAX_ARENA_ROOM_HTTP_TICKET_BYTES = 4_096;

export const ArenaRoomCreateRequestSchema = z.object({
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

/** Client intent only; authority/provenance fields are injected by the server. */
export const ArenaRoomProposalSubmitRequestSchema = z.object({
  proposalId: OpaqueKeySchema,
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
  proposalId: OpaqueKeySchema,
  status: ArenaRoomProposalMutationStatusSchema,
  result: ArenaRoomProposalMutationResultSchema,
}).strict();

export const ArenaRoomHttpErrorCodeSchema = z.enum([
  'ROOM_AUTHENTICATION_REQUIRED',
  'ROOM_AUTHENTICATION_DENIED',
  'ROOM_FORBIDDEN',
  'ROOM_NOT_FOUND',
  'ROOM_PAYLOAD_TOO_LARGE',
  'ROOM_REQUEST_INVALID',
  'ROOM_CONFLICT',
  'ROOM_RATE_LIMITED',
  'ROOM_UNAVAILABLE',
]);

export const ArenaRoomHttpErrorResponseSchema = z.object({
  code: ArenaRoomHttpErrorCodeSchema,
  error: WireErrorMessageSchema,
  retryAfterSeconds: z.number().int().positive().optional(),
}).strict();

export type ArenaRoomCreateRequest = z.infer<typeof ArenaRoomCreateRequestSchema>;
export type ArenaRoomJoinRequest = z.infer<typeof ArenaRoomJoinRequestSchema>;
export type ArenaRoomTicketRequest = z.infer<typeof ArenaRoomTicketRequestSchema>;
export type ArenaRoomEpochMutationRequest = z.infer<typeof ArenaRoomEpochMutationRequestSchema>;
export type ArenaRoomProposalSubmitRequest = z.infer<typeof ArenaRoomProposalSubmitRequestSchema>;
export type ArenaRoomProposalResolveRequest = z.infer<typeof ArenaRoomProposalResolveRequestSchema>;
export type ArenaRoomProposalWithdrawRequest = z.infer<typeof ArenaRoomProposalWithdrawRequestSchema>;
export type ArenaRoomSessionResponse = z.infer<typeof ArenaRoomSessionResponseSchema>;
export type ArenaRoomTicketResponse = z.infer<typeof ArenaRoomTicketResponseSchema>;
export type ArenaRoomLeaveResponse = z.infer<typeof ArenaRoomLeaveResponseSchema>;
export type ArenaRoomProposalMutationStatus = z.infer<typeof ArenaRoomProposalMutationStatusSchema>;
export type ArenaRoomProposalMutationResult = z.infer<typeof ArenaRoomProposalMutationResultSchema>;
export type ArenaRoomProposalMutationResponse = z.infer<typeof ArenaRoomProposalMutationResponseSchema>;
export type ArenaRoomHttpErrorCode = z.infer<typeof ArenaRoomHttpErrorCodeSchema>;
export type ArenaRoomHttpErrorResponse = z.infer<typeof ArenaRoomHttpErrorResponseSchema>;
