import type { ArenaProposalChange } from '@mahoshojo/contracts/arena-room';

import {
  issueArenaRoomGenerationPublisherAuthority,
  issueArenaRoomGenerationReservationAuthority,
} from '../src/index';

export const TEST_TIMESTAMP = '2026-08-27T16:00:00.000Z';
export const NEXT_TIMESTAMP = '2026-08-27T16:01:00.000Z';

export const hostAuthority = () => ({
  kind: 'authenticated-user' as const,
  actorUserId: 'host-1',
  accountUserId: 101,
});

export const memberAuthority = () => ({
  kind: 'authenticated-user' as const,
  actorUserId: 'member-1',
  accountUserId: 202,
});

export const snapshotDigest = (request = 'request-1') => {
  const digit = [...request].reduce((sum, value) => sum + value.codePointAt(0)!, 0).toString(16).at(-1)!;
  return `sha256:${digit.repeat(64)}`;
};

export const generationReservationAuthority = (
  request = 'request-1',
  generation = 'generation-1',
  configRevision = 0,
  attempt = 1,
) => issueArenaRoomGenerationReservationAuthority({
  actorUserId: 'host-1',
  accountUserId: 101,
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  configRevision,
  generationRequestId: request,
  generationId: generation,
  attempt,
  snapshotDigest: snapshotDigest(request),
  expiresAt: '2026-08-27T16:30:00.000Z',
});

export const generationPublisherAuthority = (
  request = 'request-1',
  generation = 'generation-1',
  attempt = 1,
) => issueArenaRoomGenerationPublisherAuthority({
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  generationRequestId: request,
  generationId: generation,
  attempt,
  expiresAt: '2026-08-27T16:30:00.000Z',
});

export const historySettings = () => ({
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
});

export const baseConfig = () => ({
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
  historySettings: historySettings(),
});

export const createRoomCommand = () => ({
  type: 'create' as const,
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  host: {
    userId: 'host-1',
    role: 'host' as const,
    displayName: 'Host',
    membershipState: 'active' as const,
    joinedAt: TEST_TIMESTAMP,
  },
  sharedConfig: baseConfig(),
  timestamp: TEST_TIMESTAMP,
});

export const joinMemberCommand = () => ({
  type: 'join-member' as const,
  expectedRoomEpoch: 'epoch-1',
  member: {
    userId: 'member-1',
    role: 'member' as const,
    displayName: 'Member',
    membershipState: 'active' as const,
    joinedAt: NEXT_TIMESTAMP,
  },
  timestamp: NEXT_TIMESTAMP,
});

export const proposal = (
  changes: readonly ArenaProposalChange[],
  proposalId = 'proposal-1',
) => ({
  proposalVersion: 1 as const,
  proposalId,
  roomId: 'room-1',
  authorUserId: 'member-1',
  baseRevision: 0,
  status: 'submitted' as const,
  changes,
  createdAt: NEXT_TIMESTAMP,
});

export const guidanceChange = (value = '成员建议') => ({
  changeId: 'guidance-1',
  type: 'setUserGuidance' as const,
  value,
  expectedBase: { kind: 'value' as const, value: '' },
});
