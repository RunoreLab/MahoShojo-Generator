import { createHash } from 'node:crypto';

import {
  IsoTimestampSchema,
  OpaqueKeySchema,
  RoomDirectoryEntrySchema,
} from '@mahoshojo/contracts/arena-room';

import type { RoomDirectoryRecord } from './d1-room-directory-store';

const KEY_PREFIX = 'mahoshojo:room-directory-registration:v1';
const MAX_REGISTRATION_BATCH_SIZE = 50;

const PUT_SCRIPT = `
-- ROOM_DIRECTORY_REGISTRATION_PUT_V1
local existing = redis.call('GET', KEYS[1])
if existing and existing ~= ARGV[2] then return 'conflict' end
if existing then
  redis.call('ZADD', KEYS[2], 'NX', ARGV[3], ARGV[1])
  return 'already'
end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
return 'stored'
`;

const REBIND_SCRIPT = `
-- ROOM_DIRECTORY_REGISTRATION_REBIND_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local decoded, current = pcall(cjson.decode, raw)
if not decoded or type(current) ~= 'table' or current.roomId ~= ARGV[1] then
  return 'invalid'
end
if current.roomEpoch == ARGV[3] then return 'already' end
if current.roomEpoch ~= ARGV[2] then return 'stale' end
current.roomEpoch = ARGV[3]
if current.lastActivityAt < ARGV[4] then current.lastActivityAt = ARGV[4] end
redis.call('SET', KEYS[1], cjson.encode(current))
return 'rebound'
`;

const DELETE_SCRIPT = `
-- ROOM_DIRECTORY_REGISTRATION_DELETE_V1
local raw = redis.call('GET', KEYS[1])
if not raw then
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 'missing'
end
local decoded, current = pcall(cjson.decode, raw)
if not decoded or type(current) ~= 'table' or current.roomId ~= ARGV[2] then
  return 'invalid'
end
if current.roomEpoch ~= ARGV[3] then return 'stale' end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 'deleted'
`;

const LIST_SCRIPT = `
-- ROOM_DIRECTORY_REGISTRATION_LIST_V1
local members = redis.call('ZRANGE', KEYS[1], 0, tonumber(ARGV[1]) - 1)
local result = {}
for _, member in ipairs(members) do
  local raw = redis.call('GET', ARGV[2] .. member)
  if raw then
    table.insert(result, raw)
  else
    redis.call('ZREM', KEYS[1], member)
  end
end
return result
`;

const TOUCH_SCRIPT = `
-- ROOM_DIRECTORY_REGISTRATION_TOUCH_V1
local raw = redis.call('GET', KEYS[1])
if not raw then
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 'missing'
end
local decoded, current = pcall(cjson.decode, raw)
if not decoded or type(current) ~= 'table' or current.roomId ~= ARGV[2] then
  return 'invalid'
end
if current.roomEpoch ~= ARGV[3] then return 'stale' end
redis.call('ZADD', KEYS[2], ARGV[4], ARGV[1])
return 'touched'
`;

export interface RedisRoomDirectoryRegistrationClient {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}

export type RedisRoomDirectoryRegistrationStore = {
  put(input: RoomDirectoryRecord): Promise<void>;
  rebindEpoch(input: {
    readonly roomId: string;
    readonly previousRoomEpoch: string;
    readonly nextRoomEpoch: string;
    readonly lastActivityAt: string;
  }): Promise<{ readonly kind: 'already' | 'missing' | 'rebound' | 'stale' }>;
  delete(input: {
    readonly roomId: string;
    readonly roomEpoch: string;
  }): Promise<{ readonly kind: 'deleted' | 'missing' | 'stale' }>;
  list(input: { readonly limit: number }): Promise<RoomDirectoryRecord[]>;
  touch(input: {
    readonly roomId: string;
    readonly roomEpoch: string;
    readonly score: number;
  }): Promise<{ readonly kind: 'missing' | 'stale' | 'touched' }>;
};

export type RedisRoomDirectoryRegistrationStoreOptions = {
  readonly getClient: () => RedisRoomDirectoryRegistrationClient;
  readonly keyPrefix?: string;
};

const invalid = (code: string): never => {
  throw new Error(code);
};

const positiveUserId = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

const parseRecord = (input: unknown): RoomDirectoryRecord => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID');
  }
  const candidate = input as Partial<RoomDirectoryRecord>;
  const entry = RoomDirectoryEntrySchema.safeParse({
    roomId: candidate.roomId,
    title: candidate.title,
    visibility: candidate.visibility,
    status: candidate.status,
    createdAt: candidate.createdAt,
    lastActivityAt: candidate.lastActivityAt,
  });
  const roomEpoch = OpaqueKeySchema.safeParse(candidate.roomEpoch);
  if (
    !entry.success
    || !roomEpoch.success
    || !positiveUserId(candidate.hostUserId ?? 0)
    || Date.parse(entry.data.lastActivityAt) < Date.parse(entry.data.createdAt)
  ) return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID');
  return {
    ...entry.data,
    roomEpoch: roomEpoch.data,
    hostUserId: candidate.hostUserId!,
  };
};

const parseIdentity = (roomId: string, roomEpoch: string): [string, string] => {
  const parsedRoomId = OpaqueKeySchema.safeParse(roomId);
  const parsedRoomEpoch = OpaqueKeySchema.safeParse(roomEpoch);
  if (!parsedRoomId.success || !parsedRoomEpoch.success) {
    return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INPUT_INVALID');
  }
  return [parsedRoomId.data, parsedRoomEpoch.data];
};

const hashRoomId = (roomId: string): string => createHash('sha256').update(roomId).digest('hex');

export const createRedisRoomDirectoryRegistrationStore = (
  options: RedisRoomDirectoryRegistrationStoreOptions,
): RedisRoomDirectoryRegistrationStore => {
  const environmentPrefix = options.keyPrefix?.trim();
  if (environmentPrefix && !/^[a-z0-9_-]{1,32}$/u.test(environmentPrefix)) {
    throw new Error('keyPrefix 必须是安全的环境标识');
  }
  const keyPrefix = environmentPrefix ? `${KEY_PREFIX}:${environmentPrefix}` : KEY_PREFIX;
  const entryPrefix = `${keyPrefix}:entry:`;
  const indexKey = `${keyPrefix}:index`;
  const keysFor = (roomId: string): [string, string, string] => {
    const member = hashRoomId(roomId);
    return [`${entryPrefix}${member}`, indexKey, member];
  };

  return Object.freeze({
    async put(input) {
      const record = parseRecord(input);
      const [entryKey, index, member] = keysFor(record.roomId);
      const response = await options.getClient().eval(PUT_SCRIPT, {
        keys: [entryKey, index],
        arguments: [member, JSON.stringify(record), String(Date.parse(record.createdAt))],
      });
      if (response === 'stored' || response === 'already') return;
      if (response === 'conflict') {
        return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_CONFLICT');
      }
      return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_RESPONSE_INVALID');
    },

    async rebindEpoch(input) {
      const [roomId, previousRoomEpoch] = parseIdentity(input.roomId, input.previousRoomEpoch);
      const nextRoomEpoch = OpaqueKeySchema.safeParse(input.nextRoomEpoch);
      const lastActivityAt = IsoTimestampSchema.safeParse(input.lastActivityAt);
      if (
        !nextRoomEpoch.success
        || !lastActivityAt.success
        || nextRoomEpoch.data === previousRoomEpoch
      ) return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INPUT_INVALID');
      const [entryKey] = keysFor(roomId);
      const response = await options.getClient().eval(REBIND_SCRIPT, {
        keys: [entryKey],
        arguments: [roomId, previousRoomEpoch, nextRoomEpoch.data, lastActivityAt.data],
      });
      if (response === 'already' || response === 'missing'
        || response === 'rebound' || response === 'stale') return { kind: response };
      if (response === 'invalid') return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID');
      return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_RESPONSE_INVALID');
    },

    async delete(input) {
      const [roomId, roomEpoch] = parseIdentity(input.roomId, input.roomEpoch);
      const [entryKey, index, member] = keysFor(roomId);
      const response = await options.getClient().eval(DELETE_SCRIPT, {
        keys: [entryKey, index],
        arguments: [member, roomId, roomEpoch],
      });
      if (response === 'deleted' || response === 'missing' || response === 'stale') {
        return { kind: response };
      }
      if (response === 'invalid') return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID');
      return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_RESPONSE_INVALID');
    },

    async list(input) {
      if (
        !Number.isSafeInteger(input.limit)
        || input.limit < 1
        || input.limit > MAX_REGISTRATION_BATCH_SIZE
      ) return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INPUT_INVALID');
      const response = await options.getClient().eval(LIST_SCRIPT, {
        keys: [indexKey],
        arguments: [String(input.limit), entryPrefix],
      });
      if (!Array.isArray(response) || response.length > input.limit) {
        return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_RESPONSE_INVALID');
      }
      return response.map((raw) => {
        if (typeof raw !== 'string') {
          return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_RESPONSE_INVALID');
        }
        try {
          return parseRecord(JSON.parse(raw));
        } catch {
          return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID');
        }
      });
    },

    async touch(input) {
      const [roomId, roomEpoch] = parseIdentity(input.roomId, input.roomEpoch);
      if (!Number.isSafeInteger(input.score) || input.score < 0) {
        return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INPUT_INVALID');
      }
      const [entryKey, index, member] = keysFor(roomId);
      const response = await options.getClient().eval(TOUCH_SCRIPT, {
        keys: [entryKey, index],
        arguments: [member, roomId, roomEpoch, String(input.score)],
      });
      if (response === 'missing' || response === 'stale' || response === 'touched') {
        return { kind: response };
      }
      if (response === 'invalid') return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID');
      return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_RESPONSE_INVALID');
    },
  });
};
