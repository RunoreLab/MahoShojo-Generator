import { createHash } from 'node:crypto';

import {
  ARENA_ROOM_AUTHORITY_STATE_VERSION,
  checkpointPredecessorOf,
  consumeArenaRoomCheckpointCommit,
  parseArenaRoomAuthorityState,
  type ArenaRoomAuthorityState,
  type ArenaRoomCheckpointCommit,
  type ArenaRoomCheckpointPredecessor,
} from '@mahoshojo/multiplayer-core';

const ACTIVE_ROOM_CHECKPOINT_VERSION = 1 as const;
const EXPIRING_ROOM_CHECKPOINT_VERSION = 2 as const;
const DEFAULT_ACTIVE_TTL_SECONDS = 3_600;
const DEFAULT_TERMINAL_TTL_SECONDS = 300;
// Checkpoint TTL 结束 Room incarnation；该有界负向 ledger 故意不设 TTL，避免迟到 create
// receipt 在相同 roomEpoch 上复活已结束的 incarnation。达到配额后必须改用新 Room ID。
const MAX_ROOM_INCARNATIONS = 16;
const KEY_PREFIX = 'mahoshojo:room:v1';

const SAVE_SCRIPT = `
-- ROOM_CHECKPOINT_SAVE_V1
local candidateDecoded, candidate = pcall(cjson.decode, ARGV[7])
if not candidateDecoded or type(candidate) ~= 'table'
  or candidate.checkpointVersion ~= tonumber(ARGV[2])
  or candidate.expiryFence ~= nil
  or candidate.roomId ~= ARGV[3] then
  return 'invalid-successor'
end
local raw = redis.call('GET', KEYS[1])
local fenceTypeReply = redis.call('TYPE', KEYS[2])
local fenceType = type(fenceTypeReply) == 'table' and fenceTypeReply.ok or fenceTypeReply
if fenceType ~= 'none' and fenceType ~= 'set' then return 'invalid-fence' end
local epochSeen = redis.call('SISMEMBER', KEYS[2], candidate.roomEpoch)
local fenceCount = redis.call('SCARD', KEYS[2])
if ARGV[1] == 'absent' then
  if raw then return 'conflict' end
  if epochSeen == 1 then return 'conflict' end
  if candidate.revision ~= 0 or candidate.controlSeq ~= 0 then
    return 'invalid-successor'
  end
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
  local currentActive = current.checkpointVersion == 1 and current.expiryFence == nil
  local currentExpiring = current.checkpointVersion == 2 and current.expiryFence == 'expiring'
  if currentExpiring then return 'conflict' end
  if not currentActive then return 'invalid-existing' end
  if raw ~= ARGV[9] then return 'conflict' end
  if candidate.roomEpoch ~= current.roomEpoch
    or candidate.controlSeq <= current.controlSeq
    or candidate.revision < current.revision
    or candidate.revision > current.revision + 1 then
    return 'invalid-successor'
  end
else
  return 'invalid-request'
end
if epochSeen == 0 and fenceCount >= tonumber(ARGV[10]) then
  return 'incarnation-limit'
end
redis.call('SADD', KEYS[2], candidate.roomEpoch)
redis.call('SET', KEYS[1], ARGV[7], 'PX', ARGV[8])
return 'saved'
`;

const DELETE_SCRIPT = `
-- ROOM_CHECKPOINT_DELETE_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local decoded, current = pcall(cjson.decode, raw)
if not decoded or type(current) ~= 'table' then return 'invalid-existing' end
if current.roomId ~= ARGV[2]
  or current.roomEpoch ~= ARGV[3]
  or current.revision ~= tonumber(ARGV[4])
  or current.controlSeq ~= tonumber(ARGV[5]) then
  return 'conflict'
end
local currentActive = current.checkpointVersion == 1 and current.expiryFence == nil
local currentExpiring = current.checkpointVersion == 2 and current.expiryFence == 'expiring'
if not currentActive and not currentExpiring then
  return 'invalid-existing'
end
if currentActive and raw ~= ARGV[6] then return 'conflict' end
if currentExpiring and raw ~= ARGV[7] then return 'conflict' end
local fenceTypeReply = redis.call('TYPE', KEYS[2])
local fenceType = type(fenceTypeReply) == 'table' and fenceTypeReply.ok or fenceTypeReply
if fenceType ~= 'none' and fenceType ~= 'set' then return 'invalid-fence' end
local epochSeen = redis.call('SISMEMBER', KEYS[2], ARGV[3])
local fenceCount = redis.call('SCARD', KEYS[2])
if epochSeen == 0 and fenceCount >= tonumber(ARGV[8]) then
  return 'incarnation-limit'
end
redis.call('SADD', KEYS[2], ARGV[3])
redis.call('DEL', KEYS[1])
return 'deleted'
`;

const EXPIRE_SCRIPT = `
-- ROOM_CHECKPOINT_EXPIRE_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local decoded, current = pcall(cjson.decode, raw)
if not decoded or type(current) ~= 'table' then return 'invalid-existing' end
if current.roomId ~= ARGV[2]
  or current.roomEpoch ~= ARGV[3]
  or current.revision ~= tonumber(ARGV[4])
  or current.controlSeq ~= tonumber(ARGV[5]) then
  return 'conflict'
end
local currentActive = current.checkpointVersion == 1 and current.expiryFence == nil
local currentExpiring = current.checkpointVersion == 2 and current.expiryFence == 'expiring'
if not currentActive and not currentExpiring then
  return 'invalid-existing'
end
if currentActive and raw ~= ARGV[7] then return 'conflict' end
if currentExpiring and raw ~= ARGV[8] then return 'conflict' end
local fenceTypeReply = redis.call('TYPE', KEYS[2])
local fenceType = type(fenceTypeReply) == 'table' and fenceTypeReply.ok or fenceTypeReply
if fenceType ~= 'none' and fenceType ~= 'set' then return 'invalid-fence' end
local epochSeen = redis.call('SISMEMBER', KEYS[2], ARGV[3])
local fenceCount = redis.call('SCARD', KEYS[2])
if epochSeen == 0 and fenceCount >= tonumber(ARGV[9]) then
  return 'incarnation-limit'
end
redis.call('SADD', KEYS[2], ARGV[3])
local currentTtl = redis.call('PTTL', KEYS[1])
if currentTtl == 0 then
  redis.call('DEL', KEYS[1])
  return 'expired'
end
local targetTtl = tonumber(ARGV[6])
if currentTtl > 0 and currentTtl < targetTtl then
  targetTtl = currentTtl
end
redis.call('SET', KEYS[1], ARGV[8], 'PX', targetTtl)
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
    commit: ArenaRoomCheckpointCommit;
  }): Promise<RedisRoomStoreSaveResult>;
  delete(input: {
    checkpoint: ArenaRoomAuthorityState;
  }): Promise<RedisRoomStoreDeleteResult>;
  expire(input: {
    checkpoint: ArenaRoomAuthorityState;
  }): Promise<RedisRoomStoreExpireResult>;
}

type StoredRoomCheckpoint = {
  checkpointVersion: typeof ACTIVE_ROOM_CHECKPOINT_VERSION | typeof EXPIRING_ROOM_CHECKPOINT_VERSION;
  expiryFence?: 'expiring';
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
    const activeKeys = 'checkpointVersion|controlSeq|revision|roomEpoch|roomId|state';
    const expiringKeys = 'checkpointVersion|controlSeq|expiryFence|revision|roomEpoch|roomId|state';
    const serializedKeys = keys.join('|');
    const activeEnvelope = candidate.checkpointVersion === ACTIVE_ROOM_CHECKPOINT_VERSION
      && serializedKeys === activeKeys
      && candidate.expiryFence === undefined;
    const expiringEnvelope = candidate.checkpointVersion === EXPIRING_ROOM_CHECKPOINT_VERSION
      && serializedKeys === expiringKeys
      && candidate.expiryFence === 'expiring';
    if (!activeEnvelope && !expiringEnvelope) {
      throw new Error('invalid');
    }
    if (
      candidate.roomId !== expectedRoomId
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
      checkpointVersion: candidate.checkpointVersion as StoredRoomCheckpoint['checkpointVersion'],
      ...(candidate.expiryFence === 'expiring' ? { expiryFence: 'expiring' as const } : {}),
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
    checkpointVersion: ACTIVE_ROOM_CHECKPOINT_VERSION,
    roomId: predecessor.roomId,
    roomEpoch: predecessor.roomEpoch,
    revision: predecessor.revision,
    controlSeq: predecessor.controlSeq,
    state,
  };
};

const createExpiringStoredCheckpoint = (input: unknown): StoredRoomCheckpoint => {
  const active = createStoredCheckpoint(input);
  return {
    checkpointVersion: EXPIRING_ROOM_CHECKPOINT_VERSION,
    expiryFence: 'expiring',
    roomId: active.roomId,
    roomEpoch: active.roomEpoch,
    revision: active.revision,
    controlSeq: active.controlSeq,
    state: active.state,
  };
};

const predecessorArguments = (expected: ArenaRoomCheckpointPredecessor): string[] => [
  String(ACTIVE_ROOM_CHECKPOINT_VERSION),
  expected.roomId,
  expected.roomEpoch,
  String(expected.revision),
  String(expected.controlSeq),
];

const isValidSuccessor = (
  stored: StoredRoomCheckpoint,
  expected: ArenaRoomCheckpointPredecessor | null,
): boolean => {
  if (expected === null) {
    return stored.revision === 0
      && stored.controlSeq === 0
      && stored.state.lifecycle.status === 'open';
  }
  return stored.roomEpoch === expected.roomEpoch
    && stored.controlSeq > expected.controlSeq
    && stored.revision >= expected.revision
    && stored.revision <= expected.revision + 1;
};

const parseMutationResult = <T extends string>(
  raw: unknown,
  allowed: readonly T[],
): { readonly kind: T } => {
  if (raw === 'invalid-existing') throw new Error('REDIS_ROOM_CHECKPOINT_INVALID');
  if (raw === 'invalid-fence') throw new Error('REDIS_ROOM_INCARNATION_FENCE_INVALID');
  if (raw === 'incarnation-limit') throw new Error('REDIS_ROOM_INCARNATION_LIMIT');
  if (raw === 'invalid-successor') throw new Error('REDIS_ROOM_SUCCESSOR_INVALID');
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
  const roomHash = (roomId: string): string => {
    if (!isRoomId(roomId)) throw new Error('REDIS_ROOM_ID_INVALID');
    return createHash('sha256').update(roomId).digest('hex');
  };
  const roomKey = (roomId: string): string => `${keyPrefix}:${roomHash(roomId)}:checkpoint`;
  const incarnationFenceKey = (roomId: string): string => (
    `${keyPrefix}:${roomHash(roomId)}:incarnations`
  );
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
      if (raw === null) return null;
      const stored = parseStoredCheckpoint(raw, roomId);
      return stored.checkpointVersion === EXPIRING_ROOM_CHECKPOINT_VERSION ? null : stored.state;
    },

    async save(input) {
      let commit;
      try {
        commit = consumeArenaRoomCheckpointCommit(input.commit);
      } catch {
        throw new Error('REDIS_ROOM_TRANSITION_COMMIT_INVALID');
      }
      const stored = createStoredCheckpoint(commit.nextState);
      const expected = commit.predecessor;
      const expectedStored = commit.predecessorState === null
        ? null
        : createStoredCheckpoint(commit.predecessorState);
      if ((expected === null) !== (expectedStored === null)) {
        throw new Error('REDIS_ROOM_TRANSITION_COMMIT_INVALID');
      }
      if (expected !== null && !isCheckpointPredecessor(expected)) {
        throw new Error('REDIS_ROOM_PREDECESSOR_INVALID');
      }
      if (expected !== null && expected.roomId !== stored.roomId) {
        throw new Error('REDIS_ROOM_PREDECESSOR_INVALID');
      }
      if (!isValidSuccessor(stored, expected)) {
        throw new Error('REDIS_ROOM_SUCCESSOR_INVALID');
      }
      if (expected !== null && expectedStored !== null) {
        const statePredecessor = checkpointPredecessorOf(expectedStored.state);
        if (
          statePredecessor.roomId !== expected.roomId
          || statePredecessor.roomEpoch !== expected.roomEpoch
          || statePredecessor.revision !== expected.revision
          || statePredecessor.controlSeq !== expected.controlSeq
        ) {
          throw new Error('REDIS_ROOM_TRANSITION_COMMIT_INVALID');
        }
      }
      const expectedArguments = expected === null
        ? [
            'absent',
            String(ACTIVE_ROOM_CHECKPOINT_VERSION),
            stored.roomId,
            '',
            '-1',
            '-1',
          ]
        : ['match', ...predecessorArguments(expected)];
      const raw = await options.getClient().eval(SAVE_SCRIPT, {
        keys: [roomKey(stored.roomId), incarnationFenceKey(stored.roomId)],
        arguments: [
          ...expectedArguments,
          JSON.stringify(stored),
          String(stored.state.lifecycle.status === 'open' ? activeTtlMs : terminalTtlMs),
          expectedStored === null ? '' : JSON.stringify(expectedStored),
          String(MAX_ROOM_INCARNATIONS),
        ],
      });
      return parseMutationResult(raw, ['saved', 'conflict'] as const);
    },

    async delete(input) {
      const active = createStoredCheckpoint(input.checkpoint);
      const expiring = createExpiringStoredCheckpoint(active.state);
      const expected = checkpointPredecessorOf(active.state);
      const raw = await options.getClient().eval(DELETE_SCRIPT, {
        keys: [roomKey(active.roomId), incarnationFenceKey(active.roomId)],
        arguments: [
          ...predecessorArguments(expected),
          JSON.stringify(active),
          JSON.stringify(expiring),
          String(MAX_ROOM_INCARNATIONS),
        ],
      });
      return parseMutationResult(raw, ['deleted', 'missing', 'conflict'] as const);
    },

    async expire(input) {
      const active = createStoredCheckpoint(input.checkpoint);
      const expiring = createExpiringStoredCheckpoint(active.state);
      const expected = checkpointPredecessorOf(active.state);
      const raw = await options.getClient().eval(EXPIRE_SCRIPT, {
        keys: [roomKey(active.roomId), incarnationFenceKey(active.roomId)],
        arguments: [
          ...predecessorArguments(expected),
          String(terminalTtlMs),
          JSON.stringify(active),
          JSON.stringify(expiring),
          String(MAX_ROOM_INCARNATIONS),
        ],
      });
      return parseMutationResult(raw, ['expired', 'missing', 'conflict'] as const);
    },
  } satisfies RedisRoomStore);
};
