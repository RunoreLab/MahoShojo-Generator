import {
  IsoTimestampSchema,
  MAX_ROOM_DIRECTORY_PAGE_SIZE,
  OpaqueKeySchema,
  RoomDirectoryEntrySchema,
  RoomDirectoryPageQuerySchema,
  RoomDirectoryPageSchema,
  type RoomDirectoryEntry,
  type RoomDirectoryPage,
  type RoomDirectoryPageQuery,
} from '@mahoshojo/contracts/arena-room';
import {
  parseArenaRoomAuthorityState,
  type ArenaRoomAuthorityState,
} from '@mahoshojo/multiplayer-core';

import type { RoomActorCheckpointStore } from './room-actor-registry';
import type {
  D1RoomDirectoryStore,
  RoomDirectoryPosition,
  RoomDirectoryRecord,
} from './d1-room-directory-store';

const DIRECTORY_CURSOR_VERSION = 1;

export type RoomDirectoryServiceErrorCode =
  | 'ROOM_DIRECTORY_AUTHORITY_UNAVAILABLE'
  | 'ROOM_DIRECTORY_CLOSE_INVALID'
  | 'ROOM_DIRECTORY_CURSOR_INVALID'
  | 'ROOM_DIRECTORY_INPUT_INVALID'
  | 'ROOM_DIRECTORY_STALE';

export class RoomDirectoryServiceError extends Error {
  constructor(readonly code: RoomDirectoryServiceErrorCode) {
    super(code);
    this.name = 'RoomDirectoryServiceError';
  }
}

type DirectoryAuthorityStore = Pick<RoomActorCheckpointStore, 'load'>;

export type ArenaRoomDirectoryServiceOptions = {
  readonly authority: DirectoryAuthorityStore;
  readonly store: D1RoomDirectoryStore;
  readonly onBackgroundError?: (error: unknown) => void;
};

export type RoomDirectoryReconcileInput = {
  readonly inactiveBefore: string;
  readonly cursor?: string;
  readonly limit?: number;
};

export type RoomDirectoryReconcileResult = {
  readonly scanned: number;
  readonly removed: number;
  readonly nextCursor: string | null;
};

export type ArenaRoomDirectoryService = {
  registerOpen(record: RoomDirectoryRecord): Promise<void>;
  lookup(roomId: string): Promise<RoomDirectoryEntry | null>;
  discoverPublic(query: Partial<RoomDirectoryPageQuery>): Promise<RoomDirectoryPage>;
  listForHost(hostUserId: number, query: Partial<RoomDirectoryPageQuery>): Promise<RoomDirectoryPage>;
  reconcile(input: RoomDirectoryReconcileInput): Promise<RoomDirectoryReconcileResult>;
  removeCommittedClosed(state: ArenaRoomAuthorityState): Promise<void>;
};

type DirectoryCursorPayload = {
  readonly version: typeof DIRECTORY_CURSOR_VERSION;
  readonly scope: string;
  readonly lastActivityAt: string;
  readonly roomId: string;
};

const fail = (code: RoomDirectoryServiceErrorCode): never => {
  throw new RoomDirectoryServiceError(code);
};

const positiveUserId = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

const parseRecord = (input: RoomDirectoryRecord): RoomDirectoryRecord => {
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

const publicEntry = (record: RoomDirectoryRecord): RoomDirectoryEntry => (
  RoomDirectoryEntrySchema.parse({
    roomId: record.roomId,
    title: record.title,
    visibility: record.visibility,
    status: record.status,
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
  })
);

const encodeCursor = (scope: string, position: RoomDirectoryPosition): string => (
  Buffer.from(JSON.stringify({
    version: DIRECTORY_CURSOR_VERSION,
    scope,
    lastActivityAt: position.lastActivityAt,
    roomId: position.roomId,
  } satisfies DirectoryCursorPayload), 'utf8').toString('base64url')
);

const decodeCursor = (cursor: string | undefined, scope: string): RoomDirectoryPosition | undefined => {
  if (cursor === undefined) return undefined;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== cursor) {
      return fail('ROOM_DIRECTORY_CURSOR_INVALID');
    }
    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return fail('ROOM_DIRECTORY_CURSOR_INVALID');
    }
    const candidate = parsed as Record<string, unknown>;
    if (
      Object.keys(candidate).sort().join(',') !== 'lastActivityAt,roomId,scope,version'
      || candidate.version !== DIRECTORY_CURSOR_VERSION
      || candidate.scope !== scope
    ) return fail('ROOM_DIRECTORY_CURSOR_INVALID');
    const lastActivityAt = IsoTimestampSchema.safeParse(candidate.lastActivityAt);
    const roomId = OpaqueKeySchema.safeParse(candidate.roomId);
    if (!lastActivityAt.success || !roomId.success) {
      return fail('ROOM_DIRECTORY_CURSOR_INVALID');
    }
    return { lastActivityAt: lastActivityAt.data, roomId: roomId.data };
  } catch (error) {
    if (error instanceof RoomDirectoryServiceError) throw error;
    return fail('ROOM_DIRECTORY_CURSOR_INVALID');
  }
};

const positionOf = (record: RoomDirectoryRecord): RoomDirectoryPosition => ({
  lastActivityAt: record.lastActivityAt,
  roomId: record.roomId,
});

const hostMatches = (state: ArenaRoomAuthorityState, hostUserId: number): boolean => (
  state.memberAuthority.some((entry) => (
    entry.accountUserId === hostUserId
    && entry.member.role === 'host'
    && entry.member.membershipState === 'active'
  ))
);

export const createArenaRoomDirectoryService = (
  options: ArenaRoomDirectoryServiceOptions,
): ArenaRoomDirectoryService => {
  const readAuthority = async (roomId: string): Promise<ArenaRoomAuthorityState | null> => {
    try {
      return await options.authority.load(roomId);
    } catch {
      return fail('ROOM_DIRECTORY_AUTHORITY_UNAVAILABLE');
    }
  };

  const isCurrent = async (record: RoomDirectoryRecord): Promise<boolean> => {
    const state = await readAuthority(record.roomId);
    return state !== null
      && state.lifecycle.status === 'open'
      && state.snapshot.roomId === record.roomId
      && state.snapshot.roomEpoch === record.roomEpoch
      && hostMatches(state, record.hostUserId);
  };

  const deleteBestEffort = async (input: {
    readonly roomId: string;
    readonly roomEpoch: string;
  }): Promise<boolean> => {
    try {
      await options.store.delete(input);
      return true;
    } catch (error) {
      try {
        options.onBackgroundError?.(error);
      } catch {
        // Observability must not change the best-effort projection outcome.
      }
      return false;
    }
  };

  const pageFromRecords = async (
    records: RoomDirectoryRecord[],
    limit: number,
    scope: string,
    allow: (record: RoomDirectoryRecord) => boolean,
  ): Promise<RoomDirectoryPage> => {
    const scanned = records.slice(0, limit);
    const items: RoomDirectoryEntry[] = [];
    for (const candidate of scanned) {
      const record = parseRecord(candidate);
      if (!allow(record) || !(await isCurrent(record))) {
        await deleteBestEffort({ roomId: record.roomId, roomEpoch: record.roomEpoch });
        continue;
      }
      items.push(publicEntry(record));
    }
    const nextCursor = records.length > limit && scanned.length > 0
      ? encodeCursor(scope, positionOf(scanned[scanned.length - 1]!))
      : null;
    return RoomDirectoryPageSchema.parse({ items, nextCursor });
  };

  return Object.freeze({
    async registerOpen(input) {
      const record = parseRecord(input);
      if (!(await isCurrent(record))) return fail('ROOM_DIRECTORY_STALE');
      await options.store.upsertOpen(record);
    },

    async lookup(inputRoomId) {
      const roomId = OpaqueKeySchema.safeParse(inputRoomId);
      if (!roomId.success) return fail('ROOM_DIRECTORY_INPUT_INVALID');
      const record = await options.store.get(roomId.data);
      if (record === null) return null;
      const parsed = parseRecord(record);
      if (!(await isCurrent(parsed))) {
        await deleteBestEffort({ roomId: parsed.roomId, roomEpoch: parsed.roomEpoch });
        return null;
      }
      return publicEntry(parsed);
    },

    async discoverPublic(input) {
      const query = RoomDirectoryPageQuerySchema.safeParse(input);
      if (!query.success) return fail('ROOM_DIRECTORY_INPUT_INVALID');
      const scope = 'public';
      const after = decodeCursor(query.data.cursor, scope);
      const records = await options.store.listPublic({ after, limit: query.data.limit + 1 });
      return pageFromRecords(
        records,
        query.data.limit,
        scope,
        (record) => record.visibility === 'public',
      );
    },

    async listForHost(hostUserId, input) {
      if (!positiveUserId(hostUserId)) return fail('ROOM_DIRECTORY_INPUT_INVALID');
      const query = RoomDirectoryPageQuerySchema.safeParse(input);
      if (!query.success) return fail('ROOM_DIRECTORY_INPUT_INVALID');
      const scope = `host:${hostUserId}`;
      const after = decodeCursor(query.data.cursor, scope);
      const records = await options.store.listByHost({
        hostUserId,
        after,
        limit: query.data.limit + 1,
      });
      return pageFromRecords(
        records,
        query.data.limit,
        scope,
        (record) => record.hostUserId === hostUserId,
      );
    },

    async reconcile(input) {
      const inactiveBefore = IsoTimestampSchema.safeParse(input.inactiveBefore);
      const limit = input.limit ?? MAX_ROOM_DIRECTORY_PAGE_SIZE;
      if (
        !inactiveBefore.success
        || !Number.isSafeInteger(limit)
        || limit < 1
        || limit > MAX_ROOM_DIRECTORY_PAGE_SIZE
      ) return fail('ROOM_DIRECTORY_INPUT_INVALID');
      const scope = `reconcile:${inactiveBefore.data}`;
      const after = decodeCursor(input.cursor, scope);
      const records = await options.store.listReconciliationCandidates({
        inactiveBefore: inactiveBefore.data,
        after,
        limit: limit + 1,
      });
      const scanned = records.slice(0, limit);
      let removed = 0;
      for (const candidate of scanned) {
        const record = parseRecord(candidate);
        if (
          !(await isCurrent(record))
          && await deleteBestEffort({ roomId: record.roomId, roomEpoch: record.roomEpoch })
        ) removed += 1;
      }
      return {
        scanned: scanned.length,
        removed,
        nextCursor: records.length > limit && scanned.length > 0
          ? encodeCursor(scope, positionOf(scanned[scanned.length - 1]!))
          : null,
      };
    },

    async removeCommittedClosed(input) {
      let state: ArenaRoomAuthorityState;
      try {
        state = parseArenaRoomAuthorityState(input);
      } catch {
        return fail('ROOM_DIRECTORY_CLOSE_INVALID');
      }
      if (state.lifecycle.status !== 'closed') return fail('ROOM_DIRECTORY_CLOSE_INVALID');
      await deleteBestEffort({
        roomId: state.snapshot.roomId,
        roomEpoch: state.snapshot.roomEpoch,
      });
    },
  });
};
