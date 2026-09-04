import { MAX_ROOM_MEMBERS, RoomEventSchema } from '@mahoshojo/contracts/arena-room';

import {
  transitionArenaRoom,
  type ArenaRoomAuthorityState,
  type ArenaRoomTransitionResult,
} from '../src/index';
import {
  NEXT_TIMESTAMP,
  TEST_TIMESTAMP,
  baseConfig,
  createRoomCommand,
  hostAuthority,
  joinMemberCommand,
  leaveMemberCommand,
  memberAuthority,
  rejoinMemberCommand,
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

const createState = (): ArenaRoomAuthorityState => success(
  transitionArenaRoom(null, createRoomCommand(), hostAuthority()),
).nextState;

describe('Arena Room runtime-neutral lifecycle transitions', () => {
  it('creates an open room with one active host and an explicit null predecessor', () => {
    const command = createRoomCommand();
    const result = success(transitionArenaRoom(null, command, hostAuthority()));

    expect(result.kind).toBe('applied');
    expect(result.predecessor).toBeNull();
    expect(result.nextState).toMatchObject({
      lifecycle: {
        status: 'open',
        createdAt: TEST_TIMESTAMP,
        updatedAt: TEST_TIMESTAMP,
      },
      snapshot: {
        protocolVersion: 1,
        schemaVersion: 1,
        roomId: 'room-1',
        roomEpoch: 'epoch-1',
        revision: 0,
        controlSeq: 0,
        members: [command.host],
        proposals: [],
        activeGeneration: null,
      },
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ type: 'room.snapshot', controlSeq: 0 });
    expect(RoomEventSchema.safeParse(result.events[0]).success).toBe(true);
    expect(result.nextState.snapshot.sharedConfig).not.toBe(command.sharedConfig);
  });

  it('rejects duplicate create and malformed or secret-bearing input without reflecting secrets', () => {
    const state = createState();
    expect(failure(transitionArenaRoom(state, createRoomCommand(), hostAuthority()))).toMatchObject({
      code: 'duplicate',
      reason: 'state-already-exists',
    });

    const secret = 'gmr01-secret-canary';
    const invalid = transitionArenaRoom(null, {
      ...createRoomCommand(),
      apiKey: secret,
      sharedConfig: {
        ...baseConfig(),
        userProviderConfig: { apiKey: secret },
      },
    }, hostAuthority());
    expect(failure(invalid)).toMatchObject({ code: 'validation-failed', reason: 'invalid-command' });
    expect(JSON.stringify(invalid)).not.toContain(secret);
  });

  it('returns the exact current checkpoint predecessor and never mutates the input state', () => {
    const state = createState();
    const before = structuredClone(state);
    const result = success(transitionArenaRoom(state, joinMemberCommand(), memberAuthority()));

    expect(result.predecessor).toEqual({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      revision: 0,
      controlSeq: 0,
    });
    expect(result.nextState.snapshot.controlSeq).toBe(1);
    expect(result.nextState.snapshot.revision).toBe(0);
    expect(result.events).toEqual([
      expect.objectContaining({ type: 'room.member.joined', controlSeq: 1 }),
    ]);
    expect(state).toEqual(before);
    expect(result.nextState).not.toBe(state);
  });

  it('keeps membership separate from connection state and enforces host/member authority', () => {
    const joined = success(transitionArenaRoom(createState(), joinMemberCommand(), memberAuthority())).nextState;
    const duplicate = success(transitionArenaRoom(joined, joinMemberCommand(), memberAuthority()));
    expect(duplicate.kind).toBe('idempotent');
    expect(duplicate.events).toEqual([]);

    const forbiddenKick = failure(transitionArenaRoom(joined, {
      type: 'kick-member',
      targetUserId: 'host-1',
      expectedRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
    }, memberAuthority()));
    expect(forbiddenKick).toMatchObject({ code: 'forbidden', reason: 'host-required' });

    const left = success(transitionArenaRoom(joined, {
      type: 'leave-member',
      expectedRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
    }, memberAuthority()));
    expect(left.nextState.snapshot.members).not.toContainEqual(expect.objectContaining({ userId: 'member-1' }));
    expect(left.nextState.memberAuthority).toContainEqual(expect.objectContaining({
      accountUserId: 202,
      member: expect.objectContaining({ userId: 'member-1', membershipState: 'revoked' }),
    }));
    expect(left.events[0]).toMatchObject({ type: 'room.member.left' });
    expect(JSON.stringify(left.nextState)).not.toContain('connectionId');
  });

  it('keeps revoked membership fenced while freeing active room capacity', () => {
    const joined = success(transitionArenaRoom(createState(), joinMemberCommand(), memberAuthority())).nextState;
    const kicked = success(transitionArenaRoom(joined, {
      type: 'kick-member',
      targetUserId: 'member-1',
      expectedRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
    }, hostAuthority()));
    expect(kicked.nextState.snapshot.members).toHaveLength(1);
    expect(kicked.nextState.memberAuthority).toContainEqual(expect.objectContaining({
      accountUserId: 202,
      revocationReason: 'kicked',
    }));

    const replayedKick = success(transitionArenaRoom(kicked.nextState, {
      type: 'kick-member',
      targetUserId: 'member-1',
      expectedRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
    }, hostAuthority()));
    expect(replayedKick.kind).toBe('idempotent');

    const replayedLeave = success(transitionArenaRoom(kicked.nextState, {
      type: 'leave-member',
      expectedRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
    }, memberAuthority()));
    expect(replayedLeave.kind).toBe('idempotent');
    expect(failure(transitionArenaRoom(kicked.nextState, joinMemberCommand(), memberAuthority())))
      .toMatchObject({ code: 'forbidden', reason: 'member-not-active' });

    const replacement = {
      ...joinMemberCommand(),
      member: { ...joinMemberCommand().member, userId: 'member-2', displayName: 'Member 2' },
    };
    const replacementContext = {
      kind: 'authenticated-user' as const,
      actorUserId: 'member-2',
      accountUserId: 203,
    };
    expect(success(transitionArenaRoom(kicked.nextState, replacement, replacementContext)).nextState.snapshot.members)
      .toContainEqual(expect.objectContaining({ userId: 'member-2', membershipState: 'active' }));
  });

  it('reactivates voluntary leavers via rejoin-member with the same identity', () => {
    const joined = success(transitionArenaRoom(createState(), joinMemberCommand(), memberAuthority())).nextState;
    const left = success(transitionArenaRoom(joined, leaveMemberCommand(NEXT_TIMESTAMP), memberAuthority())).nextState;
    expect(left.memberAuthority).toContainEqual(expect.objectContaining({
      accountUserId: 202,
      revocationReason: 'left',
    }));

    const rejoined = success(transitionArenaRoom(left, rejoinMemberCommand(), memberAuthority()));
    expect(rejoined.kind).toBe('applied');
    expect(rejoined.events).toEqual([
      expect.objectContaining({ type: 'room.member.joined', controlSeq: left.snapshot.controlSeq + 1 }),
    ]);
    expect(rejoined.nextState.snapshot.members).toContainEqual({
      userId: 'member-1',
      role: 'member',
      displayName: 'Member Rejoined',
      membershipState: 'active',
      joinedAt: '2026-08-27T16:02:00.000Z',
    });
    expect(rejoined.nextState.memberAuthority).toHaveLength(2);
    expect(rejoined.nextState.memberAuthority).toContainEqual({
      accountUserId: 202,
      member: expect.objectContaining({ userId: 'member-1', membershipState: 'active' }),
    });
    expect(rejoined.nextState.memberAuthority.find((entry) => entry.accountUserId === 202))
      .not.toHaveProperty('revocationReason');
  });

  it('keeps rejoin idempotent once membership is active again', () => {
    const joined = success(transitionArenaRoom(createState(), joinMemberCommand(), memberAuthority())).nextState;
    const left = success(transitionArenaRoom(joined, leaveMemberCommand(NEXT_TIMESTAMP), memberAuthority())).nextState;
    const rejoined = success(transitionArenaRoom(left, rejoinMemberCommand(), memberAuthority())).nextState;
    const replayed = success(transitionArenaRoom(rejoined, rejoinMemberCommand('Renamed', NEXT_TIMESTAMP), memberAuthority()));
    expect(replayed.kind).toBe('idempotent');
    expect(replayed.events).toEqual([]);
    expect(replayed.nextState).toEqual(rejoined);
  });

  it('rejects rejoin for a foreign account bound to the same tombstone', () => {
    const joined = success(transitionArenaRoom(createState(), joinMemberCommand(), memberAuthority())).nextState;
    const left = success(transitionArenaRoom(joined, leaveMemberCommand(NEXT_TIMESTAMP), memberAuthority())).nextState;
    expect(failure(transitionArenaRoom(left, rejoinMemberCommand(), {
      kind: 'authenticated-user',
      actorUserId: 'member-1',
      accountUserId: 999,
    }))).toMatchObject({ code: 'forbidden', reason: 'member-not-active' });
  });

  it('upgrades a later host kick over voluntary leave and fences rejoin monotonically', () => {
    const joined = success(transitionArenaRoom(createState(), joinMemberCommand(), memberAuthority())).nextState;
    const left = success(transitionArenaRoom(joined, leaveMemberCommand(NEXT_TIMESTAMP), memberAuthority())).nextState;
    const upgradedKick = success(transitionArenaRoom(left, {
      type: 'kick-member',
      targetUserId: 'member-1',
      expectedRoomEpoch: 'epoch-1',
      timestamp: '2026-08-27T16:03:00.000Z',
    }, hostAuthority()));
    expect(upgradedKick.kind).toBe('applied');
    expect(upgradedKick.events).toEqual([]);
    expect(upgradedKick.nextState.memberAuthority).toContainEqual(expect.objectContaining({
      accountUserId: 202,
      revocationReason: 'kicked',
    }));
    expect(failure(transitionArenaRoom(upgradedKick.nextState, rejoinMemberCommand(), memberAuthority())))
      .toMatchObject({ code: 'forbidden', reason: 'member-not-active' });

    const kickedFirst = success(transitionArenaRoom(joined, {
      type: 'kick-member',
      targetUserId: 'member-1',
      expectedRoomEpoch: 'epoch-1',
      timestamp: '2026-08-27T16:03:00.000Z',
    }, hostAuthority())).nextState;
    const replayedLeave = success(transitionArenaRoom(kickedFirst, leaveMemberCommand('2026-08-27T16:04:00.000Z'), memberAuthority()));
    expect(replayedLeave.kind).toBe('idempotent');
    expect(replayedLeave.nextState.memberAuthority).toContainEqual(expect.objectContaining({
      revocationReason: 'kicked',
    }));
    expect(failure(transitionArenaRoom(replayedLeave.nextState, rejoinMemberCommand(), memberAuthority())))
      .toMatchObject({ code: 'forbidden', reason: 'member-not-active' });
  });

  it('keeps legacy reason-less revoked tombstones fail-closed against rejoin', () => {
    const joined = success(transitionArenaRoom(createState(), joinMemberCommand(), memberAuthority())).nextState;
    const left = success(transitionArenaRoom(joined, leaveMemberCommand(NEXT_TIMESTAMP), memberAuthority())).nextState;
    const legacy = structuredClone(left);
    const legacyRecord = legacy.memberAuthority.find((entry) => entry.accountUserId === 202);
    if (!legacyRecord || !('revocationReason' in legacyRecord)) throw new Error('missing tombstone');
    delete legacyRecord.revocationReason;
    expect(failure(transitionArenaRoom(legacy, rejoinMemberCommand(), memberAuthority())))
      .toMatchObject({ code: 'forbidden', reason: 'member-not-active' });
    expect(failure(transitionArenaRoom(legacy, joinMemberCommand(), memberAuthority())))
      .toMatchObject({ code: 'forbidden', reason: 'member-not-active' });
  });

  it('enforces the active member cap on rejoin without consuming authority history', () => {
    let state = createState();
    for (let index = 1; index < MAX_ROOM_MEMBERS; index += 1) {
      state = success(transitionArenaRoom(state, {
        ...joinMemberCommand(),
        member: {
          ...joinMemberCommand().member,
          userId: `member-${index}`,
          displayName: `Member ${index}`,
        },
      }, {
        kind: 'authenticated-user',
        actorUserId: `member-${index}`,
        accountUserId: 200 + index,
      })).nextState;
    }
    const leaverAuthority = { kind: 'authenticated-user' as const, actorUserId: 'member-1', accountUserId: 201 };
    const left = success(transitionArenaRoom(state, leaveMemberCommand(NEXT_TIMESTAMP), leaverAuthority)).nextState;
    const replacement = success(transitionArenaRoom(left, {
      ...joinMemberCommand(),
      member: { ...joinMemberCommand().member, userId: 'member-backfill' },
    }, {
      kind: 'authenticated-user',
      actorUserId: 'member-backfill',
      accountUserId: 999,
    })).nextState;
    const authoritySlots = replacement.memberAuthority.length;
    expect(failure(transitionArenaRoom(replacement, rejoinMemberCommand(), leaverAuthority)))
      .toMatchObject({ code: 'capability-denied', reason: 'member-limit-reached' });

    const freed = success(transitionArenaRoom(replacement, leaveMemberCommand('2026-08-27T16:03:00.000Z'), {
      kind: 'authenticated-user',
      actorUserId: 'member-backfill',
      accountUserId: 999,
    })).nextState;
    const rejoined = success(transitionArenaRoom(freed, rejoinMemberCommand(), leaverAuthority)).nextState;
    expect(rejoined.snapshot.members).toContainEqual(expect.objectContaining({ userId: 'member-1', membershipState: 'active' }));
    expect(rejoined.memberAuthority).toHaveLength(authoritySlots);
  });

  it('enforces the active member cap without counting revoked authority tombstones', () => {
    let state = createState();
    for (let index = 1; index < MAX_ROOM_MEMBERS; index += 1) {
      state = success(transitionArenaRoom(state, {
        ...joinMemberCommand(),
        member: {
          ...joinMemberCommand().member,
          userId: `member-${index}`,
          displayName: `Member ${index}`,
        },
      }, {
        kind: 'authenticated-user',
        actorUserId: `member-${index}`,
        accountUserId: 200 + index,
      })).nextState;
    }
    expect(state.snapshot.members).toHaveLength(MAX_ROOM_MEMBERS);
    expect(failure(transitionArenaRoom(state, {
      ...joinMemberCommand(),
      member: { ...joinMemberCommand().member, userId: 'member-overflow' },
    }, {
      kind: 'authenticated-user',
      actorUserId: 'member-overflow',
      accountUserId: 999,
    }))).toMatchObject({ code: 'capability-denied', reason: 'member-limit-reached' });
  });

  it('treats host leave as room close and makes repeated close idempotent', () => {
    const state = createState();
    const closed = success(transitionArenaRoom(state, {
      type: 'leave-member',
      expectedRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
    }, hostAuthority()));
    expect(closed.nextState.lifecycle).toMatchObject({
      status: 'closed',
      closedAt: NEXT_TIMESTAMP,
    });
    expect(closed.events[0]).toMatchObject({ type: 'room.closing' });

    const repeated = success(transitionArenaRoom(closed.nextState, {
      type: 'close',
      expectedRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
      reason: 'already closed',
    }, hostAuthority()));
    expect(repeated.kind).toBe('idempotent');
    expect(repeated.nextState).toEqual(closed.nextState);

    expect(failure(transitionArenaRoom(closed.nextState, joinMemberCommand(), memberAuthority()))).toMatchObject({
      code: 'room-closed',
      reason: 'room-closed',
    });
  });

  it('rejects old epochs and stale host publish revisions before deriving a next state', () => {
    const state = createState();
    expect(failure(transitionArenaRoom(state, {
      ...joinMemberCommand(),
      expectedRoomEpoch: 'epoch-old',
    }, memberAuthority()))).toMatchObject({ code: 'stale', reason: 'room-epoch-mismatch' });

    expect(failure(transitionArenaRoom(state, {
      type: 'publish-config',
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 9,
      expectedControlSeq: state.snapshot.controlSeq,
      sharedConfig: { ...baseConfig(), userGuidance: 'stale' },
      timestamp: NEXT_TIMESTAMP,
    }, hostAuthority()))).toMatchObject({ code: 'stale', reason: 'room-revision-mismatch' });
  });

  it('publishes only semantic config changes and rejects member authority', () => {
    const state = createState();
    const publishedConfig = { ...baseConfig(), userGuidance: '房主发布' };
    const published = success(transitionArenaRoom(state, {
      type: 'publish-config',
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      expectedControlSeq: state.snapshot.controlSeq,
      sharedConfig: publishedConfig,
      timestamp: NEXT_TIMESTAMP,
    }, hostAuthority()));
    expect(published.nextState.snapshot.revision).toBe(1);
    expect(published.nextState.snapshot.controlSeq).toBe(1);
    expect(published.events[0]).toMatchObject({
      type: 'room.config.updated',
      payload: { revision: 1, sharedConfig: publishedConfig },
    });

    const noChange = success(transitionArenaRoom(published.nextState, {
      type: 'publish-config',
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 1,
      expectedControlSeq: published.nextState.snapshot.controlSeq,
      sharedConfig: publishedConfig,
      timestamp: NEXT_TIMESTAMP,
    }, hostAuthority()));
    expect(noChange.kind).toBe('idempotent');

    const joined = success(transitionArenaRoom(state, joinMemberCommand(), memberAuthority())).nextState;
    expect(failure(transitionArenaRoom(joined, {
      type: 'publish-config',
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      expectedControlSeq: joined.snapshot.controlSeq,
      sharedConfig: publishedConfig,
      timestamp: NEXT_TIMESTAMP,
    }, memberAuthority()))).toMatchObject({ code: 'forbidden', reason: 'host-required' });
  });
});
