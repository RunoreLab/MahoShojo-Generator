import {
  ArenaProposalChangeSchema,
  ArenaRoomSharedConfigSchema,
  SharedHistorySettingsSchema,
  StoryLengthSchema,
} from '@mahoshojo/contracts/arena-room';

const canonicalConfig = {
  battleMode: 'classic',
  combatants: [{
    key: 'data-card:character-001',
    ref: { id: 'character-001', kind: 'character', versionToken: 'v1' },
    characterGuidance: '保护队友',
  }],
  teams: [],
  scenario: null,
  auxScenarios: [],
  materials: [],
  userGuidance: '',
  storyLength: 'standard',
  customStoryLength: '900',
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
} as const;

describe('spec review A: canonical field names and scalar semantics', () => {
  it('keeps story length presets separate from an optional positive custom value', () => {
    expect(StoryLengthSchema.safeParse('custom').success).toBe(false);
    expect(ArenaRoomSharedConfigSchema.safeParse(canonicalConfig).success).toBe(true);
    expect(ArenaRoomSharedConfigSchema.safeParse({ ...canonicalConfig, customStoryLength: '0' }).success).toBe(false);
    expect(ArenaRoomSharedConfigSchema.safeParse({ ...canonicalConfig, customStoryLength: '01' }).success).toBe(false);
    expect(ArenaRoomSharedConfigSchema.safeParse({ ...canonicalConfig, customStoryLength: null }).success).toBe(true);
  });

  it('uses userGuidance and selectedLanguage as the only shared config names', () => {
    expect(ArenaRoomSharedConfigSchema.safeParse({ ...canonicalConfig, globalGuidance: '' }).success).toBe(false);
    expect(ArenaRoomSharedConfigSchema.safeParse({ ...canonicalConfig, language: 'zh-CN' }).success).toBe(false);
    expect(ArenaRoomSharedConfigSchema.safeParse({ ...canonicalConfig, userProviderConfig: { apiKey: 'secret' } }).success).toBe(false);
  });

  it('does not accept semantically duplicated guidance or team assignment maps', () => {
    expect(ArenaRoomSharedConfigSchema.safeParse({ ...canonicalConfig, teamAssignments: {} }).success).toBe(false);
    expect(ArenaRoomSharedConfigSchema.safeParse({ ...canonicalConfig, characterGuidance: {} }).success).toBe(false);
    expect(ArenaProposalChangeSchema.safeParse({
      changeId: 'change-1',
      type: 'setGlobalGuidance',
      value: 'no',
      expectedBase: { kind: 'value', value: '' },
    }).success).toBe(false);
    expect(ArenaProposalChangeSchema.safeParse({
      changeId: 'change-1',
      type: 'setUserGuidance',
      value: 'yes',
      expectedBase: { kind: 'value', value: '' },
    }).success).toBe(true);
  });

  it('requires both history unlimited flags in the shared settings object', () => {
    expect(SharedHistorySettingsSchema.safeParse(canonicalConfig.historySettings).success).toBe(true);
    const withoutArenaFlag = Object.fromEntries(
      Object.entries(canonicalConfig.historySettings).filter(([key]) => key !== 'isArenaHistoryUnlimited'),
    );
    expect(SharedHistorySettingsSchema.safeParse(withoutArenaFlag).success).toBe(false);
    const withoutNarrativeFlag = Object.fromEntries(
      Object.entries(canonicalConfig.historySettings).filter(([key]) => key !== 'isNarrativeHistoryUnlimited'),
    );
    expect(SharedHistorySettingsSchema.safeParse(withoutNarrativeFlag).success).toBe(false);
  });
});
