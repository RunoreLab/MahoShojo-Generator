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

type CoverageEntry = {
  readonly classification: typeof classifications[number];
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
  it('逐项分类 useBattleEngine 当前 generation request 字段', () => {
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

  it('覆盖 ArenaRoomSharedConfig 全部顶层字段和 ArenaProposalChange 全部 variant', () => {
    const matrix = coverage();
    const sharedConfigTopLevelFields = new Set(
      Object.values(matrix.roomSharedConfig).map((entry) => Reflect.get(entry, 'rootField')),
    );

    expect([...sharedConfigTopLevelFields].sort()).toEqual(
      [...ArenaRoomSharedConfigSchema.keyof().options].sort(),
    );
    expect(Object.keys(matrix.proposalChanges).sort()).toEqual(actualProposalChangeTypes());
    expect(Object.keys(matrix.proposalChanges)).toHaveLength(13);
  });

  it('每项都有合法分类，deferred 项必须说明原因', () => {
    const matrix = coverage();
    const entries = [
      ...Object.values(matrix.generationRequest),
      ...Object.values(matrix.roomSharedConfig),
      ...Object.values(matrix.proposalChanges),
      ...Object.values(matrix.arenaUi),
    ];

    expect(entries.length).toBeGreaterThan(60);
    for (const entry of entries) {
      expect(classifications).toContain(entry.classification);
      if (entry.classification === 'deferred-with-reason') {
        expect(entry.reason?.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('显式记录 language、questionnaire/lore、adjudication 与 team display name 缺口', () => {
    const matrix = coverage();

    expect(matrix.generationRequest.language.gap).toMatch(/Proposal.*setLanguage/u);
    expect(matrix.generationRequest.questionnaireSelections.reason).toMatch(/Shared Config.*Proposal/u);
    expect(matrix.generationRequest.questionnaires.reason).toMatch(/lore.*materialization/u);
    expect(matrix.generationRequest.adjudicationEvents.reason).toMatch(/Shared Config.*Proposal/u);
    expect(matrix.generationRequest.teamNames.gap).toMatch(/team display name.*Proposal/u);
    expect(matrix.arenaUi.selectedLanguage.gap).toMatch(/Proposal.*setLanguage/u);
    expect(matrix.arenaUi.teamDisplayName.gap).toMatch(/Proposal.*rename/u);
  });

  it('以现有 Arena UI 而非旧三字段 mini editor 作为产品 contract', () => {
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
