import {
  IsoTimestampSchema,
  MAX_ROOM_DIRECTORY_PAGE_SIZE,
  OpaqueKeySchema,
  RoomDirectoryEntrySchema,
  type RoomDirectoryEntry,
} from '@mahoshojo/contracts/arena-room';
import type { NodeDataD1Client } from '@mahoshojo/hosted-runtime/node-runtime/data-ports';

const MAX_INTERNAL_QUERY_ROWS = MAX_ROOM_DIRECTORY_PAGE_SIZE + 1;

export type RoomDirectoryStoreErrorCode =
  | 'ROOM_DIRECTORY_D1_FAILED'
  | 'ROOM_DIRECTORY_INPUT_INVALID'
  | 'ROOM_DIRECTORY_ROW_INVALID'
  | 'ROOM_DIRECTORY_UNAVAILABLE';

export class RoomDirectoryStoreError extends Error {
  constructor(readonly code: RoomDirectoryStoreErrorCode) {
    super(code);
    this.name = 'RoomDirectoryStoreError';
  }
}

export type RoomDirectoryRecord = RoomDirectoryEntry & {
  readonly roomEpoch: string;
  readonly hostUserId: number;
};

export type RoomDirectoryPosition = {
  readonly lastActivityAt: string;
  readonly roomId: string;
};

export type D1RoomDirectoryStore = {
  upsertOpen(input: RoomDirectoryRecord): Promise<void>;
  rebindEpoch(input: {
    readonly roomId: string;
    readonly previousRoomEpoch: string;
    readonly nextRoomEpoch: string;
    readonly hostUserId: number;
    readonly lastActivityAt: string;
  }): Promise<void>;
  delete(input: { readonly roomId: string; readonly roomEpoch: string }): Promise<void>;
  get(roomId: string): Promise<RoomDirectoryRecord | null>;
  listPublic(input: {
    readonly after?: RoomDirectoryPosition;
    readonly limit: number;
  }): Promise<RoomDirectoryRecord[]>;
  listByHost(input: {
    readonly hostUserId: number;
    readonly after?: RoomDirectoryPosition;
    readonly limit: number;
  }): Promise<RoomDirectoryRecord[]>;
  listReconciliationCandidates(input: {
    readonly inactiveBefore: string;
    readonly after?: RoomDirectoryPosition;
    readonly limit: number;
  }): Promise<RoomDirectoryRecord[]>;
};

export type D1RoomDirectoryStoreOptions = {
  readonly getClient: () => NodeDataD1Client | null;
};

const fail = (code: RoomDirectoryStoreErrorCode): never => {
  throw new RoomDirectoryStoreError(code);
};

const readClient = (options: D1RoomDirectoryStoreOptions): NodeDataD1Client => (
  options.getClient() ?? fail('ROOM_DIRECTORY_UNAVAILABLE')
);

const positiveUserId = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

const parseLimit = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_INTERNAL_QUERY_ROWS) {
    return fail('ROOM_DIRECTORY_INPUT_INVALID');
  }
  return value;
};

const parsePosition = (value: RoomDirectoryPosition | undefined): RoomDirectoryPosition | undefined => {
  if (value === undefined) return undefined;
  const timestamp = IsoTimestampSchema.safeParse(value.lastActivityAt);
  const roomId = OpaqueKeySchema.safeParse(value.roomId);
  if (!timestamp.success || !roomId.success) return fail('ROOM_DIRECTORY_INPUT_INVALID');
  return { lastActivityAt: timestamp.data, roomId: roomId.data };
};

const parseRecordInput = (input: RoomDirectoryRecord): RoomDirectoryRecord => {
  const entry = RoomDirectoryEntrySchema.safeParse({
    roomId: input.roomId,
    title: input.title,
    visibility: input.visibility,
    status: input.status,
    createdAt: input.createdAt,
    lastActivityAt: input.lastActivityAt,
  });
  const roomEpoch = OpaqueKeySchema.safeParse(input.roomEpoch);
  if (
    !entry.success
    || !roomEpoch.success
    || !positiveUserId(input.hostUserId)
    || Date.parse(entry.data.lastActivityAt) < Date.parse(entry.data.createdAt)
  ) return fail('ROOM_DIRECTORY_INPUT_INVALID');
  return { ...entry.data, roomEpoch: roomEpoch.data, hostUserId: input.hostUserId };
};

const integer = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return positiveUserId(parsed) ? parsed : fail('ROOM_DIRECTORY_ROW_INVALID');
};

const recordFromRow = (row: Record<string, unknown>): RoomDirectoryRecord => {
  const entry = RoomDirectoryEntrySchema.safeParse({
    roomId: row.id,
    title: row.title,
    visibility: row.visibility,
    status: row.status,
    createdAt: row['created_at'],
    lastActivityAt: row['last_activity_at'],
  });
  const roomEpoch = OpaqueKeySchema.safeParse(row['room_epoch']);
  if (
    !entry.success
    || !roomEpoch.success
    || Date.parse(entry.data.lastActivityAt) < Date.parse(entry.data.createdAt)
  ) return fail('ROOM_DIRECTORY_ROW_INVALID');
  return {
    ...entry.data,
    roomEpoch: roomEpoch.data,
    hostUserId: integer(row['host_user_id']),
  };
};

const rows = (result: {
  readonly success: boolean;
  readonly results: Record<string, unknown>[];
}): RoomDirectoryRecord[] => {
  if (!result.success) return fail('ROOM_DIRECTORY_D1_FAILED');
  return result.results.map(recordFromRow);
};

const ensureWriteSucceeded = (result: { readonly success: boolean }): void => {
  if (!result.success) fail('ROOM_DIRECTORY_D1_FAILED');
};

const SELECT_COLUMNS = `
SELECT
  id,
  room_epoch,
  host_user_id,
  title,
  visibility,
  status,
  created_at,
  last_activity_at
FROM arena_multiplayer_rooms
`.trim();

const UPSERT_OPEN_SQL = `
INSERT INTO arena_multiplayer_rooms (
  id,
  room_epoch,
  host_user_id,
  title,
  visibility,
  status,
  created_at,
  last_activity_at
) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
ON CONFLICT(id) DO UPDATE SET
  room_epoch = excluded.room_epoch,
  host_user_id = excluded.host_user_id,
  title = excluded.title,
  visibility = excluded.visibility,
  status = 'open',
  created_at = excluded.created_at,
  last_activity_at = excluded.last_activity_at
WHERE excluded.room_epoch = arena_multiplayer_rooms.room_epoch
  AND excluded.last_activity_at >= arena_multiplayer_rooms.last_activity_at
`.trim();

const REBIND_EPOCH_SQL = `
UPDATE arena_multiplayer_rooms
SET
  room_epoch = ?,
  last_activity_at = CASE
    WHEN last_activity_at < ? THEN ?
    ELSE last_activity_at
  END
WHERE id = ?
  AND room_epoch = ?
  AND host_user_id = ?
  AND status = 'open'
`.trim();

const withCursor = (base: string, after: RoomDirectoryPosition | undefined): string => (
  after
    ? `${base}\n  AND (last_activity_at < ? OR (last_activity_at = ? AND id < ?))`
    : base
);

const pageParams = (
  prefix: readonly unknown[],
  after: RoomDirectoryPosition | undefined,
  limit: number,
): unknown[] => [
  ...prefix,
  ...(after ? [after.lastActivityAt, after.lastActivityAt, after.roomId] : []),
  limit,
];

export const createD1RoomDirectoryStore = (
  options: D1RoomDirectoryStoreOptions,
): D1RoomDirectoryStore => Object.freeze({
  async upsertOpen(input) {
    const record = parseRecordInput(input);
    const result = await readClient(options)
      .prepare(UPSERT_OPEN_SQL)
      .bind(
        record.roomId,
        record.roomEpoch,
        record.hostUserId,
        record.title,
        record.visibility,
        record.createdAt,
        record.lastActivityAt,
      )
      .run({ retry: 'none' });
    ensureWriteSucceeded(result);
  },

  async rebindEpoch(input) {
    const roomId = OpaqueKeySchema.safeParse(input.roomId);
    const previousRoomEpoch = OpaqueKeySchema.safeParse(input.previousRoomEpoch);
    const nextRoomEpoch = OpaqueKeySchema.safeParse(input.nextRoomEpoch);
    const lastActivityAt = IsoTimestampSchema.safeParse(input.lastActivityAt);
    if (
      !roomId.success
      || !previousRoomEpoch.success
      || !nextRoomEpoch.success
      || previousRoomEpoch.data === nextRoomEpoch.data
      || !positiveUserId(input.hostUserId)
      || !lastActivityAt.success
    ) return fail('ROOM_DIRECTORY_INPUT_INVALID');
    const result = await readClient(options)
      .prepare(REBIND_EPOCH_SQL)
      .bind(
        nextRoomEpoch.data,
        lastActivityAt.data,
        lastActivityAt.data,
        roomId.data,
        previousRoomEpoch.data,
        input.hostUserId,
      )
      .run({ retry: 'none' });
    ensureWriteSucceeded(result);
  },

  async delete(input) {
    const roomId = OpaqueKeySchema.safeParse(input.roomId);
    const roomEpoch = OpaqueKeySchema.safeParse(input.roomEpoch);
    if (!roomId.success || !roomEpoch.success) return fail('ROOM_DIRECTORY_INPUT_INVALID');
    const result = await readClient(options)
      .prepare('DELETE FROM arena_multiplayer_rooms WHERE id = ? AND room_epoch = ?')
      .bind(roomId.data, roomEpoch.data)
      .run({ retry: 'none' });
    ensureWriteSucceeded(result);
  },

  async get(inputRoomId) {
    const roomId = OpaqueKeySchema.safeParse(inputRoomId);
    if (!roomId.success) return fail('ROOM_DIRECTORY_INPUT_INVALID');
    const result = await readClient(options)
      .prepare(`${SELECT_COLUMNS}\nWHERE id = ? AND status = 'open'\nLIMIT 1`)
      .bind(roomId.data)
      .all({ retry: 'safe-read' });
    const parsed = rows(result);
    return parsed[0] ?? null;
  },

  async listPublic(input) {
    const limit = parseLimit(input.limit);
    const after = parsePosition(input.after);
    const base = `${SELECT_COLUMNS}\nWHERE visibility = 'public' AND status = 'open'`;
    const result = await readClient(options)
      .prepare(`${withCursor(base, after)}\nORDER BY last_activity_at DESC, id DESC\nLIMIT ?`)
      .bind(...pageParams([], after, limit))
      .all({ retry: 'safe-read' });
    return rows(result);
  },

  async listByHost(input) {
    if (!positiveUserId(input.hostUserId)) return fail('ROOM_DIRECTORY_INPUT_INVALID');
    const limit = parseLimit(input.limit);
    const after = parsePosition(input.after);
    const base = `${SELECT_COLUMNS}\nWHERE host_user_id = ? AND status = 'open'`;
    const result = await readClient(options)
      .prepare(`${withCursor(base, after)}\nORDER BY last_activity_at DESC, id DESC\nLIMIT ?`)
      .bind(...pageParams([input.hostUserId], after, limit))
      .all({ retry: 'safe-read' });
    return rows(result);
  },

  async listReconciliationCandidates(input) {
    const inactiveBefore = IsoTimestampSchema.safeParse(input.inactiveBefore);
    if (!inactiveBefore.success) return fail('ROOM_DIRECTORY_INPUT_INVALID');
    const limit = parseLimit(input.limit);
    const after = parsePosition(input.after);
    const base = `${SELECT_COLUMNS}\nWHERE status = 'open' AND last_activity_at <= ?`;
    const result = await readClient(options)
      .prepare(`${withCursor(base, after)}\nORDER BY last_activity_at DESC, id DESC\nLIMIT ?`)
      .bind(...pageParams([inactiveBefore.data], after, limit))
      .all({ retry: 'safe-read' });
    return rows(result);
  },
});
