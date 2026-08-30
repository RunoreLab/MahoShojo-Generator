import { randomUUID } from 'node:crypto';

import {
  ARENA_ROOM_TICKET_VERSION,
  PROTOCOL_VERSION,
  RoomTicketClaimsSchema,
  type RoomReconnectCursor,
  type RoomTicketClaims,
  type RoomMember,
} from '@mahoshojo/contracts/arena-room';
import {
  createEnvSignatureService,
  type EnvSignatureServiceOptions,
} from '@mahoshojo/hosted-runtime/node-runtime/env-signature';
import type { SignatureService } from '@mahoshojo/hosted-runtime/signature';

export const ARENA_ROOM_TICKET_SIGNATURE_PURPOSE = 'arena-room-ticket-v1';
export const DEFAULT_ARENA_ROOM_TICKET_TTL_SECONDS = 45;
export const MAX_ARENA_ROOM_TICKET_TTL_SECONDS = 60;
export const MAX_ARENA_ROOM_TICKET_BYTES = 4_096;

export type ArenaRoomTicketIssueInput = {
  readonly roomId: string;
  readonly roomEpoch: string;
  readonly userId: string;
  readonly roleHint: RoomMember['role'];
  readonly reconnect?: RoomReconnectCursor;
};

export type ArenaRoomTicketCodec = {
  issue(input: ArenaRoomTicketIssueInput): Promise<string>;
  verify(token: string): Promise<RoomTicketClaims | null>;
};

export type ArenaRoomTicketCodecOptions = {
  readonly signatures: SignatureService;
  readonly createJti?: () => string;
  readonly now?: () => number;
  readonly ttlSeconds?: number;
  readonly maxClockSkewSeconds?: number;
};

export const createArenaRoomTicketSignatureService = (
  options: EnvSignatureServiceOptions = {},
): SignatureService => createEnvSignatureService({
  ...options,
  purpose: ARENA_ROOM_TICKET_SIGNATURE_PURPOSE,
});

const positiveSafeInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} 必须是正安全整数`);
  }
  return value;
};

const encodePayload = (claims: RoomTicketClaims): string => (
  Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
);

const decodePayload = (encoded: string): unknown | null => {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return null;
  try {
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) return null;
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    return null;
  }
};

export const createArenaRoomTicketCodec = (
  options: ArenaRoomTicketCodecOptions,
): ArenaRoomTicketCodec => {
  const now = options.now ?? Date.now;
  const createJti = options.createJti ?? randomUUID;
  const ttlSeconds = positiveSafeInteger(
    options.ttlSeconds ?? DEFAULT_ARENA_ROOM_TICKET_TTL_SECONDS,
    'ttlSeconds',
  );
  if (ttlSeconds > MAX_ARENA_ROOM_TICKET_TTL_SECONDS) {
    throw new Error('ttlSeconds 超过 Arena Room ticket 安全上限');
  }
  const maxClockSkewSeconds = options.maxClockSkewSeconds ?? 5;
  if (!Number.isSafeInteger(maxClockSkewSeconds) || maxClockSkewSeconds < 0 || maxClockSkewSeconds > 30) {
    throw new Error('maxClockSkewSeconds 必须是 0-30 的安全整数');
  }

  return Object.freeze({
    async issue(input) {
      const issuedAt = Math.floor(now() / 1_000);
      const parsed = RoomTicketClaimsSchema.safeParse({
        ticketVersion: ARENA_ROOM_TICKET_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        roomId: input.roomId,
        roomEpoch: input.roomEpoch,
        userId: input.userId,
        roleHint: input.roleHint,
        iat: issuedAt,
        exp: issuedAt + ttlSeconds,
        jti: createJti(),
        ...(input.reconnect === undefined ? {} : { reconnect: input.reconnect }),
      });
      if (!parsed.success) throw new Error('ROOM_TICKET_INPUT_INVALID');
      const signature = await options.signatures.generateSignature(parsed.data, {
        sanitizeIgnoredKeys: false,
      });
      if (!signature) throw new Error('ROOM_TICKET_SIGNING_UNAVAILABLE');
      const token = `${encodePayload(parsed.data)}.${signature}`;
      if (Buffer.byteLength(token, 'utf8') > MAX_ARENA_ROOM_TICKET_BYTES) {
        throw new Error('ROOM_TICKET_TOO_LARGE');
      }
      return token;
    },

    async verify(token) {
      if (
        typeof token !== 'string'
        || Buffer.byteLength(token, 'utf8') > MAX_ARENA_ROOM_TICKET_BYTES
      ) return null;
      const segments = token.split('.');
      if (segments.length !== 2) return null;
      const [encoded, signature] = segments;
      if (!encoded || !signature || !/^[0-9a-f]{64}$/u.test(signature)) return null;
      const decoded = decodePayload(encoded);
      const parsed = RoomTicketClaimsSchema.safeParse(decoded);
      if (!parsed.success) return null;
      const nowSeconds = Math.floor(now() / 1_000);
      if (
        parsed.data.iat > nowSeconds + maxClockSkewSeconds
        || parsed.data.exp <= nowSeconds
        || parsed.data.exp - parsed.data.iat > MAX_ARENA_ROOM_TICKET_TTL_SECONDS
      ) return null;
      const verified = await options.signatures.verifySignature({
        ...parsed.data,
        signature,
      }, { acceptSanitizedPayload: false });
      return verified ? parsed.data : null;
    },
  });
};
