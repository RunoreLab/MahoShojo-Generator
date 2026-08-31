import { describe, expect, it } from 'vitest';

import {
  createRoomActorRegistry,
  type RoomActorCheckpointStore,
} from '#/arena-room/room-actor-registry';
import { createArenaRoomMembershipService } from '#/arena-room/room-membership-service';
import {
  ArenaRoomConfigError,
  createArenaRoomConfigService,
} from '#/arena-room/room-config-service';
import {
  checkpointPredecessorOf,
  consumeArenaRoomCheckpointCommit,
  type ArenaRoomAuthorityState,
} from '@mahoshojo/multiplayer-core';

class MemoryRoomStore implements RoomActorCheckpointStore {
  state: ArenaRoomAuthorityState | null = null;
  saveCount = 0;
  conflictNextSave = false;

  async load(roomId: string) {
    return this.state?.snapshot.roomId === roomId ? structuredClone(this.state) : null;
  }

  async save(input: Parameters<RoomActorCheckpointStore['save']>[0]) {
    this.saveCount += 1;
    if (this.conflictNextSave) {
      this.conflictNextSave = false;
      return { kind: 'conflict' as const };
    }
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

const config = () => ({
  battleMode: 'classic' as const,
  combatants: [{
    key: 'data-card:character-1',
    ref: { id: 'character-1', kind: 'character' as const, versionToken: 'v1' },
  }],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'standard' as const,
  customStoryLength: null,
  selectedLanguage: 'zh-CN',
  historySettings: {
    readArenaHistory: true,
    readArenaHistoryLimit: 3,
    isArenaHistoryUnlimited: false,
    writeArenaHistory: true,
    readCurrentState: true,
    writeCurrentState: true,
    readNarrativeHistory: false,
    readNarrativeHistoryLimit: 10,
    isNarrativeHistoryUnlimited: false,
    writeNarrativeHistory: false,
  },
});

const createHarness = async () => {
  const store = new MemoryRoomStore();
  let userIndex = 0;
  let timestampIndex = 0;
  const timestamps = [
    '2026-08-31T00:00:00.000Z',
    '2026-08-31T00:01:00.000Z',
    '2026-08-31T00:02:00.000Z',
    '2026-08-31T00:03:00.000Z',
  ];
  const actors = createRoomActorRegistry({
    store,
    createRoomIdentity: () => ({ roomId: 'room-1', roomEpoch: 'epoch-1' }),
    createTimestamp: () => timestamps[0]!,
    now: () => Date.parse(timestamps[Math.min(timestampIndex, timestamps.length - 1)]!),
  });
  const memberships = createArenaRoomMembershipService({
    actors,
    createUserId: () => `user-${++userIndex}`,
    now: () => timestamps[Math.min(++timestampIndex, timestamps.length - 1)]!,
  });
  const host = await memberships.create({
    accountUserId: 101,
    displayName: 'Host',
    sharedConfig: config(),
  });
  await memberships.join({
    roomId: host.roomId,
    accountUserId: 202,
    displayName: 'Member',
  });
  const service = createArenaRoomConfigService({
    memberships,
    now: () => timestamps[Math.min(++timestampIndex, timestamps.length - 1)]!,
  });
  return { host, memberships, service, store };
};

describe('Arena Room config application service', () => {
  it('房主以 exact epoch/revision 发布并只在 Redis checkpoint 后取得权威 session', async () => {
    const harness = await createHarness();
    const before = harness.store.saveCount;
    const sharedConfig = { ...config(), userGuidance: '显式发布' };

    const session = await harness.service.publish({
      roomId: 'room-1',
      accountUserId: 101,
      request: {
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        sharedConfig,
      },
    });

    expect(harness.store.saveCount).toBe(before + 1);
    expect(session).toMatchObject({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      member: { role: 'host', membershipState: 'active' },
      snapshot: { revision: 1, sharedConfig },
    });
  });

  it('相同配置在 exact revision 下幂等返回当前权威 session，不写 checkpoint', async () => {
    const harness = await createHarness();
    const before = harness.store.saveCount;

    const session = await harness.service.publish({
      roomId: 'room-1',
      accountUserId: 101,
      request: {
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        sharedConfig: config(),
      },
    });

    expect(harness.store.saveCount).toBe(before);
    expect(session.snapshot).toMatchObject({ revision: 0, sharedConfig: config() });
  });

  it('成员、过期 epoch/revision 与注入字段全部 fail closed', async () => {
    const harness = await createHarness();
    const base = {
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      sharedConfig: { ...config(), userGuidance: '不能写入' },
    };

    await expect(harness.service.publish({
      roomId: 'room-1',
      accountUserId: 202,
      request: base,
    })).rejects.toEqual(new ArenaRoomConfigError('ROOM_PERMISSION_DENIED'));
    await expect(harness.service.publish({
      roomId: 'room-1',
      accountUserId: 101,
      request: { ...base, expectedRoomEpoch: 'epoch-stale' },
    })).rejects.toEqual(new ArenaRoomConfigError('ROOM_EPOCH_STALE'));
    await expect(harness.service.publish({
      roomId: 'room-1',
      accountUserId: 101,
      request: { ...base, expectedRevision: 7 },
    })).rejects.toEqual(new ArenaRoomConfigError('ROOM_REVISION_STALE'));
    await expect(harness.service.publish({
      roomId: 'room-1',
      accountUserId: 101,
      request: { ...base, payload: { apiKey: 'secret-canary' } },
    })).rejects.toEqual(new ArenaRoomConfigError('ROOM_CONFIG_INPUT_INVALID'));
    expect(harness.store.state?.snapshot.sharedConfig.userGuidance).toBe('');
  });

  it('Redis CAS conflict 进入 unknown/fail-closed，绝不安装未 checkpoint 的 revision', async () => {
    const harness = await createHarness();
    harness.store.conflictNextSave = true;

    await expect(harness.service.publish({
      roomId: 'room-1',
      accountUserId: 101,
      request: {
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        sharedConfig: { ...config(), userGuidance: '不得安装' },
      },
    })).rejects.toEqual(new ArenaRoomConfigError('ROOM_OPERATION_UNKNOWN'));

    expect(harness.store.state?.snapshot).toMatchObject({
      revision: 0,
      sharedConfig: { userGuidance: '' },
    });
  });
});
