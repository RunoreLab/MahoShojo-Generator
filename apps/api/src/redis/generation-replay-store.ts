import { createHash } from 'node:crypto';
import { ArenaMultiplayerParticipationSchema } from '@mahoshojo/contracts/arena-room';

import {
  generationCancelCode,
  isRoomGenerationAdmission,
  isArenaGenerationPersistenceWarning,
  isArenaPreparationSeed,
  isArenaPreparationVersion,
  isGenerationCancelReason,
} from '@mahoshojo/hosted-api/arena-generation/service';
import type {
  GenerationEventInput,
  GenerationReplayStore,
  GenerationReplayStoreState,
  GenerationSnapshot,
  GenerationStreamEvent,
  GenerationTerminal,
  GenerationStatus,
} from '@mahoshojo/hosted-api/arena-generation/service';
import { createArenaRoomRedisKeyspace } from '../arena-room/redis-room-keyspace';
import { isSafePublicAiErrorProjection } from '@mahoshojo/hosted-api/regular-generation';

const DEFAULT_ACTIVE_TTL_SECONDS = 3_600;
const DEFAULT_TERMINAL_TTL_SECONDS = 2_700;
const DEFAULT_MAX_EVENTS = 2_048;
const MAX_READ_EVENTS = 256;
const MIN_BLOCKING_READ_MS = 1;
const MAX_BLOCKING_READ_MS = 1_000;
const KEY_PREFIX = 'mahoshojo:gen:v1';
const PRE_CANCELLED_PAYLOAD_HASH = '__PRE_CANCELLED__';

const normalizeBlockingReadMs = (blockMs: number): number => {
  if (!Number.isFinite(blockMs)) {
    return MAX_BLOCKING_READ_MS;
  }
  return Math.min(
    MAX_BLOCKING_READ_MS,
    Math.max(MIN_BLOCKING_READ_MS, Math.floor(blockMs)),
  );
};

type RedisStreamMessage = {
  id: string;
  message: Record<string, string>;
};

type RedisStreamRead = {
  name: string;
  messages: RedisStreamMessage[];
};

export interface RedisGenerationClient {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
  xRead(
    streams: Array<{ key: string; id: string }>,
    options: { BLOCK: number; COUNT: number },
  ): Promise<RedisStreamRead[] | null>;
}

export type RedisGenerationReplayStoreOptions = {
  getClient(): RedisGenerationClient;
  keyPrefix?: string;
  activeTtlSeconds?: number;
  terminalTtlSeconds?: number;
  maxEvents?: number;
  /** Phase B opt-in for new reservations only; existing layouts are never migrated. */
  enableSnapshotSidecar?: boolean;
};

type StoredGenerationState = Omit<GenerationReplayStoreState, 'actorKey'> & {
  actorHash: string;
  reservationKey: string;
  storageVersion?: 1 | 2;
  snapshotMeta?: SnapshotMetadata | null;
};

type SnapshotMetadata = Pick<GenerationSnapshot, 'status' | 'lastEventId' | 'updatedAt'> & { digest: string };

// All mutation scripts use [state, events, reservation, snapshot]. Identity
// discovery is only a hint: validate against the current state before any write.
const STATE_HELPERS = `
local function validateState(state)
  if state.storageVersion ~= nil and state.storageVersion ~= 1 and state.storageVersion ~= 2 then
    error('REDIS_GENERATION_STORAGE_VERSION_INVALID')
  end
  if state.reservationKey ~= KEYS[3] then error('REDIS_GENERATION_IDENTITY_CHANGED') end
  local reservation = redis.call('GET', KEYS[3])
  if reservation and cjson.decode(reservation).generationId ~= state.generationId then
    error('REDIS_GENERATION_IDENTITY_CHANGED')
  end
end
local function retain(state, ttl)
  redis.call('PEXPIRE', KEYS[3], ttl)
  if state.storageVersion == 2 then
    redis.call('PEXPIRE', KEYS[2], ttl)
    redis.call('PEXPIRE', KEYS[4], ttl)
  end
end
`;

const SNAPSHOT_HELPERS = `
local function saveSnapshot(state, snapshot, encoded, ttl)
  if state.storageVersion == 2 then
    state.snapshot = cjson.null
    state.snapshotMeta = {
      status = snapshot.status, lastEventId = snapshot.lastEventId,
      updatedAt = snapshot.updatedAt, digest = redis.sha1hex(encoded)
    }
    redis.call('SET', KEYS[4], encoded, 'PX', ttl)
  else
    state.snapshot = snapshot
  end
end
`;

const DISCOVER_IDENTITY_SCRIPT = `
-- GEN_DISCOVER_IDENTITY
local raw = redis.call('GET', KEYS[1])
if not raw then return '' end
local state = cjson.decode(raw)
if state.storageVersion ~= nil and state.storageVersion ~= 1 and state.storageVersion ~= 2 then
  return redis.error_reply('REDIS_GENERATION_STORAGE_VERSION_INVALID')
end
return state.reservationKey
`;

// Return raw strings without decoding/re-encoding either body in Redis.
const READ_STATE_SCRIPT = `
-- GEN_READ_STATE
return { redis.call('GET', KEYS[1]) or '', redis.call('GET', KEYS[2]) or '' }
`;

const RESERVATION_SCRIPT = `
-- GEN_RESERVE_V1
local existing = redis.call('GET', KEYS[1])
if existing then
  local reservation = cjson.decode(existing)
  if reservation.preCancelled == true and reservation.payloadHash == '__PRE_CANCELLED__' then
    reservation.payloadHash = ARGV[1]
    reservation.preCancelled = nil
    local reqTtl = redis.call('PTTL', KEYS[1])
    redis.call('SET', KEYS[1], cjson.encode(reservation), 'PX', reqTtl > 0 and reqTtl or ARGV[3])
    local rawState = redis.call('GET', KEYS[2])
    if rawState then
      local state = cjson.decode(rawState)
      state.payloadHash = ARGV[1]
      local stateTtl = redis.call('PTTL', KEYS[2])
      redis.call('SET', KEYS[2], cjson.encode(state), 'PX', stateTtl > 0 and stateTtl or ARGV[3])
    end
    return { 'reused', reservation.generationId, '', '' }
  end
  if reservation.payloadHash == ARGV[1] then
    local seed = reservation.preparationSeed
    local version = reservation.preparationVersion
    if seed == nil or seed == cjson.null then seed = '' end
    if version == nil or version == cjson.null then version = '' end
    return { 'reused', reservation.generationId, seed, version }
  end
  return { 'conflict', '' }
end
if redis.call('EXISTS', KEYS[2]) == 1 then
  return redis.error_reply('GENERATION_ID_CONFLICT')
end
redis.call('DEL', KEYS[3])
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
redis.call('SET', KEYS[2], ARGV[4], 'PX', ARGV[3])
return { 'created', ARGV[5], ARGV[6], ARGV[7] }
`;

// Only the gated path uses Redis wall time. Noncanonical timestamps deny
// admission rather than turning a stale caller timestamp into a lease grant.
const ROOM_ADMISSION_HELPERS = `
local function canonicalMillis(value)
  if type(value) ~= 'string' then return nil end
  local y, m, d, h, n, s, ms = string.match(value, '^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)%.(%d%d%d)Z$')
  y, m, d, h, n, s, ms = tonumber(y), tonumber(m), tonumber(d), tonumber(h), tonumber(n), tonumber(s), tonumber(ms)
  if not y or y < 1970 or not m or m < 1 or m > 12 or not d or d < 1 or d > 31
    or not h or h > 23 or not n or n > 59 or not s or s > 59 then return nil end
  local leap = (y % 4 == 0 and y % 100 ~= 0) or y % 400 == 0
  local months = {31, leap and 29 or 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}
  if d > months[m] then return nil end
  local days = (y - 1970) * 365 + math.floor((y - 1) / 4) - math.floor(1969 / 4)
    - math.floor((y - 1) / 100) + math.floor(1969 / 100)
    + math.floor((y - 1) / 400) - math.floor(1969 / 400) + d - 1
  for index = 1, m - 1 do days = days + months[index] end
  return (((days * 24 + h) * 60 + n) * 60 + s) * 1000 + ms
end
local admissionFields = {'version', 'roomId', 'roomEpoch', 'hostUserId', 'hostAccountUserId',
  'generationId', 'generationRequestId', 'attempt', 'configRevision', 'snapshotDigest',
  'generationPayloadDigest', 'mode', 'startedAt'}
local function sameAdmission(left, right)
  if type(left) ~= 'table' or type(right) ~= 'table' then return false end
  for _, field in ipairs(admissionFields) do if left[field] ~= right[field] then return false end end
  return true
end
local function admitRoom(state, encoded, nextLease)
  if encoded == '' then return state.roomAdmission == nil or state.roomAdmission == cjson.null end
  local ok, admission = pcall(cjson.decode, encoded)
  if not ok or not sameAdmission(state.roomAdmission, admission)
    or state.generationId ~= admission.generationId or state.generationRequestId ~= admission.generationRequestId then return false end
  local raw = redis.call('GET', KEYS[5])
  if not raw then return false end
  local decoded, room = pcall(cjson.decode, raw)
  if not decoded or type(room) ~= 'table' or room.checkpointVersion ~= 1 or room.expiryFence ~= nil
    or room.roomId ~= admission.roomId or room.roomEpoch ~= admission.roomEpoch
    or type(room.state) ~= 'table' then return false end
  local authority = room.state
  local snapshot = authority.snapshot
  if (authority.authorityStateVersion ~= 2 and authority.authorityStateVersion ~= 3)
    or type(authority.lifecycle) ~= 'table' or authority.lifecycle.status ~= 'open'
    or type(snapshot) ~= 'table' or snapshot.roomId ~= admission.roomId or snapshot.roomEpoch ~= admission.roomEpoch
    or type(snapshot.activeGeneration) ~= 'table' or snapshot.activeGeneration.generationId ~= admission.generationId
    or type(authority.generationLedger) ~= 'table' or #authority.generationLedger > 64
    or type(authority.memberAuthority) ~= 'table' then return false end
  local hosts = 0
  for _, member in ipairs(authority.memberAuthority) do
    if type(member.member) == 'table' and member.member.role == 'host' and member.member.membershipState == 'active' then
      if member.accountUserId ~= admission.hostAccountUserId or member.member.userId ~= admission.hostUserId then return false end
      hosts = hosts + 1
    end
  end
  if hosts ~= 1 then return false end
  local record = nil
  for _, candidate in ipairs(authority.generationLedger) do
    if type(candidate.mirror) == 'table' and candidate.mirror.generationId == admission.generationId then
      if record then return false end
      record = candidate
    end
  end
  if not record then return false end
  local mirror = record.mirror
  if mirror.state ~= 'starting' or mirror.generationRequestId ~= admission.generationRequestId
    or mirror.attempt ~= admission.attempt or mirror.configRevision ~= admission.configRevision
    or mirror.snapshotDigest ~= admission.snapshotDigest or mirror.startedAt ~= admission.startedAt
    or mirror.hostAccountUserId ~= admission.hostAccountUserId
    or (record.generationPayloadDigest or cjson.null) ~= admission.generationPayloadDigest then return false end
  if admission.version == 'room-generation-legacy-start-v1' then
    return record.startGate == nil
  end
  local gate = record.startGate
  if admission.version ~= 'room-generation-start-gate-v1' or authority.authorityStateVersion ~= 3
    or type(gate) ~= 'table' or gate.version ~= admission.version
    or gate.roomEpoch ~= admission.roomEpoch or gate.hostUserId ~= admission.hostUserId or gate.mode ~= admission.mode
    or type(gate.producerTokenDigest) ~= 'string' or gate.producerTokenDigest ~= state.producerTokenDigest
    or gate.cancellationRequested ~= false or type(authority.deadlines) ~= 'table' then return false end
  local clock = redis.call('TIME')
  local current = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
  local lease = canonicalMillis(state.leaseExpiresAt)
  local successorLease = canonicalMillis(nextLease)
  if not lease or lease <= current or not successorLease or successorLease <= current then return false end
  for _, field in ipairs({'hostOfflineDeadline', 'roomIdleDeadline'}) do
    local deadline = authority.deadlines[field]
    if deadline ~= cjson.null then
      local expiry = canonicalMillis(deadline)
      if not expiry or expiry <= current then return false end
    end
  end
  return true
end
`;

const MARK_RUNNING_SCRIPT = `${STATE_HELPERS}
${ROOM_ADMISSION_HELPERS}
-- GEN_MARK_RUNNING_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
validateState(state)
if state.producerToken ~= ARGV[1] then return -1 end
if state.status ~= 'reserved' then return -1 end
if state.terminal ~= nil and state.terminal ~= cjson.null then return 0 end
if state.leaseExpiresAt == nil or state.leaseExpiresAt == cjson.null or state.leaseExpiresAt <= ARGV[2] then return 0 end
if not admitRoom(state, ARGV[5] or '', ARGV[3]) then return -1 end
if state.cancelRequested == true then
  -- Preserve the atomic never-started proof until gated durable cleanup succeeds.
  if type(state.roomAdmission) ~= 'table' or state.roomAdmission.version ~= 'room-generation-start-gate-v1' then
    state.status = 'finalizing'
  end
  state.updatedAt = ARGV[2]
  state.leaseExpiresAt = ARGV[3]
  if state.cancelReason ~= 'content_policy' then state.cancelReason = 'user' end
  redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[4])
  retain(state, ARGV[4])
  return 'cancelled:' .. state.cancelReason
end
state.status = 'running'
state.updatedAt = ARGV[2]
state.leaseExpiresAt = ARGV[3]
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[4])
retain(state, ARGV[4])
return 1
`;

const CLAIM_FINALIZATION_SCRIPT = `${STATE_HELPERS}
-- GEN_CLAIM_FINALIZATION_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 'fenced' end
local state = cjson.decode(raw)
validateState(state)
if state.producerToken ~= ARGV[1] then return 'fenced' end
if state.terminal ~= nil and state.terminal ~= cjson.null then return 'fenced' end
if state.status ~= 'running' and state.status ~= 'finalizing' then return 'fenced' end
if state.leaseExpiresAt == nil or state.leaseExpiresAt == cjson.null or state.leaseExpiresAt <= ARGV[2] then return 'fenced' end
state.status = 'finalizing'
state.updatedAt = ARGV[2]
state.leaseExpiresAt = ARGV[3]
if ARGV[5] ~= '' then state.intendedTerminal = cjson.decode(ARGV[5]) end
if state.cancelRequested == true and state.cancelReason ~= 'content_policy' then
  state.cancelReason = 'user'
end
if state.cancelRequested == true then
  if state.cancelReason == 'content_policy' then
    state.intendedTerminal = cjson.decode(ARGV[7])
  else
    state.intendedTerminal = cjson.decode(ARGV[6])
  end
end
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[4])
retain(state, ARGV[4])
if state.cancelRequested == true then
  return 'cancelled:' .. state.cancelReason
end
return 'claimed'
`;

const CLAIM_LEASE_EXPIRY_SCRIPT = `${STATE_HELPERS}
-- GEN_CLAIM_LEASE_EXPIRY_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return { 'not-found', '', '' } end
local state = cjson.decode(raw)
validateState(state)
if state.actorHash ~= ARGV[1] then return { 'forbidden', '', '' } end
if state.terminal ~= nil and state.terminal ~= cjson.null then
  return { 'terminal:' .. state.terminal.status, '', '' }
end
if state.status ~= 'reserved' and state.status ~= 'running' and state.status ~= 'finalizing' then
  return { 'not-expired', '', '' }
end
if state.leaseExpiresAt == nil or state.leaseExpiresAt == cjson.null or state.leaseExpiresAt > ARGV[2] then
  return { 'not-expired', '', '' }
end
state.producerToken = ARGV[3]
state.status = 'finalizing'
state.updatedAt = ARGV[2]
state.leaseExpiresAt = ARGV[4]
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[5])
retain(state, ARGV[5])
local intendedTerminal = ''
if state.intendedTerminal ~= nil and state.intendedTerminal ~= cjson.null then
  intendedTerminal = cjson.encode(state.intendedTerminal)
end
local mode = state.mode
if mode == nil or mode == cjson.null then mode = '' end
return { 'claimed', state.generationRequestId, state.payloadHash, mode, intendedTerminal }
`;

const RELEASE_RESERVATION_SCRIPT = `${STATE_HELPERS}
-- GEN_RELEASE_RESERVATION_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
validateState(state)
if state.producerToken ~= ARGV[1] or state.status ~= 'reserved' then return 0 end
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[3])
if state.storageVersion == 2 then redis.call('DEL', KEYS[2], KEYS[4]) end
return 1
`;

const HEARTBEAT_SCRIPT = `${STATE_HELPERS}
-- GEN_HEARTBEAT_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
validateState(state)
if state.producerToken ~= ARGV[1] then return -1 end
if state.status ~= 'running' and state.status ~= 'finalizing' then return 0 end
if state.terminal ~= nil and state.terminal ~= cjson.null then return 0 end
if state.leaseExpiresAt == nil or state.leaseExpiresAt == cjson.null or state.leaseExpiresAt <= ARGV[2] then return 0 end
state.updatedAt = ARGV[2]
state.leaseExpiresAt = ARGV[3]
if state.cancelRequested == true and state.cancelReason ~= 'content_policy' then
  state.cancelReason = 'user'
end
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[4])
retain(state, ARGV[4])
if state.cancelRequested == true then
  return 'cancelled:' .. state.cancelReason
end
return 1
`;

const APPEND_SCRIPT = `${STATE_HELPERS}
-- GEN_APPEND_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return { 'fenced' } end
local state = cjson.decode(raw)
validateState(state)
if state.producerToken ~= ARGV[1] or (state.status ~= 'running' and state.status ~= 'finalizing') then return { 'fenced' } end
if state.leaseExpiresAt == nil or state.leaseExpiresAt == cjson.null or state.leaseExpiresAt <= ARGV[5] then return { 'fenced' } end
local events = cjson.decode(ARGV[2])
local ids = {}
for index, event in ipairs(events) do
  ids[index] = redis.call(
    'XADD', KEYS[2], '*',
    'type', event.type,
    'data', event.dataJson
  )
end
redis.call('XTRIM', KEYS[2], 'MAXLEN', ARGV[3])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
if #ids > 0 then state.lastEventId = ids[#ids] end
state.updatedAt = ARGV[5]
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[4])
retain(state, ARGV[4])
return ids
`;

const SNAPSHOT_SCRIPT = `${STATE_HELPERS}${SNAPSHOT_HELPERS}
-- GEN_SNAPSHOT_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
validateState(state)
if state.producerToken ~= ARGV[1] then return -1 end
if state.leaseExpiresAt == nil or state.leaseExpiresAt == cjson.null or state.leaseExpiresAt <= ARGV[3] then return -1 end
local snapshot = cjson.decode(ARGV[2])
local terminal = state.terminal
if state.status == 'running' or state.status == 'finalizing' then
  if snapshot.status ~= 'running' then return -1 end
elseif terminal ~= nil and terminal ~= cjson.null then
  if snapshot.status ~= state.status then return -1 end
else
  return -1
end
if state.storageVersion == 2 and snapshot.lastEventId ~= state.lastEventId then
  return redis.error_reply('REDIS_GENERATION_SNAPSHOT_CURSOR_MISMATCH')
end
saveSnapshot(state, snapshot, ARGV[2], ARGV[4])
state.updatedAt = ARGV[3]
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[4])
retain(state, ARGV[4])
return 1
`;

// GEN_TERMINAL_V2 names the existing terminal protocol revision, not the storage layout.
const TERMINAL_SCRIPT = `${STATE_HELPERS}${SNAPSHOT_HELPERS}
-- GEN_TERMINAL_V2
if ARGV[6] == '' then return redis.error_reply('GENERATION_TERMINAL_EVENT_REQUIRED') end
if ARGV[7] == '' and ARGV[8] ~= '1' then return redis.error_reply('GENERATION_TERMINAL_SNAPSHOT_DECISION_REQUIRED') end
if ARGV[7] ~= '' and ARGV[8] == '1' then return redis.error_reply('GENERATION_TERMINAL_SNAPSHOT_DECISION_CONFLICT') end
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
validateState(state)
if state.producerToken ~= ARGV[1] then return -1 end
if state.terminal ~= nil and state.terminal ~= cjson.null then return 0 end
if state.status ~= 'running' and state.status ~= 'reserved' and state.status ~= 'finalizing' then return -1 end
if state.leaseExpiresAt == nil or state.leaseExpiresAt == cjson.null or state.leaseExpiresAt <= ARGV[3] then return -1 end
local terminal = cjson.decode(ARGV[2])
local terminalEvent = cjson.decode(ARGV[6])
local terminalSnapshot = nil
if ARGV[7] ~= '' then
  terminalSnapshot = cjson.decode(ARGV[7])
  if terminalSnapshot.status ~= terminal.status then return redis.error_reply('GENERATION_TERMINAL_SNAPSHOT_STATUS_INVALID') end
end
local terminalEventId = redis.call(
  'XADD', KEYS[2], '*',
  'type', terminalEvent.type,
  'data', terminalEvent.dataJson
)
redis.call('XTRIM', KEYS[2], 'MAXLEN', ARGV[5])
state.lastEventId = terminalEventId
if terminalSnapshot ~= nil then
  terminalSnapshot.lastEventId = terminalEventId
  saveSnapshot(state, terminalSnapshot, cjson.encode(terminalSnapshot), ARGV[4])
elseif ARGV[8] == '1' then
  state.snapshot = cjson.null
  if state.storageVersion == 2 then
    state.snapshotMeta = cjson.null
    redis.call('DEL', KEYS[4])
  end
end
state.status = terminal.status
state.terminal = terminal
state.intendedTerminal = cjson.null
state.leaseExpiresAt = cjson.null
state.updatedAt = ARGV[3]
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[4])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
retain(state, ARGV[4])
return { 1, terminalEventId }
`;

const CANCEL_SCRIPT = `${STATE_HELPERS}
${ROOM_ADMISSION_HELPERS}
-- GEN_CANCEL_V1
local raw = redis.call('GET', KEYS[1])
if not raw then
  if ARGV[7] and ARGV[7] ~= '' and not (ARGV[5] and ARGV[5] ~= '') then
    local existingReq = redis.call('GET', KEYS[3])
    if existingReq then
      local parsedReq = cjson.decode(existingReq)
      if parsedReq.generationId ~= ARGV[11] then return 'forbidden' end
    end
    local terminalEventId = redis.call('XADD', KEYS[2], '*', 'type', 'done', 'data', ARGV[10])
    redis.call('PEXPIRE', KEYS[2], ARGV[7])
    local state = cjson.decode(ARGV[9])
    state.lastEventId = terminalEventId
    redis.call('SET', KEYS[3], ARGV[8], 'PX', ARGV[7])
    redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[7])
    return 'accepted:' .. ARGV[2]
  end
  return 'not-found'
end
local state = cjson.decode(raw)
validateState(state)
if state.actorHash ~= ARGV[1] then return 'forbidden' end
local roomCancellation = ARGV[5] and ARGV[5] ~= ''
if roomCancellation then
  local decoded, admission = pcall(cjson.decode, ARGV[5])
  if not decoded or not sameAdmission(state.roomAdmission, admission)
    or (ARGV[6] ~= '' and state.producerTokenDigest ~= ARGV[6]) then return 'forbidden' end
end
if state.terminal ~= nil and state.terminal ~= cjson.null then
  return 'terminal:' .. state.terminal.status
end
if state.status == 'finalizing' then return 'finalizing' end
if state.cancelRequested == true then
  if state.cancelReason ~= 'content_policy' then state.cancelReason = 'user' end
else
  state.cancelRequested = true
  state.cancelReason = ARGV[2]
end
state.updatedAt = ARGV[3]
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[4])
retain(state, ARGV[4])
return roomCancellation and ('accepted:' .. state.cancelReason .. ':' .. state.status) or ('accepted:' .. state.cancelReason)
`;

const READ_SCRIPT = `
-- GEN_READ_V1
if redis.call('EXISTS', KEYS[1]) == 0 then return { 'stream-missing', '[]' } end
local after = ARGV[1]
if after ~= '' then
  local first = redis.call('XRANGE', KEYS[1], '-', '+', 'COUNT', 1)
  if #first > 0 then
    local atOrBefore = redis.call('XRANGE', KEYS[1], '-', after, 'COUNT', 1)
    if #atOrBefore == 0 then return { 'window-lost', '[]' } end
  end
end
local start = '-'
if after ~= '' then start = '(' .. after end
local entries = redis.call('XRANGE', KEYS[1], start, '+', 'COUNT', ARGV[2])
local normalized = {}
for _, entry in ipairs(entries) do
  local fields = {}
  for index = 1, #entry[2], 2 do
    fields[entry[2][index]] = entry[2][index + 1]
  end
  normalized[#normalized + 1] = {
    id = entry[1],
    type = fields.type,
    data = fields.data
  }
end
if #normalized == 0 then return { 'events', '[]' } end
return { 'events', cjson.encode(normalized) }
`;

const READ_EVENT_SCRIPT = `
-- GEN_READ_EVENT_V1
local entries = redis.call('XRANGE', KEYS[1], ARGV[1], ARGV[1], 'COUNT', 1)
if #entries == 0 then return { 'not-found', '' } end
local fields = {}
for index = 1, #entries[1][2], 2 do
  fields[entries[1][2][index]] = entries[1][2][index + 1]
end
return { 'event', cjson.encode({
  id = entries[1][1],
  type = fields.type,
  data = fields.data
}) }
`;

const hashKeyPart = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 32);

const actorScope = (actorKey: string): string => {
  const candidate = actorKey.split(':', 1)[0]?.toLowerCase() ?? '';
  return /^[a-z0-9_-]{1,24}$/u.test(candidate) ? candidate : 'actor';
};

const ttlMs = (seconds: number, optionName: string): number => {
  if (!Number.isFinite(seconds) || seconds < 1) {
    throw new Error(`${optionName} 必须是正有限数字`);
  }
  return Math.floor(seconds * 1_000);
};

const parseReservation = (
  raw: unknown,
): Awaited<ReturnType<GenerationReplayStore['reserve']>> => {
  if (!Array.isArray(raw) || typeof raw[0] !== 'string') {
    throw new Error('REDIS_GENERATION_RESERVATION_INVALID');
  }
  if ((raw[0] === 'created' || raw[0] === 'reused') && typeof raw[1] === 'string') {
    const preparationSeed = raw[2] === undefined || raw[2] === '' ? null : raw[2];
    const preparationVersion = raw[3] === undefined || raw[3] === '' ? null : raw[3];
    if (
      (preparationSeed === null) !== (preparationVersion === null)
      || (preparationSeed !== null && !isArenaPreparationSeed(preparationSeed))
      || (preparationVersion !== null && !isArenaPreparationVersion(preparationVersion))
    ) {
      throw new Error('REDIS_GENERATION_RESERVATION_INVALID');
    }
    return {
      kind: raw[0],
      generationId: raw[1],
      preparationSeed,
      preparationVersion,
    };
  }
  if (raw[0] === 'conflict') return { kind: 'conflict' };
  throw new Error('REDIS_GENERATION_RESERVATION_INVALID');
};

const isGenerationStatus = (value: unknown): value is GenerationStatus => [
  'reserved',
  'running',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
  'producer_lost',
].includes(String(value));

const isTerminalStatus = (
  value: unknown,
): value is GenerationTerminal['status'] => (
  value === 'completed'
  || value === 'failed'
  || value === 'cancelled'
  || value === 'producer_lost'
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const nullableString = (value: unknown): value is string | null => (
  value === null || typeof value === 'string'
);

const parseStoredSnapshot = (value: unknown): GenerationSnapshot | null => {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new Error('REDIS_GENERATION_STATE_INVALID');
  const lastEventId = value.lastEventId ?? null;
  const telemetry = value.telemetry ?? null;
  const terminalResultRef = value.terminalResultRef ?? null;
  const persistenceWarning = value.persistenceWarning;
  if (
    !isGenerationStatus(value.status)
    || typeof value.markdown !== 'string'
    || typeof value.reasoning !== 'string'
    || !nullableString(lastEventId)
    || typeof value.updatedAt !== 'string'
    || (telemetry !== null && !isRecord(telemetry))
    || !nullableString(terminalResultRef)
    || (persistenceWarning !== undefined && !isArenaGenerationPersistenceWarning(persistenceWarning))
  ) {
    throw new Error('REDIS_GENERATION_STATE_INVALID');
  }
  return {
    status: value.status,
    markdown: value.markdown,
    reasoning: value.reasoning,
    lastEventId,
    updatedAt: value.updatedAt,
    telemetry: telemetry as Record<string, unknown> | null,
    terminalResultRef,
    ...(persistenceWarning === undefined ? {} : {
      persistenceWarning,
    }),
  };
};

const parseStoredTerminal = (value: unknown): GenerationTerminal | null => {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !isTerminalStatus(value.status)) {
    throw new Error('REDIS_GENERATION_STATE_INVALID');
  }
  const publicError = value.publicError;
  const persistenceWarning = value.persistenceWarning;
  const replayUncertain = value.replayUncertain;
  if (
    ('code' in value && typeof value.code !== 'string')
    || (replayUncertain !== undefined && typeof replayUncertain !== 'boolean')
    || ('resultRef' in value && !nullableString(value.resultRef))
    || (persistenceWarning !== undefined
      && !isArenaGenerationPersistenceWarning(persistenceWarning))
    || (publicError !== undefined && !isSafePublicAiErrorProjection(publicError))
  ) {
    throw new Error('REDIS_GENERATION_STATE_INVALID');
  }
  const code = value.code;
  const resultRef = value.resultRef;
  return {
    status: value.status,
    ...(replayUncertain === undefined ? {} : { replayUncertain: replayUncertain as boolean }),
    ...(code === undefined ? {} : { code: code as string }),
    ...(resultRef === undefined ? {} : { resultRef: resultRef as string | null }),
    ...(persistenceWarning === undefined ? {} : {
      persistenceWarning,
    }),
    ...(publicError === undefined ? {} : { publicError: { ...publicError } }),
  };
};

const cancelReasonFromTaggedResult = (
  value: unknown,
  prefix: 'accepted:' | 'cancelled:',
): GenerationReplayStoreState['cancelReason'] => {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return null;
  const reason = value.slice(prefix.length);
  if (!isGenerationCancelReason(reason)) {
    throw new Error('REDIS_GENERATION_CANCEL_REASON_INVALID');
  }
  return reason;
};

const parseStoredState = (raw: string, sidecar = ''): StoredGenerationState => {
  let parsed: Partial<StoredGenerationState>;
  try {
    const candidate: unknown = JSON.parse(raw);
    if (!isRecord(candidate)) throw new Error('REDIS_GENERATION_STATE_INVALID');
    parsed = candidate as Partial<StoredGenerationState>;
  } catch {
    throw new Error('REDIS_GENERATION_STATE_INVALID');
  }
  if (parsed.storageVersion !== undefined && parsed.storageVersion !== 1 && parsed.storageVersion !== 2) {
    throw new Error('REDIS_GENERATION_STORAGE_VERSION_INVALID');
  }
  // This hint only makes corruption fail more conservatively; it never authorizes a read.
  const invalidEvidence = (code: string): Error => new Error(
    isRecord(parsed.terminal) && parsed.terminal.replayUncertain === true
      ? 'REDIS_GENERATION_UNCERTAIN_SNAPSHOT_UNAVAILABLE'
      : code,
  );
  let terminal: GenerationTerminal | null;
  try { terminal = parseStoredTerminal(parsed.terminal); } catch {
    throw invalidEvidence('REDIS_GENERATION_STATE_INVALID');
  }
  if (parsed.storageVersion === 2) {
    if (parsed.snapshot !== null || (parsed.snapshotMeta !== null && !isRecord(parsed.snapshotMeta))) {
      throw invalidEvidence('REDIS_GENERATION_SNAPSHOT_METADATA_INVALID');
    }
    if (parsed.snapshotMeta !== null) {
      const meta = parsed.snapshotMeta!;
      if (!sidecar || createHash('sha1').update(sidecar).digest('hex') !== meta.digest) {
        throw invalidEvidence('REDIS_GENERATION_SNAPSHOT_SIDECAR_INVALID');
      }
      let snapshot: GenerationSnapshot | null;
      try { snapshot = parseStoredSnapshot(JSON.parse(sidecar)); } catch {
        throw invalidEvidence('REDIS_GENERATION_SNAPSHOT_SIDECAR_INVALID');
      }
      if (!snapshot || snapshot.status !== meta.status || snapshot.lastEventId !== meta.lastEventId
        || snapshot.updatedAt !== meta.updatedAt) {
        throw invalidEvidence('REDIS_GENERATION_SNAPSHOT_METADATA_INVALID');
      }
      parsed.snapshot = snapshot;
    }
  }
  const preparationSeed = parsed.preparationSeed ?? null;
  const preparationVersion = parsed.preparationVersion ?? null;
  let snapshot: GenerationSnapshot | null;
  try { snapshot = parseStoredSnapshot(parsed.snapshot); } catch {
    throw invalidEvidence('REDIS_GENERATION_STATE_INVALID');
  }
  let intendedTerminal: GenerationTerminal | null;
  try { intendedTerminal = parseStoredTerminal(parsed.intendedTerminal); } catch {
    throw invalidEvidence('REDIS_GENERATION_STATE_INVALID');
  }
  if (
    typeof parsed.actorHash !== 'string'
    || typeof parsed.reservationKey !== 'string'
    || typeof parsed.generationId !== 'string'
    || typeof parsed.generationRequestId !== 'string'
    || typeof parsed.payloadHash !== 'string'
    || typeof parsed.producerToken !== 'string'
    || !isGenerationStatus(parsed.status)
    || typeof parsed.updatedAt !== 'string'
    || ((preparationSeed === null) !== (preparationVersion === null))
    || (preparationSeed !== null && !isArenaPreparationSeed(preparationSeed))
    || (preparationVersion !== null && !isArenaPreparationVersion(preparationVersion))
    || (terminal !== null && terminal.status !== parsed.status)
    || (terminal === null && isTerminalStatus(parsed.status))
    || (terminal !== null && typeof parsed.lastEventId !== 'string')
    || (terminal !== null && parsed.leaseExpiresAt !== null)
    || (terminal !== null && snapshot !== null && (
      snapshot.status !== terminal.status
      || snapshot.lastEventId !== parsed.lastEventId
      || (snapshot.terminalResultRef ?? null) !== (terminal.resultRef ?? null)
      || (snapshot.persistenceWarning ?? null) !== (terminal.persistenceWarning ?? null)
    ))
  ) {
    throw invalidEvidence('REDIS_GENERATION_STATE_INVALID');
  }
  return {
    actorHash: parsed.actorHash,
    reservationKey: parsed.reservationKey,
    generationId: parsed.generationId,
    generationRequestId: parsed.generationRequestId,
    payloadHash: parsed.payloadHash,
    mode: typeof parsed.mode === 'string' ? parsed.mode : null,
    ...(parsed.multiplayerParticipation === undefined ? {} : {
      multiplayerParticipation: ArenaMultiplayerParticipationSchema.parse(parsed.multiplayerParticipation),
    }),
    producerToken: parsed.producerToken,
    ...(parsed.roomAdmission === undefined ? {} : {
      roomAdmission: isRoomGenerationAdmission(parsed.roomAdmission) ? parsed.roomAdmission : (() => { throw new Error('REDIS_GENERATION_ROOM_ADMISSION_INVALID'); })(),
      producerTokenDigest: parsed.producerTokenDigest,
    }),
    status: parsed.status,
    lastEventId: typeof parsed.lastEventId === 'string' ? parsed.lastEventId : null,
    updatedAt: parsed.updatedAt,
    leaseExpiresAt: typeof parsed.leaseExpiresAt === 'string' ? parsed.leaseExpiresAt : null,
    snapshot,
    terminal,
    intendedTerminal,
    cancelRequested: parsed.cancelRequested === true,
    cancelReason: isGenerationCancelReason(parsed.cancelReason)
      ? parsed.cancelReason
      : parsed.cancelRequested === true
        ? 'user'
        : null,
    preparationSeed,
    preparationVersion,
  };
};

const parseEvent = (entry: RedisStreamMessage): GenerationStreamEvent => {
  if (!entry.id || typeof entry.message.type !== 'string') {
    throw new Error('REDIS_GENERATION_EVENT_INVALID');
  }
  let data: unknown;
  try {
    data = JSON.parse(entry.message.data ?? 'null');
  } catch {
    throw new Error('REDIS_GENERATION_EVENT_INVALID');
  }
  return { id: entry.id, type: entry.message.type, data };
};

const parseAtomicRead = (raw: unknown): {
  kind: 'events' | 'window-lost' | 'stream-missing';
  events: GenerationStreamEvent[];
} => {
  if (
    !Array.isArray(raw)
    || (raw[0] !== 'events' && raw[0] !== 'window-lost' && raw[0] !== 'stream-missing')
    || typeof raw[1] !== 'string'
  ) {
    throw new Error('REDIS_GENERATION_READ_INVALID');
  }
  if (raw[0] === 'window-lost') return { kind: 'window-lost', events: [] };
  if (raw[0] === 'stream-missing') return { kind: 'stream-missing', events: [] };
  let entries: unknown;
  try {
    // Redis Lua cjson encodes an empty table as `{}` unless the script emits an
    // explicit `[]`. Accept the historical shape while all new evaluations use [].
    entries = raw[1] === '{}' ? [] : JSON.parse(raw[1]);
  } catch {
    throw new Error('REDIS_GENERATION_READ_INVALID');
  }
  if (!Array.isArray(entries)) throw new Error('REDIS_GENERATION_READ_INVALID');
  return {
    kind: 'events',
    events: entries.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('REDIS_GENERATION_READ_INVALID');
      }
      const record = entry as { id?: unknown; type?: unknown; data?: unknown };
      if (
        typeof record.id !== 'string'
        || typeof record.type !== 'string'
        || typeof record.data !== 'string'
      ) {
        throw new Error('REDIS_GENERATION_READ_INVALID');
      }
      return parseEvent({
        id: record.id,
        message: { type: record.type, data: record.data },
      });
    }),
  };
};

const parseExactEvent = (raw: unknown): GenerationStreamEvent | null => {
  if (
    !Array.isArray(raw)
    || raw.length !== 2
    || (raw[0] !== 'event' && raw[0] !== 'not-found')
    || typeof raw[1] !== 'string'
  ) throw new Error('REDIS_GENERATION_EVENT_READ_INVALID');
  if (raw[0] === 'not-found') return null;
  let entry: unknown;
  try {
    entry = JSON.parse(raw[1]);
  } catch {
    throw new Error('REDIS_GENERATION_EVENT_READ_INVALID');
  }
  if (!isRecord(entry)) throw new Error('REDIS_GENERATION_EVENT_READ_INVALID');
  if (
    typeof entry.id !== 'string'
    || typeof entry.type !== 'string'
    || typeof entry.data !== 'string'
  ) throw new Error('REDIS_GENERATION_EVENT_READ_INVALID');
  return parseEvent({
    id: entry.id,
    message: { type: entry.type, data: entry.data },
  });
};

export const createRedisGenerationReplayStore = (
  options: RedisGenerationReplayStoreOptions,
): GenerationReplayStore => {
  const environmentPrefix = options.keyPrefix?.trim();
  if (environmentPrefix && !/^[a-z0-9_-]{1,32}$/u.test(environmentPrefix)) {
    throw new Error('keyPrefix 必须是安全的环境标识');
  }
  const keyPrefix = environmentPrefix ? `${KEY_PREFIX}:${environmentPrefix}` : KEY_PREFIX;
  const stateKey = (generationId: string): string => `${keyPrefix}:${generationId}:state`;
  const eventsKey = (generationId: string): string => `${keyPrefix}:${generationId}:events`;
  const snapshotKey = (generationId: string): string => `${keyPrefix}:${generationId}:snapshot`;
  const requestKey = (actorKey: string, generationRequestId: string): string =>
    `${keyPrefix}:req:${actorScope(actorKey)}:${hashKeyPart(actorKey)}:${generationRequestId}`;
  const activeTtlMs = ttlMs(
    options.activeTtlSeconds ?? DEFAULT_ACTIVE_TTL_SECONDS,
    'activeTtlSeconds',
  );
  const terminalTtlMs = ttlMs(
    options.terminalTtlSeconds ?? DEFAULT_TERMINAL_TTL_SECONDS,
    'terminalTtlSeconds',
  );
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) {
    throw new Error('maxEvents 必须是正整数');
  }

  // Bounded cache stores only a key hint, never authorization or storage layout.
  const identities = new Map<string, string>();
  const rememberIdentity = (generationId: string, identity: string): void => {
    if (!identity.startsWith(`${keyPrefix}:req:`)) throw new Error('REDIS_GENERATION_IDENTITY_INVALID');
    identities.delete(generationId);
    identities.set(generationId, identity);
    if (identities.size > 1_024) identities.delete(identities.keys().next().value!);
  };
  const mutationKeys = async (generationId: string): Promise<string[]> => {
    let identity = identities.get(generationId);
    if (identity) rememberIdentity(generationId, identity);
    if (!identity) {
      const discovered = await options.getClient().eval(DISCOVER_IDENTITY_SCRIPT, {
        keys: [stateKey(generationId)], arguments: [],
      });
      if (typeof discovered !== 'string') throw new Error('REDIS_GENERATION_IDENTITY_INVALID');
      identity = discovered;
      if (identity) rememberIdentity(generationId, identity);
    }
    // A missing state returns before identity validation. This sentinel is never touched.
    return [stateKey(generationId), eventsKey(generationId), identity || stateKey(generationId), snapshotKey(generationId)];
  };
  const roomKeyspace = createArenaRoomRedisKeyspace(options.keyPrefix);
  const mutate = async (generationId: string, script: string, input: { arguments: string[]; roomId?: string }): Promise<unknown> => {
    try {
      return await options.getClient().eval(script, {
        keys: [...await mutationKeys(generationId), ...(input.roomId ? [roomKeyspace.roomCheckpointKey(input.roomId)] : [])],
        arguments: input.arguments,
      });
    } catch (error) {
      // A failed command may have executed. Never retry it; only discard the hint.
      identities.delete(generationId);
      throw error;
    }
  };
  const readStoredState = async (generationId: string): Promise<StoredGenerationState | null> => {
    const raw = await options.getClient().eval(READ_STATE_SCRIPT, {
      keys: [stateKey(generationId), snapshotKey(generationId)], arguments: [],
    });
    if (!Array.isArray(raw) || raw.length !== 2 || raw.some((part) => typeof part !== 'string')) {
      throw new Error('REDIS_GENERATION_STATE_INVALID');
    }
    if (!raw[0]) return null;
    const state = parseStoredState(raw[0], raw[1]);
    if (state.generationId !== generationId) throw new Error('REDIS_GENERATION_STATE_INVALID');
    rememberIdentity(generationId, state.reservationKey);
    return state;
  };

  return Object.freeze({
    async reserve(input) {
      const preparationSeed = input.preparationSeed ?? null;
      const preparationVersion = input.preparationVersion ?? null;
      if (
        (preparationSeed === null) !== (preparationVersion === null)
        || (preparationSeed !== null && !isArenaPreparationSeed(preparationSeed))
        || (preparationVersion !== null && !isArenaPreparationVersion(preparationVersion))
      ) {
        throw new Error('REDIS_GENERATION_PREPARATION_INVALID');
      }
      if (input.roomAdmission && (!isRoomGenerationAdmission(input.roomAdmission)
        || input.actorKey !== `pvp-room:${input.roomAdmission.roomId}`
        || input.producerTokenDigest !== `sha256:${createHash('sha256').update(input.producerToken).digest('hex')}`)) {
        throw new Error('REDIS_GENERATION_ROOM_ADMISSION_INVALID');
      }
      const actorHash = hashKeyPart(input.actorKey);
      const identityKey = requestKey(input.actorKey, input.generationRequestId);
      const storedState: StoredGenerationState = {
        ...(options.enableSnapshotSidecar ? { storageVersion: 2 as const, snapshotMeta: null } : {}),
        actorHash,
        ...(input.roomAdmission ? { roomAdmission: input.roomAdmission, producerTokenDigest: input.producerTokenDigest } : {}),
        reservationKey: identityKey,
        generationId: input.generationId,
        generationRequestId: input.generationRequestId,
        payloadHash: input.payloadHash,
        mode: input.mode ?? null,
        ...(input.multiplayerParticipation ? {
          multiplayerParticipation: ArenaMultiplayerParticipationSchema.parse(input.multiplayerParticipation),
        } : {}),
        producerToken: input.producerToken,
        status: 'reserved',
        lastEventId: null,
        updatedAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt,
        snapshot: null,
        terminal: null,
        intendedTerminal: null,
        cancelRequested: false,
        cancelReason: null,
        preparationSeed,
        preparationVersion,
      };
      const raw = await options.getClient().eval(RESERVATION_SCRIPT, {
        keys: [
          identityKey,
          stateKey(input.generationId),
          snapshotKey(input.generationId),
        ],
        arguments: [
          input.payloadHash,
          JSON.stringify({
            generationId: input.generationId,
            payloadHash: input.payloadHash,
            preparationSeed,
            preparationVersion,
          }),
          String(activeTtlMs),
          JSON.stringify(storedState),
          input.generationId,
          preparationSeed ?? '',
          preparationVersion ?? '',
        ],
      });
      const reservation = parseReservation(raw);
      if (reservation.kind !== 'conflict') rememberIdentity(reservation.generationId, identityKey);
      return reservation;
    },

    async markRunning(input) {
      const result = await mutate(input.generationId, MARK_RUNNING_SCRIPT, {
        ...(input.roomAdmission ? { roomId: input.roomAdmission.roomId } : {}),
        arguments: [input.producerToken, input.now, input.leaseExpiresAt, String(activeTtlMs), input.roomAdmission ? JSON.stringify(input.roomAdmission) : ''],
      });
      const cancelReason = cancelReasonFromTaggedResult(result, 'cancelled:');
      if (cancelReason) {
        return { owned: true, cancelRequested: true, cancelReason };
      }
      if (result !== 2 && result !== 1 && result !== 0 && result !== -1) {
        throw new Error('REDIS_GENERATION_OWNERSHIP_INVALID');
      }
      return result === 2
        ? { owned: true, cancelRequested: true, cancelReason: 'user' }
        : { owned: result === 1, cancelRequested: false };
    },

    async claimFinalization(input) {
      const result = await mutate(input.generationId, CLAIM_FINALIZATION_SCRIPT, {
        arguments: [
          input.producerToken,
          input.now,
          input.leaseExpiresAt,
          String(activeTtlMs),
          input.terminal ? JSON.stringify(input.terminal) : '',
          JSON.stringify({
            status: 'cancelled',
            code: generationCancelCode('user'),
          }),
          JSON.stringify({
            status: 'cancelled',
            code: generationCancelCode('content_policy'),
          }),
        ],
      });
      const cancelReason = cancelReasonFromTaggedResult(result, 'cancelled:');
      if (cancelReason) return { kind: 'cancelled', cancelReason };
      if (result !== 'claimed' && result !== 'cancelled' && result !== 'fenced') {
        throw new Error('REDIS_GENERATION_FINALIZATION_CLAIM_INVALID');
      }
      return result === 'cancelled'
        ? { kind: 'cancelled', cancelReason: 'user' }
        : { kind: result };
    },

    async claimLeaseExpiry(input) {
      const result = await mutate(input.generationId, CLAIM_LEASE_EXPIRY_SCRIPT, {
        arguments: [
          hashKeyPart(input.actorKey),
          input.now,
          input.reaperToken,
          input.leaseExpiresAt,
          String(activeTtlMs),
        ],
      });
      if (!Array.isArray(result) || typeof result[0] !== 'string') {
        throw new Error('REDIS_GENERATION_REAPER_CLAIM_INVALID');
      }
      const kind = result[0];
      if (
        kind === 'claimed'
        && typeof result[1] === 'string'
        && typeof result[2] === 'string'
        && typeof result[3] === 'string'
        && (result[4] === undefined || typeof result[4] === 'string')
      ) {
        return {
          kind: 'claimed' as const,
          generationRequestId: result[1],
          payloadHash: result[2],
          mode: result[3] || null,
          ...(result[4]
            ? { intendedTerminal: parseStoredTerminal(JSON.parse(result[4])) }
            : {}),
        };
      }
      if (kind === 'not-expired' || kind === 'forbidden' || kind === 'not-found') {
        return { kind };
      }
      if (kind.startsWith('terminal:')) {
        const status = kind.slice('terminal:'.length);
        if (status === 'completed' || status === 'failed' || status === 'cancelled'
          || status === 'producer_lost') {
          return { kind: 'terminal' as const, status };
        }
      }
      throw new Error('REDIS_GENERATION_REAPER_CLAIM_INVALID');
    },

    async releaseReservation(input) {
      const result = await mutate(input.generationId, RELEASE_RESERVATION_SCRIPT, {
        arguments: [input.producerToken],
      });
      if (result !== 0 && result !== 1) {
        throw new Error('REDIS_GENERATION_RESERVATION_RELEASE_INVALID');
      }
      return { released: result === 1 };
    },

    async heartbeat(input) {
      const result = await mutate(input.generationId, HEARTBEAT_SCRIPT, {
        arguments: [input.producerToken, input.now, input.leaseExpiresAt, String(activeTtlMs)],
      });
      const cancelReason = cancelReasonFromTaggedResult(result, 'cancelled:');
      if (cancelReason) {
        return { owned: true, cancelRequested: true, cancelReason };
      }
      if (result !== -1 && result !== 0 && result !== 1 && result !== 2) {
        throw new Error('REDIS_GENERATION_LEASE_INVALID');
      }
      return result === 2
        ? { owned: true, cancelRequested: true, cancelReason: 'user' }
        : { owned: result === 1, cancelRequested: false };
    },

    async appendEvents(input) {
      if (input.events.length === 0) return { owned: true, events: [] };
      const serializedEvents = input.events.map((event) => ({
        type: event.type,
        dataJson: JSON.stringify(event.data) ?? 'null',
      }));
      const raw = await mutate(input.generationId, APPEND_SCRIPT, {
        arguments: [
          input.producerToken,
          JSON.stringify(serializedEvents),
          String(maxEvents),
          String(activeTtlMs),
          input.now,
        ],
      });
      if (Array.isArray(raw) && raw.length === 1 && raw[0] === 'fenced') {
        return { owned: false, events: [] };
      }
      if (
        !Array.isArray(raw)
        || raw.length !== input.events.length
        || raw.some((id) => typeof id !== 'string')
      ) {
        throw new Error('REDIS_GENERATION_APPEND_INVALID');
      }
      return {
        owned: true,
        events: input.events.map((event, index) => ({
          ...event,
          id: raw[index] as string,
        })),
      };
    },

    async writeSnapshot(input) {
      const result = await mutate(input.generationId, SNAPSHOT_SCRIPT, {
        arguments: [
          input.producerToken,
          JSON.stringify(input.snapshot),
          input.now,
          String(input.snapshot.status === 'running' ? activeTtlMs : terminalTtlMs),
        ],
      });
      if (result !== -1 && result !== 0 && result !== 1) {
        throw new Error('REDIS_GENERATION_SNAPSHOT_INVALID');
      }
      return { owned: result === 1 };
    },

    async readSnapshot(input) {
      return (await readStoredState(input.generationId))?.snapshot ?? null;
    },

    async readEvent(input) {
      return parseExactEvent(await options.getClient().eval(READ_EVENT_SCRIPT, {
        keys: [eventsKey(input.generationId)],
        arguments: [input.eventId],
      }));
    },

    async readAfter(input) {
      const client = options.getClient();
      const key = eventsKey(input.generationId);
      const immediate = parseAtomicRead(await client.eval(READ_SCRIPT, {
        keys: [key],
        arguments: [input.after ?? '', String(MAX_READ_EVENTS)],
      }));
      const awaitingFirstEvent = immediate.kind === 'stream-missing' && !input.after;
      if (
        (!awaitingFirstEvent && immediate.kind !== 'events')
        || immediate.events.length > 0
      ) return immediate;

      const tail = await client.xRead(
        [{ key, id: input.after ?? '0-0' }],
        {
          BLOCK: normalizeBlockingReadMs(input.blockMs),
          COUNT: MAX_READ_EVENTS,
        },
      );
      if (!tail?.some((stream) => stream.messages.length > 0)) {
        return immediate;
      }
      // XREAD cannot atomically prove that `after` survived an exact trim while it
      // was blocked. Re-read through Lua and use that result as the authoritative
      // batch so a removed cursor becomes window-lost instead of silently skipping.
      return parseAtomicRead(await client.eval(READ_SCRIPT, {
        keys: [key],
        arguments: [input.after ?? '', String(MAX_READ_EVENTS)],
      }));
    },

    async markTerminal(input) {
      if (
        !input.terminalEvent
        || Boolean(input.terminalSnapshot) === (input.clearTerminalSnapshot === true)
        || (input.terminalSnapshot && input.terminalSnapshot.status !== input.terminal.status)
      ) {
        throw new Error('REDIS_GENERATION_TERMINAL_EVIDENCE_INVALID');
      }
      const raw = await mutate(input.generationId, TERMINAL_SCRIPT, {
        arguments: [
          input.producerToken,
          JSON.stringify(input.terminal),
          input.now,
          String(terminalTtlMs),
          String(maxEvents),
          input.terminalEvent
            ? JSON.stringify({
                type: input.terminalEvent.type,
                dataJson: JSON.stringify(input.terminalEvent.data) ?? 'null',
              })
            : '',
          input.terminalSnapshot ? JSON.stringify(input.terminalSnapshot) : '',
          input.clearTerminalSnapshot ? '1' : '0',
        ],
      });
      if (
        Array.isArray(raw)
        && raw.length === 2
        && raw[0] === 1
        && typeof raw[1] === 'string'
        && input.terminalEvent
      ) {
        return {
          owned: true,
          applied: true,
          event: { ...input.terminalEvent, id: raw[1] },
        };
      }
      if (raw !== -1 && raw !== 0 && raw !== 1) {
        throw new Error('REDIS_GENERATION_TERMINAL_INVALID');
      }
      return { owned: raw !== -1, applied: raw === 1 };
    },

    async readState(input) {
      const state = await readStoredState(input.generationId);
      if (!state) return null;
      if (input.actorKey && state.actorHash !== hashKeyPart(input.actorKey)) return null;
      return {
        ...state,
        actorKey: input.actorKey ?? `sha256:${state.actorHash}`,
      };
    },

    async requestCancel(input) {
      if (!isGenerationCancelReason(input.reason)) {
        throw new Error('REDIS_GENERATION_CANCEL_REASON_INVALID');
      }
      const actorHash = hashKeyPart(input.actorKey);
      let raw: unknown;
      if (input.preCancelRequestId && !input.roomAdmission) {
        const identityKey = requestKey(input.actorKey, input.preCancelRequestId);
        const cancelCode = generationCancelCode(input.reason);
        const preCancelState: StoredGenerationState = {
          ...(options.enableSnapshotSidecar ? { storageVersion: 2 as const, snapshotMeta: null } : {}),
          actorHash,
          reservationKey: identityKey,
          generationId: input.generationId,
          generationRequestId: input.preCancelRequestId,
          payloadHash: PRE_CANCELLED_PAYLOAD_HASH,
          mode: null,
          producerToken: `pre-cancel:${input.generationId}`,
          status: 'cancelled',
          lastEventId: null,
          updatedAt: input.now,
          leaseExpiresAt: null,
          snapshot: null,
          terminal: { status: 'cancelled', code: cancelCode },
          intendedTerminal: null,
          cancelRequested: true,
          cancelReason: input.reason,
          preparationSeed: null,
          preparationVersion: null,
        };
        try {
          raw = await options.getClient().eval(CANCEL_SCRIPT, {
            keys: [
              stateKey(input.generationId),
              eventsKey(input.generationId),
              identityKey,
              snapshotKey(input.generationId),
            ],
            arguments: [
              actorHash,
              input.reason,
              input.now,
              String(activeTtlMs),
              '',
              '',
              String(terminalTtlMs),
              JSON.stringify({
                generationId: input.generationId,
                payloadHash: PRE_CANCELLED_PAYLOAD_HASH,
                preparationSeed: null,
                preparationVersion: null,
                preCancelled: true,
              }),
              JSON.stringify(preCancelState),
              JSON.stringify({ ok: false, status: 'cancelled', code: cancelCode }),
              input.generationId,
            ],
          });
          rememberIdentity(input.generationId, identityKey);
        } catch (error) {
          identities.delete(input.generationId);
          throw error;
        }
      } else {
        raw = await mutate(input.generationId, CANCEL_SCRIPT, {
          arguments: [
            actorHash,
            input.reason,
            input.now,
            String(activeTtlMs),
            input.roomAdmission ? JSON.stringify(input.roomAdmission) : '',
            input.producerTokenDigest ?? '',
          ],
        });
      }
      if (input.roomAdmission && typeof raw === 'string') {
        const match = /^accepted:(user|content_policy):(reserved|running)$/u.exec(raw);
        if (match) return { kind: 'accepted', cancelReason: match[1] as 'user' | 'content_policy', previousStatus: match[2] as 'reserved' | 'running' };
      }
      const cancelReason = cancelReasonFromTaggedResult(raw, 'accepted:');
      if (cancelReason) return { kind: 'accepted', cancelReason };
      if (
        raw === 'finalizing'
        || raw === 'forbidden'
        || raw === 'not-found'
      ) {
        return { kind: raw };
      }
      if (raw === 'accepted') return { kind: 'accepted', cancelReason: input.reason };
      if (typeof raw === 'string' && raw.startsWith('terminal:')) {
        const status = raw.slice('terminal:'.length);
        if (status === 'completed' || status === 'failed' || status === 'cancelled'
          || status === 'producer_lost') {
          return { kind: 'terminal', status };
        }
      }
      throw new Error('REDIS_GENERATION_CANCEL_INVALID');
    },
  } satisfies GenerationReplayStore);
};

export type {
  GenerationEventInput,
  GenerationSnapshot,
  GenerationTerminal,
};
