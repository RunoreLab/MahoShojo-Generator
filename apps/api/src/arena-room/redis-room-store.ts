import {
  ARENA_ROOM_AUTHORITY_STATE_VERSION,
  checkpointPredecessorOf,
  consumeArenaRoomCheckpointCommit,
  migrateArenaRoomAuthorityStateV1,
  parseArenaRoomAuthorityState,
  type ArenaRoomAuthorityState,
  type ArenaRoomCheckpointCommit,
  type ArenaRoomCheckpointPredecessor,
} from '@mahoshojo/multiplayer-core';

import { createArenaRoomRedisKeyspace } from './redis-room-keyspace';
import {
  createStoredRoomDirectoryRecord,
  roomDirectoryPublicIndexMember,
  serializeStoredRoomDirectoryRecord,
  type RoomDirectoryRecord,
} from './room-directory-record';

const ACTIVE_ROOM_CHECKPOINT_VERSION = 1 as const;
const EXPIRING_ROOM_CHECKPOINT_VERSION = 2 as const;
const DEFAULT_ACTIVE_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_TERMINAL_TTL_SECONDS = 300;
// Checkpoint TTL 结束 Room incarnation；该有界负向 ledger 故意不设 TTL，避免迟到 create
// receipt 在相同 roomEpoch 上复活已结束的 incarnation。达到配额后必须改用新 Room ID。
const MAX_ROOM_INCARNATIONS = 16;

const BOOTSTRAP_FENCE_SCRIPT = `
-- ROOM_CHECKPOINT_BOOTSTRAP_FENCE_V1
local raw = redis.call('GET', KEYS[1])
if raw and raw ~= ARGV[1] then return 'conflict' end
local decoded, current = pcall(cjson.decode, ARGV[1])
if not decoded or type(current) ~= 'table'
  or current.checkpointVersion ~= 1
  or current.expiryFence ~= nil
  or current.roomId ~= ARGV[2]
  or current.roomEpoch ~= ARGV[3] then
  return 'invalid-existing'
end
local fenceTypeReply = redis.call('TYPE', KEYS[2])
local fenceType = type(fenceTypeReply) == 'table' and fenceTypeReply.ok or fenceTypeReply
if fenceType ~= 'none' and fenceType ~= 'set' then return 'invalid-fence' end
if redis.call('SISMEMBER', KEYS[2], current.roomEpoch) == 1 then
  return raw and 'already' or 'expired'
end
if redis.call('SCARD', KEYS[2]) >= tonumber(ARGV[4]) then return 'incarnation-limit' end
redis.call('SADD', KEYS[2], current.roomEpoch)
return raw and 'seeded' or 'expired'
`;

const MIGRATE_AUTHORITY_V1_SCRIPT = `
-- ROOM_CHECKPOINT_AUTHORITY_V1_MIGRATE_V2
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
if raw ~= ARGV[1] then return 'conflict' end
local oldDecoded, old = pcall(cjson.decode, raw)
local nextDecoded, successor = pcall(cjson.decode, ARGV[2])
if not oldDecoded or type(old) ~= 'table'
  or not nextDecoded or type(successor) ~= 'table'
  or old.checkpointVersion ~= 1
  or old.expiryFence ~= nil
  or successor.checkpointVersion ~= 1
  or successor.expiryFence ~= nil
  or old.roomId ~= successor.roomId
  or old.roomEpoch ~= successor.roomEpoch
  or old.revision ~= successor.revision
  or old.controlSeq ~= successor.controlSeq
  or type(old.state) ~= 'table'
  or old.state.authorityStateVersion ~= 1
  or type(successor.state) ~= 'table'
  or successor.state.authorityStateVersion ~= 2 then
  return 'invalid-existing'
end
redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
return 'migrated'
`;

const SAVE_SCRIPT = `
-- ROOM_CHECKPOINT_SAVE_V1
local candidateDecoded, candidate = pcall(cjson.decode, ARGV[7])
if not candidateDecoded or type(candidate) ~= 'table'
  or candidate.checkpointVersion ~= tonumber(ARGV[2])
  or candidate.expiryFence ~= nil
  or candidate.roomId ~= ARGV[3]
  or type(candidate.state) ~= 'table'
  or type(candidate.state.lifecycle) ~= 'table'
  or (candidate.state.lifecycle.status ~= 'open'
    and candidate.state.lifecycle.status ~= 'closed')
  or type(candidate.state.lifecycle.updatedAt) ~= 'string' then
  return 'invalid-successor'
end
local directoryRecordTypeReply = redis.call('TYPE', KEYS[3])
local directoryRecordType = type(directoryRecordTypeReply) == 'table'
  and directoryRecordTypeReply.ok or directoryRecordTypeReply
local directoryIndexTypeReply = redis.call('TYPE', KEYS[4])
local directoryIndexType = type(directoryIndexTypeReply) == 'table'
  and directoryIndexTypeReply.ok or directoryIndexTypeReply
if (directoryRecordType ~= 'none' and directoryRecordType ~= 'string')
  or (directoryIndexType ~= 'none' and directoryIndexType ~= 'zset') then
  return 'directory-storage-invalid'
end
local raw = redis.call('GET', KEYS[1])
local directoryRaw = redis.call('GET', KEYS[3])
local fenceTypeReply = redis.call('TYPE', KEYS[2])
local fenceType = type(fenceTypeReply) == 'table' and fenceTypeReply.ok or fenceTypeReply
if fenceType ~= 'none' and fenceType ~= 'set' then return 'invalid-fence' end
local epochSeen = redis.call('SISMEMBER', KEYS[2], candidate.roomEpoch)
local fenceCount = redis.call('SCARD', KEYS[2])
local currentEpochToFence = nil
local current = nil
local directoryAction = 'none'
local directoryNextRaw = nil
local directoryStoredIndexMember = nil
local directoryNextIndexMember = ''
if ARGV[1] == 'absent' then
  if raw then return 'conflict' end
  if epochSeen == 1 then return 'conflict' end
  if candidate.revision ~= 0 or candidate.controlSeq ~= 0 then
    return 'invalid-successor'
  end
  if directoryRaw then return 'directory-conflict' end
  if ARGV[11] == '' then
    if ARGV[12] ~= '' then return 'directory-create-invalid' end
  else
    local directoryDecoded, directory = pcall(cjson.decode, ARGV[11])
    if not directoryDecoded or type(directory) ~= 'table'
      or directory.directoryVersion ~= 1
      or directory.roomId ~= candidate.roomId
      or directory.roomEpoch ~= candidate.roomEpoch
      or directory.status ~= 'open'
      or type(candidate.state) ~= 'table'
      or type(candidate.state.lifecycle) ~= 'table'
      or candidate.state.lifecycle.status ~= 'open'
      or directory.createdAt ~= candidate.state.lifecycle.createdAt
      or directory.lastActivityAt ~= candidate.state.lifecycle.updatedAt then
      return 'directory-create-invalid'
    end
    if directory.visibility == 'public' then
      if ARGV[12] == '' or directory.publicIndexMember ~= ARGV[12] then
        return 'directory-create-invalid'
      end
    elseif directory.visibility == 'unlisted' then
      if ARGV[12] ~= '' or directory.publicIndexMember ~= cjson.null then
        return 'directory-create-invalid'
      end
    else
      return 'directory-create-invalid'
    end
    directoryAction = 'create'
    directoryNextRaw = ARGV[11]
    directoryNextIndexMember = ARGV[12]
  end
elseif ARGV[1] == 'match' then
  if ARGV[11] ~= '' or ARGV[12] ~= '' then return 'directory-create-invalid' end
  if not raw then return 'conflict' end
  local decoded
  decoded, current = pcall(cjson.decode, raw)
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
  local currentEpochSeen = redis.call('SISMEMBER', KEYS[2], current.roomEpoch)
  if current.roomEpoch ~= candidate.roomEpoch and currentEpochSeen == 0 then
    currentEpochToFence = current.roomEpoch
  end
  if candidate.roomEpoch == current.roomEpoch then
    if candidate.controlSeq <= current.controlSeq
      or candidate.revision < current.revision
      or candidate.revision > current.revision + 1 then
      return 'invalid-successor'
    end
  else
    if epochSeen == 1 then return 'conflict' end
    if candidate.controlSeq ~= 0 or candidate.revision ~= current.revision then
      return 'invalid-successor'
    end
  end
  if directoryRaw then
    local directoryDecoded, directory = pcall(cjson.decode, directoryRaw)
    if directoryDecoded and type(directory) == 'table'
      and type(directory.publicIndexMember) == 'string' then
      directoryStoredIndexMember = directory.publicIndexMember
    end
    if candidate.state.lifecycle.status == 'closed' then
      directoryAction = 'remove'
    else
      local validDirectory = directoryDecoded and type(directory) == 'table'
        and directory.directoryVersion == 1
        and directory.roomId == candidate.roomId
        and directory.roomEpoch == current.roomEpoch
        and directory.status == 'open'
        and (directory.visibility == 'public' or directory.visibility == 'unlisted')
      if not validDirectory then
        directoryAction = 'remove'
      else
        directory.roomEpoch = candidate.roomEpoch
        directory.lastActivityAt = candidate.state.lifecycle.updatedAt
        if directory.visibility == 'public' then
          if ARGV[14] == '' then return 'directory-create-invalid' end
          directory.publicIndexMember = ARGV[14]
          directoryNextIndexMember = ARGV[14]
        else
          directory.publicIndexMember = cjson.null
        end
        directoryAction = 'update'
        directoryNextRaw = cjson.encode(directory)
      end
    end
  elseif candidate.state.lifecycle.status == 'closed' then
    directoryAction = 'remove'
  end
else
  return 'invalid-request'
end
local requiredEpochs = epochSeen == 0 and 1 or 0
if currentEpochToFence then requiredEpochs = requiredEpochs + 1 end
if fenceCount + requiredEpochs > tonumber(ARGV[10]) then
  return 'incarnation-limit'
end
if currentEpochToFence then redis.call('SADD', KEYS[2], currentEpochToFence) end
redis.call('SADD', KEYS[2], candidate.roomEpoch)
redis.call('SET', KEYS[1], ARGV[7], 'PX', ARGV[8])
if directoryStoredIndexMember then
  redis.call('ZREM', KEYS[4], directoryStoredIndexMember)
end
if ARGV[13] ~= '' then redis.call('ZREM', KEYS[4], ARGV[13]) end
if directoryAction == 'create' or directoryAction == 'update' then
  redis.call('SET', KEYS[3], directoryNextRaw, 'PX', ARGV[8])
  if directoryNextIndexMember ~= '' then
    redis.call('ZADD', KEYS[4], 0, directoryNextIndexMember)
  end
elseif directoryAction == 'remove' then
  redis.call('DEL', KEYS[3])
end
return 'saved'
`;

const DELETE_SCRIPT = `
-- ROOM_CHECKPOINT_DELETE_V1
local directoryRecordTypeReply = redis.call('TYPE', KEYS[3])
local directoryRecordType = type(directoryRecordTypeReply) == 'table'
  and directoryRecordTypeReply.ok or directoryRecordTypeReply
local directoryIndexTypeReply = redis.call('TYPE', KEYS[4])
local directoryIndexType = type(directoryIndexTypeReply) == 'table'
  and directoryIndexTypeReply.ok or directoryIndexTypeReply
if (directoryRecordType ~= 'none' and directoryRecordType ~= 'string')
  or (directoryIndexType ~= 'none' and directoryIndexType ~= 'zset') then
  return 'directory-storage-invalid'
end
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
local directoryRaw = redis.call('GET', KEYS[3])
if directoryRaw then
  local directoryDecoded, directory = pcall(cjson.decode, directoryRaw)
  if directoryDecoded and type(directory) == 'table'
    and type(directory.publicIndexMember) == 'string' then
    redis.call('ZREM', KEYS[4], directory.publicIndexMember)
  end
  redis.call('DEL', KEYS[3])
end
if ARGV[9] ~= '' then redis.call('ZREM', KEYS[4], ARGV[9]) end
redis.call('SADD', KEYS[2], ARGV[3])
redis.call('DEL', KEYS[1])
return 'deleted'
`;

const EXPIRE_SCRIPT = `
-- ROOM_CHECKPOINT_EXPIRE_V1
local directoryRecordTypeReply = redis.call('TYPE', KEYS[3])
local directoryRecordType = type(directoryRecordTypeReply) == 'table'
  and directoryRecordTypeReply.ok or directoryRecordTypeReply
local directoryIndexTypeReply = redis.call('TYPE', KEYS[4])
local directoryIndexType = type(directoryIndexTypeReply) == 'table'
  and directoryIndexTypeReply.ok or directoryIndexTypeReply
if (directoryRecordType ~= 'none' and directoryRecordType ~= 'string')
  or (directoryIndexType ~= 'none' and directoryIndexType ~= 'zset') then
  return 'directory-storage-invalid'
end
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
local directoryRaw = redis.call('GET', KEYS[3])
if directoryRaw then
  local directoryDecoded, directory = pcall(cjson.decode, directoryRaw)
  if directoryDecoded and type(directory) == 'table'
    and type(directory.publicIndexMember) == 'string' then
    redis.call('ZREM', KEYS[4], directory.publicIndexMember)
  end
  redis.call('DEL', KEYS[3])
end
if ARGV[10] ~= '' then redis.call('ZREM', KEYS[4], ARGV[10]) end
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

const REFRESH_SCRIPT = `
-- ROOM_CHECKPOINT_REFRESH_V1
local recordTypeReply = redis.call('TYPE', KEYS[2])
local recordType = type(recordTypeReply) == 'table' and recordTypeReply.ok or recordTypeReply
if recordType ~= 'none' and recordType ~= 'string' then
  return 'directory-storage-invalid'
end
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local decoded, current = pcall(cjson.decode, raw)
if not decoded or type(current) ~= 'table' then return 'invalid-existing' end
if current.checkpointVersion ~= tonumber(ARGV[1])
  or current.expiryFence ~= nil
  or current.roomId ~= ARGV[2]
  or current.roomEpoch ~= ARGV[3]
  or current.revision ~= tonumber(ARGV[4])
  or current.controlSeq ~= tonumber(ARGV[5]) then
  return 'conflict'
end
if raw ~= ARGV[7] then return 'conflict' end
redis.call('PEXPIRE', KEYS[1], ARGV[6])
if recordType == 'string' then redis.call('PEXPIRE', KEYS[2], ARGV[6]) end
return 'refreshed'
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
export type RedisRoomStoreRefreshResult = { readonly kind: 'refreshed' | 'missing' | 'conflict' };

export interface RedisRoomStore {
  load(roomId: string): Promise<ArenaRoomAuthorityState | null>;
  save(input: {
    commit: ArenaRoomCheckpointCommit;
    directory?: RoomDirectoryRecord;
  }): Promise<RedisRoomStoreSaveResult>;
  delete(input: {
    checkpoint: ArenaRoomAuthorityState;
  }): Promise<RedisRoomStoreDeleteResult>;
  expire(input: {
    checkpoint: ArenaRoomAuthorityState;
  }): Promise<RedisRoomStoreExpireResult>;
  refresh(input: {
    checkpoint: ArenaRoomAuthorityState;
  }): Promise<RedisRoomStoreRefreshResult>;
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

type ParsedStoredRoomCheckpoint = {
  readonly migratedFromAuthorityV1: boolean;
  readonly stored: StoredRoomCheckpoint;
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

const parseStoredCheckpoint = (
  raw: string,
  expectedRoomId: string,
): ParsedStoredRoomCheckpoint => {
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
    let state: ArenaRoomAuthorityState;
    let migratedFromAuthorityV1 = false;
    try {
      state = parseArenaRoomAuthorityState(candidate.state);
    } catch {
      const migrated = migrateArenaRoomAuthorityStateV1(candidate.state);
      if (!migrated) throw new Error('invalid');
      state = migrated;
      migratedFromAuthorityV1 = true;
    }
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
      migratedFromAuthorityV1,
      stored: {
        checkpointVersion: candidate.checkpointVersion as StoredRoomCheckpoint['checkpointVersion'],
        ...(candidate.expiryFence === 'expiring' ? { expiryFence: 'expiring' as const } : {}),
        roomId: predecessor.roomId,
        roomEpoch: predecessor.roomEpoch,
        revision: predecessor.revision,
        controlSeq: predecessor.controlSeq,
        state,
      },
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

export const serializeTerminalRoomCheckpointForFence = (input: unknown): string => {
  const stored = createStoredCheckpoint(input);
  if (stored.state.lifecycle.status !== 'closed') {
    throw new Error('REDIS_ROOM_CHECKPOINT_TERMINAL_REQUIRED');
  }
  return JSON.stringify(stored);
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
  if (stored.roomEpoch === expected.roomEpoch) {
    return stored.controlSeq > expected.controlSeq
      && stored.revision >= expected.revision
      && stored.revision <= expected.revision + 1;
  }
  return stored.state.lifecycle.status === 'open'
    && stored.controlSeq === 0
    && stored.revision === expected.revision;
};

const parseMutationResult = <T extends string>(
  raw: unknown,
  allowed: readonly T[],
): { readonly kind: T } => {
  if (raw === 'invalid-existing') throw new Error('REDIS_ROOM_CHECKPOINT_INVALID');
  if (raw === 'invalid-fence') throw new Error('REDIS_ROOM_INCARNATION_FENCE_INVALID');
  if (raw === 'incarnation-limit') throw new Error('REDIS_ROOM_INCARNATION_LIMIT');
  if (raw === 'invalid-successor') throw new Error('REDIS_ROOM_SUCCESSOR_INVALID');
  if (raw === 'directory-conflict') throw new Error('REDIS_ROOM_DIRECTORY_CONFLICT');
  if (raw === 'directory-create-invalid') throw new Error('REDIS_ROOM_DIRECTORY_INPUT_INVALID');
  if (raw === 'directory-storage-invalid') throw new Error('REDIS_ROOM_DIRECTORY_INVALID');
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) {
    throw new Error('REDIS_ROOM_CHECKPOINT_RESPONSE_INVALID');
  }
  return { kind: raw as T };
};

export const createRedisRoomStore = (options: RedisRoomStoreOptions): RedisRoomStore => {
  const keyspace = createArenaRoomRedisKeyspace(options.keyPrefix);
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
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const raw = await options.getClient().get(keyspace.roomCheckpointKey(roomId));
        if (raw === null) return null;
        const parsed = parseStoredCheckpoint(raw, roomId);
        const stored = parsed.stored;
        if (stored.checkpointVersion === EXPIRING_ROOM_CHECKPOINT_VERSION) return null;
        const bootstrapped = await options.getClient().eval(BOOTSTRAP_FENCE_SCRIPT, {
          keys: [
            keyspace.roomCheckpointKey(roomId),
            keyspace.roomIncarnationFenceKey(roomId),
          ],
          arguments: [raw, roomId, stored.roomEpoch, String(MAX_ROOM_INCARNATIONS)],
        });
        const result = parseMutationResult(
          bootstrapped,
          ['seeded', 'already', 'expired', 'conflict'] as const,
        );
        if (result.kind === 'expired') return null;
        if (result.kind === 'conflict') continue;
        if (parsed.migratedFromAuthorityV1) {
          const migratedRaw = JSON.stringify(stored);
          const migration = await options.getClient().eval(MIGRATE_AUTHORITY_V1_SCRIPT, {
            keys: [keyspace.roomCheckpointKey(roomId)],
            arguments: [raw, migratedRaw],
          });
          const migrationResult = parseMutationResult(
            migration,
            ['migrated', 'missing', 'conflict'] as const,
          );
          if (migrationResult.kind === 'missing') return null;
          if (migrationResult.kind === 'conflict') continue;
        }
        return stored.state;
      }
      throw new Error('REDIS_ROOM_CHECKPOINT_CONFLICT');
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
      if (input.directory !== undefined && expected !== null) {
        throw new Error('REDIS_ROOM_DIRECTORY_INPUT_INVALID');
      }
      const directory = input.directory === undefined
        ? null
        : createStoredRoomDirectoryRecord(input.directory);
      if (directory !== null) {
        const hostUserId = stored.state.memberAuthority.find((entry) => (
          entry.member.role === 'host' && entry.member.membershipState === 'active'
        ))?.accountUserId;
        if (
          directory.roomId !== stored.roomId
          || directory.roomEpoch !== stored.roomEpoch
          || directory.hostUserId !== hostUserId
          || directory.createdAt !== stored.state.lifecycle.createdAt
          || directory.lastActivityAt !== stored.state.lifecycle.updatedAt
          || stored.state.lifecycle.status !== 'open'
        ) throw new Error('REDIS_ROOM_DIRECTORY_INPUT_INVALID');
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
        keys: [
          keyspace.roomCheckpointKey(stored.roomId),
          keyspace.roomIncarnationFenceKey(stored.roomId),
          keyspace.roomDirectoryRecordKey(stored.roomId),
          keyspace.directoryPublicIndexKey,
        ],
        arguments: [
          ...expectedArguments,
          JSON.stringify(stored),
          String(stored.state.lifecycle.status === 'open' ? activeTtlMs : terminalTtlMs),
          expectedStored === null ? '' : JSON.stringify(expectedStored),
          String(MAX_ROOM_INCARNATIONS),
          directory === null ? '' : serializeStoredRoomDirectoryRecord(directory),
          directory?.publicIndexMember ?? '',
          expectedStored === null
            ? ''
            : roomDirectoryPublicIndexMember(
                expectedStored.roomId,
                expectedStored.state.lifecycle.updatedAt,
              ),
          roomDirectoryPublicIndexMember(stored.roomId, stored.state.lifecycle.updatedAt),
        ],
      });
      return parseMutationResult(raw, ['saved', 'conflict'] as const);
    },

    async delete(input) {
      const active = createStoredCheckpoint(input.checkpoint);
      const expiring = createExpiringStoredCheckpoint(active.state);
      const expected = checkpointPredecessorOf(active.state);
      const raw = await options.getClient().eval(DELETE_SCRIPT, {
        keys: [
          keyspace.roomCheckpointKey(active.roomId),
          keyspace.roomIncarnationFenceKey(active.roomId),
          keyspace.roomDirectoryRecordKey(active.roomId),
          keyspace.directoryPublicIndexKey,
        ],
        arguments: [
          ...predecessorArguments(expected),
          JSON.stringify(active),
          JSON.stringify(expiring),
          String(MAX_ROOM_INCARNATIONS),
          roomDirectoryPublicIndexMember(active.roomId, active.state.lifecycle.updatedAt),
        ],
      });
      return parseMutationResult(raw, ['deleted', 'missing', 'conflict'] as const);
    },

    async expire(input) {
      const active = createStoredCheckpoint(input.checkpoint);
      const expiring = createExpiringStoredCheckpoint(active.state);
      const expected = checkpointPredecessorOf(active.state);
      const raw = await options.getClient().eval(EXPIRE_SCRIPT, {
        keys: [
          keyspace.roomCheckpointKey(active.roomId),
          keyspace.roomIncarnationFenceKey(active.roomId),
          keyspace.roomDirectoryRecordKey(active.roomId),
          keyspace.directoryPublicIndexKey,
        ],
        arguments: [
          ...predecessorArguments(expected),
          String(terminalTtlMs),
          JSON.stringify(active),
          JSON.stringify(expiring),
          String(MAX_ROOM_INCARNATIONS),
          roomDirectoryPublicIndexMember(active.roomId, active.state.lifecycle.updatedAt),
        ],
      });
      return parseMutationResult(raw, ['expired', 'missing', 'conflict'] as const);
    },

    async refresh(input) {
      const active = createStoredCheckpoint(input.checkpoint);
      if (active.state.lifecycle.status !== 'open') {
        throw new Error('REDIS_ROOM_REFRESH_TERMINAL');
      }
      const expected = checkpointPredecessorOf(active.state);
      const raw = await options.getClient().eval(REFRESH_SCRIPT, {
        keys: [
          keyspace.roomCheckpointKey(active.roomId),
          keyspace.roomDirectoryRecordKey(active.roomId),
        ],
        arguments: [
          ...predecessorArguments(expected),
          String(activeTtlMs),
          JSON.stringify(active),
        ],
      });
      return parseMutationResult(raw, ['refreshed', 'missing', 'conflict'] as const);
    },
  } satisfies RedisRoomStore);
};
