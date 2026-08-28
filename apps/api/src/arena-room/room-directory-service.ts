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
import type {
  RedisRoomDirectoryRegistrationStore,
  RoomDirectoryRegistration,
} from './redis-room-directory-registration-store';

const DIRECTORY_CURSOR_VERSION = 1;
const DEFAULT_PENDING_CREATE_GRACE_MS = 5 * 60_000;

export type RoomDirectoryServiceErrorCode =
  | 'ROOM_DIRECTORY_AUTHORITY_UNAVAILABLE'
  | 'ROOM_DIRECTORY_CLEANUP_FAILED'
  | 'ROOM_DIRECTORY_CLOSE_INVALID'
  | 'ROOM_DIRECTORY_CURSOR_INVALID'
  | 'ROOM_DIRECTORY_INPUT_INVALID'
  | 'ROOM_DIRECTORY_REGISTRATION_UNAVAILABLE'
  | 'ROOM_DIRECTORY_RECOVERY_INVALID'
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
  readonly registrations?: RedisRoomDirectoryRegistrationStore;
  readonly store: D1RoomDirectoryStore;
  readonly now?: () => number;
  readonly pendingCreateGraceMs?: number;
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
  prepareCreatedOpen(record: RoomDirectoryRecord): Promise<void>;
  registerOpen(record: RoomDirectoryRecord): Promise<void>;
  rebindCommittedOpen(input: {
    readonly previousRoomEpoch: string;
    readonly state: ArenaRoomAuthorityState;
  }): Promise<void>;
  lookup(roomId: string): Promise<RoomDirectoryEntry | null>;
  discoverPublic(query: Partial<RoomDirectoryPageQuery>): Promise<RoomDirectoryPage>;
  listForHost(hostUserId: number, query: Partial<RoomDirectoryPageQuery>): Promise<RoomDirectoryPage>;
  reconcile(input: RoomDirectoryReconcileInput): Promise<RoomDirectoryReconcileResult>;
  reconcileRegistrations(input: {
    readonly limit?: number;
    readonly score?: number;
  }): Promise<{ readonly scanned: number; readonly projected: number; readonly removed: number }>;
  startRegistrationReconciler(input?: {
    readonly intervalMs?: number;
    readonly limit?: number;
  }): () => void;
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

const activeHostUserId = (state: ArenaRoomAuthorityState): number | null => (
  state.memberAuthority.find((entry) => (
    entry.member.role === 'host' && entry.member.membershipState === 'active'
  ))?.accountUserId ?? null
);

export const createArenaRoomDirectoryService = (
  options: ArenaRoomDirectoryServiceOptions,
): ArenaRoomDirectoryService => {
  const now = options.now ?? Date.now;
  const pendingCreateGraceMs = options.pendingCreateGraceMs ?? DEFAULT_PENDING_CREATE_GRACE_MS;
  if (!Number.isSafeInteger(pendingCreateGraceMs) || pendingCreateGraceMs < 1) {
    return fail('ROOM_DIRECTORY_INPUT_INVALID');
  }
  const reportBackgroundError = (error: unknown): void => {
    try {
      options.onBackgroundError?.(error);
    } catch {
      // Observability must not change derived-directory outcomes.
    }
  };

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

  const requireCurrentOpenState = async (
    input: ArenaRoomAuthorityState,
  ): Promise<{ readonly state: ArenaRoomAuthorityState; readonly hostUserId: number }> => {
    let state: ArenaRoomAuthorityState;
    try {
      state = parseArenaRoomAuthorityState(input);
    } catch {
      return fail('ROOM_DIRECTORY_RECOVERY_INVALID');
    }
    const hostUserId = activeHostUserId(state);
    if (state.lifecycle.status !== 'open' || hostUserId === null) {
      return fail('ROOM_DIRECTORY_RECOVERY_INVALID');
    }
    const current = await readAuthority(state.snapshot.roomId);
    if (
      current === null
      || current.lifecycle.status !== 'open'
      || current.snapshot.roomId !== state.snapshot.roomId
      || current.snapshot.roomEpoch !== state.snapshot.roomEpoch
      || !hostMatches(current, hostUserId)
    ) return fail('ROOM_DIRECTORY_STALE');
    return { state, hostUserId };
  };

  const deleteBestEffort = async (input: {
    readonly roomId: string;
    readonly roomEpoch: string;
  }): Promise<boolean> => {
    try {
      await options.store.delete(input);
      return true;
    } catch (error) {
      reportBackgroundError(error);
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
        if (!await deleteBestEffort({ roomId: record.roomId, roomEpoch: record.roomEpoch })) {
          return fail('ROOM_DIRECTORY_CLEANUP_FAILED');
        }
        continue;
      }
      items.push(publicEntry(record));
    }
    const nextCursor = records.length > limit && scanned.length > 0
      ? encodeCursor(scope, positionOf(scanned[scanned.length - 1]!))
      : null;
    return RoomDirectoryPageSchema.parse({ items, nextCursor });
  };

  const recordFromRegistration = (
    registration: RoomDirectoryRegistration,
    lastActivityAt = registration.lastActivityAt,
  ): RoomDirectoryRecord => parseRecord({
    roomId: registration.roomId,
    roomEpoch: registration.targetRoomEpoch,
    hostUserId: registration.hostUserId,
    title: registration.title,
    visibility: registration.visibility,
    status: registration.status,
    createdAt: registration.createdAt,
    lastActivityAt,
  });

  const projectRegistration = async (
    registration: RoomDirectoryRegistration,
    state: ArenaRoomAuthorityState,
    score: number,
  ): Promise<void> => {
    if (options.registrations === undefined || registration.phase === 'closing') {
      return fail('ROOM_DIRECTORY_STALE');
    }
    const hostUserId = activeHostUserId(state);
    if (
      state.lifecycle.status !== 'open'
      || state.snapshot.roomId !== registration.roomId
      || state.snapshot.roomEpoch !== registration.targetRoomEpoch
      || hostUserId !== registration.hostUserId
    ) return fail('ROOM_DIRECTORY_STALE');
    const projected = recordFromRegistration(
      registration,
      Date.parse(registration.lastActivityAt) > Date.parse(state.lifecycle.updatedAt)
        ? registration.lastActivityAt
        : state.lifecycle.updatedAt,
    );
    const current = await options.store.get(projected.roomId);
    if (current === null) {
      await options.store.upsertOpen(projected);
    } else if (current.roomEpoch === projected.roomEpoch) {
      if (current.hostUserId !== projected.hostUserId) return fail('ROOM_DIRECTORY_STALE');
      await options.store.upsertOpen(projected);
    } else {
      if (
        registration.projectedRoomEpoch === null
        || current.roomEpoch !== registration.projectedRoomEpoch
      ) return fail('ROOM_DIRECTORY_STALE');
      if (current.hostUserId === projected.hostUserId) {
        await options.store.rebindEpoch({
          roomId: projected.roomId,
          previousRoomEpoch: current.roomEpoch,
          nextRoomEpoch: projected.roomEpoch,
          hostUserId: projected.hostUserId,
          lastActivityAt: projected.lastActivityAt,
        });
      } else {
        await options.store.delete({ roomId: current.roomId, roomEpoch: current.roomEpoch });
      }
      await options.store.upsertOpen(projected);
    }
    const confirmed = await options.store.get(projected.roomId);
    if (
      confirmed === null
      || confirmed.roomEpoch !== projected.roomEpoch
      || confirmed.hostUserId !== projected.hostUserId
    ) return fail('ROOM_DIRECTORY_STALE');
    const confirmation = await options.registrations.confirmProjected({
      roomId: projected.roomId,
      targetRoomEpoch: projected.roomEpoch,
      updatedAtMs: now(),
      score,
    });
    if (confirmation.kind !== 'confirmed') return fail('ROOM_DIRECTORY_STALE');
  };

  const cleanupClosingRegistration = async (
    registration: RoomDirectoryRegistration,
    score: number,
  ): Promise<void> => {
    if (options.registrations === undefined) {
      return fail('ROOM_DIRECTORY_REGISTRATION_UNAVAILABLE');
    }
    if (registration.phase !== 'closing') {
      const marked = await options.registrations.markClosing({
        roomId: registration.roomId,
        targetRoomEpoch: registration.targetRoomEpoch,
        updatedAtMs: now(),
        score,
      });
      if (marked.kind === 'missing') return;
      if (marked.kind === 'stale') return fail('ROOM_DIRECTORY_STALE');
    }
    const current = await options.store.get(registration.roomId);
    if (current !== null) {
      await options.store.delete({ roomId: current.roomId, roomEpoch: current.roomEpoch });
    }
    if (await options.store.get(registration.roomId) !== null) {
      return fail('ROOM_DIRECTORY_CLEANUP_FAILED');
    }
    const removed = await options.registrations.delete({
      roomId: registration.roomId,
      targetRoomEpoch: registration.targetRoomEpoch,
      phase: 'closing',
    });
    if (removed.kind === 'stale') return fail('ROOM_DIRECTORY_STALE');
  };

  let service!: ArenaRoomDirectoryService;
  service = Object.freeze({
    async prepareCreatedOpen(input) {
      const record = parseRecord(input);
      if (options.registrations === undefined) {
        return fail('ROOM_DIRECTORY_REGISTRATION_UNAVAILABLE');
      }
      await options.registrations.prepare({ record, preparedAtMs: now() });
    },

    async registerOpen(input) {
      const record = parseRecord(input);
      const state = await readAuthority(record.roomId);
      if (
        state === null
        || state.lifecycle.status !== 'open'
        || state.snapshot.roomEpoch !== record.roomEpoch
        || !hostMatches(state, record.hostUserId)
      ) return fail('ROOM_DIRECTORY_STALE');
      if (options.registrations === undefined) {
        await options.store.upsertOpen(record);
        return;
      }
      const registration = await options.registrations.get(record.roomId);
      if (
        registration === null
        || registration.targetRoomEpoch !== record.roomEpoch
        || registration.hostUserId !== record.hostUserId
      ) return fail('ROOM_DIRECTORY_STALE');
      await projectRegistration(registration, state, now());
    },

    async rebindCommittedOpen(input) {
      if (options.registrations === undefined) {
        return fail('ROOM_DIRECTORY_REGISTRATION_UNAVAILABLE');
      }
      const previousRoomEpoch = OpaqueKeySchema.safeParse(input.previousRoomEpoch);
      const current = await requireCurrentOpenState(input.state);
      if (
        !previousRoomEpoch.success
        || previousRoomEpoch.data === current.state.snapshot.roomEpoch
      ) return fail('ROOM_DIRECTORY_RECOVERY_INVALID');

      const registrationRebind = await options.registrations.advanceTarget({
        roomId: current.state.snapshot.roomId,
        previousTargetRoomEpoch: previousRoomEpoch.data,
        targetRoomEpoch: current.state.snapshot.roomEpoch,
        lastActivityAt: current.state.lifecycle.updatedAt,
        updatedAtMs: now(),
      });
      if (registrationRebind.kind === 'stale' || registrationRebind.kind === 'missing') {
        return fail('ROOM_DIRECTORY_STALE');
      }
      const registration = await options.registrations.get(current.state.snapshot.roomId);
      if (
        registration === null
        || registration.hostUserId !== current.hostUserId
        || registration.targetRoomEpoch !== current.state.snapshot.roomEpoch
      ) {
        return fail('ROOM_DIRECTORY_RECOVERY_INVALID');
      }
      await projectRegistration(registration, current.state, now());
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
        ) {
          if (!await deleteBestEffort({ roomId: record.roomId, roomEpoch: record.roomEpoch })) {
            return fail('ROOM_DIRECTORY_CLEANUP_FAILED');
          }
          removed += 1;
        }
      }
      return {
        scanned: scanned.length,
        removed,
        nextCursor: records.length > limit && scanned.length > 0
          ? encodeCursor(scope, positionOf(scanned[scanned.length - 1]!))
          : null,
      };
    },

    async reconcileRegistrations(input) {
      if (options.registrations === undefined) {
        return fail('ROOM_DIRECTORY_REGISTRATION_UNAVAILABLE');
      }
      const limit = input.limit ?? MAX_ROOM_DIRECTORY_PAGE_SIZE;
      const score = input.score ?? now();
      if (
        !Number.isSafeInteger(limit)
        || limit < 1
        || limit > MAX_ROOM_DIRECTORY_PAGE_SIZE
        || !Number.isSafeInteger(score)
        || score < 0
      ) return fail('ROOM_DIRECTORY_INPUT_INVALID');
      const registrations = await options.registrations.list({ limit });
      let projected = 0;
      let removed = 0;
      for (const candidate of registrations) {
        let registration = candidate;
        const state = await readAuthority(registration.roomId);
        const hostUserId = state === null ? null : activeHostUserId(state);
        if (state === null) {
          if (
            registration.phase === 'pending-create'
            && score < registration.preparedAtMs + pendingCreateGraceMs
          ) {
            const deferred = await options.registrations.reschedule({
              roomId: registration.roomId,
              targetRoomEpoch: registration.targetRoomEpoch,
              phase: registration.phase,
              score: registration.preparedAtMs + pendingCreateGraceMs,
            });
            if (deferred.kind === 'stale') return fail('ROOM_DIRECTORY_STALE');
            continue;
          }
          await cleanupClosingRegistration(registration, score);
          removed += 1;
          continue;
        }
        if (state.snapshot.roomId !== registration.roomId) return fail('ROOM_DIRECTORY_STALE');
        if (state.lifecycle.status !== 'open') {
          await cleanupClosingRegistration(registration, score);
          removed += 1;
          continue;
        }
        if (hostUserId !== registration.hostUserId || registration.phase === 'closing') {
          return fail('ROOM_DIRECTORY_STALE');
        }
        if (registration.targetRoomEpoch !== state.snapshot.roomEpoch) {
          const advanced = await options.registrations.advanceTarget({
            roomId: registration.roomId,
            previousTargetRoomEpoch: registration.targetRoomEpoch,
            targetRoomEpoch: state.snapshot.roomEpoch,
            lastActivityAt: state.lifecycle.updatedAt,
            updatedAtMs: now(),
          });
          if (advanced.kind === 'missing') continue;
          if (advanced.kind === 'stale') return fail('ROOM_DIRECTORY_STALE');
          const updated = await options.registrations.get(registration.roomId);
          if (updated === null) continue;
          registration = updated;
        }
        await projectRegistration(registration, state, score);
        projected += 1;
      }
      return { scanned: registrations.length, projected, removed };
    },

    startRegistrationReconciler(input = {}) {
      const intervalMs = input.intervalMs ?? 5 * 60_000;
      const limit = input.limit ?? MAX_ROOM_DIRECTORY_PAGE_SIZE;
      if (
        !Number.isSafeInteger(intervalMs)
        || intervalMs < 1
        || !Number.isSafeInteger(limit)
        || limit < 1
        || limit > MAX_ROOM_DIRECTORY_PAGE_SIZE
      ) return fail('ROOM_DIRECTORY_INPUT_INVALID');
      let stopped = false;
      let running = false;
      const timer = setInterval(() => {
        if (stopped || running) return;
        running = true;
        void service.reconcileRegistrations({ limit, score: now() })
          .catch(reportBackgroundError)
          .finally(() => { running = false; });
      }, intervalMs);
      timer.unref?.();
      return () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
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
      if (options.registrations === undefined) {
        await deleteBestEffort({
          roomId: state.snapshot.roomId,
          roomEpoch: state.snapshot.roomEpoch,
        });
        return;
      }
      let registration = await options.registrations.get(state.snapshot.roomId);
      if (registration === null) {
        await deleteBestEffort({
          roomId: state.snapshot.roomId,
          roomEpoch: state.snapshot.roomEpoch,
        });
        return;
      }
      if (registration.targetRoomEpoch !== state.snapshot.roomEpoch) {
        const advanced = await options.registrations.advanceTarget({
          roomId: registration.roomId,
          previousTargetRoomEpoch: registration.targetRoomEpoch,
          targetRoomEpoch: state.snapshot.roomEpoch,
          lastActivityAt: state.lifecycle.updatedAt,
          updatedAtMs: now(),
        });
        if (advanced.kind === 'missing') return;
        if (advanced.kind === 'stale') return fail('ROOM_DIRECTORY_STALE');
        registration = await options.registrations.get(state.snapshot.roomId);
        if (registration === null) return;
      }
      await cleanupClosingRegistration(registration, now());
    },
  });
  return service;
};
