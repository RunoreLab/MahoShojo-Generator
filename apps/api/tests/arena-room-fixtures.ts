import {
  transitionArenaRoom,
  type ArenaRoomAuthorityState,
  type ArenaRoomTransitionSuccess,
} from '@mahoshojo/multiplayer-core';

export const ARENA_ROOM_TEST_TIMESTAMP = '2026-08-28T00:00:00.000Z';
export const ARENA_ROOM_NEXT_TIMESTAMP = '2026-08-28T00:01:00.000Z';

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
