import { describe, expect, it } from 'vitest';
import {
  ARENA_ROOM_PRESENCE_WEBSOCKET_PROTOCOL,
  ARENA_ROOM_WEBSOCKET_PROTOCOL,
  MAX_ROOM_MEMBERS,
  RoomPresenceSnapshotSchema,
  parseRoomServerTransportFrame,
  selectArenaRoomWebSocketProtocol,
} from '../src/arena-room';

const presence = {
  protocolVersion: 1 as const, type: 'room.presence' as const,
  roomId: 'room-1', roomEpoch: 'epoch-1', onlineUserIds: ['user-1'],
};

describe('member presence transport', () => {
  it('keeps presence out of the durable control envelope', () => {
    expect(parseRoomServerTransportFrame(JSON.stringify(presence))).toEqual(presence);
    expect(RoomPresenceSnapshotSchema.safeParse({ ...presence, controlSeq: 1 }).success).toBe(false);
    expect(RoomPresenceSnapshotSchema.safeParse({ ...presence, accountUserId: 42 }).success).toBe(false);
  });
  it('rejects duplicate IDs and oversized rosters; accepts empty presence', () => {
    expect(RoomPresenceSnapshotSchema.safeParse({ ...presence, onlineUserIds: [] }).success).toBe(true);
    expect(RoomPresenceSnapshotSchema.safeParse({ ...presence, onlineUserIds: ['u', 'u'] }).success).toBe(false);
    expect(RoomPresenceSnapshotSchema.safeParse({ ...presence,
      onlineUserIds: Array.from({ length: MAX_ROOM_MEMBERS + 1 }, (_, i) => `u-${i}`),
    }).success).toBe(false);
  });
  it('negotiates new protocol only when offered, preserving v1 clients', () => {
    expect(selectArenaRoomWebSocketProtocol([ARENA_ROOM_WEBSOCKET_PROTOCOL])).toBe(ARENA_ROOM_WEBSOCKET_PROTOCOL);
    expect(selectArenaRoomWebSocketProtocol([ARENA_ROOM_PRESENCE_WEBSOCKET_PROTOCOL,
      ARENA_ROOM_WEBSOCKET_PROTOCOL])).toBe(ARENA_ROOM_PRESENCE_WEBSOCKET_PROTOCOL);
    expect(selectArenaRoomWebSocketProtocol(['unsupported'])).toBe(false);
  });
});
