import { MAX_ROOM_DIRECTORY_PAGE_SIZE } from '@mahoshojo/contracts/arena-room';

import {
  createArenaRoomRedisKeyspace,
  type ArenaRoomRedisKeyspace,
} from './redis-room-keyspace';
import { isRoomDirectoryPublicIndexMember } from './room-directory-record';

const MAX_INTERNAL_QUERY_ROWS = MAX_ROOM_DIRECTORY_PAGE_SIZE + 1;

const PUBLIC_LIST_SCRIPT = `
-- ROOM_DIRECTORY_PUBLIC_LIST_V1
local min = ARGV[1]
local limit = tonumber(ARGV[2])
local recordPrefix = ARGV[3]
local members = redis.call('ZRANGE', KEYS[1], min, '+', 'BYLEX', 'LIMIT', '0', limit)
local result = {}
for _, member in ipairs(members) do
  local roomHash = string.sub(member, -64)
  local valid = string.len(member) == 80
    and string.sub(member, 16, 16) == ':'
    and string.match(string.sub(member, 1, 15), '^%d+$') ~= nil
    and string.match(roomHash, '^[0-9a-f]+$') ~= nil
  if not valid then
    redis.call('ZREM', KEYS[1], member)
    table.insert(result, { indexMember = member, raw = cjson.null })
  else
    local raw = redis.call('GET', recordPrefix .. roomHash)
    if not raw then redis.call('ZREM', KEYS[1], member) end
    table.insert(result, {
      indexMember = member,
      raw = raw or cjson.null,
    })
  end
end
if #result == 0 then return '[]' end
return cjson.encode(result)
`;

const REMOVE_EXACT_SCRIPT = `
-- ROOM_DIRECTORY_REMOVE_EXACT_V1
local recordTypeReply = redis.call('TYPE', KEYS[1])
local recordType = type(recordTypeReply) == 'table' and recordTypeReply.ok or recordTypeReply
local indexTypeReply = redis.call('TYPE', KEYS[2])
local indexType = type(indexTypeReply) == 'table' and indexTypeReply.ok or indexTypeReply
if (recordType ~= 'none' and recordType ~= 'string')
  or (indexType ~= 'none' and indexType ~= 'zset') then
  return 'invalid-storage'
end
local raw = redis.call('GET', KEYS[1])
if not raw or raw ~= ARGV[1] then return 'stale' end
redis.call('DEL', KEYS[1])
if ARGV[2] ~= '' then redis.call('ZREM', KEYS[2], ARGV[2]) end
return 'removed'
`;

export interface RedisRoomDirectoryClient {
  get(key: string): Promise<string | null>;
  eval(
    script: string,
    options: { readonly keys: string[]; readonly arguments: string[] },
  ): Promise<unknown>;
}

export type RedisRoomDirectoryCandidate = {
  readonly roomHash: string;
  readonly recordKey: string;
  readonly indexMember: string | null;
  readonly raw: string | null;
};

export type RedisRoomDirectoryStore = {
  candidateFromRaw(input: {
    readonly roomId: string;
    readonly raw: string;
    readonly indexMember?: string | null;
  }): Promise<RedisRoomDirectoryCandidate>;
  getCandidate(roomId: string): Promise<RedisRoomDirectoryCandidate | null>;
  listPublicCandidates(input: {
    readonly afterIndexMember?: string;
    readonly limit: number;
  }): Promise<RedisRoomDirectoryCandidate[]>;
  removeIfExact(
    candidate: RedisRoomDirectoryCandidate,
  ): Promise<{ readonly kind: 'removed' | 'stale' }>;
};

export type RedisRoomDirectoryStoreOptions = {
  readonly getClient: () => RedisRoomDirectoryClient;
  readonly keyPrefix?: string;
};

const fail = (code: string): never => {
  throw new Error(code);
};

const parseLimit = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_INTERNAL_QUERY_ROWS) {
    return fail('REDIS_ROOM_DIRECTORY_INPUT_INVALID');
  }
  return value;
};

const memberRoomHash = (member: string): string => {
  if (!isRoomDirectoryPublicIndexMember(member)) {
    return fail('REDIS_ROOM_DIRECTORY_RESPONSE_INVALID');
  }
  return member.slice(-64);
};

const candidateForHash = (
  keyspace: ArenaRoomRedisKeyspace,
  input: {
    readonly roomHash: string;
    readonly indexMember: string | null;
    readonly raw: string | null;
  },
): RedisRoomDirectoryCandidate => ({
  ...input,
  recordKey: keyspace.roomDirectoryRecordKeyFromHash(input.roomHash),
});

const parseListResponse = (
  raw: unknown,
  limit: number,
  keyspace: ArenaRoomRedisKeyspace,
): RedisRoomDirectoryCandidate[] => {
  if (typeof raw !== 'string') return fail('REDIS_ROOM_DIRECTORY_RESPONSE_INVALID');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > limit) {
      return fail('REDIS_ROOM_DIRECTORY_RESPONSE_INVALID');
    }
    return parsed.map((input) => {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return fail('REDIS_ROOM_DIRECTORY_RESPONSE_INVALID');
      }
      const candidate = input as Record<string, unknown>;
      if (
        Object.keys(candidate).sort().join('|') !== 'indexMember|raw'
        || typeof candidate.indexMember !== 'string'
        || (typeof candidate.raw !== 'string' && candidate.raw !== null)
      ) return fail('REDIS_ROOM_DIRECTORY_RESPONSE_INVALID');
      const roomHash = memberRoomHash(candidate.indexMember);
      return candidateForHash(keyspace, {
        roomHash,
        indexMember: candidate.indexMember,
        raw: candidate.raw as string | null,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'REDIS_ROOM_DIRECTORY_RESPONSE_INVALID') {
      throw error;
    }
    return fail('REDIS_ROOM_DIRECTORY_RESPONSE_INVALID');
  }
};

export const createRedisRoomDirectoryStore = (
  options: RedisRoomDirectoryStoreOptions,
): RedisRoomDirectoryStore => {
  const keyspace = createArenaRoomRedisKeyspace(options.keyPrefix);
  const candidateFromRaw: RedisRoomDirectoryStore['candidateFromRaw'] = async (input) => {
    const roomHash = keyspace.roomHash(input.roomId);
    const indexMember = input.indexMember ?? null;
    if (indexMember !== null && memberRoomHash(indexMember) !== roomHash) {
      return fail('REDIS_ROOM_DIRECTORY_INPUT_INVALID');
    }
    return candidateForHash(keyspace, {
      roomHash,
      indexMember,
      raw: input.raw,
    });
  };
  return Object.freeze({
    candidateFromRaw,

    async getCandidate(roomId) {
      const roomHash = keyspace.roomHash(roomId);
      const raw = await options.getClient().get(keyspace.roomDirectoryRecordKeyFromHash(roomHash));
      return raw === null
        ? null
        : candidateForHash(keyspace, { roomHash, indexMember: null, raw });
    },

    async listPublicCandidates(input) {
      const limit = parseLimit(input.limit);
      if (
        input.afterIndexMember !== undefined
        && !isRoomDirectoryPublicIndexMember(input.afterIndexMember)
      ) return fail('REDIS_ROOM_DIRECTORY_INPUT_INVALID');
      const min = input.afterIndexMember === undefined ? '-' : `(${input.afterIndexMember}`;
      const raw = await options.getClient().eval(PUBLIC_LIST_SCRIPT, {
        keys: [keyspace.directoryPublicIndexKey],
        arguments: [min, String(limit), keyspace.directoryRecordPrefix],
      });
      return parseListResponse(raw, limit, keyspace);
    },

    async removeIfExact(candidate) {
      if (
        candidate.raw === null
        || candidate.recordKey !== keyspace.roomDirectoryRecordKeyFromHash(candidate.roomHash)
        || (
          candidate.indexMember !== null
          && memberRoomHash(candidate.indexMember) !== candidate.roomHash
        )
      ) return fail('REDIS_ROOM_DIRECTORY_INPUT_INVALID');
      const raw = await options.getClient().eval(REMOVE_EXACT_SCRIPT, {
        keys: [candidate.recordKey, keyspace.directoryPublicIndexKey],
        arguments: [candidate.raw, candidate.indexMember ?? ''],
      });
      if (raw === 'invalid-storage') return fail('REDIS_ROOM_DIRECTORY_INVALID');
      if (raw !== 'removed' && raw !== 'stale') {
        return fail('REDIS_ROOM_DIRECTORY_RESPONSE_INVALID');
      }
      return { kind: raw };
    },
  });
};
