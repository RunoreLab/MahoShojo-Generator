import {
  MAX_PENDING_PROPOSALS_PER_MEMBER,
  type ArenaErrorCode,
} from '@mahoshojo/contracts/arena-room';

import {
  MAX_ROOM_GENERATION_RECORDS,
  MAX_ROOM_MEMBER_AUTHORITY_RECORDS,
  MAX_ROOM_PROPOSAL_TOMBSTONES,
  issueArenaRoomGenerationPublisherAuthority,
  issueArenaRoomGenerationReservationAuthority,
  transitionArenaRoom,
  type ArenaRoomAuthorityState,
  type ArenaRoomTransitionResult,
} from '../src/index';
import {
  NEXT_TIMESTAMP,
  baseConfig,
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

const reserveCommand = (request = 'request-1', generation = 'generation-1') => ({
  type: 'reserve-generation' as const,
  expectedRoomEpoch: 'epoch-1',
  expectedRevision: 0,
  generationRequestId: request,
  generationId: generation,
  attempt: 1,
  timestamp: '2026-08-27T16:04:00.000Z',
});

const mirror = (
  state: ArenaRoomAuthorityState,
  request: string,
  generation: string,
  terminal?: { state: 'completed'; generationRecordId: string } | { state: 'failed'; errorCode: ArenaErrorCode },
): ArenaRoomAuthorityState => {
  const running = success(transitionArenaRoom(state, {
    type: 'mirror-generation',
    expectedRoomEpoch: 'epoch-1',
    generationRequestId: request,
    generationId: generation,
    attempt: 1,
    state: 'running',
    timestamp: '2026-08-27T16:05:00.000Z',
  }, generationPublisherAuthority(request, generation))).nextState;
  if (!terminal) return running;
  return success(transitionArenaRoom(running, {
    type: 'mirror-generation',
    expectedRoomEpoch: 'epoch-1',
    generationRequestId: request,
    generationId: generation,
    attempt: 1,
    ...terminal,
    timestamp: '2026-08-27T16:06:00.000Z',
  }, generationPublisherAuthority(request, generation))).nextState;
};

describe('GMR-01 independent review regressions', () => {
  it('keeps snapshot digests and generation capabilities behind a scoped server-only boundary', () => {
    const state = createJoinedState();
    const command = reserveCommand();

    expect(failure(transitionArenaRoom(state, {
      ...command,
      snapshotDigest: 'provider-api-key-secret',
    }, hostAuthority()))).toMatchObject({ code: 'validation-failed', reason: 'invalid-command' });
    expect(failure(transitionArenaRoom(state, command, hostAuthority())))
      .toMatchObject({ code: 'forbidden', reason: 'invalid-authority-context' });

    const reservationCapability = generationReservationAuthority();
    const serializedReservationCapability = JSON.parse(JSON.stringify(reservationCapability));
    expect(failure(transitionArenaRoom(state, command, serializedReservationCapability)))
      .toMatchObject({ code: 'forbidden', reason: 'invalid-authority-context' });

    const mismatchedReservationCapability = issueArenaRoomGenerationReservationAuthority({
      actorUserId: 'host-1',
      accountUserId: 101,
      roomId: 'room-other',
      roomEpoch: 'epoch-1',
      configRevision: 0,
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      snapshotDigest: snapshotDigest(),
      expiresAt: '2026-08-27T16:30:00.000Z',
    });
    expect(failure(transitionArenaRoom(state, command, mismatchedReservationCapability)))
      .toMatchObject({ code: 'forbidden', reason: 'authority-scope-mismatch' });

    const expiredReservationCapability = issueArenaRoomGenerationReservationAuthority({
      actorUserId: 'host-1',
      accountUserId: 101,
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      configRevision: 0,
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      snapshotDigest: snapshotDigest(),
      expiresAt: '2026-08-27T16:03:59.999Z',
    });
    expect(failure(transitionArenaRoom(state, command, expiredReservationCapability)))
      .toMatchObject({ code: 'forbidden', reason: 'authority-scope-expired' });

    const reserved = success(transitionArenaRoom(state, command, reservationCapability)).nextState;
    const runningCommand = {
      type: 'mirror-generation' as const,
      expectedRoomEpoch: 'epoch-1',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      state: 'running' as const,
      timestamp: '2026-08-27T16:05:00.000Z',
    };
    const serializedPublisherCapability = JSON.parse(JSON.stringify(generationPublisherAuthority()));
    expect(failure(transitionArenaRoom(reserved, runningCommand, serializedPublisherCapability)))
      .toMatchObject({ code: 'forbidden', reason: 'invalid-authority-context' });

    const wrongPublisherCapability = issueArenaRoomGenerationPublisherAuthority({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      generationRequestId: 'request-other',
      generationId: 'generation-1',
      attempt: 1,
      expiresAt: '2026-08-27T16:30:00.000Z',
    });
    expect(failure(transitionArenaRoom(reserved, runningCommand, wrongPublisherCapability)))
      .toMatchObject({ code: 'forbidden', reason: 'authority-scope-mismatch' });

    const nextEpoch = structuredClone(reserved);
    nextEpoch.snapshot.roomEpoch = 'epoch-2';
    expect(failure(transitionArenaRoom(nextEpoch, {
      ...runningCommand,
      expectedRoomEpoch: 'epoch-2',
    }, generationPublisherAuthority()))).toMatchObject({
      code: 'forbidden',
      reason: 'authority-scope-mismatch',
    });
  });

  it('fences historical request IDs and generation IDs for the entire room lifetime', () => {
    const first = success(transitionArenaRoom(
      createJoinedState(),
      reserveCommand(),
      generationReservationAuthority(),
    )).nextState;
    const firstDone = mirror(first, 'request-1', 'generation-1', {
      state: 'completed',
      generationRecordId: 'record-1',
    });
    const second = success(transitionArenaRoom(
      firstDone,
      reserveCommand('request-2', 'generation-2'),
      generationReservationAuthority('request-2', 'generation-2'),
    )).nextState;
    const secondDone = mirror(second, 'request-2', 'generation-2', {
      state: 'completed',
      generationRecordId: 'record-2',
    });

    expect(success(transitionArenaRoom(
      secondDone,
      reserveCommand(),
      generationReservationAuthority(),
    )).kind).toBe('idempotent');
    expect(failure(transitionArenaRoom(secondDone, {
      ...reserveCommand(),
      generationId: 'generation-3',
    }, generationReservationAuthority('request-1', 'generation-3'))))
      .toMatchObject({ code: 'conflict', reason: 'generation-request-conflict' });
    expect(failure(transitionArenaRoom(
      secondDone,
      reserveCommand('request-3', 'generation-1'),
      generationReservationAuthority('request-3', 'generation-1'),
    )))
      .toMatchObject({ code: 'conflict', reason: 'generation-id-conflict' });
  });

  it('treats exact replay ledgers as bounded room-incarnation quotas while keeping close available', () => {
    const generationExhausted = structuredClone(createJoinedState());
    generationExhausted.generationLedger = Array.from({ length: MAX_ROOM_GENERATION_RECORDS }, (_, index) => ({
      mirror: {
        generationRequestId: `exhausted-request-${index}`,
        generationId: `exhausted-generation-${index}`,
        attempt: 1,
        state: 'cancelled' as const,
        configRevision: 0,
        snapshotDigest: `sha256:${(index % 16).toString(16).repeat(64)}`,
        collaborativeInfluence: false,
        participantUserIds: [101, 202],
        startedAt: '2026-08-27T16:04:00.000Z',
        finishedAt: '2026-08-27T16:05:00.000Z',
      },
    }));
    expect(failure(transitionArenaRoom(
      generationExhausted,
      reserveCommand('next-request', 'next-generation'),
      generationReservationAuthority('next-request', 'next-generation'),
    ))).toMatchObject({ code: 'capability-denied', reason: 'generation-history-limit-reached' });

    const memberExhausted = structuredClone(createJoinedState());
    memberExhausted.memberAuthority.push(...Array.from(
      { length: MAX_ROOM_MEMBER_AUTHORITY_RECORDS - memberExhausted.memberAuthority.length },
      (_, index) => ({
        accountUserId: 1_000 + index,
        member: {
          userId: `revoked-member-${index}`,
          role: 'member' as const,
          displayName: `Revoked ${index}`,
          membershipState: 'revoked' as const,
          joinedAt: NEXT_TIMESTAMP,
        },
      }),
    ));
    expect(failure(transitionArenaRoom(memberExhausted, {
      type: 'join-member',
      expectedRoomEpoch: 'epoch-1',
      member: {
        userId: 'next-member',
        role: 'member',
        displayName: 'Next member',
        membershipState: 'active',
        joinedAt: NEXT_TIMESTAMP,
      },
      timestamp: NEXT_TIMESTAMP,
    }, {
      kind: 'authenticated-user',
      actorUserId: 'next-member',
      accountUserId: 9_999,
    }))).toMatchObject({ code: 'capability-denied', reason: 'member-history-limit-reached' });

    const proposalExhausted = structuredClone(createJoinedState());
    proposalExhausted.terminalProposalIds = Array.from(
      { length: MAX_ROOM_PROPOSAL_TOMBSTONES },
      (_, index) => `terminal-proposal-${index}`,
    );
    expect(failure(transitionArenaRoom(proposalExhausted, {
      type: 'submit-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposal: proposal([guidanceChange()], 'next-proposal'),
      timestamp: NEXT_TIMESTAMP,
    }, memberAuthority()))).toMatchObject({ code: 'capability-denied', reason: 'proposal-history-limit-reached' });

    for (const exhaustedState of [generationExhausted, memberExhausted, proposalExhausted]) {
      expect(success(transitionArenaRoom(exhaustedState, {
        type: 'close',
        expectedRoomEpoch: 'epoch-1',
        reason: 'room-incarnation-limit',
        timestamp: NEXT_TIMESTAMP,
      }, hostAuthority())).nextState.lifecycle.status).toBe('closed');
    }
  });

  it('recognizes an exact reservation retry before comparing the room current revision', () => {
    const reserved = success(transitionArenaRoom(
      createJoinedState(),
      reserveCommand(),
      generationReservationAuthority(),
    )).nextState;
    const published = success(transitionArenaRoom(reserved, {
      type: 'publish-config',
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      sharedConfig: { ...baseConfig(), userGuidance: '只影响下一次生成' },
      timestamp: NEXT_TIMESTAMP,
    }, hostAuthority())).nextState;

    expect(success(transitionArenaRoom(
      published,
      reserveCommand(),
      generationReservationAuthority(),
    )).kind).toBe('idempotent');
  });

  it('rejects conflicting terminal metadata and direct starting-to-completed jumps', () => {
    const reserved = success(transitionArenaRoom(
      createJoinedState(),
      reserveCommand(),
      generationReservationAuthority(),
    )).nextState;
    expect(failure(transitionArenaRoom(reserved, {
      type: 'mirror-generation',
      expectedRoomEpoch: 'epoch-1',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      state: 'completed',
      generationRecordId: 'record-without-running',
      timestamp: '2026-08-27T16:05:00.000Z',
    }, generationPublisherAuthority()))).toMatchObject({ code: 'conflict', reason: 'generation-transition-invalid' });

    const completed = mirror(reserved, 'request-1', 'generation-1', {
      state: 'completed',
      generationRecordId: 'record-1',
    });
    expect(failure(transitionArenaRoom(completed, {
      type: 'mirror-generation',
      expectedRoomEpoch: 'epoch-1',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      state: 'completed',
      generationRecordId: 'record-2',
      timestamp: '2026-08-27T16:07:00.000Z',
    }, generationPublisherAuthority()))).toMatchObject({ code: 'conflict', reason: 'generation-terminal-conflict' });

    const failedReserved = success(transitionArenaRoom(
      createJoinedState(),
      reserveCommand('request-failed', 'generation-failed'),
      generationReservationAuthority('request-failed', 'generation-failed'),
    )).nextState;
    const failed = mirror(failedReserved, 'request-failed', 'generation-failed', {
      state: 'failed',
      errorCode: 'generation-failed',
    });
    expect(failure(transitionArenaRoom(failed, {
      type: 'mirror-generation',
      expectedRoomEpoch: 'epoch-1',
      generationRequestId: 'request-failed',
      generationId: 'generation-failed',
      attempt: 1,
      state: 'failed',
      errorCode: 'conflict',
      timestamp: '2026-08-27T16:07:00.000Z',
    }, generationPublisherAuthority('request-failed', 'generation-failed')))).toMatchObject({
      code: 'conflict',
      reason: 'generation-terminal-conflict',
    });
  });

  it('keeps control events contiguous across the complete authority mutation chain', () => {
    const sequences: number[] = [];
    const predecessorOf = (state: ArenaRoomAuthorityState) => ({
      roomId: state.snapshot.roomId,
      roomEpoch: state.snapshot.roomEpoch,
      revision: state.snapshot.revision,
      controlSeq: state.snapshot.controlSeq,
    });
    const created = success(transitionArenaRoom(null, createRoomCommand(), hostAuthority()));
    expect(created.predecessor).toBeNull();
    sequences.push(...created.events.map((event) => event.controlSeq));
    const joined = success(transitionArenaRoom(created.nextState, joinMemberCommand(), memberAuthority()));
    expect(joined.predecessor).toEqual(predecessorOf(created.nextState));
    sequences.push(...joined.events.map((event) => event.controlSeq));
    const published = success(transitionArenaRoom(joined.nextState, {
      type: 'publish-config',
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      sharedConfig: { ...baseConfig(), battleMode: 'kizuna' },
      timestamp: NEXT_TIMESTAMP,
    }, hostAuthority()));
    expect(published.predecessor).toEqual(predecessorOf(joined.nextState));
    sequences.push(...published.events.map((event) => event.controlSeq));
    const submitted = success(transitionArenaRoom(published.nextState, {
      type: 'submit-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposal: proposal([{
        changeId: 'chain-guidance',
        type: 'setUserGuidance',
        value: '链路建议',
        expectedBase: { kind: 'value', value: '' },
      }], 'proposal-chain'),
      timestamp: NEXT_TIMESTAMP,
    }, memberAuthority()));
    expect(submitted.predecessor).toEqual(predecessorOf(published.nextState));
    sequences.push(...submitted.events.map((event) => event.controlSeq));
    const resolved = success(transitionArenaRoom(submitted.nextState, {
      type: 'resolve-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'proposal-chain',
      resolution: 'accept-selected',
      selectedChangeIds: ['chain-guidance'],
      timestamp: NEXT_TIMESTAMP,
    }, hostAuthority()));
    expect(resolved.predecessor).toEqual(predecessorOf(submitted.nextState));
    sequences.push(...resolved.events.map((event) => event.controlSeq));
    const reserved = success(transitionArenaRoom(resolved.nextState, {
      ...reserveCommand('request-chain', 'generation-chain'),
      expectedRevision: 2,
    }, generationReservationAuthority('request-chain', 'generation-chain', 2)));
    expect(reserved.predecessor).toEqual(predecessorOf(resolved.nextState));
    sequences.push(...reserved.events.map((event) => event.controlSeq));
    const running = success(transitionArenaRoom(reserved.nextState, {
      type: 'mirror-generation',
      expectedRoomEpoch: 'epoch-1',
      generationRequestId: 'request-chain',
      generationId: 'generation-chain',
      attempt: 1,
      state: 'running',
      timestamp: NEXT_TIMESTAMP,
    }, generationPublisherAuthority('request-chain', 'generation-chain')));
    expect(running.predecessor).toEqual(predecessorOf(reserved.nextState));
    sequences.push(...running.events.map((event) => event.controlSeq));
    const completed = success(transitionArenaRoom(running.nextState, {
      type: 'mirror-generation',
      expectedRoomEpoch: 'epoch-1',
      generationRequestId: 'request-chain',
      generationId: 'generation-chain',
      attempt: 1,
      state: 'completed',
      generationRecordId: 'record-chain',
      timestamp: NEXT_TIMESTAMP,
    }, generationPublisherAuthority('request-chain', 'generation-chain')));
    expect(completed.predecessor).toEqual(predecessorOf(running.nextState));
    sequences.push(...completed.events.map((event) => event.controlSeq));
    const closed = success(transitionArenaRoom(completed.nextState, {
      type: 'close',
      expectedRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
    }, hostAuthority()));
    expect(closed.predecessor).toEqual(predecessorOf(completed.nextState));
    sequences.push(...closed.events.map((event) => event.controlSeq));

    expect(sequences).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(closed.nextState.snapshot.controlSeq).toBe(9);
    expect(closed.events.every((event) => event.roomEpoch === 'epoch-1' && event.roomId === 'room-1')).toBe(true);
  });

  it('removes terminal Proposals so normal room history cannot overflow the snapshot schema', () => {
    let state = createJoinedState();
    for (let index = 0; index < 65; index += 1) {
      const proposalId = `proposal-terminal-${index}`;
      const submitted = success(transitionArenaRoom(state, {
        type: 'submit-proposal',
        expectedRoomEpoch: 'epoch-1',
        proposal: proposal([{
          changeId: `change-${index}`,
          type: 'setUserGuidance',
          value: `建议-${index}`,
          expectedBase: { kind: 'value', value: '' },
        }], proposalId),
        timestamp: NEXT_TIMESTAMP,
      }, memberAuthority())).nextState;
      state = success(transitionArenaRoom(submitted, {
        type: 'resolve-proposal',
        expectedRoomEpoch: 'epoch-1',
        proposalId,
        resolution: 'reject',
        timestamp: NEXT_TIMESTAMP,
      }, hostAuthority())).nextState;
    }
    expect(state.snapshot.proposals).toEqual([]);
  });

  it('rejects terminal Proposals in the versioned authority checkpoint on every transition path', () => {
    const compatible = structuredClone(createJoinedState());
    compatible.snapshot.proposals = Array.from(
      { length: MAX_PENDING_PROPOSALS_PER_MEMBER },
      (_, index) => {
        const legacy = proposal([{
          changeId: `legacy-change-${index}`,
          type: 'setUserGuidance' as const,
          value: `legacy-${index}`,
          expectedBase: { kind: 'value' as const, value: '' },
        }], `legacy-terminal-${index}`);
        return {
          ...legacy,
          changes: [...legacy.changes],
          status: 'accepted' as const,
          updatedAt: NEXT_TIMESTAMP,
        };
      },
    );

    expect(failure(transitionArenaRoom(compatible, {
      type: 'submit-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposal: proposal([{
        changeId: 'fresh-change',
        type: 'setUserGuidance',
        value: 'fresh',
        expectedBase: { kind: 'value', value: '' },
      }], 'fresh-proposal'),
      timestamp: NEXT_TIMESTAMP,
    }, memberAuthority()))).toMatchObject({ code: 'validation-failed', reason: 'invalid-state' });

    expect(failure(transitionArenaRoom(compatible, {
      type: 'kick-member',
      targetUserId: 'member-1',
      expectedRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
    }, hostAuthority()))).toMatchObject({ code: 'validation-failed', reason: 'invalid-state' });

    expect(failure(transitionArenaRoom(compatible, {
      type: 'publish-config',
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      sharedConfig: compatible.snapshot.sharedConfig,
      timestamp: NEXT_TIMESTAMP,
    }, hostAuthority()))).toMatchObject({ code: 'validation-failed', reason: 'invalid-state' });
  });

  it('makes non-idempotent replay outcomes explicit and side-effect free', () => {
    const initial = createJoinedState();
    const publishCommand = {
      type: 'publish-config' as const,
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      sharedConfig: { ...baseConfig(), userGuidance: 'publish-once' },
      timestamp: NEXT_TIMESTAMP,
    };
    const published = success(transitionArenaRoom(initial, publishCommand, hostAuthority()));
    const publishedState = structuredClone(published.nextState);
    const publishReplay = transitionArenaRoom(published.nextState, publishCommand, hostAuthority());
    expect(publishReplay).toMatchObject({ ok: false, code: 'stale', reason: 'room-revision-mismatch' });
    expect('events' in publishReplay).toBe(false);
    expect(published.nextState).toEqual(publishedState);

    const submittedForResolve = success(transitionArenaRoom(initial, {
      type: 'submit-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposal: proposal([{
        changeId: 'replay-resolve-change',
        type: 'setUserGuidance',
        value: 'resolve-once',
        expectedBase: { kind: 'value', value: '' },
      }], 'replay-resolve'),
      timestamp: NEXT_TIMESTAMP,
    }, memberAuthority())).nextState;
    const resolveCommand = {
      type: 'resolve-proposal' as const,
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'replay-resolve',
      resolution: 'reject' as const,
      timestamp: NEXT_TIMESTAMP,
    };
    const resolved = success(transitionArenaRoom(submittedForResolve, resolveCommand, hostAuthority()));
    const resolvedState = structuredClone(resolved.nextState);
    const resolveReplay = transitionArenaRoom(resolved.nextState, resolveCommand, hostAuthority());
    expect(resolveReplay).toMatchObject({ ok: false, code: 'conflict', reason: 'proposal-not-submitted' });
    expect('events' in resolveReplay).toBe(false);
    expect(resolved.nextState).toEqual(resolvedState);

    const submittedForWithdraw = success(transitionArenaRoom(initial, {
      type: 'submit-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposal: proposal([{
        changeId: 'replay-withdraw-change',
        type: 'setUserGuidance',
        value: 'withdraw-once',
        expectedBase: { kind: 'value', value: '' },
      }], 'replay-withdraw'),
      timestamp: NEXT_TIMESTAMP,
    }, memberAuthority())).nextState;
    const withdrawCommand = {
      type: 'withdraw-proposal' as const,
      expectedRoomEpoch: 'epoch-1',
      proposalId: 'replay-withdraw',
      timestamp: NEXT_TIMESTAMP,
    };
    const withdrawn = success(transitionArenaRoom(submittedForWithdraw, withdrawCommand, memberAuthority()));
    const withdrawnState = structuredClone(withdrawn.nextState);
    const withdrawReplay = transitionArenaRoom(withdrawn.nextState, withdrawCommand, memberAuthority());
    expect(withdrawReplay).toMatchObject({ ok: false, code: 'conflict', reason: 'proposal-not-submitted' });
    expect('events' in withdrawReplay).toBe(false);
    expect(withdrawn.nextState).toEqual(withdrawnState);

    const leaveCommand = {
      type: 'leave-member' as const,
      expectedRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
    };
    const closed = success(transitionArenaRoom(initial, leaveCommand, hostAuthority()));
    const closedState = structuredClone(closed.nextState);
    const leaveReplay = transitionArenaRoom(closed.nextState, leaveCommand, hostAuthority());
    expect(leaveReplay).toMatchObject({ ok: false, code: 'room-closed', reason: 'room-closed' });
    expect('events' in leaveReplay).toBe(false);
    expect(closed.nextState).toEqual(closedState);
  });

  it('fails oversized aggregate snapshots without throwing or poisoning the last valid state', () => {
    let state = createJoinedState();
    let oversized: ArenaRoomTransitionResult | null = null;
    for (let proposalIndex = 0; proposalIndex < MAX_PENDING_PROPOSALS_PER_MEMBER; proposalIndex += 1) {
      const changes = Array.from({ length: 32 }, (_, changeIndex) => ({
        changeId: `large-${proposalIndex}-${changeIndex}`,
        type: 'addMaterial' as const,
        ref: {
          id: `material-${proposalIndex}-${changeIndex}-${'甲'.repeat(210)}`,
          kind: 'material' as const,
          versionToken: `version-${'乙'.repeat(240)}`,
        },
        expectedBase: { kind: 'absent' as const },
      }));
      const result = transitionArenaRoom(state, {
        type: 'submit-proposal',
        expectedRoomEpoch: 'epoch-1',
        proposal: proposal(changes, `proposal-large-${proposalIndex}`),
        timestamp: NEXT_TIMESTAMP,
      }, memberAuthority());
      if (!result.ok) {
        oversized = result;
        break;
      }
      state = result.nextState;
    }

    expect(oversized).toMatchObject({
      ok: false,
      code: 'payload-too-large',
      reason: 'room-snapshot-too-large',
    });
    expect(() => transitionArenaRoom(state, reserveCommand(), generationReservationAuthority())).not.toThrow();
    expect(transitionArenaRoom(state, reserveCommand(), generationReservationAuthority()).ok).toBe(true);
  });
});
