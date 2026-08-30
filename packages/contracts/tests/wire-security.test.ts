import {
  ArenaRoomSharedConfigSchema,
  HostLocalCombatantStubSchema,
  HostLocalMaterialStubSchema,
  HostLocalScenarioStubSchema,
} from '@mahoshojo/contracts/arena-room';

const onlineCharacter = {
  id: 'character-001',
  kind: 'character',
  versionToken: 'v1',
} as const;

describe('Arena Room allowlisted wire projection', () => {
  it('rejects full host-local payloads and provider credentials', () => {
    expect(() => HostLocalCombatantStubSchema.parse({
      key: 'host-local:c1',
      displayName: 'local',
      type: 'magical-girl',
      source: 'host-local',
      fullPayload: { secret: 'should-never-cross-room' },
    })).toThrow();

    expect(() => ArenaRoomSharedConfigSchema.parse({
      battleMode: 'classic',
      combatants: [{ key: 'data-card:character-001', ref: onlineCharacter }],
      teams: [],
      scenario: null,
      auxScenarios: [],
      materials: [],
      userGuidance: '',
      storyLength: 'default',
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
      userProviderConfig: { apiKey: 'secret' },
      streamingMarkdown: '# private',
      newsReport: { report: 'private' },
      updatedCombatants: [{ name: 'private' }],
    })).toThrow();
  });

  it('keeps scenario and material host-local stubs to display metadata plus guidance', () => {
    expect(HostLocalScenarioStubSchema.parse({
      key: 'host-local:s1',
      displayName: 'local scenario',
      type: 'scenario',
      source: 'host-local',
      guidance: '保持悬念',
    })).toMatchObject({ source: 'host-local' });
    expect(HostLocalMaterialStubSchema.parse({
      key: 'host-local:m1',
      displayName: 'local material',
      type: 'material',
      source: 'host-local',
      guidance: '只作为背景',
    })).toMatchObject({ source: 'host-local' });
  });
});
