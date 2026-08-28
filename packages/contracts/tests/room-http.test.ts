import { describe, expect, it } from 'vitest';

import {
  ARENA_ROOM_HTTP_BASE_PATH,
  ARENA_ROOM_HTTP_ROUTES,
  ARENA_ROOM_WEBSOCKET_PATH,
  ArenaRoomCreateRequestSchema,
  ArenaRoomEpochMutationRequestSchema,
  ArenaRoomHttpErrorResponseSchema,
  ArenaRoomJoinRequestSchema,
  ArenaRoomLeaveResponseSchema,
  ArenaRoomProposalMutationResponseSchema,
  ArenaRoomProposalResolveRequestSchema,
  ArenaRoomProposalSubmitRequestSchema,
  ArenaRoomProposalWithdrawRequestSchema,
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
      proposals: '/api/arena/rooms/v1/:roomId/proposals',
      proposalResolve: '/api/arena/rooms/v1/:roomId/proposals/:proposalId/resolve',
      proposalWithdraw: '/api/arena/rooms/v1/:roomId/proposals/:proposalId/withdraw',
    });
  });

  it('Proposal mutation DTO 只接受 client intent 与 typed changes，并保持 strict', () => {
    const change = {
      changeId: 'guidance-1',
      type: 'setUserGuidance' as const,
      value: '建议',
      expectedBase: { kind: 'value' as const, value: '' },
    };
    const submit = {
      proposalId: 'proposal-1',
      expectedRoomEpoch: 'epoch-1',
      baseRevision: 3,
      changes: [change],
    };
    expect(ArenaRoomProposalSubmitRequestSchema.parse(submit)).toEqual(submit);
    for (const injected of [
      { roomId: 'room-1' },
      { authorUserId: 'spoofed' },
      { proposalVersion: 1 },
      { status: 'submitted' },
      { createdAt: '2026-08-28T00:00:00.000Z' },
      { accountUserId: 7 },
      { role: 'member' },
    ]) {
      expect(ArenaRoomProposalSubmitRequestSchema.safeParse({ ...submit, ...injected }).success)
        .toBe(false);
    }
    expect(ArenaRoomProposalSubmitRequestSchema.safeParse({
      ...submit,
      changes: [{ ...change, unexpected: true }],
    }).success).toBe(false);
    expect(ArenaRoomProposalSubmitRequestSchema.safeParse({
      ...submit,
      changes: [{ ...change, dependsOn: ['missing-change'] }],
    }).success).toBe(false);
    expect(ArenaRoomProposalSubmitRequestSchema.safeParse({
      ...submit,
      changes: [
        { ...change, changeId: 'a', dependsOn: ['b'] },
        { ...change, changeId: 'b', dependsOn: ['a'] },
      ],
    }).success).toBe(false);

    const resolve = {
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 3,
      resolution: 'accept-selected' as const,
      selectedChangeIds: ['guidance-1'],
    };
    expect(ArenaRoomProposalResolveRequestSchema.parse(resolve)).toEqual(resolve);
    expect(ArenaRoomProposalResolveRequestSchema.safeParse({
      ...resolve,
      expectedRevision: -1,
    }).success).toBe(false);
    expect(ArenaRoomProposalResolveRequestSchema.safeParse({
      ...resolve,
      resolution: 'reject',
      selectedChangeIds: [],
    }).success).toBe(false);
    expect(ArenaRoomProposalResolveRequestSchema.safeParse({
      ...resolve,
      accountUserId: 7,
    }).success).toBe(false);

    const withdraw = { expectedRoomEpoch: 'epoch-1' };
    expect(ArenaRoomProposalWithdrawRequestSchema.parse(withdraw)).toEqual(withdraw);
    expect(ArenaRoomProposalWithdrawRequestSchema.safeParse({ ...withdraw, proposalId: 'p' }).success)
      .toBe(false);
  });

  it('Proposal mutation response 只暴露公共 cursor、proposal status 与 result', () => {
    const response = {
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 4,
      revision: 3,
      proposalId: 'proposal-1',
      status: 'partially_accepted' as const,
      result: 'applied' as const,
    };
    expect(ArenaRoomProposalMutationResponseSchema.parse(response)).toEqual(response);
    for (const internal of [
      { accountUserId: 7 },
      { deadlines: { hostOfflineDeadline: null } },
      { terminalProposalIds: ['proposal-1'] },
      { receipt: 'checkpoint-receipt' },
      { authorityState: {} },
    ]) {
      expect(ArenaRoomProposalMutationResponseSchema.safeParse({ ...response, ...internal }).success)
        .toBe(false);
    }
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

  it('leave/close 只接受 session epoch fence，不接受 identity 或 role', () => {
    expect(ArenaRoomEpochMutationRequestSchema.parse({
      expectedRoomEpoch: 'epoch-1',
    })).toEqual({ expectedRoomEpoch: 'epoch-1' });
    for (const authority of [
      { userId: 'spoofed' },
      { accountUserId: 7 },
      { role: 'host' },
      { roomEpoch: 'epoch-1' },
      { apiKey: 'secret' },
    ]) {
      expect(ArenaRoomEpochMutationRequestSchema.safeParse({
        expectedRoomEpoch: 'epoch-1',
        ...authority,
      }).success).toBe(false);
    }
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
