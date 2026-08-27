import {
  RoomEventSchema,
  type ArenaErrorCode,
} from '@mahoshojo/contracts/arena-room';

import {
  transitionArenaRoom,
  type ArenaRoomAuthorityState,
  type ArenaRoomTransitionResult,
} from '../src/index';
import {
  NEXT_TIMESTAMP,
  createRoomCommand,
  guidanceChange,
  joinMemberCommand,
  proposal,
} from './state-machine-fixtures';

const success = (result: ArenaRoomTransitionResult): Extract<ArenaRoomTransitionResult, { ok: true }> => {
  expect(result.ok, result.ok ? undefined : `${result.code}:${result.reason}`).toBe(true);
  if (!result.ok) throw new Error(`${result.code}:${result.reason}`);
  return result;
};

const failure = (result: ArenaRoomTransitionResult): Extract<ArenaRoomTransitionResult, { ok: false }> => {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected transition failure');
  return result;
};

const createJoinedState = (): ArenaRoomAuthorityState => {
  const created = success(transitionArenaRoom(null, createRoomCommand()));
  return success(transitionArenaRoom(created.nextState, joinMemberCommand())).nextState;
};

const submit = (state: ArenaRoomAuthorityState, proposalValue = proposal([guidanceChange()])) => success(
  transitionArenaRoom(state, {
    type: 'submit-proposal',
    actorUserId: 'member-1',
    expectedRoomEpoch: 'epoch-1',
    proposal: proposalValue,
    timestamp: NEXT_TIMESTAMP,
  }),
);

describe('Arena Room Proposal authority transitions', () => {
  it('submits once, rejects ID conflicts, and never accepts host-authored member proposals', () => {
    const state = createJoinedState();
    const submitted = submit(state);
    expect(submitted.nextState.snapshot.proposals).toContainEqual(expect.objectContaining({
      proposalId: 'proposal-1',
      status: 'submitted',
    }));
    expect(submitted.nextState.snapshot.revision).toBe(0);
    expect(submitted.events[0]).toMatchObject({ type: 'proposal.submitted' });

    const replayed = submit(submitted.nextState);
    expect(replayed.kind).toBe('idempotent');

    const conflicting = failure(transitionArenaRoom(submitted.nextState, {
      type: 'submit-proposal',
      actorUserId: 'member-1',
      expectedRoomEpoch: 'epoch-1',
      proposal: proposal([guidanceChange('不同内容')]),
      timestamp: NEXT_TIMESTAMP,
    }));
    expect(conflicting).toMatchObject({ code: 'duplicate', reason: 'proposal-id-conflict' });

    const hostAuthored = {
      ...proposal([guidanceChange()], 'proposal-host'),
      authorUserId: 'host-1',
    };
    expect(failure(transitionArenaRoom(state, {
      type: 'submit-proposal',
      actorUserId: 'host-1',
      expectedRoomEpoch: 'epoch-1',
      proposal: hostAuthored,
      timestamp: NEXT_TIMESTAMP,
    }))).toMatchObject({ code: 'forbidden', reason: 'member-required' });
  });

  it('lets the host atomically accept selected changes and terminally resolves the Proposal', () => {
    const submitted = submit(createJoinedState()).nextState;
    const resolved = success(transitionArenaRoom(submitted, {
      type: 'resolve-proposal',
      actorUserId: 'host-1',
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'proposal-1',
      resolution: 'accept-selected',
      selectedChangeIds: ['guidance-1'],
      timestamp: '2026-08-27T16:02:00.000Z',
    }));

    expect(resolved.predecessor).toMatchObject({ revision: 0, controlSeq: 2 });
    expect(resolved.nextState.snapshot).toMatchObject({ revision: 1, controlSeq: 4 });
    expect(resolved.nextState.snapshot.sharedConfig.userGuidance).toBe('成员建议');
    expect(resolved.nextState.snapshot.proposals[0]).toMatchObject({
      status: 'accepted',
      updatedAt: '2026-08-27T16:02:00.000Z',
    });
    expect(resolved.events.map((event) => event.type)).toEqual([
      'room.config.updated',
      'proposal.resolved',
    ]);
    expect(resolved.events.every((event) => RoomEventSchema.safeParse(event).success)).toBe(true);
  });

  it('supports host rejection and author withdrawal without changing config revision', () => {
    const submitted = submit(createJoinedState()).nextState;
    const rejected = success(transitionArenaRoom(submitted, {
      type: 'resolve-proposal',
      actorUserId: 'host-1',
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'proposal-1',
      resolution: 'reject',
      timestamp: '2026-08-27T16:02:00.000Z',
    }));
    expect(rejected.nextState.snapshot.revision).toBe(0);
    expect(rejected.nextState.snapshot.proposals[0]?.status).toBe('rejected');

    const second = submit(rejected.nextState, proposal([guidanceChange()], 'proposal-2')).nextState;
    const withdrawn = success(transitionArenaRoom(second, {
      type: 'withdraw-proposal',
      actorUserId: 'member-1',
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'proposal-2',
      timestamp: '2026-08-27T16:03:00.000Z',
    }));
    expect(withdrawn.nextState.snapshot.revision).toBe(0);
    expect(withdrawn.nextState.snapshot.proposals.find((item) => item.proposalId === 'proposal-2')?.status).toBe('withdrawn');

    expect(failure(transitionArenaRoom(second, {
      type: 'withdraw-proposal',
      actorUserId: 'host-1',
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'proposal-2',
      timestamp: '2026-08-27T16:03:00.000Z',
    }))).toMatchObject({ code: 'forbidden', reason: 'member-required' });
  });

  it('preserves state when typed expectedBase conflicts during resolution', () => {
    const submitted = submit(createJoinedState(), proposal([{
      ...guidanceChange(),
      expectedBase: { kind: 'value' as const, value: 'stale-base' },
    }])).nextState;
    const before = structuredClone(submitted);
    const result = failure(transitionArenaRoom(submitted, {
      type: 'resolve-proposal',
      actorUserId: 'host-1',
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'proposal-1',
      resolution: 'accept-selected',
      selectedChangeIds: ['guidance-1'],
      timestamp: '2026-08-27T16:02:00.000Z',
    }));
    expect(result).toMatchObject({ code: 'conflict', reason: 'proposal-conflict' });
    expect(submitted).toEqual(before);
  });
});

describe('Arena Room authoritative generation transitions', () => {
  const reserveCommand = () => ({
    type: 'reserve-generation' as const,
    actorUserId: 'host-1',
    expectedRoomEpoch: 'epoch-1',
    expectedRevision: 0,
    generationRequestId: 'request-1',
    generationId: 'generation-1',
    attempt: 1,
    snapshotDigest: 'digest-1',
    collaborativeInfluence: true,
    participantUserIds: [101, 202],
    timestamp: '2026-08-27T16:04:00.000Z',
  });

  it('reserves one immutable attempt and treats an exact duplicate as idempotent', () => {
    const state = createJoinedState();
    const reserved = success(transitionArenaRoom(state, reserveCommand()));
    expect(reserved.nextState.snapshot.activeGeneration).toEqual({
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      state: 'starting',
      configRevision: 0,
      snapshotDigest: 'digest-1',
      collaborativeInfluence: true,
      participantUserIds: [101, 202],
      startedAt: '2026-08-27T16:04:00.000Z',
    });
    expect(reserved.events[0]).toMatchObject({ type: 'room.snapshot' });

    const duplicate = success(transitionArenaRoom(reserved.nextState, reserveCommand()));
    expect(duplicate.kind).toBe('idempotent');
    expect(duplicate.events).toEqual([]);

    expect(failure(transitionArenaRoom(reserved.nextState, {
      ...reserveCommand(),
      generationId: 'generation-conflict',
    }))).toMatchObject({ code: 'conflict', reason: 'generation-request-conflict' });
  });

  it('fences callbacks by epoch and attempt and refuses terminal regression', () => {
    const reserved = success(transitionArenaRoom(createJoinedState(), reserveCommand())).nextState;
    const runningCommand = {
      type: 'mirror-generation' as const,
      expectedRoomEpoch: 'epoch-1',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      state: 'running' as const,
      timestamp: '2026-08-27T16:05:00.000Z',
    };
    expect(failure(transitionArenaRoom(reserved, {
      ...runningCommand,
      expectedRoomEpoch: 'epoch-old',
    }))).toMatchObject({ code: 'stale', reason: 'room-epoch-mismatch' });
    expect(failure(transitionArenaRoom(reserved, {
      ...runningCommand,
      attempt: 2,
    }))).toMatchObject({ code: 'stale', reason: 'generation-attempt-mismatch' });

    const running = success(transitionArenaRoom(reserved, runningCommand));
    expect(running.nextState.snapshot.activeGeneration?.state).toBe('running');
    expect(running.events[0]).toMatchObject({ type: 'generation.started' });

    const completedCommand = {
      type: 'mirror-generation' as const,
      expectedRoomEpoch: 'epoch-1',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      state: 'completed' as const,
      generationRecordId: 'record-1',
      timestamp: '2026-08-27T16:06:00.000Z',
    };
    const completed = success(transitionArenaRoom(running.nextState, completedCommand));
    expect(completed.nextState.snapshot.activeGeneration).toMatchObject({
      state: 'completed',
      finishedAt: '2026-08-27T16:06:00.000Z',
    });
    expect(completed.events[0]).toMatchObject({ type: 'generation.completed' });

    const replayed = success(transitionArenaRoom(completed.nextState, {
      ...completedCommand,
      timestamp: '2026-08-27T16:07:00.000Z',
    }));
    expect(replayed.kind).toBe('idempotent');
    expect(replayed.nextState.snapshot.activeGeneration?.finishedAt).toBe('2026-08-27T16:06:00.000Z');

    const failedAfterCompleted = failure(transitionArenaRoom(completed.nextState, {
      ...runningCommand,
      state: 'failed',
      errorCode: 'generation-failed' as ArenaErrorCode,
      timestamp: '2026-08-27T16:07:00.000Z',
    }));
    expect(failedAfterCompleted).toMatchObject({ code: 'conflict', reason: 'generation-transition-invalid' });
  });

  it('mirrors cancellation without inventing a new public wire event', () => {
    const reserved = success(transitionArenaRoom(createJoinedState(), reserveCommand())).nextState;
    const cancelled = success(transitionArenaRoom(reserved, {
      type: 'mirror-generation',
      expectedRoomEpoch: 'epoch-1',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      state: 'cancelled',
      timestamp: '2026-08-27T16:05:00.000Z',
    }));
    expect(cancelled.nextState.snapshot.activeGeneration?.state).toBe('cancelled');
    expect(cancelled.events).toEqual([
      expect.objectContaining({ type: 'room.snapshot' }),
    ]);
    expect(cancelled.events.every((event) => RoomEventSchema.safeParse(event).success)).toBe(true);
  });

  it('rejects untrusted generation fields and non-host reservation', () => {
    const state = createJoinedState();
    const secret = 'provider-secret-canary';
    const invalid = transitionArenaRoom(state, { ...reserveCommand(), providerApiKey: secret });
    expect(failure(invalid)).toMatchObject({ code: 'validation-failed', reason: 'invalid-command' });
    expect(JSON.stringify(invalid)).not.toContain(secret);

    expect(failure(transitionArenaRoom(state, {
      ...reserveCommand(),
      actorUserId: 'member-1',
    }))).toMatchObject({ code: 'forbidden', reason: 'host-required' });
  });
});
