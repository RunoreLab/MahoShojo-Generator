import { describe, expect, it } from 'vitest';

import {
  MAX_CONTROL_FRAME_BYTES,
  parseRoomClientTransportFrame,
  RoomServerTransportMessageSchema,
} from '../src/arena-room';

describe('Arena Room WebSocket transport contract', () => {
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
});
