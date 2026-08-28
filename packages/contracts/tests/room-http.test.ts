import { describe, expect, it } from 'vitest';

import {
  ARENA_ROOM_HTTP_BASE_PATH,
  ARENA_ROOM_HTTP_ROUTES,
  ARENA_ROOM_WEBSOCKET_PATH,
  ArenaRoomCreateRequestSchema,
  ArenaRoomHttpErrorResponseSchema,
  ArenaRoomJoinRequestSchema,
  ArenaRoomLeaveResponseSchema,
  ArenaRoomSessionResponseSchema,
  ArenaRoomTicketRequestSchema,
  ArenaRoomTicketResponseSchema,
} from '../src/arena-room';
import canonicalRoomSnapshot from './fixtures/arena-room-v1.json';

const session = {
  protocolVersion: 1,
  roomId: canonicalRoomSnapshot.roomId,
  roomEpoch: canonicalRoomSnapshot.roomEpoch,
  self: canonicalRoomSnapshot.members[0],
  snapshot: canonicalRoomSnapshot,
};

describe('Arena Room HTTP product contract', () => {
  it('使用单一 v1 namespace，并与 WSS endpoint 分离', () => {
    expect(ARENA_ROOM_HTTP_BASE_PATH).toBe('/api/arena/rooms/v1');
    expect(ARENA_ROOM_WEBSOCKET_PATH).toBe('/api/arena/rooms/v1/ws');
    expect(ARENA_ROOM_HTTP_ROUTES).toEqual({
      collection: '/api/arena/rooms/v1',
      join: '/api/arena/rooms/v1/:roomId/join',
      session: '/api/arena/rooms/v1/:roomId/session',
      ticket: '/api/arena/rooms/v1/:roomId/ticket',
      leave: '/api/arena/rooms/v1/:roomId/leave',
      close: '/api/arena/rooms/v1/:roomId/close',
    });
  });

  it('create 只接受展示信息、directory 与 shared config', () => {
    const request = {
      displayName: '房主',
      directory: { title: '周末竞技场', visibility: 'public' },
      sharedConfig: canonicalRoomSnapshot.sharedConfig,
    };
    expect(ArenaRoomCreateRequestSchema.parse(request)).toEqual(request);
    for (const authority of [
      { roomId: 'client-room' },
      { roomEpoch: 'client-epoch' },
      { userId: 'client-user' },
      { accountUserId: 7 },
      { role: 'host' },
      { apiKey: 'secret' },
    ]) {
      expect(ArenaRoomCreateRequestSchema.safeParse({ ...request, ...authority }).success)
        .toBe(false);
    }
  });

  it('join 与 ticket 不允许客户端提交 identity、role 或 epoch', () => {
    expect(ArenaRoomJoinRequestSchema.parse({ displayName: '成员' })).toEqual({
      displayName: '成员',
    });
    expect(ArenaRoomJoinRequestSchema.safeParse({
      displayName: '成员',
      userId: 'spoofed',
    }).success).toBe(false);

    expect(ArenaRoomTicketRequestSchema.parse({
      reconnect: { control: { roomEpoch: 'epoch-1', controlSeq: 3 } },
    })).toEqual({ reconnect: { control: { roomEpoch: 'epoch-1', controlSeq: 3 } } });
    expect(ArenaRoomTicketRequestSchema.safeParse({ roleHint: 'host' }).success).toBe(false);
    expect(ArenaRoomTicketRequestSchema.safeParse({ roomEpoch: 'epoch-1' }).success).toBe(false);
  });

  it('session 仅返回 public snapshot 与当前成员，不接受 authority state', () => {
    expect(ArenaRoomSessionResponseSchema.parse(session)).toEqual(session);
    for (const authority of [
      { memberAuthority: [] },
      { accountUserId: 7 },
      { deadlines: { hostOfflineDeadline: null, roomIdleDeadline: null } },
    ]) {
      expect(ArenaRoomSessionResponseSchema.safeParse({ ...session, ...authority }).success)
        .toBe(false);
    }
    expect(ArenaRoomSessionResponseSchema.safeParse({
      ...session,
      roomEpoch: 'other-epoch',
    }).success).toBe(false);
    expect(ArenaRoomSessionResponseSchema.safeParse({
      ...session,
      self: { ...session.self, userId: 'not-a-member' },
    }).success).toBe(false);
  });

  it('ticket/leave/error response 维持有界且可判别的 wire', () => {
    expect(ArenaRoomTicketResponseSchema.parse({
      protocolVersion: 1,
      ticket: 'opaque-ticket',
      expiresInSeconds: 45,
      websocket: {
        path: ARENA_ROOM_WEBSOCKET_PATH,
        protocol: 'mahoshojo.arena-room.v1',
      },
    })).toMatchObject({ ticket: 'opaque-ticket', expiresInSeconds: 45 });
    expect(ArenaRoomTicketResponseSchema.safeParse({
      protocolVersion: 1,
      ticket: 'x'.repeat(4_097),
      expiresInSeconds: 45,
      websocket: {
        path: ARENA_ROOM_WEBSOCKET_PATH,
        protocol: 'mahoshojo.arena-room.v1',
      },
    }).success).toBe(false);
    expect(ArenaRoomLeaveResponseSchema.parse({
      protocolVersion: 1,
      roomId: 'room-1',
      outcome: 'left',
    })).toMatchObject({ outcome: 'left' });
    expect(ArenaRoomHttpErrorResponseSchema.safeParse({
      code: 'ROOM_AUTHENTICATION_REQUIRED',
      error: '请先登录',
      accountUserId: 7,
    }).success).toBe(false);
  });
});
