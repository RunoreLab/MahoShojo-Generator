import { describe, expect, it, vi } from 'vitest';
import type { ArenaRoomAuthorityState } from '@mahoshojo/multiplayer-core';

import type {
  D1RoomDirectoryStore,
  RoomDirectoryRecord,
} from '#/arena-room/d1-room-directory-store';
import {
  createArenaRoomDirectoryService,
  RoomDirectoryServiceError,
} from '#/arena-room/room-directory-service';
import {
  closeArenaRoomState,
  createArenaRoomState,
} from './arena-room-fixtures';

const record = (
  roomId = 'room-1',
  roomEpoch = 'epoch-1',
  visibility: RoomDirectoryRecord['visibility'] = 'public',
): RoomDirectoryRecord => ({
  roomId,
  roomEpoch,
  hostUserId: 101,
  title: `Room ${roomId}`,
  visibility,
  status: 'open',
  createdAt: '2026-08-28T00:00:00.000Z',
  lastActivityAt: '2026-08-28T00:01:00.000Z',
});

const createStore = () => ({
  upsertOpen: vi.fn<D1RoomDirectoryStore['upsertOpen']>(async () => undefined),
  delete: vi.fn<D1RoomDirectoryStore['delete']>(async () => undefined),
  get: vi.fn<D1RoomDirectoryStore['get']>(async () => null),
  listPublic: vi.fn<D1RoomDirectoryStore['listPublic']>(async () => []),
  listByHost: vi.fn<D1RoomDirectoryStore['listByHost']>(async () => []),
  listReconciliationCandidates: vi.fn<D1RoomDirectoryStore['listReconciliationCandidates']>(
    async () => [],
  ),
}) satisfies D1RoomDirectoryStore;

describe('Arena Room directory service', () => {
  it('register 前以 Redis checkpoint 最终验证 epoch/host/open，D1 不可创建 Room', async () => {
    const state = createArenaRoomState();
    const authority = {
      load: vi.fn<(roomId: string) => Promise<ArenaRoomAuthorityState | null>>(async () => state),
    };
    const store = createStore();
    const service = createArenaRoomDirectoryService({ authority, store });

    await expect(service.registerOpen(record())).resolves.toBeUndefined();
    expect(authority.load).toHaveBeenCalledWith('room-1');
    expect(store.upsertOpen).toHaveBeenCalledWith(record());

    authority.load.mockResolvedValueOnce(null);
    await expect(service.registerOpen(record('room-orphan'))).rejects.toMatchObject({
      code: 'ROOM_DIRECTORY_STALE',
    });
    expect(store.upsertOpen).toHaveBeenCalledTimes(1);

    authority.load.mockResolvedValueOnce(createArenaRoomState('epoch-new'));
    await expect(service.registerOpen(record())).rejects.toMatchObject({
      code: 'ROOM_DIRECTORY_STALE',
    });
    expect(store.upsertOpen).toHaveBeenCalledTimes(1);
  });

  it('exact lookup 对 orphan/closed/epoch mismatch 只做幂等清理，绝不 recover/create', async () => {
    const authority = { load: vi.fn(async () => null) };
    const store = createStore();
    store.get.mockResolvedValue(record('room-orphan'));
    const service = createArenaRoomDirectoryService({ authority, store });

    await expect(service.lookup('room-orphan')).resolves.toBeNull();
    expect(store.delete).toHaveBeenCalledWith({
      roomId: 'room-orphan',
      roomEpoch: 'epoch-1',
    });
    expect(authority.load).toHaveBeenCalledTimes(1);
  });

  it('public page 使用 scope-bound opaque cursor，并过滤/清理 bounded stale rows', async () => {
    const first = record();
    const next = {
      ...record('room-b'),
      lastActivityAt: '2026-08-28T00:00:30.000Z',
    };
    const authority = {
      load: vi.fn(async (roomId: string) => (roomId === 'room-1' ? createArenaRoomState() : null)),
    };
    const store = createStore();
    store.listPublic
      .mockResolvedValueOnce([first, next])
      .mockResolvedValueOnce([next]);
    const service = createArenaRoomDirectoryService({ authority, store });

    const page = await service.discoverPublic({ limit: 1 });
    expect(page.items).toEqual([{
      roomId: 'room-1',
      title: 'Room room-1',
      visibility: 'public',
      status: 'open',
      createdAt: '2026-08-28T00:00:00.000Z',
      lastActivityAt: '2026-08-28T00:01:00.000Z',
    }]);
    expect(page.nextCursor).toEqual(expect.any(String));
    await expect(service.discoverPublic({ limit: 1, cursor: page.nextCursor! }))
      .resolves.toMatchObject({ items: [], nextCursor: null });
    expect(store.listPublic.mock.calls[1]?.[0]).toMatchObject({
      after: { roomId: 'room-1', lastActivityAt: '2026-08-28T00:01:00.000Z' },
      limit: 2,
    });
    expect(store.delete).toHaveBeenCalledWith({ roomId: 'room-b', roomEpoch: 'epoch-1' });

    await expect(service.listForHost(101, { limit: 1, cursor: page.nextCursor! }))
      .rejects.toMatchObject({ code: 'ROOM_DIRECTORY_CURSOR_INVALID' });
  });

  it('host list 对 host account 做 Redis 二次验证且可返回 unlisted metadata', async () => {
    const unlisted = record('room-1', 'epoch-1', 'unlisted');
    const authority = { load: vi.fn(async () => createArenaRoomState()) };
    const store = createStore();
    store.listByHost.mockResolvedValue([unlisted]);
    const service = createArenaRoomDirectoryService({ authority, store });

    await expect(service.listForHost(101, {})).resolves.toMatchObject({
      items: [expect.objectContaining({ roomId: 'room-1', visibility: 'unlisted' })],
      nextCursor: null,
    });
    expect(store.listByHost).toHaveBeenCalledWith({ hostUserId: 101, limit: 21 });
  });

  it('Redis unavailable 时 discovery fail closed，不把未知状态误删为 orphan', async () => {
    const authority = { load: vi.fn(async () => { throw new Error('redis unavailable'); }) };
    const store = createStore();
    store.get.mockResolvedValue(record());
    const service = createArenaRoomDirectoryService({ authority, store });

    await expect(service.lookup('room-1')).rejects.toBeInstanceOf(RoomDirectoryServiceError);
    await expect(service.lookup('room-1')).rejects.toMatchObject({
      code: 'ROOM_DIRECTORY_AUTHORITY_UNAVAILABLE',
    });
    expect(store.delete).not.toHaveBeenCalled();
  });

  it('reconciliation 是 bounded/cursor/idempotent，closed/absent/mismatched 才 exact-delete', async () => {
    const active = record();
    const orphan = record('room-orphan');
    const staleEpoch = record('room-stale');
    const closed = record('room-closed');
    const authority = {
      load: vi.fn(async (roomId: string) => {
        if (roomId === 'room-1') return createArenaRoomState();
        if (roomId === 'room-stale') return createArenaRoomState('epoch-new');
        if (roomId === 'room-closed') return closeArenaRoomState(createArenaRoomState());
        return null;
      }),
    };
    const store = createStore();
    store.listReconciliationCandidates.mockResolvedValue([active, orphan, staleEpoch, closed]);
    const service = createArenaRoomDirectoryService({ authority, store });

    await expect(service.reconcile({
      inactiveBefore: '2026-08-28T01:00:00.000Z',
      limit: 4,
    })).resolves.toEqual({ scanned: 4, removed: 3, nextCursor: null });
    expect(store.delete.mock.calls.map(([input]) => input)).toEqual([
      { roomId: 'room-orphan', roomEpoch: 'epoch-1' },
      { roomId: 'room-stale', roomEpoch: 'epoch-1' },
      { roomId: 'room-closed', roomEpoch: 'epoch-1' },
    ]);

    await expect(service.reconcile({
      inactiveBefore: '2026-08-28T01:00:00.000Z',
      limit: 4,
    })).resolves.toMatchObject({ scanned: 4, removed: 3 });
  });

  it('committed close projection 只接受 closed checkpoint，并 exact-delete 对应 epoch', async () => {
    const state = createArenaRoomState();
    const store = createStore();
    const service = createArenaRoomDirectoryService({ authority: { load: async () => state }, store });

    await expect(service.removeCommittedClosed(state)).rejects.toMatchObject({
      code: 'ROOM_DIRECTORY_CLOSE_INVALID',
    });
    const closed = closeArenaRoomState(state);
    await expect(service.removeCommittedClosed(closed)).resolves.toBeUndefined();
    expect(store.delete).toHaveBeenCalledWith({ roomId: 'room-1', roomEpoch: 'epoch-1' });
  });

  it('committed close 后的 D1/observer 失败不会反向改变权威结果', async () => {
    const state = closeArenaRoomState(createArenaRoomState());
    const store = createStore();
    store.delete.mockRejectedValueOnce(new Error('d1 unavailable'));
    const onBackgroundError = vi.fn(() => { throw new Error('observer unavailable'); });
    const service = createArenaRoomDirectoryService({
      authority: { load: async () => state },
      store,
      onBackgroundError,
    });

    await expect(service.removeCommittedClosed(state)).resolves.toBeUndefined();
    expect(onBackgroundError).toHaveBeenCalledOnce();
  });
});
