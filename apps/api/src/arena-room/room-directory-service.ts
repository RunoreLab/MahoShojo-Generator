import {
  MAX_ROOM_DIRECTORY_PAGE_SIZE,
  OpaqueKeySchema,
  RoomDirectoryPageQuerySchema,
  RoomDirectoryPageSchema,
  type RoomDirectoryPage,
  type RoomDirectoryPageQuery,
} from '@mahoshojo/contracts/arena-room';
import type { ArenaRoomAuthorityState } from '@mahoshojo/multiplayer-core';

import type { RoomActorCheckpointStore } from './room-actor-registry';
import type {
  RedisRoomDirectoryCandidate,
  RedisRoomDirectoryStore,
} from './redis-room-directory-store';
import {
  isRoomDirectoryPublicIndexMember,
  parseStoredRoomDirectoryRecord,
  publicRoomDirectoryEntry,
  RoomDirectoryRecordError,
  type StoredRoomDirectoryRecord,
} from './room-directory-record';

const DIRECTORY_CURSOR_VERSION = 2 as const;

export type RoomDirectoryServiceErrorCode =
  | 'ROOM_DIRECTORY_AUTHORITY_UNAVAILABLE'
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
  readonly store: RedisRoomDirectoryStore;
  readonly now?: () => number;
};

export type ArenaRoomDirectoryService = {
  lookup(roomId: string): Promise<ReturnType<typeof publicRoomDirectoryEntry> | null>;
  discoverPublic(query: Partial<RoomDirectoryPageQuery>): Promise<RoomDirectoryPage>;
};

type DirectoryCursorPayload = {
  readonly version: typeof DIRECTORY_CURSOR_VERSION;
  readonly scope: 'public';
  readonly indexMember: string;
};

const fail = (code: RoomDirectoryServiceErrorCode): never => {
  throw new RoomDirectoryServiceError(code);
};

const encodeCursor = (indexMember: string): string => Buffer.from(JSON.stringify({
  version: DIRECTORY_CURSOR_VERSION,
  scope: 'public',
  indexMember,
} satisfies DirectoryCursorPayload), 'utf8').toString('base64url');

const decodeCursor = (cursor: string | undefined): string | undefined => {
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
      Object.keys(candidate).sort().join('|') !== 'indexMember|scope|version'
      || candidate.version !== DIRECTORY_CURSOR_VERSION
      || candidate.scope !== 'public'
      || !isRoomDirectoryPublicIndexMember(candidate.indexMember)
    ) return fail('ROOM_DIRECTORY_CURSOR_INVALID');
    return candidate.indexMember;
  } catch (error) {
    if (error instanceof RoomDirectoryServiceError) throw error;
    return fail('ROOM_DIRECTORY_CURSOR_INVALID');
  }
};

const activeHostUserId = (state: ArenaRoomAuthorityState): number | null => (
  state.memberAuthority.find((entry) => (
    entry.member.role === 'host' && entry.member.membershipState === 'active'
  ))?.accountUserId ?? null
);

const deadlineExpired = (state: ArenaRoomAuthorityState, now: number): boolean => (
  [state.deadlines.hostOfflineDeadline, state.deadlines.roomIdleDeadline]
    .some((deadline) => deadline !== null && Date.parse(deadline) <= now)
);

export const createArenaRoomDirectoryService = (
  options: ArenaRoomDirectoryServiceOptions,
): ArenaRoomDirectoryService => {
  const now = options.now ?? Date.now;

  const readAuthority = async (roomId: string): Promise<ArenaRoomAuthorityState | null> => {
    try {
      return await options.authority.load(roomId);
    } catch {
      return fail('ROOM_DIRECTORY_AUTHORITY_UNAVAILABLE');
    }
  };

  const currentAuthority = async (record: StoredRoomDirectoryRecord): Promise<boolean> => {
    const state = await readAuthority(record.roomId);
    return state !== null
      && state.lifecycle.status === 'open'
      && !deadlineExpired(state, now())
      && state.snapshot.roomId === record.roomId
      && state.snapshot.roomEpoch === record.roomEpoch
      && activeHostUserId(state) === record.hostUserId;
  };

  const cleanup = async (candidate: RedisRoomDirectoryCandidate): Promise<void> => {
    if (candidate.raw === null) return;
    const result = await options.store.removeIfExact(candidate);
    if (result.kind === 'stale') return fail('ROOM_DIRECTORY_STALE');
  };

  const parseCandidate = async (
    candidate: RedisRoomDirectoryCandidate,
    expectedRoomId?: string,
  ): Promise<{ readonly candidate: RedisRoomDirectoryCandidate; readonly record: StoredRoomDirectoryRecord } | null> => {
    if (candidate.raw === null) return null;
    try {
      const record = parseStoredRoomDirectoryRecord(candidate.raw);
      if (
        (expectedRoomId !== undefined && record.roomId !== expectedRoomId)
        || (
          candidate.indexMember !== null
          && record.publicIndexMember !== candidate.indexMember
        )
      ) {
        await cleanup(candidate);
        return null;
      }
      const exactCandidate = candidate.indexMember === record.publicIndexMember
        ? candidate
        : await options.store.candidateFromRaw({
            roomId: record.roomId,
            raw: candidate.raw,
            indexMember: record.publicIndexMember,
          });
      return { candidate: exactCandidate, record };
    } catch (error) {
      if (!(error instanceof RoomDirectoryRecordError)) throw error;
      await cleanup(candidate);
      return null;
    }
  };

  return Object.freeze({
    async lookup(inputRoomId) {
      const roomId = OpaqueKeySchema.safeParse(inputRoomId);
      if (!roomId.success) return fail('ROOM_DIRECTORY_INPUT_INVALID');
      const candidate = await options.store.getCandidate(roomId.data);
      if (candidate === null) return null;
      const parsed = await parseCandidate(candidate, roomId.data);
      if (parsed === null) return null;
      if (!(await currentAuthority(parsed.record))) {
        await cleanup(parsed.candidate);
        return null;
      }
      return publicRoomDirectoryEntry(parsed.record);
    },

    async discoverPublic(input) {
      const query = RoomDirectoryPageQuerySchema.safeParse(input);
      if (!query.success) return fail('ROOM_DIRECTORY_INPUT_INVALID');
      const afterIndexMember = decodeCursor(query.data.cursor);
      const candidates = await options.store.listPublicCandidates({
        ...(afterIndexMember === undefined ? {} : { afterIndexMember }),
        limit: query.data.limit + 1,
      });
      const scanned = candidates.slice(0, query.data.limit);
      const items = [];
      for (const candidate of scanned) {
        const parsed = await parseCandidate(candidate);
        if (parsed === null) continue;
        if (
          parsed.record.visibility !== 'public'
          || !(await currentAuthority(parsed.record))
        ) {
          await cleanup(parsed.candidate);
          continue;
        }
        items.push(publicRoomDirectoryEntry(parsed.record));
      }
      const nextIndexMember = scanned.at(-1)?.indexMember;
      let nextCursor: string | null = null;
      if (candidates.length > query.data.limit) {
        if (!isRoomDirectoryPublicIndexMember(nextIndexMember)) {
          return fail('ROOM_DIRECTORY_STALE');
        }
        nextCursor = encodeCursor(nextIndexMember);
      }
      if (items.length > MAX_ROOM_DIRECTORY_PAGE_SIZE) {
        return fail('ROOM_DIRECTORY_INPUT_INVALID');
      }
      return RoomDirectoryPageSchema.parse({ items, nextCursor });
    },
  });
};
