import {
  ArenaProposalChangeSchema,
  ArenaRoomSharedConfigSchema,
} from '@mahoshojo/contracts/arena-room';

const ref = (id: string, kind: 'character' | 'scenario' | 'material') => ({ id, kind, versionToken: 'v1' });

const historySettings = {
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
} as const;

const baseConfig = {
  battleMode: 'scenario',
  combatants: [{ key: 'data-card:c1', ref: ref('c1', 'character'), characterGuidance: 'guide' }],
  teams: [{ key: 'team:a', displayName: 'A', combatantKeys: ['data-card:c1'] }],
  scenario: { key: 'data-card:s1', ref: ref('s1', 'scenario') },
  auxScenarios: [{ key: 'preset:aux1', ref: ref('aux1', 'scenario') }],
  materials: [{ key: 'host-local:m1', displayName: 'M', type: 'material', source: 'host-local' }],
  userGuidance: '',
  storyLength: 'standard',
  customStoryLength: null,
  selectedLanguage: 'zh-CN',
  historySettings,
} as const;

describe('spec review B: typed refs and stable collection keys', () => {
  it('requires keyed wrappers for every config collection entry', () => {
    expect(ArenaRoomSharedConfigSchema.safeParse({
      ...baseConfig,
      combatants: [ref('c1', 'character')],
    }).success).toBe(false);
    expect(ArenaRoomSharedConfigSchema.safeParse({
      ...baseConfig,
      scenario: ref('s1', 'scenario'),
    }).success).toBe(false);
    expect(ArenaRoomSharedConfigSchema.safeParse({
      ...baseConfig,
      auxScenarios: [ref('s2', 'scenario')],
    }).success).toBe(false);
    expect(ArenaRoomSharedConfigSchema.safeParse({
      ...baseConfig,
      materials: [ref('m1', 'material')],
    }).success).toBe(false);
  });

  it('requires stable key namespaces and unique keys in each collection', () => {
    for (const field of ['combatants', 'auxScenarios', 'materials'] as const) {
      const entry = baseConfig[field][0];
      expect(ArenaRoomSharedConfigSchema.safeParse({ ...baseConfig, [field]: [{ ...entry, key: 'unstable-name' }] }).success).toBe(false);
      expect(ArenaRoomSharedConfigSchema.safeParse({ ...baseConfig, [field]: [entry, entry] }).success).toBe(false);
    }
    expect(ArenaRoomSharedConfigSchema.safeParse({ ...baseConfig, scenario: { ...baseConfig.scenario, key: 'scenario-title' } }).success).toBe(false);
    expect(ArenaRoomSharedConfigSchema.safeParse({ ...baseConfig, scenario: { ...baseConfig.scenario, key: 'preset:scenario' } }).success).toBe(false);
    expect(ArenaRoomSharedConfigSchema.safeParse({ ...baseConfig, scenario: { ...baseConfig.scenario, key: 'preset:s1' } }).success).toBe(true);
  });

  it('requires team combatant keys to exist and assigns a combatant to at most one team', () => {
    expect(ArenaRoomSharedConfigSchema.safeParse({
      ...baseConfig,
      teams: [{ key: 'team:a', displayName: 'A', combatantKeys: ['data-card:missing'] }],
    }).success).toBe(false);
    expect(ArenaRoomSharedConfigSchema.safeParse({
      ...baseConfig,
      teams: [
        { key: 'team:a', displayName: 'A', combatantKeys: ['data-card:c1'] },
        { key: 'team:b', displayName: 'B', combatantKeys: ['data-card:c1'] },
      ],
    }).success).toBe(false);
  });

  it('narrows add and remove Proposal refs to their target data-card kind', () => {
    expect(ArenaProposalChangeSchema.safeParse({
      changeId: 'add-scenario-as-character',
      type: 'addCombatant',
      ref: ref('s1', 'scenario'),
      expectedBase: { kind: 'absent' },
    }).success).toBe(false);
    expect(ArenaProposalChangeSchema.safeParse({
      changeId: 'add-material-as-scenario',
      type: 'addAuxScenario',
      ref: ref('m1', 'material'),
      expectedBase: { kind: 'absent' },
    }).success).toBe(false);
    expect(ArenaProposalChangeSchema.safeParse({
      changeId: 'add-character-as-material',
      type: 'addMaterial',
      ref: ref('c1', 'character'),
      expectedBase: { kind: 'absent' },
    }).success).toBe(false);
    expect(ArenaProposalChangeSchema.safeParse({
      changeId: 'remove-null',
      type: 'removeAuxScenario',
      scenarioKey: 'data-card:s1',
      expectedBase: { kind: 'present', ref: null },
    }).success).toBe(false);
    expect(ArenaProposalChangeSchema.safeParse({
      changeId: 'remove-material-from-scenario',
      type: 'removeAuxScenario',
      scenarioKey: 'data-card:s1',
      expectedBase: { kind: 'present', ref: ref('m1', 'material') },
    }).success).toBe(false);
    expect(ArenaProposalChangeSchema.safeParse({
      changeId: 'set-null-scenario',
      type: 'setScenario',
      ref: null,
      expectedBase: { kind: 'ref', ref: null },
    }).success).toBe(true);
  });
});
