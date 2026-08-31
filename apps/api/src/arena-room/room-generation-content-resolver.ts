import {
  DataCardRefSchema,
  DisplayNameSchema,
  type DataCardRef,
} from '@mahoshojo/contracts/arena-room';
import {
  ONLINE_DATA_CARD_TYPES,
  OnlineDataCardTypeSchema,
} from '@mahoshojo/contracts/data-cards';
import { SafeJsonValueSchema } from '@mahoshojo/contracts/json-value';

import type { ArenaRoomGenerationCanonicalContent } from './room-generation-materializer';

type D1ReadOptions = Readonly<{ retry: 'safe-read' }>;

export type ArenaRoomGenerationContentD1Result = Readonly<{
  success: boolean;
  results: readonly Record<string, unknown>[];
}>;

export type ArenaRoomGenerationContentD1Statement = {
  bind(...params: unknown[]): ArenaRoomGenerationContentD1Statement;
  all(options: D1ReadOptions): Promise<ArenaRoomGenerationContentD1Result>;
};

export type ArenaRoomGenerationContentD1Client = Readonly<{
  prepare(sql: string): ArenaRoomGenerationContentD1Statement;
}>;

export type ArenaRoomGenerationContentResolverErrorCode =
  | 'ARENA_ROOM_REFERENCE_CONTENT_INVALID'
  | 'ARENA_ROOM_REFERENCE_D1_FAILED'
  | 'ARENA_ROOM_REFERENCE_D1_UNAVAILABLE'
  | 'ARENA_ROOM_REFERENCE_INPUT_INVALID'
  | 'ARENA_ROOM_REFERENCE_METADATA_INVALID'
  | 'ARENA_ROOM_REFERENCE_NOT_READABLE'
  | 'ARENA_ROOM_REFERENCE_VERSION_MISMATCH';

export class ArenaRoomGenerationContentResolverError extends Error {
  constructor(readonly code: ArenaRoomGenerationContentResolverErrorCode) {
    super(code);
    this.name = 'ArenaRoomGenerationContentResolverError';
  }
}

export type ArenaRoomGenerationOnlineContentResolver = Readonly<{
  resolve(input: Readonly<{
    ref: DataCardRef;
    hostAccountUserId: number;
  }>): Promise<ArenaRoomGenerationCanonicalContent>;
}>;

const SELECT_CANONICAL_CONTENT_SQL = `
SELECT
  id,
  user_id,
  type,
  name,
  data,
  is_public,
  review_status,
  updated_at,
  deleted_at
FROM data_cards
WHERE id = ?
LIMIT 1
`.trim();

const fail = (code: ArenaRoomGenerationContentResolverErrorCode): never => {
  throw new ArenaRoomGenerationContentResolverError(code);
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const positiveUserId = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
);

const integerVisibility = (value: unknown): -1 | 0 | 1 | null => {
  if (value === -1 || value === 0 || value === 1) return value;
  if (value === false) return 0;
  if (value === true) return 1;
  return null;
};

const canonicalString = (value: unknown): value is string => (
  typeof value === 'string' && value.length > 0 && value === value.trim()
);

const typeMatches = (ref: DataCardRef, type: string): boolean => (
  ref.kind === 'material'
    ? ONLINE_DATA_CARD_TYPES.includes(type as typeof ONLINE_DATA_CARD_TYPES[number])
    : ref.kind === type
);

const parsePayload = (value: unknown): Readonly<Record<string, unknown>> => {
  if (typeof value !== 'string') return fail('ARENA_ROOM_REFERENCE_CONTENT_INVALID');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return fail('ARENA_ROOM_REFERENCE_CONTENT_INVALID');
  }
  const safe = SafeJsonValueSchema.safeParse(parsed);
  if (
    !safe.success
    || typeof safe.data !== 'object'
    || safe.data === null
    || Array.isArray(safe.data)
  ) return fail('ARENA_ROOM_REFERENCE_CONTENT_INVALID');
  return Object.freeze(safe.data);
};

export const createArenaRoomGenerationOnlineContentResolver = (
  options: Readonly<{
    getClient: () => ArenaRoomGenerationContentD1Client | null;
  }>,
): ArenaRoomGenerationOnlineContentResolver => Object.freeze({
  async resolve(input) {
    const parsedRef = DataCardRefSchema.safeParse(input.ref);
    if (
      !parsedRef.success
      || parsedRef.data.id !== input.ref.id
      || parsedRef.data.versionToken !== input.ref.versionToken
      || !positiveUserId(input.hostAccountUserId)
    ) return fail('ARENA_ROOM_REFERENCE_INPUT_INVALID');
    let client: ArenaRoomGenerationContentD1Client | null;
    try {
      client = options.getClient();
    } catch {
      return fail('ARENA_ROOM_REFERENCE_D1_UNAVAILABLE');
    }
    if (!client) return fail('ARENA_ROOM_REFERENCE_D1_UNAVAILABLE');
    let rows: readonly Record<string, unknown>[];
    try {
      const result = await client.prepare(SELECT_CANONICAL_CONTENT_SQL)
        .bind(parsedRef.data.id)
        .all({ retry: 'safe-read' });
      if (!isRecord(result) || result.success !== true || !Array.isArray(result.results)) {
        return fail('ARENA_ROOM_REFERENCE_D1_FAILED');
      }
      rows = result.results;
    } catch (error) {
      if (error instanceof ArenaRoomGenerationContentResolverError) throw error;
      return fail('ARENA_ROOM_REFERENCE_D1_FAILED');
    }
    if (rows.length !== 1) return fail('ARENA_ROOM_REFERENCE_NOT_READABLE');
    const row = rows[0]!;
    if (!isRecord(row)) return fail('ARENA_ROOM_REFERENCE_METADATA_INVALID');
    const type = OnlineDataCardTypeSchema.safeParse(row.type);
    const name = DisplayNameSchema.safeParse(row.name);
    const visibility = integerVisibility(row.is_public);
    if (
      !canonicalString(row.id)
      || !positiveUserId(row.user_id)
      || !type.success
      || !name.success
      || visibility === null
      || !canonicalString(row.updated_at)
      || !(row.deleted_at === null || canonicalString(row.deleted_at))
      || typeof row.review_status !== 'string'
    ) return fail('ARENA_ROOM_REFERENCE_METADATA_INVALID');
    if (
      row.id !== parsedRef.data.id
      || !typeMatches(parsedRef.data, type.data)
      || row.deleted_at !== null
      || row.review_status !== 'approved'
      || visibility === -1
      || (visibility === 0 && row.user_id !== input.hostAccountUserId)
    ) return fail('ARENA_ROOM_REFERENCE_NOT_READABLE');
    if (row.updated_at !== parsedRef.data.versionToken) {
      return fail('ARENA_ROOM_REFERENCE_VERSION_MISMATCH');
    }
    return Object.freeze({
      ref: Object.freeze({ ...parsedRef.data }),
      displayName: name.data,
      sourceType: type.data,
      payload: parsePayload(row.data),
    });
  },
});
