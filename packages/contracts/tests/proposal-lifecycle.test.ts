import {
  ArenaRoomSnapshotSchema,
  MAX_PENDING_PROPOSALS_PER_MEMBER,
  RoomEventSchema,
} from '@mahoshojo/contracts/arena-room';

const sharedConfig = {
  battleMode: 'classic',
  combatants: [{
    key: 'data-card:character-1',
    ref: { id: 'character-1', kind: 'character', versionToken: 'v1' },
  }],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'standard',
  customStoryLength: null,
  selectedLanguage: 'zh-CN',
  historySettings: {
    readArenaHistory: false,
    readArenaHistoryLimit: 3,
    isArenaHistoryUnlimited: false,
    writeArenaHistory: false,
    readCurrentState: false,
    writeCurrentState: false,
    readNarrativeHistory: false,
    readNarrativeHistoryLimit: 10,
    isNarrativeHistoryUnlimited: false,
    writeNarrativeHistory: false,
  },
} as const;

const proposal = (status: string, index = 1) => ({
  proposalVersion: 1,
  proposalId: `proposal-${index}`,
  roomId: 'room-1',
  authorUserId: 'member-1',
  baseRevision: 1,
  status,
  changes: [{
    changeId: `change-${index}`,
    type: 'setUserGuidance',
    value: `guide-${index}`,
    expectedBase: { kind: 'value', value: '' },
  }],
  createdAt: '2026-08-23T00:00:00.000Z',
});

const eventBase = {
  protocolVersion: 1,
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  controlSeq: 1,
  timestamp: '2026-08-23T00:00:00.000Z',
} as const;

const snapshot = (proposals: readonly unknown[]) => ({
  protocolVersion: 1,
  schemaVersion: 1,
  roomId: 'room-1',
  roomEpoch: 'epoch-1',
  controlSeq: 1,
  revision: 1,
  sharedConfig,
  members: [
    { userId: 'host-1', role: 'host', displayName: 'Host', membershipState: 'active' },
    { userId: 'member-1', role: 'member', displayName: 'Member', membershipState: 'active' },
  ],
  proposals,
  activeGeneration: null,
});

describe('Arena Proposal wire lifecycle', () => {
  it.each(['draft', 'partially_accepted', 'accepted', 'rejected', 'withdrawn', 'stale'])(
    'rejects %s in proposal.submitted',
    (status) => {
      expect(RoomEventSchema.safeParse({
        ...eventBase,
        type: 'proposal.submitted',
        payload: { proposal: proposal(status) },
      }).success).toBe(false);
    },
  );

  it('allows only terminal statuses in proposal.resolved', () => {
    for (const status of ['draft', 'submitted']) {
      expect(RoomEventSchema.safeParse({
        ...eventBase,
        type: 'proposal.resolved',
        payload: { proposalId: 'proposal-1', status },
      }).success).toBe(false);
    }
    for (const status of ['partially_accepted', 'accepted', 'rejected', 'withdrawn', 'stale']) {
      expect(RoomEventSchema.safeParse({
        ...eventBase,
        type: 'proposal.resolved',
        payload: { proposalId: 'proposal-1', status },
      }).success).toBe(true);
    }
  });

  it('keeps local drafts out of snapshots and counts only submitted proposals as pending', () => {
    expect(ArenaRoomSnapshotSchema.safeParse(snapshot([proposal('draft')])).success).toBe(false);

    const overQuotaTerminal = Array.from(
      { length: MAX_PENDING_PROPOSALS_PER_MEMBER + 1 },
      (_, index) => proposal('partially_accepted', index + 1),
    );
    const terminalResult = ArenaRoomSnapshotSchema.safeParse(snapshot(overQuotaTerminal));
    expect(
      terminalResult.success,
      terminalResult.success ? undefined : JSON.stringify(terminalResult.error.issues),
    ).toBe(true);

    const overQuotaSubmitted = Array.from(
      { length: MAX_PENDING_PROPOSALS_PER_MEMBER + 1 },
      (_, index) => proposal('submitted', index + 1),
    );
    expect(ArenaRoomSnapshotSchema.safeParse(snapshot(overQuotaSubmitted)).success).toBe(false);
  });
});
