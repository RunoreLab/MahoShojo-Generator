import {
  issueArenaRoomRecoveryAuthority,
  transitionArenaRoom,
  type ArenaRoomAuthorityState,
  type ArenaRoomTransitionSuccess,
} from '@mahoshojo/multiplayer-core';
import type { ArenaDataCardRefVerifier } from '#/arena-room/arena-data-card-ref-verifier';

export const ARENA_ROOM_TEST_TIMESTAMP = '2026-08-28T00:00:00.000Z';
export const ARENA_ROOM_NEXT_TIMESTAMP = '2026-08-28T00:01:00.000Z';
export const ARENA_ROOM_TEST_DEADLINES = {
  hostOfflineDeadline: '2026-08-28T00:45:00.000Z',
  roomIdleDeadline: '2026-08-28T12:00:00.000Z',
} as const;

export const createTestArenaDataCardRefVerifier = (): ArenaDataCardRefVerifier => ({
  verify: async ({ refs }) => refs,
});

const sharedConfig = () => ({
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

const hostAuthority = {
  kind: 'authenticated-user' as const,
  actorUserId: 'host-1',
  accountUserId: 101,
};

const success = (result: ReturnType<typeof transitionArenaRoom>): ArenaRoomTransitionSuccess => {
  if (!result.ok) throw new Error(`${result.code}:${result.reason}`);
  return result;
};

export const createArenaRoomTransition = (
  roomEpoch = 'epoch-1',
): ArenaRoomTransitionSuccess => {
  const result = transitionArenaRoom(null, {
    type: 'create',
    roomId: 'room-1',
    roomEpoch,
    host: {
      userId: 'host-1',
      role: 'host',
      displayName: 'Host',
      membershipState: 'active',
      joinedAt: ARENA_ROOM_TEST_TIMESTAMP,
    },
    sharedConfig: sharedConfig(),
    deadlines: ARENA_ROOM_TEST_DEADLINES,
    timestamp: ARENA_ROOM_TEST_TIMESTAMP,
  }, hostAuthority);
  return success(result);
};

export const createArenaRoomState = (roomEpoch = 'epoch-1'): ArenaRoomAuthorityState => (
  createArenaRoomTransition(roomEpoch).nextState
);

export const publishArenaRoomTransition = (
  state: ArenaRoomAuthorityState,
): ArenaRoomTransitionSuccess => {
  const result = transitionArenaRoom(state, {
    type: 'publish-config',
    expectedRoomEpoch: state.snapshot.roomEpoch,
    expectedRevision: state.snapshot.revision,
    expectedControlSeq: state.snapshot.controlSeq,
    sharedConfig: { ...state.snapshot.sharedConfig, userGuidance: '已确认写入' },
    timestamp: ARENA_ROOM_NEXT_TIMESTAMP,
  }, hostAuthority);
  return success(result);
};

export const publishArenaRoomState = (
  state: ArenaRoomAuthorityState,
): ArenaRoomAuthorityState => publishArenaRoomTransition(state).nextState;

export const closeArenaRoomTransition = (
  state: ArenaRoomAuthorityState,
): ArenaRoomTransitionSuccess => {
  const result = transitionArenaRoom(state, {
    type: 'close',
    expectedRoomEpoch: state.snapshot.roomEpoch,
    reason: 'test-close',
    timestamp: ARENA_ROOM_NEXT_TIMESTAMP,
  }, hostAuthority);
  return success(result);
};

export const closeArenaRoomState = (
  state: ArenaRoomAuthorityState,
): ArenaRoomAuthorityState => closeArenaRoomTransition(state).nextState;

export const recoverArenaRoomTransition = (
  state: ArenaRoomAuthorityState,
  nextRoomEpoch = 'epoch-2',
): ArenaRoomTransitionSuccess => {
  const timestamp = ARENA_ROOM_NEXT_TIMESTAMP;
  const absentPresenceDeadlines = {
    hostOfflineDeadline: '2026-08-28T00:46:00.000Z',
    roomIdleDeadline: '2026-08-28T12:01:00.000Z',
  } as const;
  const result = transitionArenaRoom(state, {
    type: 'recover',
    expectedRoomEpoch: state.snapshot.roomEpoch,
    nextRoomEpoch,
    absentPresenceDeadlines,
    timestamp,
  }, issueArenaRoomRecoveryAuthority({
    roomId: state.snapshot.roomId,
    previousRoomEpoch: state.snapshot.roomEpoch,
    nextRoomEpoch,
    absentPresenceDeadlines,
    timestamp,
  }));
  return success(result);
};
