import { performance } from 'node:perf_hooks';
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
import {
  observeArenaRoomRuntime,
  type ArenaRoomCheckpointOperation,
  type ArenaRoomCheckpointOutcome,
  type ArenaRoomRuntimeObserver,
} from './runtime-observer';

const ACTIVE_ROOM_CHECKPOINT_VERSION = 1 as const;
const EXPIRING_ROOM_CHECKPOINT_VERSION = 2 as const;
const DEFAULT_ACTIVE_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_TERMINAL_TTL_SECONDS = 300;
const CREATE_ADMISSION_WINDOW_MS = 5 * 60 * 1_000;
const CREATE_ADMISSION_MAX_CLOCK_SKEW_MS = 60 * 1_000;
const INCARNATION_FENCE_RETENTION_MS = 15 * 60 * 1_000;
const CREATION_RECEIPT_VERSION = 1 as const;
const CREATION_RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000;
// absent-create Lua 使用 Redis TIME 拒绝超过 admission deadline 的迟到命令；因此
// incarnation fence 可以在覆盖最大 admission horizon 后有限保留，而无需永久占用 Redis。
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
  redis.call('PEXPIRE', KEYS[2], ARGV[5])
  return raw and 'already' or 'expired'
end
if redis.call('SCARD', KEYS[2]) >= tonumber(ARGV[4]) then return 'incarnation-limit' end
redis.call('SADD', KEYS[2], current.roomEpoch)
redis.call('PEXPIRE', KEYS[2], ARGV[5])
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
local directoryMutation = ARGV[15]
if directoryMutation ~= 'mutate' and directoryMutation ~= 'preserve' then
  return 'invalid-request'
end
local creationReceiptMutation = ARGV[19]
if creationReceiptMutation ~= 'create' and creationReceiptMutation ~= 'none' then
  return 'invalid-request'
end
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
if directoryMutation == 'mutate' then
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
end
if creationReceiptMutation == 'create' then
  if ARGV[1] ~= 'absent' then return 'invalid-request' end
  local receiptTypeReply = redis.call('TYPE', KEYS[5])
  local receiptType = type(receiptTypeReply) == 'table' and receiptTypeReply.ok or receiptTypeReply
  if receiptType ~= 'none' and receiptType ~= 'string' then
    return 'creation-receipt-invalid'
  end
  if redis.call('GET', KEYS[5]) then return 'creation-receipt-conflict' end
  local receiptDecoded, receipt = pcall(cjson.decode, ARGV[20])
  if not receiptDecoded or type(receipt) ~= 'table'
    or receipt.creationReceiptVersion ~= 1
    or receipt.roomId ~= candidate.roomId
    or type(receipt.requestDigest) ~= 'string'
    or string.len(receipt.requestDigest) ~= 71
    or not string.match(receipt.requestDigest, '^sha256:[a-f0-9]+$') then
    return 'creation-receipt-invalid'
  end
elseif ARGV[20] ~= '' then
  return 'invalid-request'
end
local raw = redis.call('GET', KEYS[1])
local directoryRaw = nil
if directoryMutation == 'mutate' then
  directoryRaw = redis.call('GET', KEYS[3])
end
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
  if directoryMutation ~= 'mutate' then return 'invalid-request' end
  local redisTime = redis.call('TIME')
  local redisNowMs = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
  local createAdmissionDeadlineMs = tonumber(ARGV[17])
  local createAdmissionMaxFutureMs = tonumber(ARGV[18])
  if not createAdmissionDeadlineMs or not createAdmissionMaxFutureMs
    or createAdmissionDeadlineMs < redisNowMs
    or createAdmissionDeadlineMs > redisNowMs + createAdmissionMaxFutureMs then
    return 'create-admission-expired'
  end
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
  if ARGV[17] ~= '' then return 'invalid-request' end
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
  if directoryMutation == 'mutate' then
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
redis.call('PEXPIRE', KEYS[2], ARGV[16])
redis.call('SET', KEYS[1], ARGV[7], 'PX', ARGV[8])
if creationReceiptMutation == 'create' then
  redis.call('SET', KEYS[5], ARGV[20], 'PX', ARGV[21])
end
if directoryMutation == 'mutate' then
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
redis.call('PEXPIRE', KEYS[2], ARGV[10])
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
redis.call('PEXPIRE', KEYS[2], ARGV[11])
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
local fenceTypeReply = redis.call('TYPE', KEYS[3])
local fenceType = type(fenceTypeReply) == 'table' and fenceTypeReply.ok or fenceTypeReply
if fenceType ~= 'none' and fenceType ~= 'set' then return 'invalid-fence' end
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
local epochSeen = redis.call('SISMEMBER', KEYS[3], current.roomEpoch)
if epochSeen == 0 and redis.call('SCARD', KEYS[3]) >= tonumber(ARGV[8]) then
  return 'incarnation-limit'
end
redis.call('SADD', KEYS[3], current.roomEpoch)
redis.call('PEXPIRE', KEYS[3], ARGV[9])
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
  now?: () => number;
  observer?: ArenaRoomRuntimeObserver;
};

export type RedisRoomStoreSaveResult = { readonly kind: 'saved' | 'conflict' };
export type RedisRoomStoreDeleteResult = { readonly kind: 'deleted' | 'missing' | 'conflict' };
export type RedisRoomStoreExpireResult = { readonly kind: 'expired' | 'missing' | 'conflict' };
export type RedisRoomStoreRefreshResult = { readonly kind: 'refreshed' | 'missing' | 'conflict' };

export type RedisRoomCreationReceiptInput = {
  readonly accountUserId: number;
  readonly creationRequestId: string;
  readonly requestDigest: string;
};

export type RedisRoomCreationReceipt = {
  readonly requestDigest: string;
  readonly roomId: string;
};

export interface RedisRoomStore {
  loadCreationReceipt(input: Pick<
    RedisRoomCreationReceiptInput,
    'accountUserId' | 'creationRequestId'
  >): Promise<RedisRoomCreationReceipt | null>;
  load(roomId: string): Promise<ArenaRoomAuthorityState | null>;
  save(input: {
    commit: ArenaRoomCheckpointCommit;
    creationReceipt?: RedisRoomCreationReceiptInput;
    directory?: RoomDirectoryRecord;
    directoryMutation?: 'mutate' | 'preserve';
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

const isRequestDigest = (value: unknown): value is string => (
  typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value)
);

const parseCreationReceipt = (raw: string): RedisRoomCreationReceipt => {
  try {
    const candidate: unknown = JSON.parse(raw);
    if (
      !isRecord(candidate)
      || Object.keys(candidate).sort().join('|')
        !== 'creationReceiptVersion|requestDigest|roomId'
      || candidate.creationReceiptVersion !== CREATION_RECEIPT_VERSION
      || !isRequestDigest(candidate.requestDigest)
      || !isRoomId(candidate.roomId)
    ) throw new Error('invalid');
    return Object.freeze({
      requestDigest: candidate.requestDigest,
      roomId: candidate.roomId,
    });
  } catch {
    throw new Error('REDIS_ROOM_CREATION_RECEIPT_INVALID');
  }
};

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
  if (raw === 'create-admission-expired') {
    throw new Error('REDIS_ROOM_CREATE_ADMISSION_EXPIRED');
  }
  if (raw === 'creation-receipt-conflict') {
    throw new Error('REDIS_ROOM_CREATION_RECEIPT_CONFLICT');
  }
  if (raw === 'creation-receipt-invalid') {
    throw new Error('REDIS_ROOM_CREATION_RECEIPT_INVALID');
  }
  if (raw === 'invalid-successor') throw new Error('REDIS_ROOM_SUCCESSOR_INVALID');
  if (raw === 'directory-conflict') throw new Error('REDIS_ROOM_DIRECTORY_CONFLICT');
  if (raw === 'directory-create-invalid') throw new Error('REDIS_ROOM_DIRECTORY_INPUT_INVALID');
  if (raw === 'directory-storage-invalid') throw new Error('REDIS_ROOM_DIRECTORY_INVALID');
  if (raw === 'invalid-request') throw new Error('REDIS_ROOM_DIRECTORY_INPUT_INVALID');
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) {
    throw new Error('REDIS_ROOM_CHECKPOINT_RESPONSE_INVALID');
  }
  return { kind: raw as T };
};

const checkpointEncoder = new TextEncoder();

const serializedCheckpointBytes = (raw: string): number => (
  checkpointEncoder.encode(raw).byteLength
);

const checkpointErrorOutcome = (error: unknown): ArenaRoomCheckpointOutcome => {
  if (error instanceof Error && error.message === 'REDIS_ROOM_CHECKPOINT_UNAVAILABLE') {
    return 'unavailable';
  }
  if (error instanceof Error && error.message === 'REDIS_ROOM_CHECKPOINT_CONFLICT') {
    return 'conflict';
  }
  return 'error';
};

type CheckpointObservationState = {
  outcome: ArenaRoomCheckpointOutcome;
  serializedBytes?: number;
};

const observeCheckpoint = (
  observer: ArenaRoomRuntimeObserver | undefined,
  operation: ArenaRoomCheckpointOperation,
  state: CheckpointObservationState,
  startedAt: number,
): void => {
  observeArenaRoomRuntime(observer, {
    event: 'checkpoint',
    operation,
    outcome: state.outcome,
    ...(state.serializedBytes === undefined
      ? {}
      : { serializedBytes: state.serializedBytes }),
    durationMs: Math.max(0, performance.now() - startedAt),
  });
};

export const createRedisRoomStore = (options: RedisRoomStoreOptions): RedisRoomStore => {
  const keyspace = createArenaRoomRedisKeyspace(options.keyPrefix);
  const now = options.now ?? Date.now;
  const activeTtlMs = ttlMs(
    options.activeTtlSeconds ?? DEFAULT_ACTIVE_TTL_SECONDS,
    'activeTtlSeconds',
  );
  const terminalTtlMs = ttlMs(
    options.terminalTtlSeconds ?? DEFAULT_TERMINAL_TTL_SECONDS,
    'terminalTtlSeconds',
  );
  return Object.freeze({
    async loadCreationReceipt(input) {
      const raw = await options.getClient().get(keyspace.roomCreationReceiptKey(
        input.accountUserId,
        input.creationRequestId,
      ));
      return raw === null ? null : parseCreationReceipt(raw);
    },

    async load(roomId) {
      const startedAt = performance.now();
      const observation: CheckpointObservationState = { outcome: 'error' };
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const raw = await options.getClient().get(keyspace.roomCheckpointKey(roomId));
          observation.serializedBytes = raw === null
            ? undefined
            : serializedCheckpointBytes(raw);
          if (raw === null) {
            observation.outcome = 'missing';
            return null;
          }
          const parsed = parseStoredCheckpoint(raw, roomId);
          const stored = parsed.stored;
          if (stored.checkpointVersion === EXPIRING_ROOM_CHECKPOINT_VERSION) {
            observation.outcome = 'missing';
            return null;
          }
          const bootstrapped = await options.getClient().eval(BOOTSTRAP_FENCE_SCRIPT, {
            keys: [
              keyspace.roomCheckpointKey(roomId),
              keyspace.roomIncarnationFenceKey(roomId),
            ],
            arguments: [
              raw,
              roomId,
              stored.roomEpoch,
              String(MAX_ROOM_INCARNATIONS),
              String(INCARNATION_FENCE_RETENTION_MS),
            ],
          });
          const result = parseMutationResult(
            bootstrapped,
            ['seeded', 'already', 'expired', 'conflict'] as const,
          );
          if (result.kind === 'expired') {
            observation.outcome = 'missing';
            return null;
          }
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
            if (migrationResult.kind === 'missing') {
              observation.outcome = 'missing';
              return null;
            }
            if (migrationResult.kind === 'conflict') continue;
            observation.serializedBytes = serializedCheckpointBytes(migratedRaw);
          }
          observation.outcome = 'ok';
          return stored.state;
        }
        observation.outcome = 'conflict';
        throw new Error('REDIS_ROOM_CHECKPOINT_CONFLICT');
      } catch (error) {
        if (observation.outcome === 'error') {
          observation.outcome = checkpointErrorOutcome(error);
        }
        throw error;
      } finally {
        observeCheckpoint(options.observer, 'load', observation, startedAt);
      }
    },

    async save(input) {
      const startedAt = performance.now();
      const observation: CheckpointObservationState = { outcome: 'error' };
      try {
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
        if (input.creationReceipt !== undefined && expected !== null) {
          throw new Error('REDIS_ROOM_CREATION_RECEIPT_INPUT_INVALID');
        }
        const directoryMutation = input.directoryMutation ?? 'mutate';
        if (input.directory !== undefined && directoryMutation !== 'mutate') {
          throw new Error('REDIS_ROOM_DIRECTORY_INPUT_INVALID');
        }
        const directory = input.directory === undefined
          ? null
          : createStoredRoomDirectoryRecord(input.directory);
        const creationReceipt = input.creationReceipt;
        if (creationReceipt !== undefined && (
          !Number.isSafeInteger(creationReceipt.accountUserId)
          || creationReceipt.accountUserId < 1
          || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(
            creationReceipt.creationRequestId,
          )
          || !isRequestDigest(creationReceipt.requestDigest)
        )) throw new Error('REDIS_ROOM_CREATION_RECEIPT_INPUT_INVALID');
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
        const storedRaw = JSON.stringify(stored);
        const expectedRaw = expectedStored === null ? '' : JSON.stringify(expectedStored);
        const createAdmissionDeadlineMs = expected === null
          ? Math.floor(now() + CREATE_ADMISSION_WINDOW_MS)
          : null;
        if (
          createAdmissionDeadlineMs !== null
          && !Number.isSafeInteger(createAdmissionDeadlineMs)
        ) {
          throw new Error('REDIS_ROOM_CREATE_ADMISSION_INVALID');
        }
        observation.serializedBytes = serializedCheckpointBytes(storedRaw);
        const raw = await options.getClient().eval(SAVE_SCRIPT, {
          keys: [
            keyspace.roomCheckpointKey(stored.roomId),
            keyspace.roomIncarnationFenceKey(stored.roomId),
            keyspace.roomDirectoryRecordKey(stored.roomId),
            keyspace.directoryPublicIndexKey,
            creationReceipt === undefined
              ? keyspace.unusedCreationReceiptKey
              : keyspace.roomCreationReceiptKey(
                  creationReceipt.accountUserId,
                  creationReceipt.creationRequestId,
                ),
          ],
          arguments: [
            ...expectedArguments,
            storedRaw,
            String(stored.state.lifecycle.status === 'open' ? activeTtlMs : terminalTtlMs),
            expectedRaw,
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
            directoryMutation,
            String(INCARNATION_FENCE_RETENTION_MS),
            createAdmissionDeadlineMs === null ? '' : String(createAdmissionDeadlineMs),
            String(CREATE_ADMISSION_WINDOW_MS + CREATE_ADMISSION_MAX_CLOCK_SKEW_MS),
            creationReceipt === undefined ? 'none' : 'create',
            creationReceipt === undefined
              ? ''
              : JSON.stringify({
                  creationReceiptVersion: CREATION_RECEIPT_VERSION,
                  requestDigest: creationReceipt.requestDigest,
                  roomId: stored.roomId,
                }),
            String(CREATION_RECEIPT_TTL_MS),
          ],
        });
        const result = parseMutationResult(raw, ['saved', 'conflict'] as const);
        observation.outcome = result.kind === 'saved' ? 'ok' : 'conflict';
        return result;
      } catch (error) {
        if (observation.outcome === 'error') {
          observation.outcome = checkpointErrorOutcome(error);
        }
        throw error;
      } finally {
        observeCheckpoint(options.observer, 'save', observation, startedAt);
      }
    },

    async delete(input) {
      const startedAt = performance.now();
      const observation: CheckpointObservationState = { outcome: 'error' };
      try {
        const active = createStoredCheckpoint(input.checkpoint);
        const expiring = createExpiringStoredCheckpoint(active.state);
        const expected = checkpointPredecessorOf(active.state);
        const activeRaw = JSON.stringify(active);
        const expiringRaw = JSON.stringify(expiring);
        observation.serializedBytes = serializedCheckpointBytes(activeRaw);
        const raw = await options.getClient().eval(DELETE_SCRIPT, {
          keys: [
            keyspace.roomCheckpointKey(active.roomId),
            keyspace.roomIncarnationFenceKey(active.roomId),
            keyspace.roomDirectoryRecordKey(active.roomId),
            keyspace.directoryPublicIndexKey,
          ],
          arguments: [
            ...predecessorArguments(expected),
            activeRaw,
            expiringRaw,
            String(MAX_ROOM_INCARNATIONS),
            roomDirectoryPublicIndexMember(active.roomId, active.state.lifecycle.updatedAt),
            String(INCARNATION_FENCE_RETENTION_MS),
          ],
        });
        const result = parseMutationResult(raw, ['deleted', 'missing', 'conflict'] as const);
        observation.outcome = result.kind === 'deleted' ? 'ok' : result.kind;
        return result;
      } catch (error) {
        if (observation.outcome === 'error') {
          observation.outcome = checkpointErrorOutcome(error);
        }
        throw error;
      } finally {
        observeCheckpoint(options.observer, 'delete', observation, startedAt);
      }
    },

    async expire(input) {
      const startedAt = performance.now();
      const observation: CheckpointObservationState = { outcome: 'error' };
      try {
        const active = createStoredCheckpoint(input.checkpoint);
        const expiring = createExpiringStoredCheckpoint(active.state);
        const expected = checkpointPredecessorOf(active.state);
        const activeRaw = JSON.stringify(active);
        const expiringRaw = JSON.stringify(expiring);
        observation.serializedBytes = serializedCheckpointBytes(expiringRaw);
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
            activeRaw,
            expiringRaw,
            String(MAX_ROOM_INCARNATIONS),
            roomDirectoryPublicIndexMember(active.roomId, active.state.lifecycle.updatedAt),
            String(INCARNATION_FENCE_RETENTION_MS),
          ],
        });
        const result = parseMutationResult(raw, ['expired', 'missing', 'conflict'] as const);
        observation.outcome = result.kind === 'expired' ? 'ok' : result.kind;
        return result;
      } catch (error) {
        if (observation.outcome === 'error') {
          observation.outcome = checkpointErrorOutcome(error);
        }
        throw error;
      } finally {
        observeCheckpoint(options.observer, 'expire', observation, startedAt);
      }
    },

    async refresh(input) {
      const startedAt = performance.now();
      const observation: CheckpointObservationState = { outcome: 'error' };
      try {
        const active = createStoredCheckpoint(input.checkpoint);
        if (active.state.lifecycle.status !== 'open') {
          throw new Error('REDIS_ROOM_REFRESH_TERMINAL');
        }
        const expected = checkpointPredecessorOf(active.state);
        const activeRaw = JSON.stringify(active);
        observation.serializedBytes = serializedCheckpointBytes(activeRaw);
        const raw = await options.getClient().eval(REFRESH_SCRIPT, {
          keys: [
            keyspace.roomCheckpointKey(active.roomId),
            keyspace.roomDirectoryRecordKey(active.roomId),
            keyspace.roomIncarnationFenceKey(active.roomId),
          ],
          arguments: [
            ...predecessorArguments(expected),
            String(activeTtlMs),
            activeRaw,
            String(MAX_ROOM_INCARNATIONS),
            String(INCARNATION_FENCE_RETENTION_MS),
          ],
        });
        const result = parseMutationResult(raw, ['refreshed', 'missing', 'conflict'] as const);
        observation.outcome = result.kind === 'refreshed' ? 'ok' : result.kind;
        return result;
      } catch (error) {
        if (observation.outcome === 'error') {
          observation.outcome = checkpointErrorOutcome(error);
        }
        throw error;
      } finally {
        observeCheckpoint(options.observer, 'refresh', observation, startedAt);
      }
    },
  } satisfies RedisRoomStore);
};
