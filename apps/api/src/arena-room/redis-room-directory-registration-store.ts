import { createHash } from 'node:crypto';

import {
  IsoTimestampSchema,
  OpaqueKeySchema,
  RoomDirectoryEntrySchema,
} from '@mahoshojo/contracts/arena-room';

import type { RoomDirectoryRecord } from './d1-room-directory-store';

const KEY_PREFIX = 'mahoshojo:room-directory-registration:v2';
const MAX_REGISTRATION_BATCH_SIZE = 50;
const REGISTRATION_VERSION = 2;

const PREPARE_SCRIPT = `
-- ROOM_DIRECTORY_REGISTRATION_PREPARE_V2
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

const ADVANCE_TARGET_SCRIPT = `
-- ROOM_DIRECTORY_REGISTRATION_ADVANCE_TARGET_V2
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local decoded, current = pcall(cjson.decode, raw)
if not decoded or type(current) ~= 'table' or current.roomId ~= ARGV[1] then
  return 'invalid'
end
if current.phase == 'closing' then return 'stale' end
if current.targetRoomEpoch == ARGV[3] then
  if current.lastActivityAt < ARGV[4] then current.lastActivityAt = ARGV[4] end
  current.updatedAtMs = tonumber(ARGV[5])
  redis.call('SET', KEYS[1], cjson.encode(current))
  return 'already'
end
if current.targetRoomEpoch ~= ARGV[2] then return 'stale' end
current.targetRoomEpoch = ARGV[3]
if current.lastActivityAt < ARGV[4] then current.lastActivityAt = ARGV[4] end
current.phase = 'projecting'
current.updatedAtMs = tonumber(ARGV[5])
redis.call('SET', KEYS[1], cjson.encode(current))
return 'advanced'
`;

const CONFIRM_PROJECTED_SCRIPT = `
-- ROOM_DIRECTORY_REGISTRATION_CONFIRM_PROJECTED_V2
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local decoded, current = pcall(cjson.decode, raw)
if not decoded or type(current) ~= 'table' or current.roomId ~= ARGV[2] then
  return 'invalid'
end
if current.phase == 'closing' or current.targetRoomEpoch ~= ARGV[3] then return 'stale' end
current.projectedRoomEpoch = ARGV[3]
current.phase = 'active'
current.updatedAtMs = tonumber(ARGV[4])
redis.call('SET', KEYS[1], cjson.encode(current))
redis.call('ZADD', KEYS[2], ARGV[5], ARGV[1])
return 'confirmed'
`;

const MARK_CLOSING_SCRIPT = `
-- ROOM_DIRECTORY_REGISTRATION_MARK_CLOSING_V2
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local decoded, current = pcall(cjson.decode, raw)
if not decoded or type(current) ~= 'table' or current.roomId ~= ARGV[2] then
  return 'invalid'
end
if current.targetRoomEpoch ~= ARGV[3] then return 'stale' end
if current.phase == 'closing' then return 'already' end
current.phase = 'closing'
current.updatedAtMs = tonumber(ARGV[4])
redis.call('SET', KEYS[1], cjson.encode(current))
redis.call('ZADD', KEYS[2], ARGV[5], ARGV[1])
return 'marked'
`;

const DELETE_SCRIPT = `
-- ROOM_DIRECTORY_REGISTRATION_DELETE_V2
local raw = redis.call('GET', KEYS[1])
if not raw then
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 'missing'
end
local decoded, current = pcall(cjson.decode, raw)
if not decoded or type(current) ~= 'table' or current.roomId ~= ARGV[2] then
  return 'invalid'
end
if current.targetRoomEpoch ~= ARGV[3] or current.phase ~= ARGV[4] then return 'stale' end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 'deleted'
`;

const GET_SCRIPT = `
-- ROOM_DIRECTORY_REGISTRATION_GET_V2
return redis.call('GET', KEYS[1])
`;

const LIST_SCRIPT = `
-- ROOM_DIRECTORY_REGISTRATION_LIST_V2
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

const RESCHEDULE_SCRIPT = `
-- ROOM_DIRECTORY_REGISTRATION_RESCHEDULE_V2
local raw = redis.call('GET', KEYS[1])
if not raw then
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 'missing'
end
local decoded, current = pcall(cjson.decode, raw)
if not decoded or type(current) ~= 'table' or current.roomId ~= ARGV[2] then
  return 'invalid'
end
if current.targetRoomEpoch ~= ARGV[3] or current.phase ~= ARGV[4] then return 'stale' end
redis.call('ZADD', KEYS[2], ARGV[5], ARGV[1])
return 'rescheduled'
`;

export interface RedisRoomDirectoryRegistrationClient {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}

export type RoomDirectoryRegistrationPhase =
  | 'active'
  | 'closing'
  | 'pending-create'
  | 'projecting';

export type RoomDirectoryRegistration = Omit<RoomDirectoryRecord, 'roomEpoch'> & {
  readonly registrationVersion: typeof REGISTRATION_VERSION;
  readonly phase: RoomDirectoryRegistrationPhase;
  readonly targetRoomEpoch: string;
  readonly projectedRoomEpoch: string | null;
  readonly preparedAtMs: number;
  readonly updatedAtMs: number;
};

type ExactRegistrationInput = {
  readonly roomId: string;
  readonly targetRoomEpoch: string;
};

export type RedisRoomDirectoryRegistrationStore = {
  prepare(input: {
    readonly record: RoomDirectoryRecord;
    readonly preparedAtMs: number;
  }): Promise<void>;
  advanceTarget(input: ExactRegistrationInput & {
    readonly previousTargetRoomEpoch: string;
    readonly lastActivityAt: string;
    readonly updatedAtMs: number;
  }): Promise<{ readonly kind: 'advanced' | 'already' | 'missing' | 'stale' }>;
  confirmProjected(input: ExactRegistrationInput & {
    readonly score: number;
    readonly updatedAtMs: number;
  }): Promise<{ readonly kind: 'confirmed' | 'missing' | 'stale' }>;
  markClosing(input: ExactRegistrationInput & {
    readonly score: number;
    readonly updatedAtMs: number;
  }): Promise<{ readonly kind: 'already' | 'marked' | 'missing' | 'stale' }>;
  delete(input: ExactRegistrationInput & {
    readonly phase: 'closing' | 'pending-create';
  }): Promise<{ readonly kind: 'deleted' | 'missing' | 'stale' }>;
  get(roomId: string): Promise<RoomDirectoryRegistration | null>;
  list(input: { readonly limit: number }): Promise<RoomDirectoryRegistration[]>;
  reschedule(input: ExactRegistrationInput & {
    readonly phase: RoomDirectoryRegistrationPhase;
    readonly score: number;
  }): Promise<{ readonly kind: 'missing' | 'rescheduled' | 'stale' }>;
};

export type RedisRoomDirectoryRegistrationStoreOptions = {
  readonly getClient: () => RedisRoomDirectoryRegistrationClient;
  readonly keyPrefix?: string;
};

const invalid = (code: string): never => {
  throw new Error(code);
};

const positiveUserId = (value: number): boolean => Number.isSafeInteger(value) && value > 0;
const nonNegativeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

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
  return { ...entry.data, roomEpoch: roomEpoch.data, hostUserId: candidate.hostUserId! };
};

const phases = new Set<RoomDirectoryRegistrationPhase>([
  'active',
  'closing',
  'pending-create',
  'projecting',
]);

const parseRegistration = (input: unknown): RoomDirectoryRegistration => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID');
  }
  const candidate = input as Partial<RoomDirectoryRegistration>;
  const record = parseRecord({ ...candidate, roomEpoch: candidate.targetRoomEpoch });
  const projected = candidate.projectedRoomEpoch === null
    ? null
    : OpaqueKeySchema.safeParse(candidate.projectedRoomEpoch);
  if (
    candidate.registrationVersion !== REGISTRATION_VERSION
    || !phases.has(candidate.phase as RoomDirectoryRegistrationPhase)
    || (projected !== null && !projected.success)
    || !nonNegativeInteger(candidate.preparedAtMs ?? -1)
    || !nonNegativeInteger(candidate.updatedAtMs ?? -1)
    || candidate.updatedAtMs! < candidate.preparedAtMs!
    || (candidate.phase === 'pending-create' && projected !== null)
    || (candidate.phase === 'active'
      && (projected === null || projected.data !== record.roomEpoch))
  ) return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID');
  const { roomEpoch: targetRoomEpoch, ...metadata } = record;
  return {
    ...metadata,
    registrationVersion: REGISTRATION_VERSION,
    phase: candidate.phase!,
    targetRoomEpoch,
    projectedRoomEpoch: projected === null ? null : projected.data,
    preparedAtMs: candidate.preparedAtMs!,
    updatedAtMs: candidate.updatedAtMs!,
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

const parseTime = (value: number): string => {
  if (!nonNegativeInteger(value)) {
    return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INPUT_INVALID');
  }
  return String(value);
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
    async prepare(input) {
      const record = parseRecord(input.record);
      const preparedAtMs = parseTime(input.preparedAtMs);
      const registration = parseRegistration({
        ...record,
        roomEpoch: undefined,
        registrationVersion: REGISTRATION_VERSION,
        phase: 'pending-create',
        targetRoomEpoch: record.roomEpoch,
        projectedRoomEpoch: null,
        preparedAtMs: input.preparedAtMs,
        updatedAtMs: input.preparedAtMs,
      });
      const [entryKey, index, member] = keysFor(record.roomId);
      const response = await options.getClient().eval(PREPARE_SCRIPT, {
        keys: [entryKey, index],
        arguments: [member, JSON.stringify(registration), preparedAtMs],
      });
      if (response === 'stored' || response === 'already') return;
      if (response === 'conflict') return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_CONFLICT');
      return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_RESPONSE_INVALID');
    },

    async advanceTarget(input) {
      const [roomId, previousTargetRoomEpoch] = parseIdentity(
        input.roomId,
        input.previousTargetRoomEpoch,
      );
      const targetRoomEpoch = OpaqueKeySchema.safeParse(input.targetRoomEpoch);
      const lastActivityAt = IsoTimestampSchema.safeParse(input.lastActivityAt);
      const updatedAtMs = parseTime(input.updatedAtMs);
      if (
        !targetRoomEpoch.success
        || !lastActivityAt.success
        || targetRoomEpoch.data === previousTargetRoomEpoch
      ) return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INPUT_INVALID');
      const [entryKey] = keysFor(roomId);
      const response = await options.getClient().eval(ADVANCE_TARGET_SCRIPT, {
        keys: [entryKey],
        arguments: [
          roomId,
          previousTargetRoomEpoch,
          targetRoomEpoch.data,
          lastActivityAt.data,
          updatedAtMs,
        ],
      });
      if (response === 'advanced' || response === 'already'
        || response === 'missing' || response === 'stale') return { kind: response };
      if (response === 'invalid') return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID');
      return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_RESPONSE_INVALID');
    },

    async confirmProjected(input) {
      const [roomId, targetRoomEpoch] = parseIdentity(input.roomId, input.targetRoomEpoch);
      const updatedAtMs = parseTime(input.updatedAtMs);
      const score = parseTime(input.score);
      const [entryKey, index, member] = keysFor(roomId);
      const response = await options.getClient().eval(CONFIRM_PROJECTED_SCRIPT, {
        keys: [entryKey, index],
        arguments: [member, roomId, targetRoomEpoch, updatedAtMs, score],
      });
      if (response === 'confirmed' || response === 'missing' || response === 'stale') {
        return { kind: response };
      }
      if (response === 'invalid') return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID');
      return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_RESPONSE_INVALID');
    },

    async markClosing(input) {
      const [roomId, targetRoomEpoch] = parseIdentity(input.roomId, input.targetRoomEpoch);
      const updatedAtMs = parseTime(input.updatedAtMs);
      const score = parseTime(input.score);
      const [entryKey, index, member] = keysFor(roomId);
      const response = await options.getClient().eval(MARK_CLOSING_SCRIPT, {
        keys: [entryKey, index],
        arguments: [member, roomId, targetRoomEpoch, updatedAtMs, score],
      });
      if (response === 'already' || response === 'marked'
        || response === 'missing' || response === 'stale') return { kind: response };
      if (response === 'invalid') return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID');
      return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_RESPONSE_INVALID');
    },

    async delete(input) {
      const [roomId, targetRoomEpoch] = parseIdentity(input.roomId, input.targetRoomEpoch);
      if (input.phase !== 'closing' && input.phase !== 'pending-create') {
        return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INPUT_INVALID');
      }
      const [entryKey, index, member] = keysFor(roomId);
      const response = await options.getClient().eval(DELETE_SCRIPT, {
        keys: [entryKey, index],
        arguments: [member, roomId, targetRoomEpoch, input.phase],
      });
      if (response === 'deleted' || response === 'missing' || response === 'stale') {
        return { kind: response };
      }
      if (response === 'invalid') return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID');
      return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_RESPONSE_INVALID');
    },

    async get(inputRoomId) {
      const roomId = OpaqueKeySchema.safeParse(inputRoomId);
      if (!roomId.success) return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INPUT_INVALID');
      const [entryKey] = keysFor(roomId.data);
      const response = await options.getClient().eval(GET_SCRIPT, {
        keys: [entryKey],
        arguments: [],
      });
      if (response === null) return null;
      if (typeof response !== 'string') {
        return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_RESPONSE_INVALID');
      }
      try {
        return parseRegistration(JSON.parse(response));
      } catch {
        return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID');
      }
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
          return parseRegistration(JSON.parse(raw));
        } catch {
          return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID');
        }
      });
    },

    async reschedule(input) {
      const [roomId, targetRoomEpoch] = parseIdentity(input.roomId, input.targetRoomEpoch);
      if (!phases.has(input.phase)) {
        return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INPUT_INVALID');
      }
      const score = parseTime(input.score);
      const [entryKey, index, member] = keysFor(roomId);
      const response = await options.getClient().eval(RESCHEDULE_SCRIPT, {
        keys: [entryKey, index],
        arguments: [member, roomId, targetRoomEpoch, input.phase, score],
      });
      if (response === 'missing' || response === 'rescheduled' || response === 'stale') {
        return { kind: response };
      }
      if (response === 'invalid') return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID');
      return invalid('REDIS_ROOM_DIRECTORY_REGISTRATION_RESPONSE_INVALID');
    },
  });
};
