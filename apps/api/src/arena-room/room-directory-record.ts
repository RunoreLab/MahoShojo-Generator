import {
  MAX_ROOM_MEMBERS,
  OpaqueKeySchema,
  RoomDirectoryEntrySchema,
  type RoomDirectoryEntry,
} from '@mahoshojo/contracts/arena-room';
import type { ArenaRoomAuthorityState } from '@mahoshojo/multiplayer-core';

import { hashArenaRoomId } from './redis-room-keyspace';

export const ROOM_DIRECTORY_RECORD_VERSION = 1 as const;
const MAX_ISO_TIMESTAMP_MS = 253_402_300_799_999;
const INDEX_TIMESTAMP_WIDTH = 15;
const PUBLIC_INDEX_MEMBER_PATTERN = /^\d{15}:[a-f0-9]{64}$/u;

export type RoomDirectoryRecord = RoomDirectoryEntry & {
  readonly roomEpoch: string;
  readonly hostUserId: number;
};

export type StoredRoomDirectoryRecord = RoomDirectoryRecord & {
  readonly directoryVersion: typeof ROOM_DIRECTORY_RECORD_VERSION;
  readonly publicIndexMember: string | null;
};

export class RoomDirectoryRecordError extends Error {
  constructor(readonly code: 'ROOM_DIRECTORY_RECORD_INVALID') {
    super(code);
    this.name = 'RoomDirectoryRecordError';
  }
}

const fail = (): never => {
  throw new RoomDirectoryRecordError('ROOM_DIRECTORY_RECORD_INVALID');
};

const positiveUserId = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

export const isRoomDirectoryPublicIndexMember = (value: unknown): value is string => (
  typeof value === 'string' && PUBLIC_INDEX_MEMBER_PATTERN.test(value)
);

export const roomDirectoryPublicIndexMember = (
  roomId: string,
  lastActivityAt: string,
): string => {
  const parsedRoomId = OpaqueKeySchema.safeParse(roomId);
  const parsedTimestamp = RoomDirectoryEntrySchema.shape.lastActivityAt.safeParse(lastActivityAt);
  if (!parsedRoomId.success || !parsedTimestamp.success) return fail();
  const timestampMs = Date.parse(parsedTimestamp.data);
  if (
    !Number.isSafeInteger(timestampMs)
    || timestampMs < 0
    || timestampMs > MAX_ISO_TIMESTAMP_MS
  ) return fail();
  const inverted = String(MAX_ISO_TIMESTAMP_MS - timestampMs).padStart(INDEX_TIMESTAMP_WIDTH, '0');
  return `${inverted}:${hashArenaRoomId(parsedRoomId.data)}`;
};

const parseRecord = (input: RoomDirectoryRecord): RoomDirectoryRecord => {
  const entry = RoomDirectoryEntrySchema.safeParse({
    roomId: input.roomId,
    title: input.title,
    visibility: input.visibility,
    status: input.status,
    createdAt: input.createdAt,
    lastActivityAt: input.lastActivityAt,
  });
  const roomEpoch = OpaqueKeySchema.safeParse(input.roomEpoch);
  if (
    !entry.success
    || !roomEpoch.success
    || !positiveUserId(input.hostUserId)
    || Date.parse(entry.data.lastActivityAt) < Date.parse(entry.data.createdAt)
  ) return fail();
  return {
    ...entry.data,
    roomEpoch: roomEpoch.data,
    hostUserId: input.hostUserId,
  };
};

export const createStoredRoomDirectoryRecord = (
  input: RoomDirectoryRecord,
): StoredRoomDirectoryRecord => {
  const record = parseRecord(input);
  return {
    directoryVersion: ROOM_DIRECTORY_RECORD_VERSION,
    ...record,
    publicIndexMember: record.visibility === 'public'
      ? roomDirectoryPublicIndexMember(record.roomId, record.lastActivityAt)
      : null,
  };
};

export const serializeStoredRoomDirectoryRecord = (
  input: StoredRoomDirectoryRecord,
): string => JSON.stringify(parseStoredRoomDirectoryRecord(JSON.stringify(input)));

export const parseStoredRoomDirectoryRecord = (
  raw: string,
): StoredRoomDirectoryRecord => {
  try {
    const input: unknown = JSON.parse(raw);
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return fail();
    const candidate = input as Partial<StoredRoomDirectoryRecord>;
    if (
      Object.keys(candidate).sort().join('|')
        !== 'createdAt|directoryVersion|hostUserId|lastActivityAt|publicIndexMember|roomEpoch|roomId|status|title|visibility'
      || candidate.directoryVersion !== ROOM_DIRECTORY_RECORD_VERSION
    ) return fail();
    const record = parseRecord(candidate as RoomDirectoryRecord);
    const expectedIndexMember = record.visibility === 'public'
      ? roomDirectoryPublicIndexMember(record.roomId, record.lastActivityAt)
      : null;
    if (candidate.publicIndexMember !== expectedIndexMember) return fail();
    return {
      directoryVersion: ROOM_DIRECTORY_RECORD_VERSION,
      ...record,
      publicIndexMember: expectedIndexMember,
    };
  } catch (error) {
    if (error instanceof RoomDirectoryRecordError) throw error;
    return fail();
  }
};

/**
 * 目录条目投影：从当前 authority 状态补充房主名与活跃成员数等可选展示字段。
 * authority 状态在 discover/lookup 时本就会读取用于校验，这里零额外 IO。
 */
export const publicRoomDirectoryEntry = (
  record: StoredRoomDirectoryRecord,
  authorityState?: ArenaRoomAuthorityState | null,
): RoomDirectoryEntry => {
  const activeMembers = authorityState?.snapshot.members.filter(
    (member) => member.membershipState === 'active',
  ) ?? [];
  const hostMember = activeMembers.find((member) => member.role === 'host');
  return RoomDirectoryEntrySchema.parse({
    roomId: record.roomId,
    title: record.title,
    visibility: record.visibility,
    status: record.status,
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
    memberLimit: MAX_ROOM_MEMBERS,
    ...(hostMember ? { hostDisplayName: hostMember.displayName } : {}),
    ...(activeMembers.length > 0 ? { memberCount: activeMembers.length } : {}),
  });
};
