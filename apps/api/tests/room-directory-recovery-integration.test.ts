import { readFileSync } from 'node:fs';

import type { D1LikeStatementResult } from '@mahoshojo/hosted-runtime/d1-http-client';
import type {
  NodeDataD1Client,
  NodeDataD1Statement,
} from '@mahoshojo/hosted-runtime/node-runtime/data-ports';
import {
  checkpointPredecessorOf,
  consumeArenaRoomCheckpointCommit,
  type ArenaRoomAuthorityState,
} from '@mahoshojo/multiplayer-core';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  createD1RoomDirectoryStore,
  type D1RoomDirectoryStore,
  type RoomDirectoryRecord,
} from '#/arena-room/d1-room-directory-store';
import type { RedisRoomDirectoryRegistrationStore } from '#/arena-room/redis-room-directory-registration-store';
import {
  createRoomActorRegistry,
  type RoomActorCheckpointStore,
} from '#/arena-room/room-actor-registry';
import { createArenaRoomDirectoryService } from '#/arena-room/room-directory-service';
import { createArenaRoomMembershipService } from '#/arena-room/room-membership-service';
import { createArenaRoomState } from './arena-room-fixtures';

const migrationPath = new URL('../../../drizzle/0014_arena_multiplayer_rooms.sql', import.meta.url);

class MemoryRoomStore implements RoomActorCheckpointStore {
  state: ArenaRoomAuthorityState | null = null;

  async load(roomId: string) {
    return this.state?.snapshot.roomId === roomId ? structuredClone(this.state) : null;
  }

  async save(input: Parameters<RoomActorCheckpointStore['save']>[0]) {
    const data = consumeArenaRoomCheckpointCommit(input.commit);
    if (data.predecessor === null) {
      if (this.state !== null) return { kind: 'conflict' as const };
    } else if (
      this.state === null
      || JSON.stringify(this.state) !== JSON.stringify(data.predecessorState)
      || JSON.stringify(checkpointPredecessorOf(this.state)) !== JSON.stringify(data.predecessor)
    ) return { kind: 'conflict' as const };
    this.state = structuredClone(data.nextState);
    return { kind: 'saved' as const };
  }

  async refresh() {
    return { kind: 'refreshed' as const };
  }
}

class MemoryRegistrationStore implements RedisRoomDirectoryRegistrationStore {
  private readonly records = new Map<string, RoomDirectoryRecord>();

  async put(input: RoomDirectoryRecord) {
    const current = this.records.get(input.roomId);
    if (current && JSON.stringify(current) !== JSON.stringify(input)) {
      throw new Error('registration conflict');
    }
    this.records.set(input.roomId, structuredClone(input));
  }

  async rebindEpoch(input: Parameters<RedisRoomDirectoryRegistrationStore['rebindEpoch']>[0]) {
    const current = this.records.get(input.roomId);
    if (!current) return { kind: 'missing' as const };
    if (current.roomEpoch === input.nextRoomEpoch) return { kind: 'already' as const };
    if (current.roomEpoch !== input.previousRoomEpoch) return { kind: 'stale' as const };
    this.records.set(input.roomId, {
      ...current,
      roomEpoch: input.nextRoomEpoch,
      lastActivityAt: input.lastActivityAt,
    });
    return { kind: 'rebound' as const };
  }

  async delete(input: Parameters<RedisRoomDirectoryRegistrationStore['delete']>[0]) {
    const current = this.records.get(input.roomId);
    if (!current) return { kind: 'missing' as const };
    if (current.roomEpoch !== input.roomEpoch) return { kind: 'stale' as const };
    this.records.delete(input.roomId);
    return { kind: 'deleted' as const };
  }

  async get(roomId: string) {
    const current = this.records.get(roomId);
    return current ? structuredClone(current) : null;
  }

  async list(input: { limit: number }) {
    return [...this.records.values()].slice(0, input.limit).map((record) => structuredClone(record));
  }

  async touch(input: Parameters<RedisRoomDirectoryRegistrationStore['touch']>[0]) {
    const current = this.records.get(input.roomId);
    if (!current) return { kind: 'missing' as const };
    return { kind: current.roomEpoch === input.roomEpoch ? 'touched' as const : 'stale' as const };
  }
}

const sqliteClient = (sqlite: Database.Database): NodeDataD1Client => ({
  prepare(sql) {
    let params: unknown[] = [];
    const statement: NodeDataD1Statement = {
      bind(...input) {
        params = input;
        return statement;
      },
      async all(_options) {
        return {
          success: true,
          results: sqlite.prepare(sql).all(...params) as Record<string, unknown>[],
          meta: {},
        } satisfies D1LikeStatementResult;
      },
      async run(_options) {
        const result = sqlite.prepare(sql).run(...params);
        return {
          success: true,
          results: [],
          meta: { changes: Number(result.changes) },
        } satisfies D1LikeStatementResult;
      },
    };
    return statement;
  },
});

describe('Arena Room directory recovery integration', () => {
  it('create D1 failure 由 registration 补建，recovery exact rebind 后抗旧 epoch writer/delete', async () => {
    const sqlite = new Database(':memory:');
    try {
      sqlite.pragma('foreign_keys = ON');
      sqlite.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users (id) VALUES (101);');
      sqlite.exec(readFileSync(migrationPath, 'utf8'));
      const rawD1 = createD1RoomDirectoryStore({ getClient: () => sqliteClient(sqlite) });
      let failCreateProjection = true;
      const d1: D1RoomDirectoryStore = {
        ...rawD1,
        async upsertOpen(input) {
          if (failCreateProjection) throw new Error('d1 unavailable');
          await rawD1.upsertOpen(input);
        },
      };
      const authority = new MemoryRoomStore();
      const registrations = new MemoryRegistrationStore();
      const directory = createArenaRoomDirectoryService({
        authority,
        registrations,
        store: d1,
      });
      const firstActors = createRoomActorRegistry({
        store: authority,
        createRoomIdentity: () => ({ roomId: 'room-1', roomEpoch: 'epoch-1' }),
        createTimestamp: () => '2026-08-28T00:00:00.000Z',
        now: () => Date.parse('2026-08-28T00:00:00.000Z'),
        prepareCreatedOpen: directory.prepareCreatedOpen,
        onCommittedClosed: directory.removeCommittedClosed,
        onCommittedRecovered: directory.rebindCommittedOpen,
      });
      const memberships = createArenaRoomMembershipService({
        actors: firstActors,
        createUserId: () => 'host-1',
        directory,
      });

      await expect(memberships.create({
        accountUserId: 101,
        displayName: 'Host',
        sharedConfig: createArenaRoomState().snapshot.sharedConfig,
        directory: { title: '可恢复公开房', visibility: 'public' },
      })).resolves.toMatchObject({ roomId: 'room-1', roomEpoch: 'epoch-1' });
      expect(authority.state?.lifecycle.status).toBe('open');
      await expect(rawD1.get('room-1')).resolves.toBeNull();
      await expect(registrations.get('room-1')).resolves.toMatchObject({ roomEpoch: 'epoch-1' });

      failCreateProjection = false;
      await expect(directory.reconcileRegistrations({ limit: 10, score: 1 }))
        .resolves.toEqual({ scanned: 1, projected: 1, removed: 0 });
      await expect(rawD1.get('room-1')).resolves.toMatchObject({
        roomEpoch: 'epoch-1',
        title: '可恢复公开房',
      });

      await firstActors.shutdown();
      const recoveredActors = createRoomActorRegistry({
        store: authority,
        createRoomEpoch: () => 'epoch-2',
        recoveryTimestamp: () => '2026-08-28T00:01:00.000Z',
        now: () => Date.parse('2026-08-28T00:01:00.000Z'),
        prepareCreatedOpen: directory.prepareCreatedOpen,
        onCommittedClosed: directory.removeCommittedClosed,
        onCommittedRecovered: directory.rebindCommittedOpen,
      });
      await expect(recoveredActors.recover('room-1')).resolves.toMatchObject({ roomId: 'room-1' });
      await expect(rawD1.get('room-1')).resolves.toMatchObject({
        roomEpoch: 'epoch-2',
        title: '可恢复公开房',
        visibility: 'public',
      });

      await rawD1.upsertOpen({
        roomId: 'room-1',
        roomEpoch: 'epoch-1',
        hostUserId: 101,
        title: 'late stale writer',
        visibility: 'unlisted',
        status: 'open',
        createdAt: '2026-08-28T00:00:00.000Z',
        lastActivityAt: '2026-08-28T00:02:00.000Z',
      });
      await rawD1.delete({ roomId: 'room-1', roomEpoch: 'epoch-1' });
      await expect(rawD1.get('room-1')).resolves.toMatchObject({
        roomEpoch: 'epoch-2',
        title: '可恢复公开房',
        visibility: 'public',
      });
      await recoveredActors.shutdown();
    } finally {
      sqlite.close();
    }
  });
});
