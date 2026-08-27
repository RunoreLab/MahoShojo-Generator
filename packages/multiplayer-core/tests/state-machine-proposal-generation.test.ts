import {
  MAX_PENDING_PROPOSALS_PER_MEMBER,
  RoomEventSchema,
  type ArenaErrorCode,
} from '@mahoshojo/contracts/arena-room';

import {
  issueArenaRoomGenerationReservationAuthority,
  transitionArenaRoom,
  type ArenaRoomAuthorityState,
  type ArenaRoomTransitionResult,
} from '../src/index';
import {
  NEXT_TIMESTAMP,
  createRoomCommand,
  generationPublisherAuthority,
  generationReservationAuthority,
  guidanceChange,
  hostAuthority,
  joinMemberCommand,
  memberAuthority,
  proposal,
  snapshotDigest,
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
  const created = success(transitionArenaRoom(null, createRoomCommand(), hostAuthority()));
  return success(transitionArenaRoom(created.nextState, joinMemberCommand(), memberAuthority())).nextState;
};

const submit = (state: ArenaRoomAuthorityState, proposalValue = proposal([guidanceChange()])) => success(
  transitionArenaRoom(state, {
    type: 'submit-proposal',
    expectedRoomEpoch: 'epoch-1',
    proposal: proposalValue,
    timestamp: NEXT_TIMESTAMP,
  }, memberAuthority()),
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
      expectedRoomEpoch: 'epoch-1',
      proposal: proposal([guidanceChange('不同内容')]),
      timestamp: NEXT_TIMESTAMP,
    }, memberAuthority()));
    expect(conflicting).toMatchObject({ code: 'duplicate', reason: 'proposal-id-conflict' });

    const hostAuthored = {
      ...proposal([guidanceChange()], 'proposal-host'),
      authorUserId: 'host-1',
    };
    expect(failure(transitionArenaRoom(state, {
      type: 'submit-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposal: hostAuthored,
      timestamp: NEXT_TIMESTAMP,
    }, hostAuthority()))).toMatchObject({ code: 'forbidden', reason: 'member-required' });
  });

  it('lets the host atomically accept selected changes and terminally resolves the Proposal', () => {
    const submitted = submit(createJoinedState()).nextState;
    const resolved = success(transitionArenaRoom(submitted, {
      type: 'resolve-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'proposal-1',
      resolution: 'accept-selected',
      selectedChangeIds: ['guidance-1'],
      timestamp: '2026-08-27T16:02:00.000Z',
    }, hostAuthority()));

    expect(resolved.predecessor).toMatchObject({ revision: 0, controlSeq: 2 });
    expect(resolved.nextState.snapshot).toMatchObject({ revision: 1, controlSeq: 4 });
    expect(resolved.nextState.snapshot.sharedConfig.userGuidance).toBe('成员建议');
    expect(resolved.nextState.snapshot.proposals).toEqual([]);
    expect(resolved.nextState.terminalProposalIds).toContain('proposal-1');
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
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'proposal-1',
      resolution: 'reject',
      timestamp: '2026-08-27T16:02:00.000Z',
    }, hostAuthority()));
    expect(rejected.nextState.snapshot.revision).toBe(0);
    expect(rejected.nextState.snapshot.proposals).toEqual([]);

    const second = submit(rejected.nextState, proposal([guidanceChange()], 'proposal-2')).nextState;
    const withdrawn = success(transitionArenaRoom(second, {
      type: 'withdraw-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'proposal-2',
      timestamp: '2026-08-27T16:03:00.000Z',
    }, memberAuthority()));
    expect(withdrawn.nextState.snapshot.revision).toBe(0);
    expect(withdrawn.nextState.snapshot.proposals).toEqual([]);

    expect(failure(transitionArenaRoom(second, {
      type: 'withdraw-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'proposal-2',
      timestamp: '2026-08-27T16:03:00.000Z',
    }, hostAuthority()))).toMatchObject({ code: 'forbidden', reason: 'member-required' });
  });

  it('preserves state when typed expectedBase conflicts during resolution', () => {
    const submitted = submit(createJoinedState(), proposal([{
      ...guidanceChange(),
      expectedBase: { kind: 'value' as const, value: 'stale-base' },
    }])).nextState;
    const before = structuredClone(submitted);
    const result = failure(transitionArenaRoom(submitted, {
      type: 'resolve-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'proposal-1',
      resolution: 'accept-selected',
      selectedChangeIds: ['guidance-1'],
      timestamp: '2026-08-27T16:02:00.000Z',
    }, hostAuthority()));
    expect(result).toMatchObject({ code: 'conflict', reason: 'proposal-conflict' });
    expect(submitted).toEqual(before);
  });

  it('preserves partial-selection, dependency/atomicity, and online-ref conflict semantics', () => {
    const partialProposal = proposal([
      guidanceChange(),
      {
        changeId: 'battle-mode-1',
        type: 'setBattleMode',
        value: 'kizuna',
        expectedBase: { kind: 'value', value: 'classic' },
      },
    ], 'proposal-partial');
    const partialSubmitted = submit(createJoinedState(), partialProposal).nextState;
    const partial = success(transitionArenaRoom(partialSubmitted, {
      type: 'resolve-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'proposal-partial',
      resolution: 'accept-selected',
      selectedChangeIds: ['guidance-1'],
      timestamp: '2026-08-27T16:02:00.000Z',
    }, hostAuthority()));
    expect(partial.nextState.snapshot.sharedConfig).toMatchObject({
      userGuidance: '成员建议',
      battleMode: 'classic',
    });
    expect(partial.events.at(-1)).toMatchObject({
      type: 'proposal.resolved',
      payload: { status: 'partially_accepted' },
    });

    const atomicProposal = proposal([
      { ...guidanceChange(), atomicGroupId: 'group-1' },
      {
        changeId: 'battle-mode-atomic',
        type: 'setBattleMode',
        value: 'kizuna',
        expectedBase: { kind: 'value', value: 'classic' },
        atomicGroupId: 'group-1',
        dependsOn: ['guidance-1'],
      },
    ], 'proposal-atomic');
    const atomicSubmitted = submit(createJoinedState(), atomicProposal).nextState;
    expect(failure(transitionArenaRoom(atomicSubmitted, {
      type: 'resolve-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'proposal-atomic',
      resolution: 'accept-selected',
      selectedChangeIds: ['battle-mode-atomic'],
      timestamp: '2026-08-27T16:02:00.000Z',
    }, hostAuthority()))).toMatchObject({
      code: 'validation-failed',
      reason: 'proposal-selection-invalid',
    });

    const versionDrift = proposal([{
      changeId: 'remove-character-1',
      type: 'removeCombatant',
      combatantKey: 'data-card:character-1',
      expectedBase: {
        kind: 'present',
        ref: { id: 'character-1', kind: 'character', versionToken: 'stale-version' },
      },
    }], 'proposal-version-drift');
    const driftSubmitted = submit(createJoinedState(), versionDrift).nextState;
    expect(failure(transitionArenaRoom(driftSubmitted, {
      type: 'resolve-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'proposal-version-drift',
      resolution: 'accept-selected',
      selectedChangeIds: ['remove-character-1'],
      timestamp: '2026-08-27T16:02:00.000Z',
    }, hostAuthority()))).toMatchObject({ code: 'conflict', reason: 'proposal-conflict' });
  });

  it('enforces the pending Proposal cap with a stable failure', () => {
    let state = createJoinedState();
    for (let index = 0; index < MAX_PENDING_PROPOSALS_PER_MEMBER; index += 1) {
      state = submit(state, proposal([{
        ...guidanceChange(`建议-${index}`),
        changeId: `guidance-${index}`,
      }], `proposal-pending-${index}`)).nextState;
    }
    expect(failure(transitionArenaRoom(state, {
      type: 'submit-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposal: proposal([guidanceChange()], 'proposal-pending-overflow'),
      timestamp: NEXT_TIMESTAMP,
    }, memberAuthority()))).toMatchObject({ code: 'capability-denied', reason: 'member-limit-reached' });
  });

  it('resolves a semantic no-op without incrementing revision or collaborative provenance', () => {
    const noOp = submit(createJoinedState(), proposal([guidanceChange('')], 'proposal-no-op')).nextState;
    const resolved = success(transitionArenaRoom(noOp, {
      type: 'resolve-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'proposal-no-op',
      resolution: 'accept-selected',
      selectedChangeIds: ['guidance-1'],
      timestamp: '2026-08-27T16:02:00.000Z',
    }, hostAuthority()));
    expect(resolved.nextState.snapshot.revision).toBe(0);
    expect(resolved.nextState.collaborativeChanges).toEqual([]);
    expect(resolved.events).toEqual([
      expect.objectContaining({
        type: 'proposal.resolved',
        payload: expect.objectContaining({ status: 'accepted' }),
      }),
    ]);
  });
});

describe('Arena Room authoritative generation transitions', () => {
  const reserveCommand = () => ({
    type: 'reserve-generation' as const,
    expectedRoomEpoch: 'epoch-1',
    expectedRevision: 0,
    generationRequestId: 'request-1',
    generationId: 'generation-1',
    attempt: 1,
    timestamp: '2026-08-27T16:04:00.000Z',
  });

  it('reserves one immutable attempt and treats an exact duplicate as idempotent', () => {
    const state = createJoinedState();
    const reserved = success(transitionArenaRoom(state, reserveCommand(), generationReservationAuthority()));
    expect(reserved.nextState.snapshot.activeGeneration).toEqual({
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      state: 'starting',
      configRevision: 0,
      snapshotDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      collaborativeInfluence: false,
      participantUserIds: [101, 202],
      startedAt: '2026-08-27T16:04:00.000Z',
    });
    expect(reserved.events[0]).toMatchObject({ type: 'room.snapshot' });

    const duplicate = success(transitionArenaRoom(
      reserved.nextState,
      reserveCommand(),
      generationReservationAuthority(),
    ));
    expect(duplicate.kind).toBe('idempotent');
    expect(duplicate.events).toEqual([]);

    expect(failure(transitionArenaRoom(reserved.nextState, {
      ...reserveCommand(),
      generationId: 'generation-conflict',
    }, generationReservationAuthority('request-1', 'generation-conflict'))))
      .toMatchObject({ code: 'conflict', reason: 'generation-request-conflict' });
  });

  it('derives participant and collaboration provenance from trusted authority state', () => {
    const clean = success(transitionArenaRoom(
      createJoinedState(),
      reserveCommand(),
      generationReservationAuthority(),
    ));
    expect(clean.nextState.snapshot.activeGeneration).toMatchObject({
      collaborativeInfluence: false,
      participantUserIds: [101, 202],
    });

    const submitted = submit(createJoinedState()).nextState;
    const accepted = success(transitionArenaRoom(submitted, {
      type: 'resolve-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'proposal-1',
      resolution: 'accept-selected',
      selectedChangeIds: ['guidance-1'],
      timestamp: '2026-08-27T16:02:00.000Z',
    }, hostAuthority())).nextState;
    const collaborative = success(transitionArenaRoom(accepted, {
      ...reserveCommand(),
      expectedRevision: 1,
      generationRequestId: 'request-collaborative',
      generationId: 'generation-collaborative',
    }, generationReservationAuthority('request-collaborative', 'generation-collaborative', 1)));
    expect(collaborative.nextState.snapshot.activeGeneration).toMatchObject({
      collaborativeInfluence: true,
      participantUserIds: [101, 202],
      configRevision: 1,
    });

    const hostOverride = success(transitionArenaRoom(accepted, {
      type: 'publish-config',
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 1,
      sharedConfig: { ...accepted.snapshot.sharedConfig, userGuidance: '房主覆盖' },
      timestamp: '2026-08-27T16:03:00.000Z',
    }, hostAuthority())).nextState;
    const overridden = success(transitionArenaRoom(hostOverride, {
      ...reserveCommand(),
      expectedRevision: 2,
      generationRequestId: 'request-host-override',
      generationId: 'generation-host-override',
    }, generationReservationAuthority('request-host-override', 'generation-host-override', 2)));
    expect(overridden.nextState.snapshot.activeGeneration?.collaborativeInfluence).toBe(false);

    const unrelatedHostPublish = success(transitionArenaRoom(accepted, {
      type: 'publish-config',
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 1,
      sharedConfig: { ...accepted.snapshot.sharedConfig, battleMode: 'kizuna' },
      timestamp: '2026-08-27T16:03:00.000Z',
    }, hostAuthority())).nextState;
    const retained = success(transitionArenaRoom(unrelatedHostPublish, {
      ...reserveCommand(),
      expectedRevision: 2,
      generationRequestId: 'request-retained-collaboration',
      generationId: 'generation-retained-collaboration',
    }, generationReservationAuthority(
      'request-retained-collaboration',
      'generation-retained-collaboration',
      2,
    )));
    expect(retained.nextState.snapshot.activeGeneration?.collaborativeInfluence).toBe(true);

    const untrusted = transitionArenaRoom(createJoinedState(), {
      ...reserveCommand(),
      participantUserIds: [999],
      collaborativeInfluence: true,
    }, hostAuthority());
    expect(failure(untrusted)).toMatchObject({ code: 'validation-failed', reason: 'invalid-command' });
  });

  it('fences callbacks by epoch and attempt and refuses terminal regression', () => {
    const reserved = success(transitionArenaRoom(
      createJoinedState(),
      reserveCommand(),
      generationReservationAuthority(),
    )).nextState;
    const runningCommand = {
      type: 'mirror-generation' as const,
      expectedRoomEpoch: 'epoch-1',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      state: 'running' as const,
      timestamp: '2026-08-27T16:05:00.000Z',
    };
    expect(failure(transitionArenaRoom(reserved, runningCommand, hostAuthority())))
      .toMatchObject({ code: 'forbidden', reason: 'invalid-authority-context' });
    expect(failure(transitionArenaRoom(reserved, {
      ...runningCommand,
      expectedRoomEpoch: 'epoch-old',
    }, generationPublisherAuthority()))).toMatchObject({ code: 'stale', reason: 'room-epoch-mismatch' });
    expect(failure(transitionArenaRoom(reserved, {
      ...runningCommand,
      attempt: 2,
    }, generationPublisherAuthority('request-1', 'generation-1', 2))))
      .toMatchObject({ code: 'stale', reason: 'generation-attempt-mismatch' });

    const running = success(transitionArenaRoom(reserved, runningCommand, generationPublisherAuthority()));
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
    const completed = success(transitionArenaRoom(running.nextState, completedCommand, generationPublisherAuthority()));
    expect(completed.nextState.snapshot.activeGeneration).toMatchObject({
      state: 'completed',
      finishedAt: '2026-08-27T16:06:00.000Z',
    });
    expect(completed.events[0]).toMatchObject({ type: 'generation.completed' });

    const replayed = success(transitionArenaRoom(completed.nextState, {
      ...completedCommand,
      timestamp: '2026-08-27T16:07:00.000Z',
    }, generationPublisherAuthority()));
    expect(replayed.kind).toBe('idempotent');
    expect(replayed.nextState.snapshot.activeGeneration?.finishedAt).toBe('2026-08-27T16:06:00.000Z');

    const failedAfterCompleted = failure(transitionArenaRoom(completed.nextState, {
      ...runningCommand,
      state: 'failed',
      errorCode: 'generation-failed' as ArenaErrorCode,
      timestamp: '2026-08-27T16:07:00.000Z',
    }, generationPublisherAuthority()));
    expect(failedAfterCompleted).toMatchObject({ code: 'conflict', reason: 'generation-transition-invalid' });
  });

  it('mirrors cancellation without inventing a new public wire event', () => {
    const reserved = success(transitionArenaRoom(
      createJoinedState(),
      reserveCommand(),
      generationReservationAuthority(),
    )).nextState;
    const cancelled = success(transitionArenaRoom(reserved, {
      type: 'mirror-generation',
      expectedRoomEpoch: 'epoch-1',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      state: 'cancelled',
      timestamp: '2026-08-27T16:05:00.000Z',
    }, generationPublisherAuthority()));
    expect(cancelled.nextState.snapshot.activeGeneration?.state).toBe('cancelled');
    expect(cancelled.events).toEqual([
      expect.objectContaining({ type: 'room.snapshot' }),
    ]);
    expect(cancelled.events.every((event) => RoomEventSchema.safeParse(event).success)).toBe(true);
  });

  it('rejects untrusted generation fields and non-host reservation', () => {
    const state = createJoinedState();
    const secret = 'provider-secret-canary';
    const invalid = transitionArenaRoom(state, { ...reserveCommand(), providerApiKey: secret }, hostAuthority());
    expect(failure(invalid)).toMatchObject({ code: 'validation-failed', reason: 'invalid-command' });
    expect(JSON.stringify(invalid)).not.toContain(secret);

    expect(failure(transitionArenaRoom(state, reserveCommand(), memberAuthority())))
      .toMatchObject({ code: 'forbidden', reason: 'invalid-authority-context' });

    expect(failure(transitionArenaRoom(state, reserveCommand(),
      issueArenaRoomGenerationReservationAuthority({
        actorUserId: 'member-1',
        accountUserId: 202,
        roomId: 'room-1',
        roomEpoch: 'epoch-1',
        configRevision: 0,
        generationRequestId: 'request-1',
        generationId: 'generation-1',
        attempt: 1,
        snapshotDigest: snapshotDigest(),
        expiresAt: '2026-08-27T16:30:00.000Z',
      })))).toMatchObject({ code: 'forbidden', reason: 'host-required' });

    expect(failure(transitionArenaRoom(state, reserveCommand(),
      issueArenaRoomGenerationReservationAuthority({
        actorUserId: 'host-1',
        accountUserId: 999,
        roomId: 'room-1',
        roomEpoch: 'epoch-1',
        configRevision: 0,
        generationRequestId: 'request-1',
        generationId: 'generation-1',
        attempt: 1,
        snapshotDigest: snapshotDigest(),
        expiresAt: '2026-08-27T16:30:00.000Z',
      })))).toMatchObject({ code: 'forbidden', reason: 'host-required' });
  });
});
