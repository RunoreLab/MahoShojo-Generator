import { describe, expect, it, vi } from 'vitest';

import {
  ArenaDataCardRefVerifierError,
  createArenaDataCardRefVerifier,
  type ArenaDataCardRefVerifier,
  type ArenaDataCardRefVerifierD1Client,
  type ArenaDataCardRefVerifierD1Statement,
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
import { createTestArenaDataCardRefVerifier } from './arena-room-fixtures';

class MemoryRoomStore implements RoomActorCheckpointStore {
  state: ArenaRoomAuthorityState | null = null;
  saveCount = 0;
  failNextSave = false;
  commitThenThrow = false;
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
    if (this.commitThenThrow) {
      this.commitThenThrow = false;
      throw new Error('redis reply lost after commit');
    }
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
    createRoomEpoch: () => 'epoch-reconciled',
    recoveryTimestamp: () => '2026-08-28T00:04:00.000Z',
  });
  const memberships = createArenaRoomMembershipService({
    actors,
    references: createTestArenaDataCardRefVerifier(),
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

  it('author withdraw and host reject checkpoint terminal lifecycle without changing revision', async () => {
    const withdrawHarness = await createHarness();
    await withdrawHarness.service.submit({
      roomId: 'room-1',
      accountUserId: 202,
      request: {
        proposalId: 'proposal-withdraw',
        expectedRoomEpoch: 'epoch-1',
        baseRevision: 0,
        changes: [guidanceChange()],
      },
    });
    const beforeWithdraw = withdrawHarness.store.saveCount;
    const withdrawn = await withdrawHarness.service.withdraw({
      roomId: 'room-1',
      proposalId: 'proposal-withdraw',
      accountUserId: 202,
      request: { expectedRoomEpoch: 'epoch-1' },
    });
    expect(withdrawn).toMatchObject({ status: 'withdrawn', revision: 0, result: 'applied' });
    expect(withdrawHarness.store.saveCount).toBe(beforeWithdraw + 1);
    expect(withdrawHarness.store.state?.snapshot.proposals).toEqual([]);
    expect(withdrawHarness.store.state?.terminalProposalIds).toContain('proposal-withdraw');

    const rejectHarness = await createHarness();
    await rejectHarness.service.submit({
      roomId: 'room-1',
      accountUserId: 202,
      request: {
        proposalId: 'proposal-reject',
        expectedRoomEpoch: 'epoch-1',
        baseRevision: 0,
        changes: [guidanceChange()],
      },
    });
    vi.mocked(rejectHarness.references.verify).mockClear();
    const beforeReject = rejectHarness.store.saveCount;
    const rejected = await rejectHarness.service.resolve({
      roomId: 'room-1',
      proposalId: 'proposal-reject',
      accountUserId: 101,
      request: {
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        resolution: 'reject',
      },
    });
    expect(rejected).toMatchObject({ status: 'rejected', revision: 0, result: 'applied' });
    expect(rejectHarness.references.verify).not.toHaveBeenCalled();
    expect(rejectHarness.store.saveCount).toBe(beforeReject + 1);
    expect(rejectHarness.store.state?.snapshot.sharedConfig.userGuidance).toBe('');
    expect(rejectHarness.store.state?.snapshot.proposals).toEqual([]);
  });

  it('dependency/atomic selection fails before checkpoint, while a closed partial selection applies once', async () => {
    const harness = await createHarness();
    await harness.service.submit({
      roomId: 'room-1',
      accountUserId: 202,
      request: {
        proposalId: 'proposal-atomic',
        expectedRoomEpoch: 'epoch-1',
        baseRevision: 0,
        changes: [
          { ...guidanceChange(), atomicGroupId: 'group-1' },
          {
            changeId: 'battle-mode-1',
            type: 'setBattleMode',
            value: 'kizuna',
            expectedBase: { kind: 'value', value: 'classic' },
            dependsOn: ['guidance-1'],
            atomicGroupId: 'group-1',
          },
          {
            changeId: 'story-length-1',
            type: 'setStoryLength',
            value: 'long',
            expectedBase: {
              kind: 'value',
              value: { storyLength: 'standard', customStoryLength: null },
            },
          },
        ],
      },
    });
    const beforeInvalid = harness.store.saveCount;
    await expect(harness.service.resolve({
      roomId: 'room-1',
      proposalId: 'proposal-atomic',
      accountUserId: 101,
      request: {
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        resolution: 'accept-selected',
        selectedChangeIds: ['battle-mode-1'],
      },
    })).rejects.toMatchObject({ code: 'ROOM_PROPOSAL_CONFLICT' });
    expect(harness.store.saveCount).toBe(beforeInvalid);
    expect(harness.store.state?.snapshot.proposals).toHaveLength(1);

    const partial = await harness.service.resolve({
      roomId: 'room-1',
      proposalId: 'proposal-atomic',
      accountUserId: 101,
      request: {
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        resolution: 'accept-selected',
        selectedChangeIds: ['guidance-1', 'battle-mode-1'],
      },
    });
    expect(partial).toMatchObject({ status: 'partially_accepted', revision: 1 });
    expect(harness.store.state?.snapshot.sharedConfig).toMatchObject({
      userGuidance: '成员建议',
      battleMode: 'kizuna',
      storyLength: 'standard',
    });
    expect(harness.store.saveCount).toBe(beforeInvalid + 1);
  });

  it('competing same-target Proposals fail closed after the first revision and preserve the loser', async () => {
    const harness = await createHarness();
    for (const [proposalId, value] of [
      ['proposal-first', '先应用'],
      ['proposal-second', '后应用'],
    ] as const) {
      await harness.service.submit({
        roomId: 'room-1',
        accountUserId: 202,
        request: {
          proposalId,
          expectedRoomEpoch: 'epoch-1',
          baseRevision: 0,
          changes: [guidanceChange(value)],
        },
      });
    }
    await harness.service.resolve({
      roomId: 'room-1',
      proposalId: 'proposal-first',
      accountUserId: 101,
      request: {
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        resolution: 'accept-selected',
        selectedChangeIds: ['guidance-1'],
      },
    });
    const beforeConflict = harness.store.saveCount;
    await expect(harness.service.resolve({
      roomId: 'room-1',
      proposalId: 'proposal-second',
      accountUserId: 101,
      request: {
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 1,
        resolution: 'accept-selected',
        selectedChangeIds: ['guidance-1'],
      },
    })).rejects.toMatchObject({ code: 'ROOM_PROPOSAL_CONFLICT' });
    expect(harness.store.saveCount).toBe(beforeConflict);
    expect(harness.store.state?.snapshot.sharedConfig.userGuidance).toBe('先应用');
    expect(harness.store.state?.snapshot.proposals).toMatchObject([
      { proposalId: 'proposal-second', status: 'submitted' },
    ]);
  });

  it.each([
    ['ARENA_DATA_CARD_REF_VERSION_MISMATCH', 'ROOM_REFERENCE_STALE'],
    ['ARENA_DATA_CARD_REF_NOT_READABLE', 'ROOM_REFERENCE_DENIED'],
  ] as const)('resolve revalidates refs after metadata drift: %s', async (refCode, publicCode) => {
    const harness = await createHarness();
    await harness.service.submit({
      roomId: 'room-1',
      accountUserId: 202,
      request: {
        proposalId: `proposal-drift-${refCode}`,
        expectedRoomEpoch: 'epoch-1',
        baseRevision: 0,
        changes: [{
          changeId: 'scenario-1',
          type: 'setScenario',
          ref: { id: 'scenario-1', kind: 'scenario', versionToken: 'v1' },
          expectedBase: { kind: 'ref', ref: null },
        }],
      },
    });
    vi.mocked(harness.references.verify).mockRejectedValueOnce(
      new ArenaDataCardRefVerifierError(refCode),
    );
    const before = harness.store.saveCount;
    const controlSeq = harness.store.state?.snapshot.controlSeq;

    await expect(harness.service.resolve({
      roomId: 'room-1',
      proposalId: `proposal-drift-${refCode}`,
      accountUserId: 101,
      request: {
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        resolution: 'accept-selected',
        selectedChangeIds: ['scenario-1'],
      },
    })).rejects.toMatchObject({ code: publicCode });
    expect(harness.store.saveCount).toBe(before);
    expect(harness.store.state?.snapshot).toMatchObject({
      controlSeq,
      revision: 0,
      proposals: [{ proposalId: `proposal-drift-${refCode}`, status: 'submitted' }],
    });
    expect(harness.store.state?.snapshot.sharedConfig.scenario).toBeNull();
  });

  it.each([
    ['version changed', { updated_at: 'v2' }, 'ROOM_REFERENCE_STALE'],
    ['deleted', { deleted_at: '2026-08-28T00:03:00.000Z' }, 'ROOM_REFERENCE_DENIED'],
    ['permission changed', { is_public: 0, user_id: 202 }, 'ROOM_REFERENCE_DENIED'],
    ['review changed', { review_status: 'pending' }, 'ROOM_REFERENCE_DENIED'],
    ['kind changed', { type: 'character' }, 'ROOM_REFERENCE_DENIED'],
  ] as const)('mutable D1 metadata drift (%s) is re-read before checkpoint', async (
    _name,
    drift,
    publicCode,
  ) => {
    const harness = await createHarness();
    const rows = new Map<string, Record<string, unknown>>([
      ['character-1', {
        id: 'character-1',
        user_id: 101,
        type: 'character',
        is_public: 1,
        review_status: 'approved',
        updated_at: 'v1',
        deleted_at: null,
      }],
      ['scenario-1', {
        id: 'scenario-1',
        user_id: 101,
        type: 'scenario',
        is_public: 1,
        review_status: 'approved',
        updated_at: 'v1',
        deleted_at: null,
      }],
    ]);
    const client: ArenaDataCardRefVerifierD1Client = {
      prepare() {
        let id = '';
        const statement: ArenaDataCardRefVerifierD1Statement = {
          bind(value) {
            id = String(value);
            return statement;
          },
          async all() {
            const row = rows.get(id);
            return { success: true, results: row ? [structuredClone(row)] : [] };
          },
        };
        return statement;
      },
    };
    const service = createArenaRoomProposalService({
      memberships: harness.memberships,
      references: createArenaDataCardRefVerifier({ getClient: () => client }),
      now: () => '2026-08-28T00:03:00.000Z',
    });
    await service.submit({
      roomId: 'room-1',
      accountUserId: 202,
      request: {
        proposalId: `proposal-d1-${_name.replaceAll(' ', '-')}`,
        expectedRoomEpoch: 'epoch-1',
        baseRevision: 0,
        changes: [{
          changeId: 'scenario-1',
          type: 'setScenario',
          ref: { id: 'scenario-1', kind: 'scenario', versionToken: 'v1' },
          expectedBase: { kind: 'ref', ref: null },
        }],
      },
    });
    rows.set('scenario-1', { ...rows.get('scenario-1')!, ...drift });
    const before = harness.store.saveCount;
    const beforeControlSeq = harness.store.state?.snapshot.controlSeq;

    await expect(service.resolve({
      roomId: 'room-1',
      proposalId: `proposal-d1-${_name.replaceAll(' ', '-')}`,
      accountUserId: 101,
      request: {
        expectedRoomEpoch: 'epoch-1',
        expectedRevision: 0,
        resolution: 'accept-selected',
        selectedChangeIds: ['scenario-1'],
      },
    })).rejects.toMatchObject({ code: publicCode });
    expect(harness.store.saveCount).toBe(before);
    expect(harness.store.state?.snapshot).toMatchObject({
      controlSeq: beforeControlSeq,
      revision: 0,
      proposals: [{ status: 'submitted' }],
      sharedConfig: { scenario: null },
    });
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

  it('foreign, absent and terminal Proposal withdraw are publicly indistinguishable', async () => {
    const foreignHarness = await createHarness();
    await foreignHarness.service.submit({
      roomId: 'room-1',
      accountUserId: 202,
      request: {
        proposalId: 'proposal-hidden',
        expectedRoomEpoch: 'epoch-1',
        baseRevision: 0,
        changes: [guidanceChange()],
      },
    });
    await foreignHarness.memberships.join({
      roomId: 'room-1',
      accountUserId: 303,
      displayName: 'Other member',
    });

    const foreign = await foreignHarness.service.withdraw({
      roomId: 'room-1',
      proposalId: 'proposal-hidden',
      accountUserId: 303,
      request: { expectedRoomEpoch: 'epoch-1' },
    }).catch((error: unknown) => error);
    const absent = await foreignHarness.service.withdraw({
      roomId: 'room-1',
      proposalId: 'proposal-absent',
      accountUserId: 303,
      request: { expectedRoomEpoch: 'epoch-1' },
    }).catch((error: unknown) => error);

    const terminalHarness = await createHarness();
    await terminalHarness.service.submit({
      roomId: 'room-1',
      accountUserId: 202,
      request: {
        proposalId: 'proposal-terminal',
        expectedRoomEpoch: 'epoch-1',
        baseRevision: 0,
        changes: [guidanceChange()],
      },
    });
    await terminalHarness.service.withdraw({
      roomId: 'room-1',
      proposalId: 'proposal-terminal',
      accountUserId: 202,
      request: { expectedRoomEpoch: 'epoch-1' },
    });
    const terminal = await terminalHarness.service.withdraw({
      roomId: 'room-1',
      proposalId: 'proposal-terminal',
      accountUserId: 202,
      request: { expectedRoomEpoch: 'epoch-1' },
    }).catch((error: unknown) => error);

    for (const error of [foreign, absent, terminal]) {
      expect(error).toBeInstanceOf(ArenaRoomProposalError);
      expect(error).toMatchObject({ code: 'ROOM_PROPOSAL_NOT_FOUND' });
    }
    expect(foreignHarness.store.state?.snapshot.proposals).toHaveLength(1);
    expect(terminalHarness.store.state?.snapshot.proposals).toEqual([]);
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
    expect(fanout).toHaveBeenCalledOnce();
    expect(fanout).toHaveBeenCalledWith(expect.objectContaining({
      events: [],
      terminal: 'fenced',
    }));
    expect(harness.store.state?.snapshot.proposals).toEqual([]);
    expect(harness.actors.get('room-1')).toBeNull();
  });

  it('commit-then-reply-loss quarantines stale Actor and recovers from Redis without replay', async () => {
    const harness = await createHarness();
    const staleActor = await harness.actors.recover('room-1');
    if (!staleActor) throw new Error('expected actor');
    harness.store.commitThenThrow = true;
    const before = harness.store.saveCount;

    await expect(harness.service.submit({
      roomId: 'room-1',
      accountUserId: 202,
      request: {
        proposalId: 'proposal-commit-unknown',
        expectedRoomEpoch: 'epoch-1',
        baseRevision: 0,
        changes: [guidanceChange()],
      },
    })).rejects.toMatchObject({ code: 'ROOM_OPERATION_UNKNOWN' });

    expect(harness.store.saveCount).toBe(before + 1);
    expect(harness.store.state?.snapshot.proposals).toHaveLength(1);
    expect(() => staleActor.getSnapshot()).toThrow('ROOM_ACTOR_FENCED');
    expect(harness.actors.get('room-1')).toBeNull();

    const reconciled = await harness.memberships.getSession({
      roomId: 'room-1',
      accountUserId: 202,
    });
    expect(reconciled.roomEpoch).toBe('epoch-reconciled');
    expect(reconciled.snapshot.proposals).toMatchObject([
      { proposalId: 'proposal-commit-unknown', status: 'submitted' },
    ]);
    expect(harness.store.saveCount).toBe(before + 2);
  });
});
