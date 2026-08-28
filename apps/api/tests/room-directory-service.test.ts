import { describe, expect, it, vi } from 'vitest';
import type { ArenaRoomAuthorityState } from '@mahoshojo/multiplayer-core';

import type {
  D1RoomDirectoryStore,
  RoomDirectoryRecord,
} from '#/arena-room/d1-room-directory-store';
import type {
  RedisRoomDirectoryRegistrationStore,
  RoomDirectoryRegistration,
} from '#/arena-room/redis-room-directory-registration-store';
import {
  createArenaRoomDirectoryService,
  RoomDirectoryServiceError,
} from '#/arena-room/room-directory-service';
import {
  closeArenaRoomState,
  createArenaRoomState,
  recoverArenaRoomTransition,
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

const registration = (
  input = record(),
  phase: RoomDirectoryRegistration['phase'] = 'active',
  projectedRoomEpoch: string | null = phase === 'pending-create' ? null : input.roomEpoch,
): RoomDirectoryRegistration => {
  const { roomEpoch, ...metadata } = input;
  return {
    ...metadata,
    registrationVersion: 2,
    phase,
    targetRoomEpoch: roomEpoch,
    projectedRoomEpoch,
    preparedAtMs: 100,
    updatedAtMs: 100,
  };
};

const createStore = () => ({
  upsertOpen: vi.fn<D1RoomDirectoryStore['upsertOpen']>(async () => undefined),
  rebindEpoch: vi.fn<D1RoomDirectoryStore['rebindEpoch']>(async () => undefined),
  delete: vi.fn<D1RoomDirectoryStore['delete']>(async () => undefined),
  get: vi.fn<D1RoomDirectoryStore['get']>(async () => null),
  listPublic: vi.fn<D1RoomDirectoryStore['listPublic']>(async () => []),
  listByHost: vi.fn<D1RoomDirectoryStore['listByHost']>(async () => []),
  listReconciliationCandidates: vi.fn<D1RoomDirectoryStore['listReconciliationCandidates']>(
    async () => [],
  ),
}) satisfies D1RoomDirectoryStore;

const createRegistrations = () => ({
  prepare: vi.fn<RedisRoomDirectoryRegistrationStore['prepare']>(async () => undefined),
  advanceTarget: vi.fn<RedisRoomDirectoryRegistrationStore['advanceTarget']>(
    async () => ({ kind: 'advanced' }),
  ),
  confirmProjected: vi.fn<RedisRoomDirectoryRegistrationStore['confirmProjected']>(
    async () => ({ kind: 'confirmed' }),
  ),
  markClosing: vi.fn<RedisRoomDirectoryRegistrationStore['markClosing']>(
    async () => ({ kind: 'marked' }),
  ),
  delete: vi.fn<RedisRoomDirectoryRegistrationStore['delete']>(
    async () => ({ kind: 'deleted' }),
  ),
  get: vi.fn<RedisRoomDirectoryRegistrationStore['get']>(async () => null),
  list: vi.fn<RedisRoomDirectoryRegistrationStore['list']>(async () => []),
  reschedule: vi.fn<RedisRoomDirectoryRegistrationStore['reschedule']>(
    async () => ({ kind: 'rescheduled' }),
  ),
}) satisfies RedisRoomDirectoryRegistrationStore;

describe('Arena Room directory service', () => {
  it('create commit 前先持久化 server-owned registration，且不借 D1/authority 创建 Room', async () => {
    const authority = { load: vi.fn(async () => null) };
    const store = createStore();
    const registrations = createRegistrations();
    const service = createArenaRoomDirectoryService({ authority, store, registrations });

    await expect(service.prepareCreatedOpen(record())).resolves.toBeUndefined();
    expect(registrations.prepare).toHaveBeenCalledWith({
      record: record(),
      preparedAtMs: expect.any(Number),
    });
    expect(authority.load).not.toHaveBeenCalled();
    expect(store.upsertOpen).not.toHaveBeenCalled();
  });

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

  it('public page 的 stale cleanup 失败时不签发跳过 orphan 的 cursor', async () => {
    const store = createStore();
    store.listPublic.mockResolvedValue([
      record('room-failed'),
      record('room-next'),
    ]);
    store.delete.mockRejectedValueOnce(new Error('d1 unavailable'));
    const service = createArenaRoomDirectoryService({
      authority: { load: async () => null },
      store,
    });

    await expect(service.discoverPublic({ limit: 1 })).rejects.toMatchObject({
      code: 'ROOM_DIRECTORY_CLEANUP_FAILED',
    });
    expect(store.delete).toHaveBeenCalledOnce();
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

  it('reconciliation delete 失败显式中止且不签发跳过失败 orphan 的 cursor', async () => {
    const authority = { load: vi.fn(async () => null) };
    const store = createStore();
    store.listReconciliationCandidates.mockResolvedValue([
      record('room-failed'),
      record('room-next'),
    ]);
    store.delete.mockRejectedValueOnce(new Error('d1 unavailable'));
    const service = createArenaRoomDirectoryService({ authority, store });

    await expect(service.reconcile({
      inactiveBefore: '2026-08-28T01:00:00.000Z',
      limit: 1,
    })).rejects.toMatchObject({ code: 'ROOM_DIRECTORY_CLEANUP_FAILED' });
    expect(store.delete).toHaveBeenCalledTimes(1);
  });

  it('committed recovery 以 predecessor epoch 精确重绑 D1/registration 并保留 metadata', async () => {
    const recovered = recoverArenaRoomTransition(createArenaRoomState(), 'epoch-2').nextState;
    const authority = { load: vi.fn(async () => recovered) };
    const store = createStore();
    store.get
      .mockResolvedValueOnce(record())
      .mockResolvedValueOnce(record('room-1', 'epoch-2'));
    const registrations = createRegistrations();
    registrations.get.mockResolvedValue(registration(record('room-1', 'epoch-2'), 'projecting', 'epoch-1'));
    const service = createArenaRoomDirectoryService({
      authority,
      store,
      registrations,
      now: () => 200,
    });

    await expect(service.rebindCommittedOpen({
      previousRoomEpoch: 'epoch-1',
      state: recovered,
    })).resolves.toBeUndefined();
    expect(registrations.advanceTarget).toHaveBeenCalledWith({
      roomId: 'room-1',
      previousTargetRoomEpoch: 'epoch-1',
      targetRoomEpoch: 'epoch-2',
      lastActivityAt: '2026-08-28T00:01:00.000Z',
      updatedAtMs: 200,
    });
    expect(registrations.get.mock.invocationCallOrder[0])
      .toBeLessThan(registrations.advanceTarget.mock.invocationCallOrder[0]!);
    expect(store.rebindEpoch).toHaveBeenCalledWith({
      roomId: 'room-1',
      previousRoomEpoch: 'epoch-1',
      nextRoomEpoch: 'epoch-2',
      hostUserId: 101,
      lastActivityAt: '2026-08-28T00:01:00.000Z',
    });
    expect(store.upsertOpen).toHaveBeenCalledWith({
      ...record(),
      roomEpoch: 'epoch-2',
    });
    expect(registrations.confirmProjected).toHaveBeenCalledWith({
      roomId: 'room-1',
      targetRoomEpoch: 'epoch-2',
      updatedAtMs: 200,
      score: 200,
    });
  });

  it('迟到 recovery projection 遇到更新 registration epoch 时不得回退 D1', async () => {
    const recovered = recoverArenaRoomTransition(createArenaRoomState(), 'epoch-2').nextState;
    const store = createStore();
    store.get.mockResolvedValue({ ...record(), roomEpoch: 'epoch-3' });
    const registrations = createRegistrations();
    registrations.advanceTarget.mockResolvedValue({ kind: 'stale' });
    registrations.get.mockResolvedValue(registration(record('room-1', 'epoch-3')));
    const service = createArenaRoomDirectoryService({
      authority: { load: async () => recovered },
      store,
      registrations,
    });

    await expect(service.rebindCommittedOpen({
      previousRoomEpoch: 'epoch-1',
      state: recovered,
    })).rejects.toMatchObject({ code: 'ROOM_DIRECTORY_STALE' });
    expect(store.rebindEpoch).not.toHaveBeenCalled();
    expect(store.upsertOpen).not.toHaveBeenCalled();
  });

  it('registration reconciliation 可有界补建缺失 D1，authority absent 则 exact cleanup', async () => {
    const current = record();
    const orphan = record('room-orphan');
    const authority = {
      load: vi.fn(async (roomId: string) => (roomId === 'room-1' ? createArenaRoomState() : null)),
    };
    const store = createStore();
    store.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(orphan)
      .mockResolvedValueOnce(null);
    const registrations = createRegistrations();
    registrations.list.mockResolvedValue([
      registration(current),
      registration(orphan, 'pending-create', null),
    ]);
    const service = createArenaRoomDirectoryService({ authority, store, registrations });

    await expect(service.reconcileRegistrations({ limit: 2, score: 1_787_904_000_000 }))
      .resolves.toEqual({ scanned: 2, projected: 1, removed: 1 });
    expect(store.upsertOpen).toHaveBeenCalledWith(current);
    expect(store.delete).toHaveBeenCalledWith({
      roomId: 'room-orphan',
      roomEpoch: 'epoch-1',
    });
    expect(registrations.markClosing).toHaveBeenCalledWith({
      roomId: 'room-orphan',
      targetRoomEpoch: 'epoch-1',
      updatedAtMs: expect.any(Number),
      score: 1_787_904_000_000,
    });
    expect(registrations.delete).toHaveBeenCalledWith({
      roomId: 'room-orphan',
      targetRoomEpoch: 'epoch-1',
      phase: 'closing',
    });
    expect(registrations.confirmProjected).toHaveBeenCalledWith({
      roomId: 'room-1',
      targetRoomEpoch: 'epoch-1',
      updatedAtMs: expect.any(Number),
      score: 1_787_904_000_000,
    });
  });

  it('pending-create 在 grace 内观察不到 checkpoint 时只重排，不误判 orphan', async () => {
    const store = createStore();
    const registrations = createRegistrations();
    registrations.list.mockResolvedValue([
      registration(record(), 'pending-create', null),
    ]);
    const service = createArenaRoomDirectoryService({
      authority: { load: async () => null },
      store,
      registrations,
      now: () => 200,
      pendingCreateGraceMs: 1_000,
    });

    await expect(service.reconcileRegistrations({ limit: 1, score: 200 }))
      .resolves.toEqual({ scanned: 1, projected: 0, removed: 0 });
    expect(registrations.reschedule).toHaveBeenCalledWith({
      roomId: 'room-1',
      targetRoomEpoch: 'epoch-1',
      phase: 'pending-create',
      score: 1_100,
    });
    expect(store.get).not.toHaveBeenCalled();
    expect(registrations.delete).not.toHaveBeenCalled();
  });

  it('absent 观察后 checkpoint 先提交时，原子 closing fence 阻止删除新 Room 目录', async () => {
    const store = createStore();
    store.get.mockResolvedValue(record());
    const registrations = createRegistrations();
    registrations.list.mockResolvedValue([
      registration(record(), 'pending-create', null),
    ]);
    registrations.markClosing.mockResolvedValue({ kind: 'authority-open' });
    const service = createArenaRoomDirectoryService({
      authority: { load: async () => null },
      store,
      registrations,
      now: () => 2_000,
      pendingCreateGraceMs: 1_000,
    });

    await expect(service.reconcileRegistrations({ limit: 1, score: 2_000 }))
      .resolves.toEqual({ scanned: 1, projected: 0, removed: 0 });
    expect(registrations.markClosing).toHaveBeenCalledOnce();
    expect(store.delete).not.toHaveBeenCalled();
    expect(registrations.delete).not.toHaveBeenCalled();
  });

  it('低频 registration reconciler 单例有界运行、可停止且不会重叠', async () => {
    vi.useFakeTimers();
    try {
      const state = createArenaRoomState();
      const store = createStore();
      const registrations = createRegistrations();
      registrations.list.mockResolvedValue([registration(record())]);
      store.get.mockResolvedValue(record());
      const service = createArenaRoomDirectoryService({
        authority: { load: async () => state },
        store,
        registrations,
      });
      const stop = service.startRegistrationReconciler({ intervalMs: 100, limit: 1 });

      await vi.advanceTimersByTimeAsync(100);
      expect(registrations.list).toHaveBeenCalledWith({ limit: 1 });
      expect(store.upsertOpen).toHaveBeenCalledOnce();
      stop();
      await vi.advanceTimersByTimeAsync(200);
      expect(registrations.list).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('低频 D1 reconciler 不重叠，稳定推进 cursor 且失败后可重试', async () => {
    vi.useFakeTimers();
    try {
      const store = createStore();
      let resolveFirst!: (value: RoomDirectoryRecord[]) => void;
      store.listReconciliationCandidates
        .mockImplementationOnce(async () => new Promise<RoomDirectoryRecord[]>((resolve) => {
          resolveFirst = resolve;
        }))
        .mockRejectedValueOnce(new Error('D1_RECONCILE_FAULT_INJECTED'))
        .mockResolvedValueOnce([]);
      const onBackgroundError = vi.fn();
      const service = createArenaRoomDirectoryService({
        authority: { load: async () => createArenaRoomState() },
        store,
        now: () => Date.parse('2026-08-28T02:00:00.000Z'),
        onBackgroundError,
      });
      const stop = service.startD1Reconciler({ intervalMs: 100, limit: 1 });

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(300);
      expect(store.listReconciliationCandidates).toHaveBeenCalledOnce();
      resolveFirst([record(), record('room-2')]);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(store.listReconciliationCandidates).toHaveBeenCalledTimes(2);
      const continuedCursor = store.listReconciliationCandidates.mock.calls[1]?.[0].after;
      expect(continuedCursor).toEqual(expect.any(Object));
      await vi.advanceTimersByTimeAsync(100);
      expect(onBackgroundError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'D1_RECONCILE_FAULT_INJECTED' }),
      );
      expect(store.listReconciliationCandidates).toHaveBeenCalledTimes(3);
      expect(store.listReconciliationCandidates).toHaveBeenCalledWith({
        inactiveBefore: '2026-08-28T02:00:00.000Z',
        after: continuedCursor,
        limit: 2,
      });
      stop();
      await vi.advanceTimersByTimeAsync(200);
      expect(store.listReconciliationCandidates).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('committed close projection 只接受 closed checkpoint，并 exact-delete 对应 epoch', async () => {
    const state = createArenaRoomState();
    const store = createStore();
    store.get.mockResolvedValueOnce(record()).mockResolvedValueOnce(null);
    const registrations = createRegistrations();
    registrations.get.mockResolvedValue(registration(record()));
    const service = createArenaRoomDirectoryService({
      authority: { load: async () => state },
      store,
      registrations,
    });

    await expect(service.removeCommittedClosed(state)).rejects.toMatchObject({
      code: 'ROOM_DIRECTORY_CLOSE_INVALID',
    });
    const closed = closeArenaRoomState(state);
    await expect(service.removeCommittedClosed(closed)).resolves.toBeUndefined();
    expect(store.delete).toHaveBeenCalledWith({ roomId: 'room-1', roomEpoch: 'epoch-1' });
    expect(registrations.markClosing).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'room-1',
      targetRoomEpoch: 'epoch-1',
    }));
    expect(registrations.delete).toHaveBeenCalledWith({
      roomId: 'room-1',
      targetRoomEpoch: 'epoch-1',
      phase: 'closing',
    });
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

  it('committed close 的 D1 删除失败保留 closing tombstone 供后续补偿', async () => {
    const state = closeArenaRoomState(createArenaRoomState());
    const store = createStore();
    store.get.mockResolvedValueOnce(record());
    store.delete.mockRejectedValueOnce(new Error('d1 unavailable'));
    const registrations = createRegistrations();
    registrations.get.mockResolvedValue(registration(record()));
    const service = createArenaRoomDirectoryService({
      authority: { load: async () => state },
      store,
      registrations,
      now: () => 500,
    });

    await expect(service.removeCommittedClosed(state)).rejects.toThrow('d1 unavailable');
    expect(registrations.markClosing).toHaveBeenCalledWith({
      roomId: 'room-1',
      targetRoomEpoch: 'epoch-1',
      updatedAtMs: 500,
      score: 500,
    });
    expect(registrations.delete).not.toHaveBeenCalled();
  });
});
