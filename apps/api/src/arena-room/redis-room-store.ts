import { createHash } from 'node:crypto';

import {
  ARENA_ROOM_AUTHORITY_STATE_VERSION,
  checkpointPredecessorOf,
  parseArenaRoomAuthorityState,
  type ArenaRoomAuthorityState,
  type ArenaRoomCheckpointPredecessor,
} from '@mahoshojo/multiplayer-core';

const ROOM_CHECKPOINT_VERSION = 1 as const;
const DEFAULT_ACTIVE_TTL_SECONDS = 3_600;
const DEFAULT_TERMINAL_TTL_SECONDS = 300;
const KEY_PREFIX = 'mahoshojo:room:v1';

const SAVE_SCRIPT = `
-- ROOM_CHECKPOINT_SAVE_V1
local raw = redis.call('GET', KEYS[1])
if ARGV[1] == 'absent' then
  if raw then return 'conflict' end
elseif ARGV[1] == 'match' then
  if not raw then return 'conflict' end
  local decoded, current = pcall(cjson.decode, raw)
  if not decoded or type(current) ~= 'table' then return 'invalid-existing' end
  if current.checkpointVersion ~= tonumber(ARGV[2])
    or current.roomId ~= ARGV[3]
    or current.roomEpoch ~= ARGV[4]
    or current.revision ~= tonumber(ARGV[5])
    or current.controlSeq ~= tonumber(ARGV[6]) then
    return 'conflict'
  end
else
  return 'invalid-request'
end
redis.call('SET', KEYS[1], ARGV[7], 'PX', ARGV[8])
return 'saved'
`;

const DELETE_SCRIPT = `
-- ROOM_CHECKPOINT_DELETE_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local decoded, current = pcall(cjson.decode, raw)
if not decoded or type(current) ~= 'table' then return 'invalid-existing' end
if current.checkpointVersion ~= tonumber(ARGV[1])
  or current.roomId ~= ARGV[2]
  or current.roomEpoch ~= ARGV[3]
  or current.revision ~= tonumber(ARGV[4])
  or current.controlSeq ~= tonumber(ARGV[5]) then
  return 'conflict'
end
redis.call('DEL', KEYS[1])
return 'deleted'
`;

const EXPIRE_SCRIPT = `
-- ROOM_CHECKPOINT_EXPIRE_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local decoded, current = pcall(cjson.decode, raw)
if not decoded or type(current) ~= 'table' then return 'invalid-existing' end
if current.checkpointVersion ~= tonumber(ARGV[1])
  or current.roomId ~= ARGV[2]
  or current.roomEpoch ~= ARGV[3]
  or current.revision ~= tonumber(ARGV[4])
  or current.controlSeq ~= tonumber(ARGV[5]) then
  return 'conflict'
end
redis.call('PEXPIRE', KEYS[1], ARGV[6])
return 'expired'
`;

export interface RedisRoomClient {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

export type RedisRoomStoreOptions = {
  getClient(): RedisRoomClient;
  keyPrefix?: string;
  activeTtlSeconds?: number;
  terminalTtlSeconds?: number;
};

export type RedisRoomStoreSaveResult = { readonly kind: 'saved' | 'conflict' };
export type RedisRoomStoreDeleteResult = { readonly kind: 'deleted' | 'missing' | 'conflict' };
export type RedisRoomStoreExpireResult = { readonly kind: 'expired' | 'missing' | 'conflict' };

export interface RedisRoomStore {
  load(roomId: string): Promise<ArenaRoomAuthorityState | null>;
  save(input: {
    checkpoint: ArenaRoomAuthorityState;
    expected: ArenaRoomCheckpointPredecessor | null;
  }): Promise<RedisRoomStoreSaveResult>;
  delete(input: {
    roomId: string;
    expected: ArenaRoomCheckpointPredecessor;
  }): Promise<RedisRoomStoreDeleteResult>;
  expire(input: {
    roomId: string;
    expected: ArenaRoomCheckpointPredecessor;
  }): Promise<RedisRoomStoreExpireResult>;
}

type StoredRoomCheckpoint = {
  checkpointVersion: typeof ROOM_CHECKPOINT_VERSION;
  roomId: string;
  roomEpoch: string;
  revision: number;
  controlSeq: number;
  state: ArenaRoomAuthorityState;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isRoomId = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length >= 1
  && value.length <= 256
  && value.trim() === value
);

const isCheckpointPredecessor = (value: unknown): value is ArenaRoomCheckpointPredecessor => {
  if (!isRecord(value)) return false;
  return isRoomId(value.roomId)
    && isRoomId(value.roomEpoch)
    && Number.isSafeInteger(value.revision)
    && Number(value.revision) >= 0
    && Number.isSafeInteger(value.controlSeq)
    && Number(value.controlSeq) >= 0;
};

const ttlMs = (seconds: number, optionName: string): number => {
  if (!Number.isFinite(seconds) || seconds < 1) {
    throw new Error(`${optionName} 必须是正有限数字`);
  }
  return Math.floor(seconds * 1_000);
};

const parseStoredCheckpoint = (raw: string, expectedRoomId: string): StoredRoomCheckpoint => {
  try {
    const candidate: unknown = JSON.parse(raw);
    if (!isRecord(candidate)) throw new Error('invalid');
    const keys = Object.keys(candidate).sort();
    if (keys.join('|') !== 'checkpointVersion|controlSeq|revision|roomEpoch|roomId|state') {
      throw new Error('invalid');
    }
    if (
      candidate.checkpointVersion !== ROOM_CHECKPOINT_VERSION
      || candidate.roomId !== expectedRoomId
      || !isRoomId(candidate.roomEpoch)
      || !Number.isSafeInteger(candidate.revision)
      || Number(candidate.revision) < 0
      || !Number.isSafeInteger(candidate.controlSeq)
      || Number(candidate.controlSeq) < 0
    ) {
      throw new Error('invalid');
    }
    const state = parseArenaRoomAuthorityState(candidate.state);
    const predecessor = checkpointPredecessorOf(state);
    if (
      state.authorityStateVersion !== ARENA_ROOM_AUTHORITY_STATE_VERSION
      || predecessor.roomId !== candidate.roomId
      || predecessor.roomEpoch !== candidate.roomEpoch
      || predecessor.revision !== candidate.revision
      || predecessor.controlSeq !== candidate.controlSeq
    ) {
      throw new Error('invalid');
    }
    return {
      checkpointVersion: ROOM_CHECKPOINT_VERSION,
      roomId: predecessor.roomId,
      roomEpoch: predecessor.roomEpoch,
      revision: predecessor.revision,
      controlSeq: predecessor.controlSeq,
      state,
    };
  } catch {
    throw new Error('REDIS_ROOM_CHECKPOINT_INVALID');
  }
};

const createStoredCheckpoint = (input: unknown): StoredRoomCheckpoint => {
  let state: ArenaRoomAuthorityState;
  try {
    state = parseArenaRoomAuthorityState(input);
  } catch {
    throw new Error('REDIS_ROOM_CHECKPOINT_INVALID');
  }
  const predecessor = checkpointPredecessorOf(state);
  return {
    checkpointVersion: ROOM_CHECKPOINT_VERSION,
    roomId: predecessor.roomId,
    roomEpoch: predecessor.roomEpoch,
    revision: predecessor.revision,
    controlSeq: predecessor.controlSeq,
    state,
  };
};

const predecessorArguments = (expected: ArenaRoomCheckpointPredecessor): string[] => [
  String(ROOM_CHECKPOINT_VERSION),
  expected.roomId,
  expected.roomEpoch,
  String(expected.revision),
  String(expected.controlSeq),
];

const parseMutationResult = <T extends string>(
  raw: unknown,
  allowed: readonly T[],
): { readonly kind: T } => {
  if (raw === 'invalid-existing') throw new Error('REDIS_ROOM_CHECKPOINT_INVALID');
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) {
    throw new Error('REDIS_ROOM_CHECKPOINT_RESPONSE_INVALID');
  }
  return { kind: raw as T };
};

export const createRedisRoomStore = (options: RedisRoomStoreOptions): RedisRoomStore => {
  const environmentPrefix = options.keyPrefix?.trim();
  if (environmentPrefix && !/^[a-z0-9_-]{1,32}$/u.test(environmentPrefix)) {
    throw new Error('keyPrefix 必须是安全的环境标识');
  }
  const keyPrefix = environmentPrefix ? `${KEY_PREFIX}:${environmentPrefix}` : KEY_PREFIX;
  const roomKey = (roomId: string): string => {
    if (!isRoomId(roomId)) throw new Error('REDIS_ROOM_ID_INVALID');
    const roomHash = createHash('sha256').update(roomId).digest('hex');
    return `${keyPrefix}:${roomHash}:checkpoint`;
  };
  const activeTtlMs = ttlMs(
    options.activeTtlSeconds ?? DEFAULT_ACTIVE_TTL_SECONDS,
    'activeTtlSeconds',
  );
  const terminalTtlMs = ttlMs(
    options.terminalTtlSeconds ?? DEFAULT_TERMINAL_TTL_SECONDS,
    'terminalTtlSeconds',
  );

  return Object.freeze({
    async load(roomId) {
      const raw = await options.getClient().get(roomKey(roomId));
      return raw === null ? null : parseStoredCheckpoint(raw, roomId).state;
    },

    async save(input) {
      const stored = createStoredCheckpoint(input.checkpoint);
      if (input.expected !== null && !isCheckpointPredecessor(input.expected)) {
        throw new Error('REDIS_ROOM_PREDECESSOR_INVALID');
      }
      if (input.expected !== null && input.expected.roomId !== stored.roomId) {
        throw new Error('REDIS_ROOM_PREDECESSOR_INVALID');
      }
      const expectedArguments = input.expected === null
        ? [
            'absent',
            String(ROOM_CHECKPOINT_VERSION),
            stored.roomId,
            '',
            '-1',
            '-1',
          ]
        : ['match', ...predecessorArguments(input.expected)];
      const raw = await options.getClient().eval(SAVE_SCRIPT, {
        keys: [roomKey(stored.roomId)],
        arguments: [
          ...expectedArguments,
          JSON.stringify(stored),
          String(stored.state.lifecycle.status === 'open' ? activeTtlMs : terminalTtlMs),
        ],
      });
      return parseMutationResult(raw, ['saved', 'conflict'] as const);
    },

    async delete(input) {
      if (!isRoomId(input.roomId)
        || !isCheckpointPredecessor(input.expected)
        || input.expected.roomId !== input.roomId) {
        throw new Error('REDIS_ROOM_PREDECESSOR_INVALID');
      }
      const raw = await options.getClient().eval(DELETE_SCRIPT, {
        keys: [roomKey(input.roomId)],
        arguments: predecessorArguments(input.expected),
      });
      return parseMutationResult(raw, ['deleted', 'missing', 'conflict'] as const);
    },

    async expire(input) {
      if (!isRoomId(input.roomId)
        || !isCheckpointPredecessor(input.expected)
        || input.expected.roomId !== input.roomId) {
        throw new Error('REDIS_ROOM_PREDECESSOR_INVALID');
      }
      const raw = await options.getClient().eval(EXPIRE_SCRIPT, {
        keys: [roomKey(input.roomId)],
        arguments: [...predecessorArguments(input.expected), String(terminalTtlMs)],
      });
      return parseMutationResult(raw, ['expired', 'missing', 'conflict'] as const);
    },
  } satisfies RedisRoomStore);
};
