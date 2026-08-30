import { describe, expect, it } from 'vitest';

import {
  createArenaRoomCheckpointCommit,
  issueArenaRoomRecoveryAuthority,
  transitionArenaRoom,
  type ArenaRoomAuthorityContext,
} from '../src/index';
import {
  createRoomCommand,
  generationPublisherAuthority,
  generationPayloadDigest,
  generationReservationAuthority,
  guidanceChange,
  hostAuthority,
  joinMemberCommand,
  memberAuthority,
  NEXT_TIMESTAMP,
  proposal,
  TEST_TIMESTAMP,
  transitionArenaRoomAt,
} from './state-machine-fixtures';

const RECOVERY_DEADLINES = {
  hostOfflineDeadline: '2026-08-27T16:46:00.000Z',
  roomIdleDeadline: '2026-08-28T04:01:00.000Z',
} as const;

const recoverCommand = () => ({
  type: 'recover' as const,
  expectedRoomEpoch: 'epoch-1',
  nextRoomEpoch: 'epoch-2',
  absentPresenceDeadlines: RECOVERY_DEADLINES,
  timestamp: NEXT_TIMESTAMP,
});

describe('Arena Room recovery transition', () => {
  it('完整保留 member、pending Proposal、generation ledger/mirror 与 collaborative provenance', () => {
    const created = transitionArenaRoom(null, createRoomCommand(), hostAuthority());
    if (!created.ok) throw new Error('expected create success');
    const joined = transitionArenaRoom(created.nextState, joinMemberCommand(), memberAuthority());
    if (!joined.ok) throw new Error('expected join success');
    const submitted = transitionArenaRoom(joined.nextState, {
      type: 'submit-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposal: proposal([guidanceChange()]),
      timestamp: '2026-08-27T16:02:00.000Z',
    }, memberAuthority());
    if (!submitted.ok) throw new Error('expected proposal success');
    const resolved = transitionArenaRoom(submitted.nextState, {
      type: 'resolve-proposal',
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      proposalId: 'proposal-1',
      resolution: 'accept-selected',
      selectedChangeIds: ['guidance-1'],
      timestamp: '2026-08-27T16:03:00.000Z',
    }, hostAuthority());
    if (!resolved.ok) throw new Error('expected resolution success');
    const pending = transitionArenaRoom(resolved.nextState, {
      type: 'submit-proposal',
      expectedRoomEpoch: 'epoch-1',
      proposal: {
        ...proposal([guidanceChange('第二个待处理建议')], 'proposal-2'),
        baseRevision: 1,
        createdAt: '2026-08-27T16:04:00.000Z',
      },
      timestamp: '2026-08-27T16:04:00.000Z',
    }, memberAuthority());
    if (!pending.ok) throw new Error('expected pending proposal success');
    const reserved = transitionArenaRoomAt(pending.nextState, {
      type: 'reserve-generation',
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 1,
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      generationPayloadDigest: generationPayloadDigest(),
      timestamp: '2026-08-27T16:05:00.000Z',
    }, generationReservationAuthority('request-1', 'generation-1', 1));
    if (!reserved.ok) throw new Error('expected reservation success');
    const richStateResult = transitionArenaRoomAt(reserved.nextState, {
      type: 'mirror-generation',
      expectedRoomEpoch: 'epoch-1',
      generationRequestId: 'request-1',
      generationId: 'generation-1',
      attempt: 1,
      state: 'running',
      timestamp: '2026-08-27T16:06:00.000Z',
    }, generationPublisherAuthority(), '2026-08-27T16:06:00.000Z');
    if (!richStateResult.ok) throw new Error('expected mirror success');
    const richState = richStateResult.nextState;
    const timestamp = '2026-08-27T16:07:00.000Z';
    const authority = issueArenaRoomRecoveryAuthority({
      roomId: 'room-1',
      previousRoomEpoch: 'epoch-1',
      nextRoomEpoch: 'epoch-2',
      absentPresenceDeadlines: RECOVERY_DEADLINES,
      timestamp,
    });

    const recovered = transitionArenaRoom(richState, {
      type: 'recover',
      expectedRoomEpoch: 'epoch-1',
      nextRoomEpoch: 'epoch-2',
      absentPresenceDeadlines: RECOVERY_DEADLINES,
      timestamp,
    }, authority);
    if (!recovered.ok) throw new Error('expected recovery success');

    expect(recovered.nextState).toEqual({
      ...richState,
      lifecycle: { ...richState.lifecycle, updatedAt: timestamp },
      snapshot: { ...richState.snapshot, roomEpoch: 'epoch-2', controlSeq: 0 },
    });
    expect(recovered.nextState.snapshot).toMatchObject({
      members: expect.arrayContaining([expect.objectContaining({ userId: 'member-1' })]),
      proposals: [expect.objectContaining({ proposalId: 'proposal-2', status: 'submitted' })],
      activeGeneration: expect.objectContaining({ state: 'running' }),
    });
    expect(recovered.nextState.collaborativeChanges).toHaveLength(1);
    expect(recovered.nextState.generationLedger).toHaveLength(1);
  });

  it('以 opaque server capability 原子切换 epoch，并生成可 checkpoint 的完整 snapshot', () => {
    const created = transitionArenaRoom(null, createRoomCommand(), hostAuthority());
    if (!created.ok) throw new Error('expected create success');
    const authority = issueArenaRoomRecoveryAuthority({
      roomId: 'room-1',
      previousRoomEpoch: 'epoch-1',
      nextRoomEpoch: 'epoch-2',
      absentPresenceDeadlines: RECOVERY_DEADLINES,
      timestamp: NEXT_TIMESTAMP,
    });

    const recovered = transitionArenaRoom(created.nextState, recoverCommand(), authority);

    expect(recovered).toMatchObject({
      ok: true,
      kind: 'applied',
      predecessor: {
        roomId: 'room-1',
        roomEpoch: 'epoch-1',
        revision: 0,
        controlSeq: 0,
      },
      nextState: {
        lifecycle: { status: 'open', createdAt: TEST_TIMESTAMP, updatedAt: NEXT_TIMESTAMP },
        snapshot: { roomId: 'room-1', roomEpoch: 'epoch-2', revision: 0, controlSeq: 0 },
      },
      events: [{
        roomId: 'room-1',
        roomEpoch: 'epoch-2',
        controlSeq: 0,
        type: 'room.snapshot',
      }],
    });
    expect(() => createArenaRoomCheckpointCommit(recovered)).not.toThrow();
  });

  it('拒绝伪造/序列化 capability、scope 漂移、epoch 复用与 closed Room recovery', () => {
    const created = transitionArenaRoom(null, createRoomCommand(), hostAuthority());
    if (!created.ok) throw new Error('expected create success');
    const authority = issueArenaRoomRecoveryAuthority({
      roomId: 'room-1',
      previousRoomEpoch: 'epoch-1',
      nextRoomEpoch: 'epoch-2',
      absentPresenceDeadlines: RECOVERY_DEADLINES,
      timestamp: NEXT_TIMESTAMP,
    });

    expect(transitionArenaRoom(
      created.nextState,
      recoverCommand(),
      structuredClone(authority) as ArenaRoomAuthorityContext,
    )).toMatchObject({ ok: false, code: 'forbidden', reason: 'invalid-authority-context' });
    expect(transitionArenaRoom(
      created.nextState,
      { ...recoverCommand(), nextRoomEpoch: 'epoch-other' },
      authority,
    )).toMatchObject({ ok: false, code: 'forbidden', reason: 'authority-scope-mismatch' });

    const reuseAuthority = issueArenaRoomRecoveryAuthority({
      roomId: 'room-1',
      previousRoomEpoch: 'epoch-1',
      nextRoomEpoch: 'epoch-1',
      absentPresenceDeadlines: RECOVERY_DEADLINES,
      timestamp: NEXT_TIMESTAMP,
    });
    expect(transitionArenaRoom(
      created.nextState,
      { ...recoverCommand(), nextRoomEpoch: 'epoch-1' },
      reuseAuthority,
    )).toMatchObject({ ok: false, code: 'stale', reason: 'room-epoch-reuse' });

    const oldTimestamp = '2026-08-27T15:59:00.000Z';
    const regressedAuthority = issueArenaRoomRecoveryAuthority({
      roomId: 'room-1',
      previousRoomEpoch: 'epoch-1',
      nextRoomEpoch: 'epoch-2',
      absentPresenceDeadlines: RECOVERY_DEADLINES,
      timestamp: oldTimestamp,
    });
    expect(transitionArenaRoom(created.nextState, {
      ...recoverCommand(),
      timestamp: oldTimestamp,
    }, regressedAuthority)).toMatchObject({
      ok: false,
      code: 'stale',
      reason: 'command-timestamp-regression',
    });

    const closed = transitionArenaRoom(created.nextState, {
      type: 'close',
      expectedRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
    }, hostAuthority());
    if (!closed.ok) throw new Error('expected close success');
    expect(transitionArenaRoom(closed.nextState, recoverCommand(), authority))
      .toMatchObject({ ok: false, code: 'room-closed', reason: 'room-closed' });
  });
});
