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
import { describe, expect, it, vi } from 'vitest';

import {
  createD1RoomDirectoryStore,
  type D1RoomDirectoryStore,
} from '#/arena-room/d1-room-directory-store';
import type {
  RedisRoomDirectoryRegistrationStore,
  RoomDirectoryRegistration,
} from '#/arena-room/redis-room-directory-registration-store';
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
  private readonly records = new Map<string, RoomDirectoryRegistration>();

  async prepare(input: Parameters<RedisRoomDirectoryRegistrationStore['prepare']>[0]) {
    const current = this.records.get(input.record.roomId);
    const { roomEpoch, ...metadata } = input.record;
    const next: RoomDirectoryRegistration = {
      ...metadata,
      registrationVersion: 2,
      phase: 'pending-create',
      targetRoomEpoch: roomEpoch,
      projectedRoomEpoch: null,
      preparedAtMs: input.preparedAtMs,
      updatedAtMs: input.preparedAtMs,
    };
    if (current && JSON.stringify(current) !== JSON.stringify(next)) {
      throw new Error('registration conflict');
    }
    this.records.set(input.record.roomId, structuredClone(next));
  }

  async advanceTarget(input: Parameters<RedisRoomDirectoryRegistrationStore['advanceTarget']>[0]) {
    const current = this.records.get(input.roomId);
    if (!current) return { kind: 'missing' as const };
    if (current.phase === 'closing') return { kind: 'stale' as const };
    if (current.targetRoomEpoch === input.targetRoomEpoch) return { kind: 'already' as const };
    if (current.targetRoomEpoch !== input.previousTargetRoomEpoch) {
      return { kind: 'stale' as const };
    }
    this.records.set(input.roomId, {
      ...current,
      phase: 'projecting',
      targetRoomEpoch: input.targetRoomEpoch,
      lastActivityAt: input.lastActivityAt,
      updatedAtMs: input.updatedAtMs,
    });
    return { kind: 'advanced' as const };
  }

  async confirmProjected(
    input: Parameters<RedisRoomDirectoryRegistrationStore['confirmProjected']>[0],
  ) {
    const current = this.records.get(input.roomId);
    if (!current) return { kind: 'missing' as const };
    if (current.phase === 'closing' || current.targetRoomEpoch !== input.targetRoomEpoch) {
      return { kind: 'stale' as const };
    }
    this.records.set(input.roomId, {
      ...current,
      phase: 'active',
      projectedRoomEpoch: input.targetRoomEpoch,
      updatedAtMs: input.updatedAtMs,
    });
    return { kind: 'confirmed' as const };
  }

  async markClosing(input: Parameters<RedisRoomDirectoryRegistrationStore['markClosing']>[0]) {
    const current = this.records.get(input.roomId);
    if (!current) return { kind: 'missing' as const };
    if (current.targetRoomEpoch !== input.targetRoomEpoch) return { kind: 'stale' as const };
    if (current.phase === 'closing') return { kind: 'already' as const };
    this.records.set(input.roomId, {
      ...current,
      phase: 'closing',
      updatedAtMs: input.updatedAtMs,
    });
    return { kind: 'marked' as const };
  }

  async delete(input: Parameters<RedisRoomDirectoryRegistrationStore['delete']>[0]) {
    const current = this.records.get(input.roomId);
    if (!current) return { kind: 'missing' as const };
    if (current.targetRoomEpoch !== input.targetRoomEpoch || current.phase !== input.phase) {
      return { kind: 'stale' as const };
    }
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

  async reschedule(input: Parameters<RedisRoomDirectoryRegistrationStore['reschedule']>[0]) {
    const current = this.records.get(input.roomId);
    if (!current) return { kind: 'missing' as const };
    return {
      kind: current.targetRoomEpoch === input.targetRoomEpoch && current.phase === input.phase
        ? 'rescheduled' as const
        : 'stale' as const,
    };
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
      let failRecoveryRead = false;
      const d1: D1RoomDirectoryStore = {
        ...rawD1,
        async get(roomId) {
          if (failRecoveryRead) throw new Error('d1 unavailable during recovery');
          return rawD1.get(roomId);
        },
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
      await expect(registrations.get('room-1')).resolves.toMatchObject({
        targetRoomEpoch: 'epoch-1',
        projectedRoomEpoch: null,
        phase: 'pending-create',
      });

      failCreateProjection = false;
      await expect(directory.reconcileRegistrations({ limit: 10, score: 1 }))
        .resolves.toEqual({ scanned: 1, projected: 1, removed: 0 });
      await expect(rawD1.get('room-1')).resolves.toMatchObject({
        roomEpoch: 'epoch-1',
        title: '可恢复公开房',
      });

      await firstActors.shutdown();
      failRecoveryRead = true;
      const onRecoveryProjectionError = vi.fn();
      const recoveredActors = createRoomActorRegistry({
        store: authority,
        createRoomEpoch: () => 'epoch-2',
        recoveryTimestamp: () => '2026-08-28T00:01:00.000Z',
        now: () => Date.parse('2026-08-28T00:01:00.000Z'),
        prepareCreatedOpen: directory.prepareCreatedOpen,
        onCommittedClosed: directory.removeCommittedClosed,
        onCommittedRecovered: directory.rebindCommittedOpen,
        onBackgroundError: onRecoveryProjectionError,
      });
      await expect(recoveredActors.recover('room-1')).resolves.toMatchObject({ roomId: 'room-1' });
      await vi.waitFor(() => expect(onRecoveryProjectionError).toHaveBeenCalledOnce());
      await expect(registrations.get('room-1')).resolves.toMatchObject({
        phase: 'projecting',
        projectedRoomEpoch: 'epoch-1',
        targetRoomEpoch: 'epoch-2',
      });
      failRecoveryRead = false;
      await expect(directory.reconcileRegistrations({ limit: 10, score: 2 }))
        .resolves.toEqual({ scanned: 1, projected: 1, removed: 0 });
      await vi.waitFor(async () => {
        await expect(rawD1.get('room-1')).resolves.toMatchObject({
          roomEpoch: 'epoch-2',
          title: '可恢复公开房',
          visibility: 'public',
        });
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
