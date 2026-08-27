import { describe, expect, it } from 'vitest';

import { createEnvSignatureService } from '@mahoshojo/hosted-runtime/node-runtime/env-signature';
import {
  ARENA_ROOM_TICKET_SIGNATURE_PURPOSE,
  createArenaRoomTicketCodec,
  createArenaRoomTicketSignatureService,
} from '#/arena-room/room-ticket';

const env = { SIGNATURE_SECRET_KEY: 'room-ticket-test-secret-at-least-32-characters' };
const silentLogger = { warn: () => undefined, error: () => undefined };

describe('Arena Room signed ticket codec', () => {
  it('签发短期、domain-separated、绑定 epoch/reconnect cursor 的严格 ticket', async () => {
    let now = Date.parse('2026-08-28T00:00:00.500Z');
    const signatures = createArenaRoomTicketSignatureService({ env, logger: silentLogger });
    const codec = createArenaRoomTicketCodec({
      signatures,
      createJti: () => 'jti-1',
      now: () => now,
      ttlSeconds: 45,
    });

    expect(ARENA_ROOM_TICKET_SIGNATURE_PURPOSE).toBe('arena-room-ticket-v1');
    const token = await codec.issue({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      userId: 'member-1',
      roleHint: 'member',
      reconnect: {
        control: { roomEpoch: 'epoch-1', controlSeq: 7 },
        story: { generationId: 'generation-1', chunkSeq: 12 },
      },
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/u);
    await expect(codec.verify(token)).resolves.toEqual({
      ticketVersion: 1,
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      userId: 'member-1',
      roleHint: 'member',
      iat: 1_787_875_200,
      exp: 1_787_875_245,
      jti: 'jti-1',
      reconnect: {
        control: { roomEpoch: 'epoch-1', controlSeq: 7 },
        story: { generationId: 'generation-1', chunkSeq: 12 },
      },
    });

    const genericCodec = createArenaRoomTicketCodec({
      signatures: createEnvSignatureService({ env, logger: silentLogger }),
      now: () => now,
    });
    await expect(genericCodec.verify(token)).resolves.toBeNull();

    now += 45_000;
    await expect(codec.verify(token)).resolves.toBeNull();
  });

  it('拒绝 tamper、malformed、oversized、future-issued 与超出最大 TTL 的 token', async () => {
    const now = Date.parse('2026-08-28T00:00:00.000Z');
    const signatures = createArenaRoomTicketSignatureService({ env, logger: silentLogger });
    const codec = createArenaRoomTicketCodec({
      signatures,
      createJti: () => 'jti-1',
      now: () => now,
    });
    const token = await codec.issue({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      userId: 'host-1',
      roleHint: 'host',
    });
    const tampered = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;

    await expect(codec.verify(tampered)).resolves.toBeNull();
    await expect(codec.verify('not-a-ticket')).resolves.toBeNull();
    await expect(codec.verify('x'.repeat(4_097))).resolves.toBeNull();

    const signClaims = async (claims: Record<string, unknown>) => {
      const signature = await signatures.generateSignature(claims, { sanitizeIgnoredKeys: false });
      if (!signature) throw new Error('signature unavailable');
      return `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
    };
    const baseClaims = {
      ticketVersion: 1,
      protocolVersion: 1,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      userId: 'host-1',
      roleHint: 'host',
      iat: Math.floor(now / 1_000),
      exp: Math.floor(now / 1_000) + 45,
      jti: 'jti-2',
    };
    await expect(codec.verify(await signClaims({
      ...baseClaims,
      iat: baseClaims.iat + 10,
      exp: baseClaims.exp + 10,
    }))).resolves.toBeNull();
    await expect(codec.verify(await signClaims({
      ...baseClaims,
      exp: baseClaims.iat + 61,
    }))).resolves.toBeNull();
    await expect(codec.verify(await signClaims({
      ...baseClaims,
      signingSecret: 'secret-canary',
    }))).resolves.toBeNull();
  });

  it('signing capability 缺失时 fail closed，不产生 unsigned ticket', async () => {
    const codec = createArenaRoomTicketCodec({
      signatures: {
        generateSignature: async () => null,
        verifySignature: async () => false,
      },
      createJti: () => 'jti-1',
      now: () => Date.parse('2026-08-28T00:00:00.000Z'),
    });

    await expect(codec.issue({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      userId: 'host-1',
      roleHint: 'host',
    })).rejects.toThrow('ROOM_TICKET_SIGNING_UNAVAILABLE');
  });
});
