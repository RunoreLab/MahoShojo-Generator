import { describe, expect, it, vi } from 'vitest';

import {
  ArenaDataCardRefVerifierError,
  type ArenaDataCardRefVerifier,
} from '#/arena-room/arena-data-card-ref-verifier';
import {
  createRoomActorRegistry,
  type RoomActorCheckpointStore,
} from '#/arena-room/room-actor-registry';
import { createArenaRoomMembershipService } from '#/arena-room/room-membership-service';
import {
  ArenaRoomProposalError,
  createArenaRoomProposalService,
} from '#/arena-room/room-proposal-service';
import {
  checkpointPredecessorOf,
  consumeArenaRoomCheckpointCommit,
  type ArenaRoomAuthorityState,
} from '@mahoshojo/multiplayer-core';

class MemoryRoomStore implements RoomActorCheckpointStore {
  state: ArenaRoomAuthorityState | null = null;
  saveCount = 0;
  failNextSave = false;
  readonly order: string[] = [];

  async load(roomId: string) {
    return this.state?.snapshot.roomId === roomId ? structuredClone(this.state) : null;
  }

  async save(input: Parameters<RoomActorCheckpointStore['save']>[0]) {
    this.saveCount += 1;
    this.order.push('checkpoint');
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('redis result unknown');
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

const guidanceChange = (value = '成员建议') => ({
  changeId: 'guidance-1',
  type: 'setUserGuidance' as const,
  value,
  expectedBase: { kind: 'value' as const, value: '' },
});

const createHarness = async () => {
  const store = new MemoryRoomStore();
  let userIndex = 0;
  let timestampIndex = 0;
  const timestamps = [
    '2026-08-28T00:00:00.000Z',
    '2026-08-28T00:01:00.000Z',
    '2026-08-28T00:02:00.000Z',
    '2026-08-28T00:03:00.000Z',
    '2026-08-28T00:04:00.000Z',
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
  const sharedConfig = {
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
  };
  const host = await memberships.create({
    accountUserId: 101,
    displayName: 'Host',
    sharedConfig,
  });
  const member = await memberships.join({
    roomId: host.roomId,
    accountUserId: 202,
    displayName: 'Member',
  });
  const references = {
    verify: vi.fn(async ({ refs }: Parameters<ArenaDataCardRefVerifier['verify']>[0]) => refs),
  } satisfies ArenaDataCardRefVerifier;
  const service = createArenaRoomProposalService({
    memberships,
    references,
    now: () => timestamps[Math.min(++timestampIndex, timestamps.length - 1)]!,
  });
  return { actors, host, member, memberships, references, service, store };
};

describe('Arena Room Proposal application service', () => {
  it('server-normalizes authority metadata and only returns after checkpoint/fanout', async () => {
    const harness = await createHarness();
    const actor = await harness.actors.recover('room-1');
    if (!actor) throw new Error('expected actor');
    actor.subscribe(() => { harness.store.order.push('fanout'); });
    const before = harness.store.saveCount;

    const response = await harness.service.submit({
      roomId: 'room-1',
      accountUserId: 202,
      request: {
        proposalId: 'proposal-1',
        expectedRoomEpoch: 'epoch-1',
        baseRevision: 0,
        changes: [guidanceChange()],
      },
    });

    expect(response).toMatchObject({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      proposalId: 'proposal-1',
      status: 'submitted',
      result: 'applied',
      revision: 0,
    });
    expect(harness.store.saveCount).toBe(before + 1);
    expect(harness.store.order.slice(-2)).toEqual(['checkpoint', 'fanout']);
    expect(harness.store.state?.snapshot.proposals[0]).toMatchObject({
      proposalVersion: 1,
      proposalId: 'proposal-1',
      roomId: 'room-1',
      authorUserId: harness.member.member.userId,
      baseRevision: 0,
      status: 'submitted',
      createdAt: '2026-08-28T00:02:00.000Z',
    });
    expect(harness.store.state?.snapshot.proposals[0]).not.toHaveProperty('accountUserId');
  });

  it('same stable intent reconciles idempotently, while a different body conflicts', async () => {
    const harness = await createHarness();
    const request = {
      proposalId: 'proposal-stable',
      expectedRoomEpoch: 'epoch-1',
      baseRevision: 0,
      changes: [guidanceChange()],
    };
    const first = await harness.service.submit({ roomId: 'room-1', accountUserId: 202, request });
    const afterFirst = harness.store.saveCount;
    const second = await harness.service.submit({ roomId: 'room-1', accountUserId: 202, request });

    expect(first.result).toBe('applied');
    expect(second.result).toBe('idempotent');
    expect(harness.store.saveCount).toBe(afterFirst);
    await expect(harness.service.submit({
      roomId: 'room-1',
      accountUserId: 202,
      request: { ...request, changes: [guidanceChange('不同正文')] },
    })).rejects.toMatchObject({ code: 'ROOM_PROPOSAL_CONFLICT' });
  });

  it('host resolves selected changes only after resulting config refs pass host-readable verification', async () => {
    const harness = await createHarness();
    await harness.service.submit({
      roomId: 'room-1',
      accountUserId: 202,
      request: {
        proposalId: 'proposal-1',
        expectedRoomEpoch: 'epoch-1',
        baseRevision: 0,
        changes: [guidanceChange()],
      },
    });
    vi.mocked(harness.references.verify).mockClear();

    const response = await harness.service.resolve({
      roomId: 'room-1',
      proposalId: 'proposal-1',
      accountUserId: 101,
      request: {
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        resolution: 'accept-selected',
        selectedChangeIds: ['guidance-1'],
      },
    });

    expect(harness.references.verify).toHaveBeenCalledWith({
      hostAccountUserId: 101,
      refs: [{ id: 'character-1', kind: 'character', versionToken: 'v1' }],
    });
    expect(response).toMatchObject({ status: 'accepted', revision: 1, result: 'applied' });
    expect(harness.store.state?.snapshot.sharedConfig.userGuidance).toBe('成员建议');
    expect(harness.store.state?.snapshot.proposals).toEqual([]);
  });

  it('stale revision and stale expectedBase preserve pending Proposal and avoid ref reads', async () => {
    const harness = await createHarness();
    await harness.service.submit({
      roomId: 'room-1',
      accountUserId: 202,
      request: {
        proposalId: 'proposal-stale',
        expectedRoomEpoch: 'epoch-1',
        baseRevision: 0,
        changes: [{
          ...guidanceChange(),
          expectedBase: { kind: 'value' as const, value: '旧值' },
        }],
      },
    });
    vi.mocked(harness.references.verify).mockClear();

    await expect(harness.service.resolve({
      roomId: 'room-1',
      proposalId: 'proposal-stale',
      accountUserId: 101,
      request: {
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 1,
        resolution: 'accept-selected',
        selectedChangeIds: ['guidance-1'],
      },
    })).rejects.toMatchObject({ code: 'ROOM_REVISION_STALE' });
    await expect(harness.service.resolve({
      roomId: 'room-1',
      proposalId: 'proposal-stale',
      accountUserId: 101,
      request: {
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        resolution: 'accept-selected',
        selectedChangeIds: ['guidance-1'],
      },
    })).rejects.toMatchObject({ code: 'ROOM_PROPOSAL_CONFLICT' });
    expect(harness.references.verify).not.toHaveBeenCalled();
    expect(harness.store.state?.snapshot.proposals).toHaveLength(1);
  });

  it('old epoch, wrong roles and foreign withdraw all fail before mutation', async () => {
    const harness = await createHarness();
    const submit = {
      proposalId: 'proposal-1',
      expectedRoomEpoch: 'old-epoch',
      baseRevision: 0,
      changes: [guidanceChange()],
    };
    await expect(harness.service.submit({ roomId: 'room-1', accountUserId: 202, request: submit }))
      .rejects.toMatchObject({ code: 'ROOM_EPOCH_STALE' });
    await expect(harness.service.submit({
      roomId: 'room-1',
      accountUserId: 101,
      request: { ...submit, expectedRoomEpoch: 'epoch-1' },
    })).rejects.toMatchObject({ code: 'ROOM_PERMISSION_DENIED' });

    await harness.service.submit({
      roomId: 'room-1',
      accountUserId: 202,
      request: { ...submit, expectedRoomEpoch: 'epoch-1' },
    });
    await expect(harness.service.resolve({
      roomId: 'room-1',
      proposalId: 'proposal-1',
      accountUserId: 202,
      request: {
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        resolution: 'reject',
      },
    })).rejects.toMatchObject({ code: 'ROOM_PERMISSION_DENIED' });
    await expect(harness.service.withdraw({
      roomId: 'room-1',
      proposalId: 'proposal-1',
      accountUserId: 101,
      request: { expectedRoomEpoch: 'epoch-1' },
    })).rejects.toMatchObject({ code: 'ROOM_PERMISSION_DENIED' });
  });

  it('reference permission/version failures are stable and do not reach RoomActor', async () => {
    const harness = await createHarness();
    vi.mocked(harness.references.verify).mockRejectedValue(
      new ArenaDataCardRefVerifierError('ARENA_DATA_CARD_REF_VERSION_MISMATCH'),
    );
    const before = harness.store.saveCount;

    await expect(harness.service.submit({
      roomId: 'room-1',
      accountUserId: 202,
      request: {
        proposalId: 'proposal-ref',
        expectedRoomEpoch: 'epoch-1',
        baseRevision: 0,
        changes: [{
          changeId: 'add-scenario',
          type: 'setScenario',
          ref: { id: 'scenario-1', kind: 'scenario', versionToken: 'stale' },
          expectedBase: { kind: 'ref', ref: null },
        }],
      },
    })).rejects.toMatchObject({ code: 'ROOM_REFERENCE_STALE' });
    expect(harness.store.saveCount).toBe(before);
  });

  it('Redis save unknown is surfaced once without retry, ack, or fanout', async () => {
    const harness = await createHarness();
    const actor = await harness.actors.recover('room-1');
    if (!actor) throw new Error('expected actor');
    const fanout = vi.fn();
    actor.subscribe(fanout);
    harness.store.failNextSave = true;
    const before = harness.store.saveCount;

    const error = await harness.service.submit({
      roomId: 'room-1',
      accountUserId: 202,
      request: {
        proposalId: 'proposal-unknown',
        expectedRoomEpoch: 'epoch-1',
        baseRevision: 0,
        changes: [guidanceChange()],
      },
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ArenaRoomProposalError);
    expect(error).toMatchObject({ code: 'ROOM_OPERATION_UNKNOWN' });
    expect(harness.store.saveCount).toBe(before + 1);
    expect(fanout).not.toHaveBeenCalled();
    expect(harness.store.state?.snapshot.proposals).toEqual([]);
  });
});
