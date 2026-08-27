import { RoomEventSchema } from '@mahoshojo/contracts/arena-room';

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
  joinMemberCommand,
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
  transitionArenaRoom(null, createRoomCommand()),
).nextState;

describe('Arena Room runtime-neutral lifecycle transitions', () => {
  it('creates an open room with one active host and an explicit null predecessor', () => {
    const command = createRoomCommand();
    const result = success(transitionArenaRoom(null, command));

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
    expect(failure(transitionArenaRoom(state, createRoomCommand()))).toMatchObject({
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
    });
    expect(failure(invalid)).toMatchObject({ code: 'validation-failed', reason: 'invalid-command' });
    expect(JSON.stringify(invalid)).not.toContain(secret);
  });

  it('returns the exact current checkpoint predecessor and never mutates the input state', () => {
    const state = createState();
    const before = structuredClone(state);
    const result = success(transitionArenaRoom(state, joinMemberCommand()));

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
    const joined = success(transitionArenaRoom(createState(), joinMemberCommand())).nextState;
    const duplicate = success(transitionArenaRoom(joined, joinMemberCommand()));
    expect(duplicate.kind).toBe('idempotent');
    expect(duplicate.events).toEqual([]);

    const forbiddenKick = failure(transitionArenaRoom(joined, {
      type: 'kick-member',
      actorUserId: 'member-1',
      targetUserId: 'host-1',
      expectedRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
    }));
    expect(forbiddenKick).toMatchObject({ code: 'forbidden', reason: 'host-required' });

    const left = success(transitionArenaRoom(joined, {
      type: 'leave-member',
      actorUserId: 'member-1',
      expectedRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
    }));
    expect(left.nextState.snapshot.members).toContainEqual(expect.objectContaining({
      userId: 'member-1',
      membershipState: 'revoked',
    }));
    expect(left.events[0]).toMatchObject({ type: 'room.member.left' });
    expect(JSON.stringify(left.nextState)).not.toContain('connectionId');
  });

  it('treats host leave as room close and makes repeated close idempotent', () => {
    const state = createState();
    const closed = success(transitionArenaRoom(state, {
      type: 'leave-member',
      actorUserId: 'host-1',
      expectedRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
    }));
    expect(closed.nextState.lifecycle).toMatchObject({
      status: 'closed',
      closedAt: NEXT_TIMESTAMP,
    });
    expect(closed.events[0]).toMatchObject({ type: 'room.closing' });

    const repeated = success(transitionArenaRoom(closed.nextState, {
      type: 'close',
      actorUserId: 'host-1',
      expectedRoomEpoch: 'epoch-1',
      timestamp: NEXT_TIMESTAMP,
      reason: 'already closed',
    }));
    expect(repeated.kind).toBe('idempotent');
    expect(repeated.nextState).toEqual(closed.nextState);

    expect(failure(transitionArenaRoom(closed.nextState, joinMemberCommand()))).toMatchObject({
      code: 'room-closed',
      reason: 'room-closed',
    });
  });

  it('rejects old epochs and stale host publish revisions before deriving a next state', () => {
    const state = createState();
    expect(failure(transitionArenaRoom(state, {
      ...joinMemberCommand(),
      expectedRoomEpoch: 'epoch-old',
    }))).toMatchObject({ code: 'stale', reason: 'room-epoch-mismatch' });

    expect(failure(transitionArenaRoom(state, {
      type: 'publish-config',
      actorUserId: 'host-1',
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 9,
      sharedConfig: { ...baseConfig(), userGuidance: 'stale' },
      timestamp: NEXT_TIMESTAMP,
    }))).toMatchObject({ code: 'stale', reason: 'room-revision-mismatch' });
  });

  it('publishes only semantic config changes and rejects member authority', () => {
    const state = createState();
    const publishedConfig = { ...baseConfig(), userGuidance: '房主发布' };
    const published = success(transitionArenaRoom(state, {
      type: 'publish-config',
      actorUserId: 'host-1',
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      sharedConfig: publishedConfig,
      timestamp: NEXT_TIMESTAMP,
    }));
    expect(published.nextState.snapshot.revision).toBe(1);
    expect(published.nextState.snapshot.controlSeq).toBe(1);
    expect(published.events[0]).toMatchObject({
      type: 'room.config.updated',
      payload: { revision: 1, sharedConfig: publishedConfig },
    });

    const noChange = success(transitionArenaRoom(published.nextState, {
      type: 'publish-config',
      actorUserId: 'host-1',
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 1,
      sharedConfig: publishedConfig,
      timestamp: NEXT_TIMESTAMP,
    }));
    expect(noChange.kind).toBe('idempotent');

    const joined = success(transitionArenaRoom(state, joinMemberCommand())).nextState;
    expect(failure(transitionArenaRoom(joined, {
      type: 'publish-config',
      actorUserId: 'member-1',
      expectedRoomEpoch: 'epoch-1',
      expectedRevision: 0,
      sharedConfig: publishedConfig,
      timestamp: NEXT_TIMESTAMP,
    }))).toMatchObject({ code: 'forbidden', reason: 'host-required' });
  });
});
