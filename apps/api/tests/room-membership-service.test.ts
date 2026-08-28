import { describe, expect, it } from 'vitest';

import {
  checkpointPredecessorOf,
  consumeArenaRoomCheckpointCommit,
  type ArenaRoomAuthorityState,
} from '@mahoshojo/multiplayer-core';
import {
  createRoomActorRegistry,
  type RoomActorCheckpointStore,
} from '#/arena-room/room-actor-registry';
import {
  ArenaRoomMembershipError,
  createArenaRoomMembershipService,
} from '#/arena-room/room-membership-service';
import { createArenaRoomState } from './arena-room-fixtures';

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

const createHarness = () => {
  const store = new MemoryRoomStore();
  let userIndex = 0;
  let nowIndex = 0;
  const timestamps = [
    '2026-08-28T00:00:00.000Z',
    '2026-08-28T00:01:00.000Z',
    '2026-08-28T00:02:00.000Z',
    '2026-08-28T00:03:00.000Z',
    '2026-08-28T00:04:00.000Z',
  ];
  const registry = createRoomActorRegistry({
    store,
    createRoomIdentity: () => ({ roomId: 'room-1', roomEpoch: 'epoch-1' }),
    createTimestamp: () => timestamps[0]!,
    now: () => Date.parse(timestamps[Math.min(nowIndex, timestamps.length - 1)]!),
  });
  const service = createArenaRoomMembershipService({
    actors: registry,
    createUserId: () => `server-user-${++userIndex}`,
    now: () => timestamps[Math.min(++nowIndex, timestamps.length - 1)]!,
  });
  return { registry, service, store };
};

describe('Arena Room membership service', () => {
  it('create 的 room/user/role/joinedAt 都由 server-owned service 归一化', async () => {
    const { service } = createHarness();
    const created = await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });

    expect(created).toMatchObject({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      member: {
        userId: 'server-user-1',
        role: 'host',
        displayName: 'Host',
        membershipState: 'active',
        joinedAt: '2026-08-28T00:00:00.000Z',
      },
    });
  });

  it('同一 account multi-tab join 复用一个 membership，不重复 member', async () => {
    const { service, store } = createHarness();
    await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    const first = await service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    });
    const second = await service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Untrusted rename',
    });

    expect(second).toEqual(first);
    expect(store.state?.snapshot.members).toHaveLength(2);
    expect(store.state?.memberAuthority.filter((entry) => entry.accountUserId === 202))
      .toHaveLength(1);
  });

  it('member leave/kick revokes durable membership，host explicit leave closes room', async () => {
    const { service, store } = createHarness();
    const host = await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    const member = await service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    });
    await service.kick({
      roomId: 'room-1',
      accountUserId: 101,
      targetUserId: member.member.userId,
    });
    await expect(service.join({
      roomId: 'room-1',
      accountUserId: 202,
      displayName: 'Member',
    })).rejects.toMatchObject({ code: 'ROOM_MEMBERSHIP_REVOKED' });

    await service.leave({ roomId: host.roomId, accountUserId: 101 });
    expect(store.state?.lifecycle).toMatchObject({ status: 'closed' });
  });

  it('普通 member 显式 leave 不受 socket 数量影响，重复 leave 幂等', async () => {
    const { service, store } = createHarness();
    await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    await service.join({ roomId: 'room-1', accountUserId: 202, displayName: 'Member' });

    await service.leave({ roomId: 'room-1', accountUserId: 202 });
    await service.leave({ roomId: 'room-1', accountUserId: 202 });
    expect(store.state?.lifecycle.status).toBe('open');
    expect(store.state?.memberAuthority.find((entry) => entry.accountUserId === 202)?.member)
      .toMatchObject({ membershipState: 'revoked' });
  });

  it('absent checkpoint / invalid account fail closed，join 不会隐式 create Room', async () => {
    const { service, store } = createHarness();

    await expect(service.join({
      roomId: 'room-missing',
      accountUserId: 202,
      displayName: 'Member',
    })).rejects.toMatchObject({ code: 'ROOM_NOT_FOUND' });
    await expect(service.create({
      accountUserId: 0,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    })).rejects.toBeInstanceOf(ArenaRoomMembershipError);
    expect(store.state).toBeNull();
  });

  it('lazy membership resolution 在 deadline 到期后先权威关闭，reconnect 不能清除期限', async () => {
    const store = new MemoryRoomStore();
    let now = '2026-08-28T00:00:00.000Z';
    const registry = createRoomActorRegistry({
      store,
      createRoomIdentity: () => ({ roomId: 'room-1', roomEpoch: 'epoch-1' }),
      createTimestamp: () => now,
      now: () => Date.parse(now),
    });
    const service = createArenaRoomMembershipService({
      actors: registry,
      createUserId: () => 'host-1',
      now: () => now,
    });
    await service.create({
      accountUserId: 101,
      displayName: 'Host',
      sharedConfig: createArenaRoomState().snapshot.sharedConfig,
    });
    now = '2026-08-28T00:45:00.000Z';

    await expect(service.resolveActiveByAccount({ roomId: 'room-1', accountUserId: 101 }))
      .rejects.toMatchObject({ code: 'ROOM_CLOSED' });
    expect(store.state?.lifecycle).toMatchObject({
      status: 'closed',
      closeReason: 'host-offline-timeout',
    });
  });
});
