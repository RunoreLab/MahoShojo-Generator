import {
  ArenaProposalSchema,
  ArenaRoomSnapshotSchema,
  type ArenaProposal,
  type ArenaRoomSnapshot,
} from '@mahoshojo/contracts/arena-room';

class InMemoryRoomContractHarness {
  private snapshot: ArenaRoomSnapshot;

  public constructor(snapshot: unknown) {
    this.snapshot = ArenaRoomSnapshotSchema.parse(snapshot);
  }

  public submitProposal(proposal: unknown): ArenaProposal {
    const parsed = ArenaProposalSchema.parse(proposal);
    this.snapshot = { ...this.snapshot, proposals: [...this.snapshot.proposals, parsed] };
    return parsed;
  }

  public readSnapshot(): ArenaRoomSnapshot {
    return ArenaRoomSnapshotSchema.parse(this.snapshot);
  }
}

describe('in-memory wire contract harness', () => {
  it('round-trips a proposal through a snapshot without runtime dependencies', async () => {
    const fixture = await import('./fixtures/arena-room-v1.json');
    const harness = new InMemoryRoomContractHarness({ ...fixture.default, proposals: [] });
    const proposal = harness.submitProposal({
      proposalVersion: 1,
      proposalId: 'proposal-1',
      roomId: fixture.default.roomId,
      authorUserId: 'user-member',
      baseRevision: fixture.default.revision,
      status: 'submitted',
      createdAt: '2026-08-22T00:00:00.000Z',
      changes: [{
        changeId: 'change-1',
        type: 'setUserGuidance',
        value: 'focus',
        expectedBase: { kind: 'value', value: fixture.default.sharedConfig.userGuidance },
      }],
    });
    expect(harness.readSnapshot().proposals).toEqual([proposal]);
  });
});
