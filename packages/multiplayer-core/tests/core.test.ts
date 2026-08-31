import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  applyArenaProposal,
  applyArenaRoomSharedConfig,
  buildArenaRoomSharedConfig,
  detectProposalConflicts,
  diffArenaSharedConfig,
  validateProposalChanges,
  type ArenaRoomNormalizedSource,
} from '../src/index';

const historySettings = () => ({
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

const ref = (id: string, kind: 'character' | 'scenario' | 'material', versionToken = 'v1') => ({
  id,
  kind,
  versionToken,
});

const online = (id: string, kind: 'character' | 'scenario' | 'material', versionToken = 'v1') => ({
  key: `data-card:${id}`,
  ref: ref(id, kind, versionToken),
});

const baseConfig = () => ({
  battleMode: 'classic' as const,
  combatants: [
    { ...online('c1', 'character'), characterGuidance: '保护队友' },
    online('c2', 'character'),
  ],
  teams: [
    { key: 'team:a', displayName: 'A', combatantKeys: ['data-card:c1'] },
    { key: 'team:b', displayName: 'B', combatantKeys: [] },
  ],
  scenario: online('s1', 'scenario'),
  auxScenarios: [online('aux-keep', 'scenario'), online('aux-remove', 'scenario')],
  materials: [online('mat-keep', 'material'), online('mat-remove', 'material')],
  userGuidance: '',
  storyLength: 'standard' as const,
  customStoryLength: null,
  selectedLanguage: 'zh-CN',
  historySettings: historySettings(),
});

const makeProposal = (changes: readonly unknown[], proposalId = 'proposal-matrix') => ({
  proposalVersion: 1,
  proposalId,
  roomId: 'room-1',
  authorUserId: 'user-1',
  baseRevision: 7,
  status: 'submitted' as const,
  changes,
  createdAt: '2026-08-23T00:00:00.000Z',
});

const proposalState = (config: unknown, revision: number) => ({ roomId: 'room-1', config, revision });

const callApplyWithLegacyArgs = (...values: unknown[]): unknown => Reflect.apply(
  applyArenaProposal as CallableFunction,
  undefined,
  values,
);

const fixturePath = fileURLToPath(new URL('../../contracts/tests/fixtures/arena-room-v1.json', import.meta.url));

describe('Arena shared config projection and working copy', () => {
  it('documents the normalized projection boundary and rejects a legacy BattleStore-shaped source', () => {
    const normalized: ArenaRoomNormalizedSource = baseConfig();
    expect(buildArenaRoomSharedConfig(normalized)).toEqual(baseConfig());
    const legacySource = {
      battleMode: 'classic',
      selectedCharacters: [{ id: 'c1', data: { secret: 'private' } }],
      selectedScenario: { id: 's1', content: { private: true } },
      userProviderConfig: { apiKey: 'secret' },
      streamingMarkdown: 'legacy runtime state',
    };
    expect(() => buildArenaRoomSharedConfig(legacySource as unknown as ArenaRoomNormalizedSource)).toThrow();
  });

  it('copies only allowlisted fields and strips sensitive nested payloads', () => {
    const source = {
      ...baseConfig(),
      provider: 'openai',
      userProviderConfig: { apiKey: 'provider-secret' },
      streamingMarkdown: 'private report',
      combatants: [
        {
          ...online('c1', 'character'),
          characterGuidance: 'guidance',
          ref: { ...ref('c1', 'character'), data: { secret: 'nested' }, payload: 'private' },
          content: { secret: 'private' },
        },
        {
          key: 'host-local:c2',
          displayName: '本地角色',
          type: 'magical-girl',
          source: 'host-local',
          characterGuidance: '谨慎',
          data: { fullPayload: 'private' },
          provider: { apiKey: 'private' },
        },
      ],
      scenario: {
        key: 'host-local:s1',
        displayName: '本地情景',
        type: 'scenario',
        source: 'host-local',
        guidance: '保持悬念',
        payload: { full: 'private' },
      },
      materials: [{
        key: 'host-local:m1',
        displayName: '本地素材',
        type: 'material',
        source: 'host-local',
        guidance: '只作背景',
        content: { full: 'private' },
      }],
      extraTopLevel: 'private',
    };

    const projected = buildArenaRoomSharedConfig(source as unknown as ArenaRoomNormalizedSource);

    expect(projected).toEqual({
      ...baseConfig(),
      combatants: [
        { ...online('c1', 'character'), characterGuidance: 'guidance' },
        {
          key: 'host-local:c2',
          displayName: '本地角色',
          type: 'magical-girl',
          source: 'host-local',
          characterGuidance: '谨慎',
        },
      ],
      scenario: {
        key: 'host-local:s1',
        displayName: '本地情景',
        type: 'scenario',
        source: 'host-local',
        guidance: '保持悬念',
      },
      materials: [{
        key: 'host-local:m1',
        displayName: '本地素材',
        type: 'material',
        source: 'host-local',
        guidance: '只作背景',
      }],
    });
    expect(JSON.stringify(projected)).not.toContain('private');
  });

  it('parses a wire config and returns an independently mutable working copy', () => {
    const input = baseConfig();
    const working = applyArenaRoomSharedConfig(input);

    expect(working).toEqual(input);
    expect(working).not.toBe(input);
    expect(working.combatants).not.toBe(input.combatants);
    expect(working.combatants[0]).not.toBe(input.combatants[0]);
    expect(working.historySettings).not.toBe(input.historySettings);

    (working.combatants[0] as { ref: { versionToken: string } }).ref.versionToken = 'working-version';
    working.teams[0].combatantKeys.push('data-card:c2');
    working.historySettings.readArenaHistoryLimit = 9;
    expect(input.combatants[0].ref.versionToken).toBe('v1');
    expect(input.teams[0].combatantKeys).toEqual(['data-card:c1']);
    expect(input.historySettings.readArenaHistoryLimit).toBe(3);
  });
});

describe('Arena shared config diff', () => {
  it('returns no changes for an equal config and deterministic typed changes for every supported target', () => {
    const base = baseConfig();
    expect(diffArenaSharedConfig(base, base)).toEqual([]);

    const working = {
      ...base,
      combatants: [
        { ...online('c1', 'character'), characterGuidance: '新的引导' },
        { ...online('c3', 'character'), characterGuidance: '新角色引导' },
      ],
      teams: [
        { key: 'team:a', displayName: 'A', combatantKeys: ['data-card:c3'] },
        { key: 'team:b', displayName: 'B', combatantKeys: ['data-card:c1'] },
      ],
      battleMode: 'scenario' as const,
      scenario: online('s2', 'scenario'),
      auxScenarios: [online('aux-keep', 'scenario'), online('aux-add', 'scenario')],
      materials: [online('mat-keep', 'material'), online('mat-add', 'material')],
      userGuidance: '全局引导',
      storyLength: 'long' as const,
      customStoryLength: '1200',
      historySettings: { ...base.historySettings, readCurrentState: false },
    };

    const changes = diffArenaSharedConfig(base, working);
    expect(changes).toEqual(diffArenaSharedConfig(base, working));
    expect(changes.map((change) => change.type)).toEqual([
      'addCombatant',
      'removeCombatant',
      'setCharacterGuidance',
      'setCharacterGuidance',
      'assignTeam',
      'assignTeam',
      'setBattleMode',
      'setScenario',
      'addAuxScenario',
      'removeAuxScenario',
      'addMaterial',
      'removeMaterial',
      'setUserGuidance',
      'setStoryLength',
      'setHistorySettings',
    ]);
    expect(changes[0]).toMatchObject({
      type: 'addCombatant',
      ref: ref('c3', 'character'),
      expectedBase: { kind: 'absent' },
    });
    expect(changes[2]).toMatchObject({
      type: 'setCharacterGuidance',
      combatantKey: 'data-card:c1',
      value: '新的引导',
      expectedBase: { kind: 'value', value: '保护队友' },
    });
    expect(changes[4]).toMatchObject({
      type: 'assignTeam',
      combatantKey: 'data-card:c1',
      teamKey: 'team:b',
      expectedBase: { kind: 'value', value: 'team:a' },
    });
    expect(changes[7]).toMatchObject({
      type: 'setScenario',
      ref: ref('s2', 'scenario'),
      expectedBase: { kind: 'ref', ref: ref('s1', 'scenario') },
    });
    expect(changes[13]).toMatchObject({
      type: 'setStoryLength',
      value: 'long',
      customStoryLength: '1200',
      expectedBase: { kind: 'value', value: { storyLength: 'standard', customStoryLength: null } },
    });

    const expectedByType = new Map(changes.map((change) => [change.type, change]));
    expect(expectedByType.get('addCombatant')).toMatchObject({ expectedBase: { kind: 'absent' } });
    expect(expectedByType.get('removeCombatant')).toMatchObject({
      expectedBase: { kind: 'present', ref: ref('c2', 'character') },
    });
    expect(expectedByType.get('setCharacterGuidance')).toEqual(expect.objectContaining({
      expectedBase: expect.objectContaining({ kind: 'value' }),
    }));
    expect(changes.filter((change) => change.type === 'setCharacterGuidance')).toEqual(expect.arrayContaining([
      expect.objectContaining({ combatantKey: 'data-card:c1', expectedBase: { kind: 'value', value: '保护队友' } }),
      expect.objectContaining({ combatantKey: 'data-card:c3', expectedBase: { kind: 'value', value: null } }),
    ]));
    expect(expectedByType.get('assignTeam')).toEqual(expect.objectContaining({
      expectedBase: expect.objectContaining({ kind: 'value' }),
    }));
    expect(expectedByType.get('setBattleMode')).toMatchObject({ expectedBase: { kind: 'value', value: 'classic' } });
    expect(expectedByType.get('setScenario')).toMatchObject({
      expectedBase: { kind: 'ref', ref: ref('s1', 'scenario') },
    });
    expect(expectedByType.get('addAuxScenario')).toMatchObject({ expectedBase: { kind: 'absent' } });
    expect(expectedByType.get('removeAuxScenario')).toMatchObject({
      expectedBase: { kind: 'present', ref: ref('aux-remove', 'scenario') },
    });
    expect(expectedByType.get('addMaterial')).toMatchObject({ expectedBase: { kind: 'absent' } });
    expect(expectedByType.get('removeMaterial')).toMatchObject({
      expectedBase: { kind: 'present', ref: ref('mat-remove', 'material') },
    });
    expect(expectedByType.get('setUserGuidance')).toMatchObject({ expectedBase: { kind: 'value', value: '' } });
    expect(expectedByType.get('setStoryLength')).toMatchObject({
      expectedBase: { kind: 'value', value: { storyLength: 'standard', customStoryLength: null } },
    });
    expect(expectedByType.get('setHistorySettings')).toMatchObject({
      expectedBase: { kind: 'value', value: base.historySettings },
    });

    expect(diffArenaSharedConfig(base, { ...base, scenario: null })[0]).toMatchObject({
      type: 'setScenario',
      ref: null,
      expectedBase: { kind: 'ref', ref: ref('s1', 'scenario') },
    });
    expect(diffArenaSharedConfig({ ...base, scenario: null }, base)[0]).toMatchObject({
      type: 'setScenario',
      ref: ref('s1', 'scenario'),
      expectedBase: { kind: 'ref', ref: null },
    });
  });

  it('supports team rename/language while failing closed for array reorder, preset additions, and host-local additions', () => {
    const base = baseConfig();
    expect(() => diffArenaSharedConfig(base, {
      ...base,
      teams: [{ ...base.teams[1] }, { ...base.teams[0] }],
    })).toThrowError(/array reorder|reorder/i);
    expect(diffArenaSharedConfig(base, {
      ...base,
      teams: [{ ...base.teams[0], displayName: 'renamed' }, base.teams[1]],
    })).toEqual([expect.objectContaining({ type: 'renameTeam', teamKey: 'team:a', value: 'renamed' })]);
    expect(diffArenaSharedConfig(base, {
      ...base,
      selectedLanguage: 'en-US',
    })).toEqual([expect.objectContaining({ type: 'setSelectedLanguage', value: 'en-US' })]);
    expect(() => diffArenaSharedConfig(base, {
      ...base,
      combatants: [...base.combatants, { key: 'preset:c3', ref: ref('c3', 'character') }],
    })).toThrowError(/data-card|preset|represent/i);
    expect(() => diffArenaSharedConfig(base, {
      ...base,
      materials: [...base.materials, {
        key: 'host-local:m3',
        displayName: '本地素材',
        type: 'material',
        source: 'host-local',
      }],
    })).toThrowError(/host-local|represent/i);
  });

  it('fails closed when a collection insertion is not the append position reproducible by apply', () => {
    const base = baseConfig();
    expect(() => diffArenaSharedConfig(base, {
      ...base,
      combatants: [base.combatants[0], online('c3', 'character'), base.combatants[1]],
    })).toThrowError(/order|reorder|append/i);
    expect(() => diffArenaSharedConfig(base, {
      ...base,
      auxScenarios: [base.auxScenarios[0], online('aux-middle', 'scenario'), base.auxScenarios[1]],
    })).toThrowError(/order|reorder|append/i);
    expect(() => diffArenaSharedConfig(base, {
      ...base,
      materials: [base.materials[0], online('mat-middle', 'material'), base.materials[1]],
    })).toThrowError(/order|reorder|append/i);
  });

  it('fails closed when team assignment append semantics cannot reproduce the working order', () => {
    const base = baseConfig();
    expect(() => diffArenaSharedConfig(base, {
      ...base,
      combatants: [...base.combatants, online('c3', 'character')],
      teams: [
        { key: 'team:a', displayName: 'A', combatantKeys: ['data-card:c3', 'data-card:c1'] },
        { key: 'team:b', displayName: 'B', combatantKeys: [] },
      ],
    })).toThrowError(/order|reorder|append/i);
  });
});

describe('proposal selection and conflicts', () => {
  it('returns structured dependency and atomic-group selection problems', () => {
    const changes = [
      {
        changeId: 'add',
        type: 'addCombatant' as const,
        ref: ref('c3', 'character'),
        expectedBase: { kind: 'absent' as const },
        atomicGroupId: 'role',
      },
      {
        changeId: 'guide',
        type: 'setCharacterGuidance' as const,
        combatantKey: 'data-card:c3',
        value: 'guide',
        expectedBase: { kind: 'value' as const, value: null },
        dependsOn: ['add'],
        atomicGroupId: 'role',
      },
      {
        changeId: 'mode',
        type: 'setBattleMode' as const,
        value: 'scenario' as const,
        expectedBase: { kind: 'value' as const, value: 'classic' as const },
      },
    ];

    const dependency = validateProposalChanges(changes, ['guide']);
    expect(dependency.valid).toBe(false);
    expect(dependency.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'dependency-not-selected', changeId: 'guide', dependencyId: 'add' }),
    ]));

    const atomic = validateProposalChanges(changes, ['add']);
    expect(atomic.valid).toBe(false);
    expect(atomic.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'atomic-group-partial', atomicGroupId: 'role' }),
    ]));

    expect(validateProposalChanges(changes, ['add', 'guide']).valid).toBe(true);
    const emptySelection = validateProposalChanges(changes, []);
    expect(emptySelection.valid).toBe(false);
    expect(emptySelection.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'empty-selection' }),
    ]));

    const duplicateDependency = validateProposalChanges([
      changes[0],
      { ...changes[1], dependsOn: ['add', 'add'] },
    ], ['add', 'guide']);
    expect(duplicateDependency.valid).toBe(false);
    expect(duplicateDependency.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate-dependency', changeId: 'guide', dependencyId: 'add' }),
    ]));
  });

  it('distinguishes stale value preconditions from online reference version drift', () => {
    const base = baseConfig();
    const changes = diffArenaSharedConfig(base, {
      ...base,
      combatants: [base.combatants[1]],
      teams: [
        { key: 'team:a', displayName: 'A', combatantKeys: [] },
        { key: 'team:b', displayName: 'B', combatantKeys: [] },
      ],
      scenario: online('s2', 'scenario'),
      userGuidance: '成员引导',
    });
    const current = {
      ...base,
      combatants: [{ ...online('c1', 'character', 'v2'), characterGuidance: '房主引导' }, base.combatants[1]],
      userGuidance: '房主全局引导',
    };
    const conflicts = detectProposalConflicts(current, changes);

    expect(conflicts.find((conflict) => conflict.target === 'combatant:data-card:c1')).toMatchObject({ code: 'reference-changed' });
    expect(conflicts.find((conflict) => conflict.target === 'userGuidance')).toMatchObject({ code: 'precondition-failed' });
  });
});

describe('proposal application', () => {
  it('rejects proposals from another room without changing state', () => {
    const current = baseConfig();
    const crossRoomProposal = {
      ...makeProposal([{
        changeId: 'guidance',
        type: 'setUserGuidance' as const,
        value: 'must not cross rooms',
        expectedBase: { kind: 'value' as const, value: '' },
      }], 'proposal-cross-room'),
      roomId: 'room-2',
    };

    const result = applyArenaProposal(proposalState(current, 2), crossRoomProposal);

    expect(result).toMatchObject({ status: 'rejected', revision: 2, config: current });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'proposal-room-mismatch' }));
    expect(() => applyArenaProposal({ roomId: '', config: current, revision: 2 }, makeProposal([]))).toThrowError(
      expect.objectContaining({ code: 'invalid-input' }),
    );
  });

  it('accepts only the state/proposal API and rejects legacy positional compatibility forms', () => {
    const current = baseConfig();
    const proposal = makeProposal([{
      changeId: 'guidance',
      type: 'setUserGuidance' as const,
      value: 'state api',
      expectedBase: { kind: 'value' as const, value: '' },
    }], 'proposal-api');
    const accepted = applyArenaProposal(proposalState(current, 2), proposal);

    expect(accepted.status).toBe('accepted');
    expect(() => callApplyWithLegacyArgs(current, 2, proposal)).toThrowError(
      expect.objectContaining({ code: 'invalid-input' }),
    );
    expect(() => callApplyWithLegacyArgs(current, proposal)).toThrowError(
      expect.objectContaining({ code: 'invalid-input' }),
    );
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative', -1],
    ['fractional', 1.5],
  ])('rejects invalid state revision: %s', (_label, revision) => {
    const proposal = makeProposal([{
      changeId: 'guidance',
      type: 'setUserGuidance' as const,
      value: 'must not apply',
      expectedBase: { kind: 'value' as const, value: '' },
    }], `proposal-invalid-${_label}`);

    expect(() => applyArenaProposal(proposalState(baseConfig(), revision), proposal)).toThrowError(
      expect.objectContaining({ code: 'invalid-input' }),
    );
  });

  it('reports malformed proposal as a structured invalid-proposal issue', () => {
    const current = baseConfig();
    const result = applyArenaProposal(proposalState(current, 3), {
      ...makeProposal([{ changeId: 'bad', type: 'setBattleMode', value: 'invalid' }], 'proposal-invalid'),
    });

    expect(result.status).toBe('rejected');
    expect(result.revision).toBe(3);
    expect(result.config).toEqual(current);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid-proposal' }),
    ]));
  });

  it.each(['draft', 'stale'] as const)('reports non-submitted proposal status %s structurally', (status) => {
    const current = baseConfig();
    const result = applyArenaProposal(proposalState(current, 3), {
      ...makeProposal([{
        changeId: 'guidance',
        type: 'setUserGuidance' as const,
        value: 'must not apply',
        expectedBase: { kind: 'value' as const, value: '' },
      }], `proposal-${status}`),
      status,
    });

    expect(result.status).toBe('rejected');
    expect(result.revision).toBe(3);
    expect(result.config).toEqual(current);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid-proposal-status' }),
    ]));
  });

  it('reports an explicitly empty selection as a structured issue', () => {
    const current = baseConfig();
    const result = applyArenaProposal(proposalState(current, 3), makeProposal([{
      changeId: 'guidance',
      type: 'setUserGuidance' as const,
      value: 'must not apply',
      expectedBase: { kind: 'value' as const, value: '' },
    }], 'proposal-empty-selection'), []);

    expect(result.status).toBe('rejected');
    expect(result.revision).toBe(3);
    expect(result.config).toEqual(current);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'empty-selection' }),
    ]));
  });

  it('applies scenario, auxiliary/material add-remove, and combatant removal with team cleanup', () => {
    const current = baseConfig();
    const changes = [
      {
        changeId: 'scenario-null',
        type: 'setScenario' as const,
        ref: null,
        expectedBase: { kind: 'ref' as const, ref: ref('s1', 'scenario') },
      },
      {
        changeId: 'aux-add',
        type: 'addAuxScenario' as const,
        ref: ref('aux-add', 'scenario'),
        expectedBase: { kind: 'absent' as const },
      },
      {
        changeId: 'aux-remove',
        type: 'removeAuxScenario' as const,
        scenarioKey: 'data-card:aux-remove',
        expectedBase: { kind: 'present' as const, ref: ref('aux-remove', 'scenario') },
      },
      {
        changeId: 'material-add',
        type: 'addMaterial' as const,
        ref: ref('mat-add', 'material'),
        expectedBase: { kind: 'absent' as const },
      },
      {
        changeId: 'material-remove',
        type: 'removeMaterial' as const,
        materialKey: 'data-card:mat-remove',
        expectedBase: { kind: 'present' as const, ref: ref('mat-remove', 'material') },
      },
      {
        changeId: 'combatant-remove',
        type: 'removeCombatant' as const,
        combatantKey: 'data-card:c1',
        expectedBase: { kind: 'present' as const, ref: ref('c1', 'character') },
      },
    ];
    const result = applyArenaProposal(proposalState(current, 4), makeProposal(changes));

    expect(result.status).toBe('accepted');
    expect(result.revision).toBe(5);
    expect(result.config.scenario).toBeNull();
    expect(result.config.auxScenarios.map((entry) => entry.key)).toEqual(['data-card:aux-keep', 'data-card:aux-add']);
    expect(result.config.materials.map((entry) => entry.key)).toEqual(['data-card:mat-keep', 'data-card:mat-add']);
    expect(result.config.combatants.map((entry) => entry.key)).toEqual(['data-card:c2']);
    expect(result.config.teams[0].combatantKeys).toEqual([]);
    expect(current.scenario).not.toBeNull();
    expect(current.combatants).toHaveLength(2);
  });

  it('applies assignment, user guidance, story length, and history settings together', () => {
    const current = baseConfig();
    const nextHistory = { ...current.historySettings, writeCurrentState: false };
    const changes = [
      {
        changeId: 'assignment',
        type: 'assignTeam' as const,
        combatantKey: 'data-card:c1',
        teamKey: 'team:b',
        expectedBase: { kind: 'value' as const, value: 'team:a' },
      },
      {
        changeId: 'user-guidance',
        type: 'setUserGuidance' as const,
        value: '保持节奏',
        expectedBase: { kind: 'value' as const, value: '' },
      },
      {
        changeId: 'story-length',
        type: 'setStoryLength' as const,
        value: 'long' as const,
        customStoryLength: '1200',
        expectedBase: { kind: 'value' as const, value: { storyLength: 'standard' as const, customStoryLength: null } },
      },
      {
        changeId: 'history',
        type: 'setHistorySettings' as const,
        value: nextHistory,
        expectedBase: { kind: 'value' as const, value: current.historySettings },
      },
    ];
    const result = applyArenaProposal(proposalState(current, 9), makeProposal(changes, 'proposal-scalars'));

    expect(result.status).toBe('accepted');
    expect(result.config.teams[0].combatantKeys).toEqual([]);
    expect(result.config.teams[1].combatantKeys).toEqual(['data-card:c1']);
    expect(result.config.userGuidance).toBe('保持节奏');
    expect(result.config.storyLength).toBe('long');
    expect(result.config.customStoryLength).toBe('1200');
    expect(result.config.historySettings).toEqual(nextHistory);
  });

  it('rejects malformed proposals and absent targets without changing config or revision', () => {
    const current = baseConfig();
    const malformed = applyArenaProposal(proposalState(current, 3), {
      ...makeProposal([{ changeId: 'bad', type: 'setBattleMode', value: 'invalid' }], 'proposal-malformed'),
    });
    expect(malformed.status).toBe('rejected');
    expect(malformed.revision).toBe(3);
    expect(malformed.config).toEqual(current);

    const absentTarget = applyArenaProposal(proposalState(current, 3), makeProposal([{
      changeId: 'remove-missing',
      type: 'removeMaterial' as const,
      materialKey: 'data-card:missing',
      expectedBase: { kind: 'present' as const, ref: ref('missing', 'material') },
    }], 'proposal-absent'));
    expect(absentTarget.status).toBe('rejected');
    expect(absentTarget.revision).toBe(3);
    expect(absentTarget.config).toEqual(current);
    expect(current.materials).toHaveLength(2);
  });

  it('returns the original config/revision when an earlier selected change stages before a later conflict', () => {
    const current = baseConfig();
    const result = applyArenaProposal(proposalState(current, 11), makeProposal([
      {
        changeId: 'first-guidance',
        type: 'setUserGuidance' as const,
        value: 'should-not-escape',
        expectedBase: { kind: 'value' as const, value: '' },
      },
      {
        changeId: 'later-stale-mode',
        type: 'setBattleMode' as const,
        value: 'scenario' as const,
        expectedBase: { kind: 'value' as const, value: 'kizuna' as const },
      },
    ], 'proposal-staged-conflict'));

    expect(result.status).toBe('rejected');
    expect(result.acceptedChangeIds).toEqual([]);
    expect(result.revision).toBe(11);
    expect(result.config).toEqual(current);
    expect(result.config.userGuidance).toBe('');
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ changeId: 'later-stale-mode', code: 'precondition-failed' }),
    ]));
  });

  it('accepts a dependency closure atomically, increments revision once, and preserves input immutability', () => {
    const current = baseConfig();
    const proposal = {
      proposalVersion: 1,
      proposalId: 'proposal-1',
      roomId: 'room-1',
      authorUserId: 'user-1',
      baseRevision: 7,
      status: 'submitted' as const,
      changes: [
        {
          changeId: 'add-c3',
          type: 'addCombatant' as const,
          ref: ref('c3', 'character'),
          expectedBase: { kind: 'absent' as const },
          atomicGroupId: 'new-role',
        },
        {
          changeId: 'guide-c3',
          type: 'setCharacterGuidance' as const,
          combatantKey: 'data-card:c3',
          value: 'new guide',
          expectedBase: { kind: 'value' as const, value: null },
          dependsOn: ['add-c3'],
          atomicGroupId: 'new-role',
        },
        {
          changeId: 'mode',
          type: 'setBattleMode' as const,
          value: 'scenario' as const,
          expectedBase: { kind: 'value' as const, value: 'classic' as const },
        },
      ],
      createdAt: '2026-08-23T00:00:00.000Z',
    };

    const result = applyArenaProposal(proposalState(current, 7), proposal, ['add-c3', 'guide-c3']);

    expect(result.status).toBe('partially_accepted');
    expect(result.revision).toBe(8);
    expect(result.acceptedChangeIds).toEqual(['add-c3', 'guide-c3']);
    expect(result.rejectedChangeIds).toEqual(['mode']);
    expect(result.config.combatants).toContainEqual({
      key: 'data-card:c3',
      ref: ref('c3', 'character'),
      characterGuidance: 'new guide',
    });
    expect(result.config.battleMode).toBe('classic');
    expect(current.combatants).toHaveLength(2);
    expect(current.battleMode).toBe('classic');
  });

  it('rejects the whole selected set when one selected change conflicts', () => {
    const current = baseConfig();
    const proposal = {
      proposalVersion: 1,
      proposalId: 'proposal-conflict',
      roomId: 'room-1',
      authorUserId: 'user-1',
      baseRevision: 7,
      status: 'submitted' as const,
      changes: [
        {
          changeId: 'mode',
          type: 'setBattleMode' as const,
          value: 'scenario' as const,
          expectedBase: { kind: 'value' as const, value: 'kizuna' as const },
        },
        {
          changeId: 'guidance',
          type: 'setUserGuidance' as const,
          value: 'new',
          expectedBase: { kind: 'value' as const, value: '' as const },
        },
      ],
      createdAt: '2026-08-23T00:00:00.000Z',
    };

    const result = applyArenaProposal(proposalState(current, 7), proposal, ['mode', 'guidance']);

    expect(result.status).toBe('rejected');
    expect(result.revision).toBe(7);
    expect(result.acceptedChangeIds).toEqual([]);
    expect(result.rejectedChangeIds).toEqual(['mode', 'guidance']);
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ changeId: 'mode', code: 'precondition-failed' }),
    ]));
    expect(result.config).toEqual(current);
  });

  it('accepts the v1 snapshot fixture in memory without mutating it', async () => {
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as { sharedConfig: unknown; revision: number };
    const working = applyArenaRoomSharedConfig(fixture.sharedConfig);
    const changes = diffArenaSharedConfig(working, working);
    expect(changes).toEqual([]);
    (working.combatants[0] as { ref: { versionToken: string } }).ref.versionToken = 'changed-locally';
    expect(fixture.sharedConfig).toEqual(expect.objectContaining({
      combatants: expect.arrayContaining([
        expect.objectContaining({ ref: expect.objectContaining({ versionToken: 'v2026-08-22-001' }) }),
      ]),
    }));
  });
});
