import { createHash } from 'node:crypto';

import {
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

const DEFAULT_ACTIVE_TTL_SECONDS = 3_600;
const DEFAULT_TERMINAL_TTL_SECONDS = 2_700;
const DEFAULT_MAX_EVENTS = 2_048;
const MAX_READ_EVENTS = 256;
const KEY_PREFIX = 'mahoshojo:gen:v1';

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
};

type StoredGenerationState = Omit<GenerationReplayStoreState, 'actorKey'> & {
  actorHash: string;
  reservationKey: string;
};

const RESERVATION_SCRIPT = `
-- GEN_RESERVE_V1
local existing = redis.call('GET', KEYS[1])
if existing then
  local reservation = cjson.decode(existing)
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
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
redis.call('SET', KEYS[2], ARGV[4], 'PX', ARGV[3])
return { 'created', ARGV[5], ARGV[6], ARGV[7] }
`;

const MARK_RUNNING_SCRIPT = `
-- GEN_MARK_RUNNING_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
if state.producerToken ~= ARGV[1] then return -1 end
if state.status ~= 'reserved' then return -1 end
if state.terminal ~= nil and state.terminal ~= cjson.null then return 0 end
if state.leaseExpiresAt == nil or state.leaseExpiresAt == cjson.null or state.leaseExpiresAt <= ARGV[2] then return 0 end
if state.cancelRequested == true then
  state.status = 'finalizing'
  state.updatedAt = ARGV[2]
  state.leaseExpiresAt = ARGV[3]
  if state.cancelReason ~= 'content_policy' then state.cancelReason = 'user' end
  redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[4])
  redis.call('PEXPIRE', state.reservationKey, ARGV[4])
  return 'cancelled:' .. state.cancelReason
end
state.status = 'running'
state.updatedAt = ARGV[2]
state.leaseExpiresAt = ARGV[3]
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[4])
redis.call('PEXPIRE', state.reservationKey, ARGV[4])
return 1
`;

const CLAIM_FINALIZATION_SCRIPT = `
-- GEN_CLAIM_FINALIZATION_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 'fenced' end
local state = cjson.decode(raw)
if state.producerToken ~= ARGV[1] then return 'fenced' end
if state.terminal ~= nil and state.terminal ~= cjson.null then return 'fenced' end
if state.status ~= 'running' and state.status ~= 'finalizing' then return 'fenced' end
if state.leaseExpiresAt == nil or state.leaseExpiresAt == cjson.null or state.leaseExpiresAt <= ARGV[2] then return 'fenced' end
state.status = 'finalizing'
state.updatedAt = ARGV[2]
state.leaseExpiresAt = ARGV[3]
if state.cancelRequested == true and state.cancelReason ~= 'content_policy' then
  state.cancelReason = 'user'
end
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[4])
redis.call('PEXPIRE', state.reservationKey, ARGV[4])
if state.cancelRequested == true then
  return 'cancelled:' .. state.cancelReason
end
return 'claimed'
`;

const CLAIM_LEASE_EXPIRY_SCRIPT = `
-- GEN_CLAIM_LEASE_EXPIRY_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return { 'not-found', '', '' } end
local state = cjson.decode(raw)
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
redis.call('PEXPIRE', state.reservationKey, ARGV[5])
return { 'claimed', state.generationRequestId, state.payloadHash, state.mode or '' }
`;

const RELEASE_RESERVATION_SCRIPT = `
-- GEN_RELEASE_RESERVATION_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
if state.producerToken ~= ARGV[1] or state.status ~= 'reserved' then return 0 end
redis.call('DEL', KEYS[1])
redis.call('DEL', state.reservationKey)
return 1
`;

const HEARTBEAT_SCRIPT = `
-- GEN_HEARTBEAT_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
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
redis.call('PEXPIRE', state.reservationKey, ARGV[4])
if state.cancelRequested == true then
  return 'cancelled:' .. state.cancelReason
end
return 1
`;

const APPEND_SCRIPT = `
-- GEN_APPEND_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return { 'fenced' } end
local state = cjson.decode(raw)
if state.producerToken ~= ARGV[1] or (state.status ~= 'running' and state.status ~= 'finalizing') then return { 'fenced' } end
if state.leaseExpiresAt == nil or state.leaseExpiresAt == cjson.null or state.leaseExpiresAt <= ARGV[5] then return { 'fenced' } end
local events = cjson.decode(ARGV[2])
local ids = {}
for index, event in ipairs(events) do
  ids[index] = redis.call(
    'XADD', KEYS[2], '*',
    'type', event.type,
    'data', cjson.encode(event.data)
  )
end
redis.call('XTRIM', KEYS[2], 'MAXLEN', ARGV[3])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
if #ids > 0 then state.lastEventId = ids[#ids] end
state.updatedAt = ARGV[5]
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[4])
redis.call('PEXPIRE', state.reservationKey, ARGV[4])
return ids
`;

const SNAPSHOT_SCRIPT = `
-- GEN_SNAPSHOT_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
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
state.snapshot = snapshot
state.updatedAt = ARGV[3]
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[4])
redis.call('PEXPIRE', state.reservationKey, ARGV[4])
return 1
`;

const TERMINAL_SCRIPT = `
-- GEN_TERMINAL_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
if state.producerToken ~= ARGV[1] then return -1 end
if state.terminal ~= nil and state.terminal ~= cjson.null then return 0 end
if state.status ~= 'running' and state.status ~= 'reserved' and state.status ~= 'finalizing' then return -1 end
if state.leaseExpiresAt == nil or state.leaseExpiresAt == cjson.null or state.leaseExpiresAt <= ARGV[3] then return -1 end
local terminal = cjson.decode(ARGV[2])
state.status = terminal.status
state.terminal = terminal
state.leaseExpiresAt = cjson.null
state.updatedAt = ARGV[3]
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[4])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
redis.call('PEXPIRE', state.reservationKey, ARGV[4])
return 1
`;

const CANCEL_SCRIPT = `
-- GEN_CANCEL_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 'not-found' end
local state = cjson.decode(raw)
if state.actorHash ~= ARGV[1] then return 'forbidden' end
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
redis.call('PEXPIRE', state.reservationKey, ARGV[4])
return 'accepted:' .. state.cancelReason
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
  if (
    !isGenerationStatus(value.status)
    || typeof value.markdown !== 'string'
    || typeof value.reasoning !== 'string'
    || !nullableString(lastEventId)
    || typeof value.updatedAt !== 'string'
    || (telemetry !== null && !isRecord(telemetry))
    || !nullableString(terminalResultRef)
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
  };
};

const parseStoredTerminal = (value: unknown): GenerationTerminal | null => {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !isTerminalStatus(value.status)) {
    throw new Error('REDIS_GENERATION_STATE_INVALID');
  }
  if (
    ('code' in value && typeof value.code !== 'string')
    || ('resultRef' in value && !nullableString(value.resultRef))
  ) {
    throw new Error('REDIS_GENERATION_STATE_INVALID');
  }
  const code = value.code;
  const resultRef = value.resultRef;
  return {
    status: value.status,
    ...(code === undefined ? {} : { code: code as string }),
    ...(resultRef === undefined ? {} : { resultRef: resultRef as string | null }),
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

const parseStoredState = (raw: string): StoredGenerationState => {
  let parsed: Partial<StoredGenerationState>;
  try {
    const candidate: unknown = JSON.parse(raw);
    if (!isRecord(candidate)) throw new Error('REDIS_GENERATION_STATE_INVALID');
    parsed = candidate as Partial<StoredGenerationState>;
  } catch {
    throw new Error('REDIS_GENERATION_STATE_INVALID');
  }
  const preparationSeed = parsed.preparationSeed ?? null;
  const preparationVersion = parsed.preparationVersion ?? null;
  const snapshot = parseStoredSnapshot(parsed.snapshot);
  const terminal = parseStoredTerminal(parsed.terminal);
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
  ) {
    throw new Error('REDIS_GENERATION_STATE_INVALID');
  }
  return {
    actorHash: parsed.actorHash,
    reservationKey: parsed.reservationKey,
    generationId: parsed.generationId,
    generationRequestId: parsed.generationRequestId,
    payloadHash: parsed.payloadHash,
    mode: typeof parsed.mode === 'string' ? parsed.mode : null,
    producerToken: parsed.producerToken,
    status: parsed.status,
    lastEventId: typeof parsed.lastEventId === 'string' ? parsed.lastEventId : null,
    updatedAt: parsed.updatedAt,
    leaseExpiresAt: typeof parsed.leaseExpiresAt === 'string' ? parsed.leaseExpiresAt : null,
    snapshot,
    terminal,
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
      const actorHash = hashKeyPart(input.actorKey);
      const identityKey = requestKey(input.actorKey, input.generationRequestId);
      const storedState: StoredGenerationState = {
        actorHash,
        reservationKey: identityKey,
        generationId: input.generationId,
        generationRequestId: input.generationRequestId,
        payloadHash: input.payloadHash,
        mode: input.mode ?? null,
        producerToken: input.producerToken,
        status: 'reserved',
        lastEventId: null,
        updatedAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt,
        snapshot: null,
        terminal: null,
        cancelRequested: false,
        cancelReason: null,
        preparationSeed,
        preparationVersion,
      };
      const raw = await options.getClient().eval(RESERVATION_SCRIPT, {
        keys: [
          identityKey,
          stateKey(input.generationId),
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
      return parseReservation(raw);
    },

    async markRunning(input) {
      const result = await options.getClient().eval(MARK_RUNNING_SCRIPT, {
        keys: [stateKey(input.generationId)],
        arguments: [input.producerToken, input.now, input.leaseExpiresAt, String(activeTtlMs)],
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
      const result = await options.getClient().eval(CLAIM_FINALIZATION_SCRIPT, {
        keys: [stateKey(input.generationId)],
        arguments: [
          input.producerToken,
          input.now,
          input.leaseExpiresAt,
          String(activeTtlMs),
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
      const result = await options.getClient().eval(CLAIM_LEASE_EXPIRY_SCRIPT, {
        keys: [stateKey(input.generationId)],
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
      ) {
        return {
          kind: 'claimed' as const,
          generationRequestId: result[1],
          payloadHash: result[2],
          mode: result[3] || null,
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
      const result = await options.getClient().eval(RELEASE_RESERVATION_SCRIPT, {
        keys: [stateKey(input.generationId)],
        arguments: [input.producerToken],
      });
      if (result !== 0 && result !== 1) {
        throw new Error('REDIS_GENERATION_RESERVATION_RELEASE_INVALID');
      }
      return { released: result === 1 };
    },

    async heartbeat(input) {
      const result = await options.getClient().eval(HEARTBEAT_SCRIPT, {
        keys: [stateKey(input.generationId)],
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
      const raw = await options.getClient().eval(APPEND_SCRIPT, {
        keys: [stateKey(input.generationId), eventsKey(input.generationId)],
        arguments: [
          input.producerToken,
          JSON.stringify(input.events),
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
      const result = await options.getClient().eval(SNAPSHOT_SCRIPT, {
        keys: [stateKey(input.generationId)],
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
      const raw = await options.getClient().get(stateKey(input.generationId));
      return raw ? parseStoredState(raw).snapshot : null;
    },

    async readAfter(input) {
      const client = options.getClient();
      const key = eventsKey(input.generationId);
      const immediate = parseAtomicRead(await client.eval(READ_SCRIPT, {
        keys: [key],
        arguments: [input.after ?? '', String(MAX_READ_EVENTS)],
      }));
      if (immediate.kind !== 'events' || immediate.events.length > 0) return immediate;

      const tail = await client.xRead(
        [{ key, id: input.after ?? '0-0' }],
        { BLOCK: Math.max(1, Math.floor(input.blockMs)), COUNT: MAX_READ_EVENTS },
      );
      if (!tail?.some((stream) => stream.messages.length > 0)) {
        return { kind: 'events' as const, events: [] };
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
      const raw = await options.getClient().eval(TERMINAL_SCRIPT, {
        keys: [stateKey(input.generationId), eventsKey(input.generationId)],
        arguments: [
          input.producerToken,
          JSON.stringify(input.terminal),
          input.now,
          String(terminalTtlMs),
        ],
      });
      if (raw !== -1 && raw !== 0 && raw !== 1) {
        throw new Error('REDIS_GENERATION_TERMINAL_INVALID');
      }
      return { owned: raw !== -1, applied: raw === 1 };
    },

    async readState(input) {
      const raw = await options.getClient().get(stateKey(input.generationId));
      if (!raw) return null;
      const state = parseStoredState(raw);
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
      const raw = await options.getClient().eval(CANCEL_SCRIPT, {
        keys: [stateKey(input.generationId)],
        arguments: [
          hashKeyPart(input.actorKey),
          input.reason,
          input.now,
          String(activeTtlMs),
        ],
      });
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
