import {
  AdminArenaObservationQuerySchema, AdminArenaObservationResponseSchema,
  type AdminArenaObservationItem, type AdminArenaObservationQuery, type AdminArenaObservationResponse,
} from '@mahoshojo/contracts/admin-arena-observation';
import { createArenaRoomRedisKeyspace } from './redis-room-keyspace';
import { parseStoredRoomDirectoryRecord } from './room-directory-record';
import { parseArenaRoomAuthorityState } from '@mahoshojo/multiplayer-core';

/** Capability intentionally exposes only Redis reads. Never reuse directory.load/listPublic (they repair storage). */
export interface AdminArenaObservationRedis {
  get(_key: string): Promise<string | null>;
  pTTL(_key: string): Promise<number>;
  scan(_cursor: string, _options: { MATCH: string; COUNT: number; TYPE: 'string' }): Promise<{ cursor: string; keys: string[] }>;
}
export type AdminArenaObservationService = { read(_query: AdminArenaObservationQuery): Promise<AdminArenaObservationResponse> };
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function createAdminArenaObservationService(redis: AdminArenaObservationRedis, keyPrefix = ''): AdminArenaObservationService {
  const keyspace = createArenaRoomRedisKeyspace(keyPrefix);
  const item = async (directoryKey: string, withCheckpoint: boolean): Promise<AdminArenaObservationItem | null> => {
    const raw = await redis.get(directoryKey);
    if (raw === null) return null;
    if (raw.length > 16384) throw new Error('ADMIN_ARENA_DIRECTORY_INVALID');
    const directory = parseStoredRoomDirectoryRecord(raw);
    if (keyspace.roomDirectoryRecordKey(directory.roomId) !== directoryKey) throw new Error('ADMIN_ARENA_DIRECTORY_INVALID');
    const base: AdminArenaObservationItem = {
      roomId: directory.roomId, title: directory.title, visibility: directory.visibility, status: directory.status,
      hostUserId: directory.hostUserId, createdAt: directory.createdAt, lastActivityAt: directory.lastActivityAt,
      directoryTtlMs: await redis.pTTL(directoryKey), checkpoint: 'not-read', checkpointRevision: null, memberCount: null,
    };
    if (!withCheckpoint) return base;
    const rawCheckpoint = await redis.get(keyspace.roomCheckpointKey(directory.roomId));
    if (rawCheckpoint === null) return { ...base, checkpoint: 'missing' };
    try {
      if (rawCheckpoint.length > 4 * 1024 * 1024) throw new Error();
      const checkpoint: unknown = JSON.parse(rawCheckpoint);
      if (!record(checkpoint) || ![1, 2].includes(Number(checkpoint.checkpointVersion)) || checkpoint.roomId !== directory.roomId
        || checkpoint.roomEpoch !== directory.roomEpoch || typeof checkpoint.revision !== 'number' || !Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 0
        || (checkpoint.checkpointVersion === 2 && checkpoint.expiryFence !== 'expiring')) throw new Error();
      // Parsing is pure: unsupported/legacy checkpoints are reported, never migrated or restored here.
      const state = parseArenaRoomAuthorityState(checkpoint.state);
      if (state.snapshot.roomId !== checkpoint.roomId || state.snapshot.roomEpoch !== checkpoint.roomEpoch
        || state.snapshot.revision !== checkpoint.revision || state.snapshot.controlSeq !== checkpoint.controlSeq) throw new Error();
      const members = state.snapshot.members;
      return { ...base, checkpoint: checkpoint.checkpointVersion === 2 ? 'expiring' : 'present', checkpointRevision: checkpoint.revision,
        memberCount: members.filter((member) => member.membershipState === 'active').length };
    } catch { return { ...base, checkpoint: 'invalid' }; }
  };
  return { async read(input) {
    const query = AdminArenaObservationQuerySchema.parse(input);
    if (query.roomId) {
      const observed = await item(keyspace.roomDirectoryRecordKey(query.roomId), true);
      return AdminArenaObservationResponseSchema.parse({ protocolVersion: 1, items: observed ? [observed] : [], nextCursor: null, observedAt: new Date().toISOString() });
    }
    // One bounded scan step: an empty page with a nonzero cursor must remain pageable.
    const scanned = await redis.scan(query.cursor ?? '0', { MATCH: `${keyspace.directoryRecordPrefix}*`, COUNT: 25, TYPE: 'string' });
    if (!/^(?:0|[1-9][0-9]{0,19})$/.test(scanned.cursor) || scanned.keys.length > 128
      || scanned.keys.some((key) => !key.startsWith(keyspace.directoryRecordPrefix) || !/^[a-f0-9]{64}$/.test(key.slice(keyspace.directoryRecordPrefix.length)))) throw new Error('ADMIN_ARENA_SCAN_INVALID');
    const items: AdminArenaObservationItem[] = [];
    // Avoid a fanout of 128 simultaneous commands on the shared production Redis connection.
    for (const directoryKey of [...new Set(scanned.keys)]) { const observed = await item(directoryKey, false); if (observed) items.push(observed); }
    return AdminArenaObservationResponseSchema.parse({ protocolVersion: 1, items, nextCursor: scanned.cursor === '0' ? null : scanned.cursor, observedAt: new Date().toISOString() });
  } };
}
