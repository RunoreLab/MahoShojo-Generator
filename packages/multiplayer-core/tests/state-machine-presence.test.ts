import {
  issueArenaRoomDeadlineCloseAuthority,
  issueArenaRoomPresenceAuthority,
  issueArenaRoomRecoveryAuthority,
  transitionArenaRoom,
  type ArenaRoomTransitionResult,
} from '../src/index';
import {
  NEXT_TIMESTAMP,
  createRoomCommand,
  hostAuthority,
} from './state-machine-fixtures';

const HOST_DEADLINE = '2026-08-27T16:45:00.000Z';
const IDLE_DEADLINE = '2026-08-28T04:00:00.000Z';
const NEXT_HOST_DEADLINE = '2026-08-27T16:46:00.000Z';
const NEXT_IDLE_DEADLINE = '2026-08-28T04:01:00.000Z';

const success = (result: ArenaRoomTransitionResult) => {
  expect(result.ok, result.ok ? undefined : `${result.code}:${result.reason}`).toBe(true);
  if (!result.ok) throw new Error(`${result.code}:${result.reason}`);
  return result;
};

const failure = (result: ArenaRoomTransitionResult) => {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected failure');
  return result;
};

const createState = () => success(transitionArenaRoom(null, {
  ...createRoomCommand(),
  deadlines: {
    hostOfflineDeadline: HOST_DEADLINE,
    roomIdleDeadline: IDLE_DEADLINE,
  },
}, hostAuthority())).nextState;

describe('Arena Room durable presence deadlines', () => {
  it('由 server create capability 写入初始离线/idle deadline，且不进入 public snapshot', () => {
    const state = createState();

    expect(state.deadlines).toEqual({
      hostOfflineDeadline: HOST_DEADLINE,
      roomIdleDeadline: IDLE_DEADLINE,
    });
    expect(state.authorityStateVersion).toBe(2);
    expect(JSON.stringify(state.snapshot)).not.toContain('Deadline');
  });

  it('presence capability 原子清除/设置 deadline，connection 变化不修改 membership', () => {
    const initial = createState();
    const onlineDeadlines = {
      hostOfflineDeadline: null,
      roomIdleDeadline: null,
    } as const;
    const online = success(transitionArenaRoom(initial, {
      type: 'sync-presence',
      expectedRoomEpoch: 'epoch-1',
      deadlines: onlineDeadlines,
      timestamp: NEXT_TIMESTAMP,
    }, issueArenaRoomPresenceAuthority({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      deadlines: onlineDeadlines,
      timestamp: NEXT_TIMESTAMP,
    })));

    expect(online.nextState.deadlines).toEqual(onlineDeadlines);
    expect(online.nextState.memberAuthority).toEqual(initial.memberAuthority);
    expect(online.events).toEqual([
      expect.objectContaining({ type: 'room.host.online', controlSeq: 1 }),
    ]);

    const offlineDeadlines = {
      hostOfflineDeadline: NEXT_HOST_DEADLINE,
      roomIdleDeadline: NEXT_IDLE_DEADLINE,
    } as const;
    const offline = success(transitionArenaRoom(online.nextState, {
      type: 'sync-presence',
      expectedRoomEpoch: 'epoch-1',
      deadlines: offlineDeadlines,
      timestamp: '2026-08-27T16:01:30.000Z',
    }, issueArenaRoomPresenceAuthority({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      deadlines: offlineDeadlines,
      timestamp: '2026-08-27T16:01:30.000Z',
    })));

    expect(offline.events).toEqual([
      expect.objectContaining({ type: 'room.host.offline', controlSeq: 2 }),
    ]);
    expect(offline.nextState.snapshot.members).toEqual(initial.snapshot.members);
  });

  it('拒绝可序列化伪 capability、deadline 回退和 capability scope mismatch', () => {
    const state = createState();
    const deadlines = { hostOfflineDeadline: null, roomIdleDeadline: null } as const;
    const command = {
      type: 'sync-presence' as const,
      expectedRoomEpoch: 'epoch-1',
      deadlines,
      timestamp: NEXT_TIMESTAMP,
    };

    expect(failure(transitionArenaRoom(state, command, {
      kind: 'room-presence',
      scope: { roomId: 'room-1', roomEpoch: 'epoch-1', deadlines, timestamp: NEXT_TIMESTAMP },
    }))).toMatchObject({ code: 'forbidden', reason: 'invalid-authority-context' });

    expect(failure(transitionArenaRoom(state, command, issueArenaRoomPresenceAuthority({
      roomId: 'room-other',
      roomEpoch: 'epoch-1',
      deadlines,
      timestamp: NEXT_TIMESTAMP,
    })))).toMatchObject({ code: 'forbidden', reason: 'authority-scope-mismatch' });

    expect(failure(transitionArenaRoom(state, {
      ...command,
      timestamp: '2026-08-27T15:59:00.000Z',
    }, issueArenaRoomPresenceAuthority({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      deadlines,
      timestamp: '2026-08-27T15:59:00.000Z',
    })))).toMatchObject({ code: 'stale', reason: 'command-timestamp-regression' });
  });

  it('deadline closer 只在 exact current deadline 到期后关闭，重复 cleanup 由 terminal state 幂等吸收', () => {
    const state = createState();
    const authority = issueArenaRoomDeadlineCloseAuthority({
      roomId: 'room-1',
      roomEpoch: 'epoch-1',
      deadlineKind: 'host-offline',
      deadline: HOST_DEADLINE,
    });

    expect(failure(transitionArenaRoom(state, {
      type: 'close',
      expectedRoomEpoch: 'epoch-1',
      reason: 'host-offline-timeout',
      timestamp: '2026-08-27T16:44:59.999Z',
    }, authority))).toMatchObject({ code: 'stale', reason: 'deadline-not-reached' });

    const closed = success(transitionArenaRoom(state, {
      type: 'close',
      expectedRoomEpoch: 'epoch-1',
      reason: 'host-offline-timeout',
      timestamp: HOST_DEADLINE,
    }, authority));
    expect(closed.nextState.lifecycle).toMatchObject({
      status: 'closed',
      closeReason: 'host-offline-timeout',
    });

    const repeated = success(transitionArenaRoom(closed.nextState, {
      type: 'close',
      expectedRoomEpoch: 'epoch-1',
      reason: 'host-offline-timeout',
      timestamp: HOST_DEADLINE,
    }, authority));
    expect(repeated.kind).toBe('idempotent');
  });

  it('epoch recovery 保留既有 deadline，只为 crash 时仍为 online 的 null deadline 填入 fallback', () => {
    const state = createState();
    state.deadlines = { hostOfflineDeadline: null, roomIdleDeadline: IDLE_DEADLINE };
    const fallbackDeadlines = {
      hostOfflineDeadline: NEXT_HOST_DEADLINE,
      roomIdleDeadline: NEXT_IDLE_DEADLINE,
    } as const;
    const command = {
      type: 'recover' as const,
      expectedRoomEpoch: 'epoch-1',
      nextRoomEpoch: 'epoch-2',
      absentPresenceDeadlines: fallbackDeadlines,
      timestamp: NEXT_TIMESTAMP,
    };
    const recovered = success(transitionArenaRoom(state, command, issueArenaRoomRecoveryAuthority({
      roomId: 'room-1',
      previousRoomEpoch: 'epoch-1',
      nextRoomEpoch: 'epoch-2',
      absentPresenceDeadlines: fallbackDeadlines,
      timestamp: NEXT_TIMESTAMP,
    })));

    expect(recovered.nextState.deadlines).toEqual({
      hostOfflineDeadline: NEXT_HOST_DEADLINE,
      roomIdleDeadline: IDLE_DEADLINE,
    });
    expect(recovered.events).toEqual([
      expect.objectContaining({ type: 'room.snapshot', roomEpoch: 'epoch-2', controlSeq: 0 }),
    ]);
  });
});
