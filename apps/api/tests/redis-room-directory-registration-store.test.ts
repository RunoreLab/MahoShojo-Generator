import { describe, expect, it, vi } from 'vitest';

import {
  createRedisRoomDirectoryRegistrationStore,
  type RedisRoomDirectoryRegistrationClient,
} from '#/arena-room/redis-room-directory-registration-store';

const registration = {
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  hostUserId: 101,
  title: '协作竞技场',
  visibility: 'public' as const,
  status: 'open' as const,
  createdAt: '2026-08-28T08:00:00.000Z',
  lastActivityAt: '2026-08-28T08:10:00.000Z',
};

const createClient = (...responses: unknown[]) => {
  const evalCommand = vi.fn<RedisRoomDirectoryRegistrationClient['eval']>();
  for (const response of responses) evalCommand.mockResolvedValueOnce(response);
  return { client: { eval: evalCommand }, evalCommand };
};

describe('Redis Room directory registration store', () => {
  it('prepare 使用 server-owned metadata 原子登记，重复相同 payload 幂等', async () => {
    const { client, evalCommand } = createClient('stored', 'already');
    const store = createRedisRoomDirectoryRegistrationStore({
      getClient: () => client,
      keyPrefix: 'test',
    });

    await expect(store.put(registration)).resolves.toBeUndefined();
    await expect(store.put(registration)).resolves.toBeUndefined();
    expect(evalCommand).toHaveBeenCalledTimes(2);
    const [script, options] = evalCommand.mock.calls[0]!;
    expect(script).toContain('ROOM_DIRECTORY_REGISTRATION_PUT_V1');
    expect(options.keys[0]).toMatch(/^mahoshojo:room-directory-registration:v1:test:entry:/u);
    expect(options.keys[1]).toBe('mahoshojo:room-directory-registration:v1:test:index');
    expect(JSON.parse(options.arguments[1]!)).toEqual(registration);
  });

  it('epoch rebind/delete 都绑定 exact predecessor，stale 操作不能命中新登记', async () => {
    const { client, evalCommand } = createClient('rebound', 'stale', 'deleted', 'stale');
    const store = createRedisRoomDirectoryRegistrationStore({ getClient: () => client });

    await expect(store.rebindEpoch({
      roomId: 'room-1',
      previousRoomEpoch: 'epoch-1',
      nextRoomEpoch: 'epoch-2',
      lastActivityAt: '2026-08-28T08:20:00.000Z',
    })).resolves.toEqual({ kind: 'rebound' });
    await expect(store.rebindEpoch({
      roomId: 'room-1',
      previousRoomEpoch: 'epoch-1',
      nextRoomEpoch: 'epoch-stale',
      lastActivityAt: '2026-08-28T08:30:00.000Z',
    })).resolves.toEqual({ kind: 'stale' });
    await expect(store.delete({ roomId: 'room-1', roomEpoch: 'epoch-2' }))
      .resolves.toEqual({ kind: 'deleted' });
    await expect(store.delete({ roomId: 'room-1', roomEpoch: 'epoch-1' }))
      .resolves.toEqual({ kind: 'stale' });
    expect(evalCommand.mock.calls[0]?.[0]).toContain('ROOM_DIRECTORY_REGISTRATION_REBIND_V1');
    expect(evalCommand.mock.calls[2]?.[0]).toContain('ROOM_DIRECTORY_REGISTRATION_DELETE_V1');
  });

  it('sorted registration queue listing 有界并严格解析，touch 只移动 exact epoch', async () => {
    const raw = JSON.stringify(registration);
    const { client, evalCommand } = createClient([raw], 'touched', ['not-json']);
    const store = createRedisRoomDirectoryRegistrationStore({ getClient: () => client });

    await expect(store.list({ limit: 25 })).resolves.toEqual([registration]);
    expect(evalCommand.mock.calls[0]?.[0]).toContain('ROOM_DIRECTORY_REGISTRATION_LIST_V1');
    expect(evalCommand.mock.calls[0]?.[1].arguments).toEqual([
      '25',
      'mahoshojo:room-directory-registration:v1:entry:',
    ]);
    await expect(store.touch({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      score: 1_787_904_000_000,
    })).resolves.toEqual({ kind: 'touched' });
    expect(evalCommand.mock.calls[1]?.[0]).toContain('ROOM_DIRECTORY_REGISTRATION_TOUCH_V1');
    await expect(store.list({ limit: 25 })).rejects.toThrow(
      'REDIS_ROOM_DIRECTORY_REGISTRATION_INVALID',
    );
  });

  it('conflict/invalid response 与越界输入显式 fail closed', async () => {
    const { client } = createClient('conflict', 'unexpected');
    const store = createRedisRoomDirectoryRegistrationStore({ getClient: () => client });

    await expect(store.put(registration)).rejects.toThrow(
      'REDIS_ROOM_DIRECTORY_REGISTRATION_CONFLICT',
    );
    await expect(store.put(registration)).rejects.toThrow(
      'REDIS_ROOM_DIRECTORY_REGISTRATION_RESPONSE_INVALID',
    );
    await expect(store.list({ limit: 51 })).rejects.toThrow(
      'REDIS_ROOM_DIRECTORY_REGISTRATION_INPUT_INVALID',
    );
  });
});
