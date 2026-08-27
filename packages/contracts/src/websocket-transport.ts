import { z } from 'zod';

import { ArenaContractError } from './errors';
import { MAX_CONTROL_FRAME_BYTES } from './limits';
import { RoomControlCursorSchema, StoryStreamCursorSchema } from './protocol';
import { PROTOCOL_VERSION } from './versions';
import {
  decodeRawJson,
  rawUtf8ByteLength,
  type RawWireInput,
} from './wire-size';

export const ARENA_ROOM_WEBSOCKET_PROTOCOL = 'mahoshojo.arena-room.v1';

export const RoomReconnectCursorSchema = z.object({
  control: RoomControlCursorSchema.optional(),
  story: StoryStreamCursorSchema.optional(),
}).strict();
export type RoomReconnectCursor = z.infer<typeof RoomReconnectCursorSchema>;

export const RoomClientTransportMessageSchema = z.discriminatedUnion('type', [
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('room.resync.request'),
    cursor: RoomReconnectCursorSchema.optional(),
  }).strict(),
]);
export type RoomClientTransportMessage = z.infer<typeof RoomClientTransportMessageSchema>;

export const RoomServerTransportMessageSchema = z.discriminatedUnion('type', [
  z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.literal('room.resync.required'),
    reason: z.enum(['state-not-attached', 'replay-unavailable', 'slow-consumer']),
  }).strict(),
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
