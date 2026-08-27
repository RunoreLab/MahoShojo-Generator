import { describe, expect, it } from 'vitest';

import {
  MAX_CONTROL_FRAME_BYTES,
  parseRoomClientTransportFrame,
  parseRoomServerTransportFrame,
  RoomTicketClaimsSchema,
  RoomServerTransportMessageSchema,
} from '../src/arena-room';

describe('Arena Room WebSocket transport contract', () => {
  it('冻结短期 ticket claims 的 room/user/epoch/role/exp/jti/protocol/reconnect 绑定', () => {
    const claims = {
      ticketVersion: 1,
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      userId: 'member-1',
      roleHint: 'member',
      iat: 1_787_875_200,
      exp: 1_787_875_245,
      jti: 'ticket-jti-1',
      reconnect: { control: { roomEpoch: 'epoch-1', controlSeq: 7 } },
    };
    expect(RoomTicketClaimsSchema.parse(claims)).toEqual(claims);
    expect(RoomTicketClaimsSchema.safeParse({
      ...claims,
      signingSecret: 'secret-canary',
    }).success).toBe(false);
    expect(RoomTicketClaimsSchema.safeParse({ ...claims, protocolVersion: 2 }).success).toBe(false);
    expect(RoomTicketClaimsSchema.safeParse({ ...claims, roleHint: 'admin' }).success).toBe(false);
  });

  it('接受 versioned resync request 与独立 control/story cursor', () => {
    expect(parseRoomClientTransportFrame(JSON.stringify({
      protocolVersion: 1,
      type: 'room.resync.request',
      cursor: {
        control: { roomEpoch: 'epoch-1', controlSeq: 7 },
        story: { generationId: 'generation-1', chunkSeq: 12 },
      },
    }))).toEqual({
      protocolVersion: 1,
      type: 'room.resync.request',
      cursor: {
        control: { roomEpoch: 'epoch-1', controlSeq: 7 },
        story: { generationId: 'generation-1', chunkSeq: 12 },
      },
    });
  });

  it.each([
    '{not-json',
    JSON.stringify({ protocolVersion: 2, type: 'room.resync.request' }),
    JSON.stringify({ protocolVersion: 1, type: 'room.command', payload: {} }),
    JSON.stringify({
      protocolVersion: 1,
      type: 'room.resync.request',
      providerApiKey: 'secret-canary',
    }),
  ])('拒绝 malformed、version skew、unknown type 与额外敏感字段：%s', (raw) => {
    expect(() => parseRoomClientTransportFrame(raw)).toThrow();
  });

  it('在 JSON decode 前拒绝 oversized raw frame', () => {
    const raw = `{"protocolVersion":1,"type":"room.resync.request","padding":"${'x'.repeat(MAX_CONTROL_FRAME_BYTES)}"}`;
    expect(() => parseRoomClientTransportFrame(raw)).toThrow('payload-too-large');
  });

  it('冻结 server resync-required envelope 与固定 reason allowlist', () => {
    expect(RoomServerTransportMessageSchema.parse({
      protocolVersion: 1,
      type: 'room.resync.required',
      reason: 'state-not-attached',
    })).toEqual({
      protocolVersion: 1,
      type: 'room.resync.required',
      reason: 'state-not-attached',
    });
    expect(RoomServerTransportMessageSchema.safeParse({
      protocolVersion: 1,
      type: 'room.resync.required',
      reason: 'secret-canary',
    }).success).toBe(false);
  });

  it('server transport 复用 canonical RoomEvent wire，拒绝额外字段与 oversized raw frame', () => {
    const snapshot = {
      protocolVersion: 1,
      schemaVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 0,
      revision: 0,
      sharedConfig: {
        battleMode: 'classic',
        combatants: [{
          key: 'data-card:character-1',
          ref: { id: 'character-1', kind: 'character', versionToken: 'v1' },
        }],
        teams: [],
        scenario: null,
        auxScenarios: [],
        materials: [],
        userGuidance: '',
        storyLength: 'standard',
        customStoryLength: null,
        selectedLanguage: 'zh-CN',
        historySettings: {
          readArenaHistory: true,
          readArenaHistoryLimit: 3,
          isArenaHistoryUnlimited: false,
          writeArenaHistory: true,
          readCurrentState: true,
          writeCurrentState: true,
          readNarrativeHistory: false,
          readNarrativeHistoryLimit: 10,
          isNarrativeHistoryUnlimited: false,
          writeNarrativeHistory: false,
        },
      },
      members: [{
        userId: 'host-1',
        role: 'host',
        displayName: 'Host',
        membershipState: 'active',
      }],
      proposals: [],
      activeGeneration: null,
    };
    const event = {
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      controlSeq: 0,
      timestamp: '2026-08-28T00:00:00.000Z',
      type: 'room.snapshot',
      payload: snapshot,
    };

    expect(parseRoomServerTransportFrame(JSON.stringify(event))).toEqual(event);
    expect(() => parseRoomServerTransportFrame(JSON.stringify({
      ...event,
      signingSecret: 'secret-canary',
    }))).toThrow();
    expect(() => parseRoomServerTransportFrame('x'.repeat(MAX_CONTROL_FRAME_BYTES + 1)))
      .toThrow('payload-too-large');
  });
});
