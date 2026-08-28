import { describe, expect, it, vi } from 'vitest';

import type { ArenaRoomAuthorityState } from '@mahoshojo/multiplayer-core';

import {
  createArenaRoomDirectoryService,
  RoomDirectoryServiceError,
} from '#/arena-room/room-directory-service';
import type {
  RedisRoomDirectoryCandidate,
  RedisRoomDirectoryStore,
} from '#/arena-room/redis-room-directory-store';
import {
  createStoredRoomDirectoryRecord,
  serializeStoredRoomDirectoryRecord,
  type StoredRoomDirectoryRecord,
} from '#/arena-room/room-directory-record';
import { createArenaRoomState } from './arena-room-fixtures';

const stored = (input: Partial<StoredRoomDirectoryRecord> = {}) => (
  createStoredRoomDirectoryRecord({
    roomId: 'room-1',
    roomEpoch: 'epoch-1',
    hostUserId: 101,
    title: '公开测试房',
    visibility: 'public',
    status: 'open',
    createdAt: '2026-08-28T00:00:00.000Z',
    lastActivityAt: '2026-08-28T00:00:00.000Z',
    ...input,
  })
);

const candidate = (record: StoredRoomDirectoryRecord): RedisRoomDirectoryCandidate => ({
  roomHash: record.publicIndexMember!.slice(-64),
  recordKey: `mahoshojo:room-directory:v1:entry:${record.publicIndexMember!.slice(-64)}`,
  indexMember: record.publicIndexMember,
  raw: serializeStoredRoomDirectoryRecord(record),
});

const createStore = () => ({
  candidateFromRaw: vi.fn<RedisRoomDirectoryStore['candidateFromRaw']>(async (input) => ({
    ...candidate(stored({ roomId: input.roomId })),
    indexMember: input.indexMember ?? null,
    raw: input.raw,
  })),
  getCandidate: vi.fn<RedisRoomDirectoryStore['getCandidate']>(async () => null),
  listPublicCandidates: vi.fn<RedisRoomDirectoryStore['listPublicCandidates']>(async () => []),
  removeIfExact: vi.fn<RedisRoomDirectoryStore['removeIfExact']>(async () => ({
    kind: 'removed',
  })),
}) satisfies RedisRoomDirectoryStore;

const createAuthority = (states: ReadonlyMap<string, ArenaRoomAuthorityState | null>) => ({
  load: vi.fn(async (roomId: string) => states.get(roomId) ?? null),
});

const withRoomId = (roomId: string): ArenaRoomAuthorityState => {
  const state = createArenaRoomState();
  state.snapshot.roomId = roomId;
  return state;
};

describe('Arena Room Redis-only directory service', () => {
  it('public list 只返回 current open exact epoch/host authority', async () => {
    const store = createStore();
    const current = stored();
    store.listPublicCandidates.mockResolvedValue([candidate(current)]);
    const authority = createAuthority(new Map([['room-1', createArenaRoomState()]]));
    const service = createArenaRoomDirectoryService({
      authority,
      store,
      now: () => Date.parse('2026-08-28T00:10:00.000Z'),
    });

    await expect(service.discoverPublic({ limit: 20 })).resolves.toEqual({
      items: [{
        roomId: 'room-1',
        title: '公开测试房',
        visibility: 'public',
        status: 'open',
        createdAt: '2026-08-28T00:00:00.000Z',
        lastActivityAt: '2026-08-28T00:00:00.000Z',
      }],
      nextCursor: null,
    });
    expect(authority.load).toHaveBeenCalledWith('room-1');
    expect(store.removeIfExact).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', null],
    ['wrong epoch', createArenaRoomState('epoch-2')],
    ['closed', (() => {
      const state = createArenaRoomState();
      state.lifecycle.status = 'closed';
      return state;
    })()],
    ['wrong host', (() => {
      const state = createArenaRoomState();
      state.memberAuthority[0]!.accountUserId = 202;
      return state;
    })()],
  ])('%s candidate 不返回并做 exact lazy cleanup', async (_case, state) => {
    const store = createStore();
    const current = candidate(stored());
    store.listPublicCandidates.mockResolvedValue([current]);
    const service = createArenaRoomDirectoryService({
      authority: createAuthority(new Map([['room-1', state]])),
      store,
      now: () => Date.parse('2026-08-28T00:10:00.000Z'),
    });

    await expect(service.discoverPublic({})).resolves.toEqual({ items: [], nextCursor: null });
    expect(store.removeIfExact).toHaveBeenCalledWith(current);
  });

  it('deadline 已过的 open checkpoint 不再可发现', async () => {
    const store = createStore();
    const current = candidate(stored());
    store.listPublicCandidates.mockResolvedValue([current]);
    const service = createArenaRoomDirectoryService({
      authority: createAuthority(new Map([['room-1', createArenaRoomState()]])),
      store,
      now: () => Date.parse('2026-08-28T13:00:00.000Z'),
    });

    await expect(service.discoverPublic({})).resolves.toEqual({ items: [], nextCursor: null });
    expect(store.removeIfExact).toHaveBeenCalledWith(current);
  });

  it('malformed record fail closed 为不可发现，并且 cleanup CAS 失败不会伪装完成', async () => {
    const store = createStore();
    const invalid = { ...candidate(stored()), raw: '{not-json' };
    store.listPublicCandidates.mockResolvedValue([invalid]);
    store.removeIfExact.mockResolvedValue({ kind: 'stale' });
    const service = createArenaRoomDirectoryService({
      authority: createAuthority(new Map()),
      store,
    });

    await expect(service.discoverPublic({})).rejects.toMatchObject({
      code: 'ROOM_DIRECTORY_STALE',
    });
    expect(store.removeIfExact).toHaveBeenCalledWith(invalid);
  });

  it('分页只扫描 limit 个候选，并用最后扫描 member 生成 scope-bound cursor', async () => {
    const store = createStore();
    const first = candidate(stored({ roomId: 'room-1' }));
    const second = candidate(stored({ roomId: 'room-2' }));
    const lookahead = candidate(stored({ roomId: 'room-3' }));
    store.listPublicCandidates.mockResolvedValue([first, second, lookahead]);
    const service = createArenaRoomDirectoryService({
      authority: createAuthority(new Map([
        ['room-1', withRoomId('room-1')],
        ['room-2', withRoomId('room-2')],
      ])),
      store,
      now: () => Date.parse('2026-08-28T00:10:00.000Z'),
    });

    const page = await service.discoverPublic({ limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(store.listPublicCandidates).toHaveBeenCalledWith({ limit: 3 });
    expect(store.removeIfExact).not.toHaveBeenCalledWith(lookahead);

    store.listPublicCandidates.mockResolvedValue([]);
    await service.discoverPublic({ limit: 2, cursor: page.nextCursor! });
    expect(store.listPublicCandidates).toHaveBeenLastCalledWith({
      afterIndexMember: second.indexMember,
      limit: 3,
    });
  });

  it('cursor 篡改、超限 query 与 Redis authority failure 均 fail closed', async () => {
    const store = createStore();
    const service = createArenaRoomDirectoryService({
      authority: { load: vi.fn(async () => { throw new Error('redis unavailable'); }) },
      store,
    });

    await expect(service.discoverPublic({ cursor: 'not-canonical-base64' }))
      .rejects.toBeInstanceOf(RoomDirectoryServiceError);
    const structurallyValidButInvalidMember = Buffer.from(JSON.stringify({
      version: 2,
      scope: 'public',
      indexMember: 'attacker-controlled',
    }), 'utf8').toString('base64url');
    await expect(service.discoverPublic({ cursor: structurallyValidButInvalidMember }))
      .rejects.toMatchObject({ code: 'ROOM_DIRECTORY_CURSOR_INVALID' });
    await expect(service.discoverPublic({ limit: 51 })).rejects.toMatchObject({
      code: 'ROOM_DIRECTORY_INPUT_INVALID',
    });

    const current = candidate(stored());
    store.listPublicCandidates.mockResolvedValue([current]);
    await expect(service.discoverPublic({})).rejects.toMatchObject({
      code: 'ROOM_DIRECTORY_AUTHORITY_UNAVAILABLE',
    });
  });
});
