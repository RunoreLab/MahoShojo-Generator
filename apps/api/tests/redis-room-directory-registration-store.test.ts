import { describe, expect, it, vi } from 'vitest';

import {
  createRedisRoomDirectoryRegistrationStore,
  type RedisRoomDirectoryRegistrationClient,
  type RoomDirectoryRegistration,
} from '#/arena-room/redis-room-directory-registration-store';

const record = {
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  hostUserId: 101,
  title: '协作竞技场',
  visibility: 'public' as const,
  status: 'open' as const,
  createdAt: '2026-08-28T08:00:00.000Z',
  lastActivityAt: '2026-08-28T08:10:00.000Z',
};

const pending = {
  ...record,
  roomEpoch: undefined,
  registrationVersion: 2,
  phase: 'pending-create',
  targetRoomEpoch: 'epoch-1',
  projectedRoomEpoch: null,
  preparedAtMs: 100,
  updatedAtMs: 100,
} satisfies RoomDirectoryRegistration & { readonly roomEpoch?: undefined };

const createClient = (...responses: unknown[]) => {
  const evalCommand = vi.fn<RedisRoomDirectoryRegistrationClient['eval']>();
  for (const response of responses) evalCommand.mockResolvedValueOnce(response);
  return { client: { eval: evalCommand }, evalCommand };
};

describe('Redis Room directory registration store', () => {
  it('prepare 原子登记 pending-create intent，重复相同 payload 幂等', async () => {
    const { client, evalCommand } = createClient('stored', 'already');
    const store = createRedisRoomDirectoryRegistrationStore({ getClient: () => client });

    await expect(store.prepare({ record, preparedAtMs: 100 })).resolves.toBeUndefined();
    await expect(store.prepare({ record, preparedAtMs: 100 })).resolves.toBeUndefined();
    const [script, options] = evalCommand.mock.calls[0]!;
    expect(script).toContain('ROOM_DIRECTORY_REGISTRATION_PREPARE_V2');
    expect(options.keys[0]).toMatch(/^mahoshojo:room-directory-registration:v2:entry:/u);
    expect(JSON.parse(options.arguments[1]!)).toEqual(pending);
  });

  it('target 前进保留 projected predecessor，确认投影才切换 active', async () => {
    const { client, evalCommand } = createClient('advanced', 'confirmed');
    const store = createRedisRoomDirectoryRegistrationStore({ getClient: () => client });

    await expect(store.advanceTarget({
      roomId: 'room-1',
      previousTargetRoomEpoch: 'epoch-1',
      targetRoomEpoch: 'epoch-2',
      lastActivityAt: '2026-08-28T08:20:00.000Z',
      updatedAtMs: 200,
    })).resolves.toEqual({ kind: 'advanced' });
    await expect(store.confirmProjected({
      roomId: 'room-1',
      targetRoomEpoch: 'epoch-2',
      updatedAtMs: 300,
      score: 300,
    })).resolves.toEqual({ kind: 'confirmed' });
    expect(evalCommand.mock.calls[0]?.[0]).toContain(
      'ROOM_DIRECTORY_REGISTRATION_ADVANCE_TARGET_V2',
    );
    expect(evalCommand.mock.calls[0]?.[0]).toContain(
      'current.projectedRoomEpoch = current.targetRoomEpoch',
    );
    expect(evalCommand.mock.calls[1]?.[0]).toContain(
      'ROOM_DIRECTORY_REGISTRATION_CONFIRM_PROJECTED_V2',
    );
  });

  it('get 对 v1 registration 做 strict parse 与 exact-CAS v2 migration', async () => {
    const { roomEpoch, ...metadata } = record;
    const migrated = {
      ...metadata,
      registrationVersion: 2,
      phase: 'pending-create',
      targetRoomEpoch: roomEpoch,
      projectedRoomEpoch: null,
      preparedAtMs: Date.parse(record.createdAt),
      updatedAtMs: Date.parse(record.lastActivityAt),
    } satisfies RoomDirectoryRegistration;
    const { client, evalCommand } = createClient(
      null,
      JSON.stringify(record),
      ['migrated', JSON.stringify(migrated)],
    );
    const store = createRedisRoomDirectoryRegistrationStore({ getClient: () => client });

    await expect(store.get('room-1')).resolves.toEqual(migrated);
    expect(evalCommand.mock.calls[1]?.[0]).toContain('ROOM_DIRECTORY_REGISTRATION_GET_LEGACY_V1');
    expect(evalCommand.mock.calls[2]?.[0]).toContain(
      'ROOM_DIRECTORY_REGISTRATION_MIGRATE_V1_TO_V2',
    );
    expect(evalCommand.mock.calls[2]?.[1].keys).toEqual([
      expect.stringContaining('room-directory-registration:v1:entry:'),
      'mahoshojo:room-directory-registration:v1:index',
      expect.stringContaining('room-directory-registration:v2:entry:'),
      'mahoshojo:room-directory-registration:v2:index',
    ]);
  });

  it('closing tombstone 只允许 exact target/phase 删除', async () => {
    const { client, evalCommand } = createClient('marked', 'stale', 'deleted');
    const store = createRedisRoomDirectoryRegistrationStore({ getClient: () => client });

    await expect(store.markClosing({
      roomId: 'room-1', targetRoomEpoch: 'epoch-2', updatedAtMs: 400, score: 400,
    })).resolves.toEqual({ kind: 'marked' });
    await expect(store.delete({
      roomId: 'room-1', targetRoomEpoch: 'epoch-1', phase: 'closing',
    })).resolves.toEqual({ kind: 'stale' });
    await expect(store.delete({
      roomId: 'room-1', targetRoomEpoch: 'epoch-2', phase: 'closing',
    })).resolves.toEqual({ kind: 'deleted' });
    expect(evalCommand.mock.calls[0]?.[0]).toContain(
      'ROOM_DIRECTORY_REGISTRATION_MARK_CLOSING_V2',
    );
    expect(evalCommand.mock.calls[2]?.[0]).toContain('ROOM_DIRECTORY_REGISTRATION_DELETE_V2');
  });

  it('listing/get 严格解析 envelope，pending 可延迟重排', async () => {
    const raw = JSON.stringify(pending);
    const { client, evalCommand } = createClient(
      raw,
      [],
      [raw],
      'rescheduled',
      [],
      ['not-json'],
    );
    const store = createRedisRoomDirectoryRegistrationStore({ getClient: () => client });

    await expect(store.get('room-1')).resolves.toEqual(pending);
    await expect(store.list({ limit: 25 })).resolves.toEqual([pending]);
    await expect(store.reschedule({
      roomId: 'room-1',
      targetRoomEpoch: 'epoch-1',
      phase: 'pending-create',
      score: 1_000,
    })).resolves.toEqual({ kind: 'rescheduled' });
    expect(evalCommand.mock.calls[3]?.[0]).toContain(
      'ROOM_DIRECTORY_REGISTRATION_RESCHEDULE_V2',
    );
    await expect(store.list({ limit: 25 })).rejects.toThrow(
      'REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID',
    );
  });

  it('conflict/invalid response 与越界输入显式 fail closed', async () => {
    const { client } = createClient('conflict', 'unexpected');
    const store = createRedisRoomDirectoryRegistrationStore({ getClient: () => client });

    await expect(store.prepare({ record, preparedAtMs: 100 })).rejects.toThrow(
      'REDIS_ROOM_DIRECTORY_REGISTRATION_CONFLICT',
    );
    await expect(store.prepare({ record, preparedAtMs: 100 })).rejects.toThrow(
      'REDIS_ROOM_DIRECTORY_REGISTRATION_RESPONSE_INVALID',
    );
    await expect(store.list({ limit: 51 })).rejects.toThrow(
      'REDIS_ROOM_DIRECTORY_REGISTRATION_INPUT_INVALID',
    );
  });
});
