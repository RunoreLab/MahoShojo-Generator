import { z } from 'zod';

import { ArenaRoomSnapshotSchema, RoomMemberSchema } from './protocol';
import { DisplayNameSchema, OpaqueKeySchema, WireErrorMessageSchema } from './primitives';
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

export const ArenaRoomEmptyRequestSchema = z.object({}).strict();

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
export type ArenaRoomSessionResponse = z.infer<typeof ArenaRoomSessionResponseSchema>;
export type ArenaRoomTicketResponse = z.infer<typeof ArenaRoomTicketResponseSchema>;
export type ArenaRoomLeaveResponse = z.infer<typeof ArenaRoomLeaveResponseSchema>;
export type ArenaRoomHttpErrorCode = z.infer<typeof ArenaRoomHttpErrorCodeSchema>;
export type ArenaRoomHttpErrorResponse = z.infer<typeof ArenaRoomHttpErrorResponseSchema>;
