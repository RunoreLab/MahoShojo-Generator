import {
  ArenaProposalChangeSchema,
  ArenaProposalSchema,
  MAX_PROPOSAL_CHANGES,
} from '@mahoshojo/contracts/arena-room';

const metadata = {
  changeId: 'change-1',
  expectedBase: { kind: 'absent' },
  dependsOn: [],
  atomicGroupId: 'group-1',
} as const;

const validChanges: readonly Record<string, unknown>[] = [
  { ...metadata, type: 'addCombatant', ref: { id: 'c1', kind: 'character', versionToken: 'v1' } },
  { changeId: 'change-2', type: 'removeCombatant', combatantKey: 'data-card:c1', expectedBase: { kind: 'present', ref: { id: 'c1', kind: 'character', versionToken: 'v1' } } },
  { changeId: 'change-3', type: 'setCharacterGuidance', combatantKey: 'data-card:c1', value: 'protect', expectedBase: { kind: 'value', value: null } },
  { changeId: 'change-4', type: 'assignTeam', combatantKey: 'data-card:c1', teamKey: 'team-a', expectedBase: { kind: 'value', value: null } },
  { changeId: 'change-5', type: 'setBattleMode', value: 'scenario', expectedBase: { kind: 'value', value: 'classic' } },
  { changeId: 'change-6', type: 'setScenario', ref: null, expectedBase: { kind: 'ref', ref: null } },
  { changeId: 'change-7', type: 'addAuxScenario', ref: { id: 's1', kind: 'scenario', versionToken: 'v1' }, expectedBase: { kind: 'absent' } },
  { changeId: 'change-8', type: 'removeAuxScenario', scenarioKey: 'data-card:s1', expectedBase: { kind: 'present', ref: { id: 's1', kind: 'scenario', versionToken: 'v1' } } },
  { changeId: 'change-9', type: 'addMaterial', ref: { id: 'm1', kind: 'material', versionToken: 'v1' }, expectedBase: { kind: 'absent' } },
  { changeId: 'change-10', type: 'removeMaterial', materialKey: 'data-card:m1', expectedBase: { kind: 'present', ref: { id: 'm1', kind: 'material', versionToken: 'v1' } } },
  { changeId: 'change-11', type: 'setUserGuidance', value: 'short', expectedBase: { kind: 'value', value: '' } },
  { changeId: 'change-12', type: 'setStoryLength', value: 'standard', customStoryLength: '900', expectedBase: { kind: 'value', value: { storyLength: 'default', customStoryLength: null } } },
  { changeId: 'change-13', type: 'setHistorySettings', value: { readArenaHistory: false, readArenaHistoryLimit: 3, isArenaHistoryUnlimited: false, writeArenaHistory: true, readCurrentState: true, writeCurrentState: true, readNarrativeHistory: false, readNarrativeHistoryLimit: 10, isNarrativeHistoryUnlimited: false, writeNarrativeHistory: false }, expectedBase: { kind: 'value', value: { readArenaHistory: true, readArenaHistoryLimit: 3, isArenaHistoryUnlimited: false, writeArenaHistory: true, readCurrentState: true, writeCurrentState: true, readNarrativeHistory: false, readNarrativeHistoryLimit: 10, isNarrativeHistoryUnlimited: false, writeNarrativeHistory: false } } },
];

describe('typed Arena Proposal changes', () => {
  it.each(validChanges)('accepts the typed %s change with an expectedBase precondition', (change) => {
    expect(ArenaProposalChangeSchema.parse(change)).toEqual(change);
  });

  it('rejects every change kind when expectedBase is missing', () => {
    for (const change of validChanges) {
      const withoutExpectedBase = { ...change };
      delete withoutExpectedBase.expectedBase;
      expect(ArenaProposalChangeSchema.safeParse(withoutExpectedBase).success).toBe(false);
    }
  });

  it('supports dependency and atomic-group metadata, and caps change count', () => {
    const change = {
      ...validChanges[0],
      dependsOn: ['change-previous'],
      atomicGroupId: 'atomic-1',
    };
    expect(ArenaProposalChangeSchema.parse(change)).toMatchObject({ dependsOn: ['change-previous'], atomicGroupId: 'atomic-1' });

    const tooManyChanges = Array.from({ length: MAX_PROPOSAL_CHANGES + 1 }, (_, index) => ({
      ...validChanges[0],
      changeId: `change-${index}`,
    }));
    expect(ArenaProposalSchema.safeParse({
      proposalVersion: 1,
      proposalId: 'proposal-1',
      roomId: 'room-1',
      authorUserId: 'user-1',
      baseRevision: 1,
      status: 'submitted',
      changes: tooManyChanges,
      createdAt: '2026-08-22T00:00:00.000Z',
    }).success).toBe(false);
  });
});
