import {
  ArenaProposalChangeSchema,
  ArenaRoomSharedConfigSchema,
} from '@mahoshojo/contracts/arena-room';
import { describe, expect, it } from 'vitest';

import * as multiplayerCore from '../src/index';

const classifications = [
  'shared/proposable',
  'shared/host-only',
  'host-runtime-only',
  'local-only',
  'forbidden',
  'deferred-with-reason',
] as const;

const modeCapabilities = [
  'editable',
  'derived',
  'materialized',
  'read-only',
  'host-only',
  'local-only',
  'forbidden',
  'deferred',
  'not-applicable',
] as const;

type CoverageEntry = {
  readonly classification: typeof classifications[number];
  readonly single: typeof modeCapabilities[number];
  readonly roomHost: typeof modeCapabilities[number];
  readonly roomProposal: typeof modeCapabilities[number];
  readonly contractChangeTypes: readonly string[];
  readonly testIds: readonly string[];
  readonly reason?: string;
  readonly gap?: string;
};

type ProductParityCoverage = {
  readonly contractSource: string;
  readonly legacyMiniEditorIsProductContract: boolean;
  readonly generationRequest: Readonly<Record<string, CoverageEntry>>;
  readonly roomSharedConfig: Readonly<Record<string, CoverageEntry>>;
  readonly proposalChanges: Readonly<Record<string, CoverageEntry>>;
  readonly arenaUi: Readonly<Record<string, CoverageEntry>>;
};

const coverage = (): ProductParityCoverage => {
  const value = Reflect.get(multiplayerCore, 'ARENA_PRODUCT_PARITY_COVERAGE') as
    | ProductParityCoverage
    | undefined;
  expect(
    value,
    'GMR-10P-A 必须从 multiplayer-core 导出 machine-readable 产品一致性覆盖矩阵',
  ).toBeDefined();
  return value!;
};

const actualProposalChangeTypes = (): string[] => ArenaProposalChangeSchema.options
  .map((option) => option.shape.type.value)
  .sort();

describe('GMR-10P Arena 产品一致性覆盖矩阵', () => {
  it('[GMR10P-A-EXACT-GENERATION-FIELDS] 逐项分类 useBattleEngine 当前 generation request 字段', () => {
    expect(Object.keys(coverage().generationRequest).sort()).toEqual([
      'adjudicationEvents',
      'arenaFreeRankingEnabled',
      'arenaHistoryReadLimit',
      'auxScenarios',
      'combatants',
      'customProvider',
      'customStoryLength',
      'generationRequestId',
      'isDowngrade',
      'language',
      'materials',
      'mode',
      'narrativeHistory',
      'narrativeHistoryReadLimit',
      'questionnaireSelections',
      'questionnaires',
      'readArenaHistory',
      'readCurrentState',
      'readNarrativeHistory',
      'scenario',
      'scenarioFileName',
      'scenarioSourceDataCardId',
      'scenarioSourceDataCardUpdatedAt',
      'scenarioTitle',
      'storyLength',
      'teamNames',
      'teams',
      'userGuidance',
      'writeArenaHistory',
      'writeCurrentState',
      'writeNarrativeHistory',
    ]);
  });

  it('运行时拒绝 matrix 外 generation semantic field', () => {
    const classified = { generationRequestId: 'request-1', combatants: [] };

    expect(multiplayerCore.assertArenaGenerationRequestFieldsClassified(classified)).toBe(classified);
    expect(() => multiplayerCore.assertArenaGenerationRequestFieldsClassified({
      ...classified,
      unclassifiedSemantic: true,
    }))
      .toThrow('ARENA_GENERATION_FIELD_UNCLASSIFIED:unclassifiedSemantic');
  });

  it('[GMR10P-A-SHARED-PROPOSAL-COVERAGE] 覆盖 SharedConfig 与 Proposal variant', () => {
    const matrix = coverage();
    const sharedConfigTopLevelFields = new Set(
      Object.values(matrix.roomSharedConfig).map((entry) => Reflect.get(entry, 'rootField')),
    );

    expect([...sharedConfigTopLevelFields].sort()).toEqual(
      [...ArenaRoomSharedConfigSchema.keyof().options].sort(),
    );
    expect(Object.keys(matrix.proposalChanges).sort()).toEqual(actualProposalChangeTypes());
    expect(Object.keys(matrix.proposalChanges)).toHaveLength(22);
    expect(matrix.roomSharedConfig.combatants.contractChangeTypes).toContain('reorderCombatants');
    expect(matrix.roomSharedConfig.teams.contractChangeTypes).toContain('reorderTeams');
    expect(matrix.roomSharedConfig['teams.combatantKeys'].contractChangeTypes)
      .toContain('reorderTeamCombatants');
    expect(matrix.roomSharedConfig.auxScenarios.contractChangeTypes)
      .toContain('reorderAuxScenarios');
    expect(matrix.roomSharedConfig.materials.contractChangeTypes).toContain('reorderMaterials');
  });

  it('每项都有 §11.1 mode、contract change 与 test ID 列', () => {
    const matrix = coverage();
    const entries = [
      ...Object.values(matrix.generationRequest),
      ...Object.values(matrix.roomSharedConfig),
      ...Object.values(matrix.proposalChanges),
      ...Object.values(matrix.arenaUi),
    ];

    const knownTestIds = new Set(
      Reflect.get(multiplayerCore, 'ARENA_PRODUCT_PARITY_TEST_IDS') as readonly string[],
    );
    const actualProposalTypes = new Set(actualProposalChangeTypes());

    expect(entries.length).toBeGreaterThan(60);
    for (const entry of entries) {
      expect(classifications).toContain(entry.classification);
      expect(modeCapabilities).toContain(entry.single);
      expect(modeCapabilities).toContain(entry.roomHost);
      expect(modeCapabilities).toContain(entry.roomProposal);
      expect(Array.isArray(entry.contractChangeTypes)).toBe(true);
      expect(entry.testIds.length).toBeGreaterThan(0);
      entry.testIds.forEach((testId) => expect(knownTestIds).toContain(testId));
      entry.contractChangeTypes.forEach((changeType) => (
        expect(actualProposalTypes).toContain(changeType)
      ));
      if (entry.classification === 'deferred-with-reason') {
        expect(entry.reason?.trim().length).toBeGreaterThan(0);
      }
      if (entry.classification === 'shared/proposable') {
        expect(entry.contractChangeTypes.length).toBeGreaterThan(0);
      }
      if (entry.classification === 'forbidden') {
        expect(entry.roomProposal).toBe('forbidden');
      }
    }
  });

  it('[GMR10P-A-EXPLICIT-GAPS] 显式记录 authority 与产品覆盖缺口', () => {
    const matrix = coverage();

    expect(matrix.generationRequest.language).toMatchObject({
      classification: 'shared/proposable',
      contractChangeTypes: ['setSelectedLanguage'],
    });
    expect(matrix.generationRequest.questionnaireSelections.reason).toMatch(/Shared Config.*Proposal/u);
    expect(matrix.generationRequest.questionnaires.reason).toMatch(/lore.*materialization/u);
    expect(matrix.generationRequest.adjudicationEvents.reason).toMatch(/Shared Config.*Proposal/u);
    expect(matrix.generationRequest.teamNames).toMatchObject({
      classification: 'shared/proposable',
      contractChangeTypes: ['addTeam', 'renameTeam'],
    });
    expect(matrix.arenaUi.selectedLanguage.classification).toBe('shared/proposable');
    expect(matrix.arenaUi.teamDisplayName.classification).toBe('shared/proposable');
    for (const key of ['combatants', 'scenario', 'auxScenarios', 'materials'] as const) {
      expect(matrix.generationRequest[key]).toMatchObject({
        classification: 'shared/proposable',
        single: 'derived',
        roomHost: 'materialized',
        roomProposal: 'derived',
      });
      expect(matrix.generationRequest[key].reason).toMatch(/materialize/u);
      expect(matrix.generationRequest[key].gap).toBeUndefined();
    }
  });

  it('preset 角色/情景进入 shared/proposable，material preset 保持有理由 deferred', () => {
    const matrix = coverage();
    expect(matrix.arenaUi.combatantPreset).toMatchObject({
      classification: 'shared/proposable',
      roomProposal: 'editable',
      contractChangeTypes: ['addCombatant'],
    });
    expect(matrix.arenaUi.scenarioPreset).toMatchObject({
      classification: 'shared/proposable',
      roomProposal: 'editable',
      contractChangeTypes: ['setScenario'],
    });
    expect(matrix.arenaUi.auxScenarioPreset).toMatchObject({
      classification: 'shared/proposable',
      roomProposal: 'editable',
      contractChangeTypes: ['addAuxScenario'],
    });
    expect(matrix.arenaUi.materialPreset).toMatchObject({
      classification: 'deferred-with-reason',
      roomProposal: 'deferred',
      reason: expect.stringMatching(/server.*registry|registry.*material/u),
    });
  });

  it('[GMR10P-A-ARENA-UI-CONTRACT] 以现有 Arena UI 而非三字段 editor 作为 contract', () => {
    const matrix = coverage();

    expect(matrix.contractSource).toBe('existing-arena-ui');
    expect(matrix.legacyMiniEditorIsProductContract).toBe(false);
    expect(Object.keys(matrix.arenaUi)).toEqual(expect.arrayContaining([
      'battleMode',
      'combatantRoster',
      'characterGuidance',
      'teamAssignment',
      'teamDisplayName',
      'scenario',
      'auxScenarios',
      'materials',
      'userGuidance',
      'storyLength',
      'selectedLanguage',
      'historySettings',
      'questionnaireLore',
      'adjudicationEvents',
    ]));
    expect(Object.keys(matrix.arenaUi).length).toBeGreaterThan(3);
  });
});
