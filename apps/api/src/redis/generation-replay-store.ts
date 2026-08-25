import { createHash } from 'node:crypto';

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
    return { 'reused', reservation.generationId }
  end
  return { 'conflict', '' }
end
if redis.call('EXISTS', KEYS[2]) == 1 then
  return redis.error_reply('GENERATION_ID_CONFLICT')
end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
redis.call('SET', KEYS[2], ARGV[4], 'PX', ARGV[3])
return { 'created', ARGV[5] }
`;

const MARK_RUNNING_SCRIPT = `
-- GEN_MARK_RUNNING_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
if state.terminal ~= nil and state.terminal ~= cjson.null then return 0 end
state.status = 'running'
state.updatedAt = ARGV[1]
state.leaseExpiresAt = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[3])
redis.call('PEXPIRE', state.reservationKey, ARGV[3])
return 1
`;

const HEARTBEAT_SCRIPT = `
-- GEN_HEARTBEAT_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
if state.status ~= 'running' then return 0 end
if state.terminal ~= nil and state.terminal ~= cjson.null then return 0 end
state.updatedAt = ARGV[1]
state.leaseExpiresAt = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[3])
redis.call('PEXPIRE', state.reservationKey, ARGV[3])
if state.cancelRequested == true then return 2 end
return 1
`;

const APPEND_SCRIPT = `
-- GEN_APPEND_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return redis.error_reply('GENERATION_STATE_NOT_FOUND') end
local state = cjson.decode(raw)
local events = cjson.decode(ARGV[1])
local ids = {}
for index, event in ipairs(events) do
  ids[index] = redis.call(
    'XADD', KEYS[2], '*',
    'type', event.type,
    'data', cjson.encode(event.data)
  )
end
redis.call('XTRIM', KEYS[2], 'MAXLEN', '~', ARGV[2])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
if #ids > 0 then state.lastEventId = ids[#ids] end
state.updatedAt = ARGV[4]
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[3])
redis.call('PEXPIRE', state.reservationKey, ARGV[3])
return ids
`;

const SNAPSHOT_SCRIPT = `
-- GEN_SNAPSHOT_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
state.snapshot = cjson.decode(ARGV[1])
state.updatedAt = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[3])
redis.call('PEXPIRE', state.reservationKey, ARGV[3])
return 1
`;

const TERMINAL_SCRIPT = `
-- GEN_TERMINAL_V1
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local state = cjson.decode(raw)
if state.terminal ~= nil and state.terminal ~= cjson.null then return 0 end
local terminal = cjson.decode(ARGV[1])
state.status = terminal.status
state.terminal = terminal
state.leaseExpiresAt = cjson.null
state.updatedAt = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[3])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
redis.call('PEXPIRE', state.reservationKey, ARGV[3])
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
state.cancelRequested = true
state.cancelReason = ARGV[2]
state.updatedAt = ARGV[3]
redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ARGV[4])
redis.call('PEXPIRE', state.reservationKey, ARGV[4])
return 'accepted'
`;

const READ_SCRIPT = `
-- GEN_READ_V1
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
return { 'events', cjson.encode(normalized) }
`;

const hashKeyPart = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 32);

const actorScope = (actorKey: string): string => {
  const candidate = actorKey.split(':', 1)[0]?.toLowerCase() ?? '';
  return /^[a-z0-9_-]{1,24}$/u.test(candidate) ? candidate : 'actor';
};

const stateKey = (generationId: string): string =>
  `${KEY_PREFIX}:${generationId}:state`;

const eventsKey = (generationId: string): string =>
  `${KEY_PREFIX}:${generationId}:events`;

const requestKey = (actorKey: string, generationRequestId: string): string =>
  `${KEY_PREFIX}:req:${actorScope(actorKey)}:${hashKeyPart(actorKey)}:${generationRequestId}`;

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
    return { kind: raw[0], generationId: raw[1] };
  }
  if (raw[0] === 'conflict') return { kind: 'conflict' };
  throw new Error('REDIS_GENERATION_RESERVATION_INVALID');
};

const isGenerationStatus = (value: unknown): value is GenerationStatus => [
  'reserved',
  'running',
  'completed',
  'failed',
  'cancelled',
  'producer_lost',
].includes(String(value));

const parseStoredState = (raw: string): StoredGenerationState => {
  const parsed = JSON.parse(raw) as Partial<StoredGenerationState>;
  if (
    typeof parsed.actorHash !== 'string'
    || typeof parsed.reservationKey !== 'string'
    || typeof parsed.generationId !== 'string'
    || typeof parsed.generationRequestId !== 'string'
    || typeof parsed.payloadHash !== 'string'
    || !isGenerationStatus(parsed.status)
    || typeof parsed.updatedAt !== 'string'
  ) {
    throw new Error('REDIS_GENERATION_STATE_INVALID');
  }
  return {
    actorHash: parsed.actorHash,
    reservationKey: parsed.reservationKey,
    generationId: parsed.generationId,
    generationRequestId: parsed.generationRequestId,
    payloadHash: parsed.payloadHash,
    status: parsed.status,
    lastEventId: typeof parsed.lastEventId === 'string' ? parsed.lastEventId : null,
    updatedAt: parsed.updatedAt,
    leaseExpiresAt: typeof parsed.leaseExpiresAt === 'string' ? parsed.leaseExpiresAt : null,
    snapshot: parsed.snapshot ?? null,
    terminal: parsed.terminal ?? null,
    cancelRequested: parsed.cancelRequested === true,
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
  kind: 'events' | 'window-lost';
  events: GenerationStreamEvent[];
} => {
  if (
    !Array.isArray(raw)
    || (raw[0] !== 'events' && raw[0] !== 'window-lost')
    || typeof raw[1] !== 'string'
  ) {
    throw new Error('REDIS_GENERATION_READ_INVALID');
  }
  if (raw[0] === 'window-lost') return { kind: 'window-lost', events: [] };
  let entries: unknown;
  try {
    entries = JSON.parse(raw[1]);
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
      const actorHash = hashKeyPart(input.actorKey);
      const identityKey = requestKey(input.actorKey, input.generationRequestId);
      const storedState: StoredGenerationState = {
        actorHash,
        reservationKey: identityKey,
        generationId: input.generationId,
        generationRequestId: input.generationRequestId,
        payloadHash: input.payloadHash,
        status: 'reserved',
        lastEventId: null,
        updatedAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt,
        snapshot: null,
        terminal: null,
        cancelRequested: false,
      };
      const raw = await options.getClient().eval(RESERVATION_SCRIPT, {
        keys: [
          identityKey,
          stateKey(input.generationId),
        ],
        arguments: [
          input.payloadHash,
          JSON.stringify({ generationId: input.generationId, payloadHash: input.payloadHash }),
          String(activeTtlMs),
          JSON.stringify(storedState),
          input.generationId,
        ],
      });
      return parseReservation(raw);
    },

    async markRunning(input) {
      const result = await options.getClient().eval(MARK_RUNNING_SCRIPT, {
        keys: [stateKey(input.generationId)],
        arguments: [input.now, input.leaseExpiresAt, String(activeTtlMs)],
      });
      if (result !== 1) throw new Error('REDIS_GENERATION_OWNERSHIP_LOST');
    },

    async heartbeat(input) {
      const result = await options.getClient().eval(HEARTBEAT_SCRIPT, {
        keys: [stateKey(input.generationId)],
        arguments: [input.now, input.leaseExpiresAt, String(activeTtlMs)],
      });
      if (result !== 1 && result !== 2) throw new Error('REDIS_GENERATION_LEASE_LOST');
      return { cancelRequested: result === 2 };
    },

    async appendEvents(input) {
      if (input.events.length === 0) return { events: [] };
      const raw = await options.getClient().eval(APPEND_SCRIPT, {
        keys: [stateKey(input.generationId), eventsKey(input.generationId)],
        arguments: [
          JSON.stringify(input.events),
          String(maxEvents),
          String(activeTtlMs),
          input.now,
        ],
      });
      if (
        !Array.isArray(raw)
        || raw.length !== input.events.length
        || raw.some((id) => typeof id !== 'string')
      ) {
        throw new Error('REDIS_GENERATION_APPEND_INVALID');
      }
      return {
        events: input.events.map((event, index) => ({
          ...event,
          id: raw[index] as string,
        })),
      };
    },

    async writeSnapshot(input) {
      await options.getClient().eval(SNAPSHOT_SCRIPT, {
        keys: [stateKey(input.generationId)],
        arguments: [JSON.stringify(input.snapshot), input.now, String(activeTtlMs)],
      });
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
      if (immediate.kind === 'window-lost' || immediate.events.length > 0) return immediate;

      const tail = await client.xRead(
        [{ key, id: input.after ?? '0-0' }],
        { BLOCK: Math.max(1, Math.floor(input.blockMs)), COUNT: MAX_READ_EVENTS },
      );
      return {
        kind: 'events' as const,
        events: (tail?.flatMap((stream) => stream.messages) ?? []).map(parseEvent),
      };
    },

    async markTerminal(input) {
      const raw = await options.getClient().eval(TERMINAL_SCRIPT, {
        keys: [stateKey(input.generationId), eventsKey(input.generationId)],
        arguments: [JSON.stringify(input.terminal), input.now, String(terminalTtlMs)],
      });
      if (raw !== 0 && raw !== 1) throw new Error('REDIS_GENERATION_TERMINAL_INVALID');
      return { applied: raw === 1 };
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
      const raw = await options.getClient().eval(CANCEL_SCRIPT, {
        keys: [stateKey(input.generationId)],
        arguments: [
          hashKeyPart(input.actorKey),
          input.reason,
          input.now,
          String(activeTtlMs),
        ],
      });
      if (raw === 'accepted' || raw === 'forbidden' || raw === 'not-found') {
        return { kind: raw };
      }
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
