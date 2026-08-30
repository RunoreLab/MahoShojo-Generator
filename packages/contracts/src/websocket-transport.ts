import { z } from 'zod';

import { ArenaContractError } from './errors';
import { MAX_CONTROL_FRAME_BYTES } from './limits';
import {
  RoomControlCursorSchema,
  RoomEventSchema,
  RoomMemberRoleSchema,
  StoryStreamCursorSchema,
} from './protocol';
import { OpaqueKeySchema } from './primitives';
import { PROTOCOL_VERSION } from './versions';
import {
  decodeRawJson,
  rawUtf8ByteLength,
  type RawWireInput,
} from './wire-size';

export const ARENA_ROOM_WEBSOCKET_PROTOCOL = 'mahoshojo.arena-room.v1';
export const ARENA_ROOM_WEBSOCKET_PATH = '/api/arena/rooms/v1/ws';
export const ARENA_ROOM_TICKET_VERSION = 1 as const;

export const RoomReconnectCursorSchema = z.object({
  control: RoomControlCursorSchema.optional(),
  story: StoryStreamCursorSchema.optional(),
}).strict();
export type RoomReconnectCursor = z.infer<typeof RoomReconnectCursorSchema>;

export const RoomTicketClaimsSchema = z.object({
  ticketVersion: z.literal(ARENA_ROOM_TICKET_VERSION),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  roomId: OpaqueKeySchema,
  roomEpoch: OpaqueKeySchema,
  userId: OpaqueKeySchema,
  roleHint: RoomMemberRoleSchema,
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  jti: OpaqueKeySchema,
  reconnect: RoomReconnectCursorSchema.optional(),
}).strict().superRefine((claims, context) => {
  if (claims.exp <= claims.iat) {
    context.addIssue({ code: 'custom', path: ['exp'], message: 'ticket exp must follow iat' });
  }
});
export type RoomTicketClaims = z.infer<typeof RoomTicketClaimsSchema>;

export const RoomClientTransportMessageSchema = z.discriminatedUnion('type', [
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('room.resync.request'),
    cursor: RoomReconnectCursorSchema.optional(),
  }).strict(),
]);
export type RoomClientTransportMessage = z.infer<typeof RoomClientTransportMessageSchema>;

const RoomServerResyncRequiredSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal('room.resync.required'),
  reason: z.enum(['state-not-attached', 'replay-unavailable', 'slow-consumer']),
}).strict();

export const RoomServerTransportMessageSchema = z.union([
  RoomEventSchema,
  RoomServerResyncRequiredSchema,
]);
export type RoomServerTransportMessage = z.infer<typeof RoomServerTransportMessageSchema>;

export const parseRoomClientTransportFrame = (
  input: RawWireInput,
): RoomClientTransportMessage => {
  if (rawUtf8ByteLength(input) > MAX_CONTROL_FRAME_BYTES) {
    throw new ArenaContractError('payload-too-large');
  }
  let decoded: unknown;
  try {
    decoded = decodeRawJson(input);
  } catch (error) {
    throw new ArenaContractError(
      'invalid-message',
      'invalid Arena Room client transport frame',
      undefined,
      error,
    );
  }
  const parsed = RoomClientTransportMessageSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ArenaContractError('invalid-message', 'invalid Arena Room client transport frame');
  }
  return parsed.data;
};

export const parseRoomServerTransportFrame = (
  input: RawWireInput,
): RoomServerTransportMessage => {
  if (rawUtf8ByteLength(input) > MAX_CONTROL_FRAME_BYTES) {
    throw new ArenaContractError('payload-too-large');
  }
  let decoded: unknown;
  try {
    decoded = decodeRawJson(input);
  } catch (error) {
    throw new ArenaContractError(
      'invalid-message',
      'invalid Arena Room server transport frame',
      undefined,
      error,
    );
  }
  const parsed = RoomServerTransportMessageSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ArenaContractError('invalid-message', 'invalid Arena Room server transport frame');
  }
  return parsed.data;
};
