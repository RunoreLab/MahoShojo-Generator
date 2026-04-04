import { describe, expect, test } from 'bun:test';

import type { EnemySnapshotV1, StrengthTier } from '@/lib/challenge/types';

type MockArenaCardOptions = {
  id: string;
  name: string;
  powerLevel: string;
  isPreset?: boolean;
};

const createMockArenaCard = (input: MockArenaCardOptions) => ({
  id: input.id,
  sourceId: input.id,
  sourceType: input.isPreset ? 'preset' : 'public-card',
  isPreset: input.isPreset === true,
  codename: input.name,
  magicalGirl: {
    codename: input.name,
  },
  magicConstruct: {
    name: `${input.name}的魔装`,
    description: `${input.name}擅长用稳定节奏处理竞技场局面。`,
  },
  analysis: {
    personalityAnalysis: `${input.name}冷静审慎，偏好寻找破绽。`,
    abilityReasoning: `${input.name}会围绕自身能力建立稳定战斗流程。`,
    coreTraits: ['冷静', '试探'],
    predictionBasis: `${input.name}有较明确的竞技场经验与节奏意识。`,
  },
  buildState: {
    primaryRuleId: 'arena-trpg-lite',
    rules: [
      {
        ruleId: 'arena-trpg-lite',
        version: '1.0.0',
        blockResults: {
          powerLevel: input.powerLevel,
          coreAttributes: {
            STR: 42,
            CON: 40,
            AGI: 43,
            MAG: 44,
            WILL: 41,
            PER: 38,
            CHM: 30,
          },
          specialties: ['tempo-control', 'mid-range'],
        },
        derived: {
          HP: 9,
          Radiance: 10,
        },
      },
    ],
  },
});

const createMockEnemySnapshot = (input: {
  sourceType: EnemySnapshotV1['sourceType'];
  sourceId: string;
  displayName: string;
  strengthTier: StrengthTier;
}): EnemySnapshotV1 => ({
  version: 1,
  sourceType: input.sourceType,
  sourceId: input.sourceId,
  displayName: input.displayName,
  strengthTier: input.strengthTier,
  combatProfile: {},
  tags: [input.strengthTier],
  promptSummary: `${input.displayName}的竞技场挑战快照`,
});

describe('arena enemy source', () => {
  test('普通敌人优先使用在线候选，并归一化为 common 敌人快照', async () => {
    const { resolveArenaEnemyCandidates } = await import('@/lib/challenge/worlds/arena/enemy-source');

    const result = await resolveArenaEnemyCandidates(
      {
        tier: 'common',
        sourceMode: 'online-first',
        runSeed: 'run-a',
      },
      {
        loadRankedEntities: async () => [
          {
            entityType: 'data_card',
            entityId: 'card-common-1',
            displayName: '潮汐',
          },
        ],
        loadPublicCardById: async (entityId) =>
          entityId === 'card-common-1'
            ? createMockArenaCard({
                id: 'card-common-1',
                name: '潮汐',
                powerLevel: 'leaf',
              })
            : null,
        loadPresetPool: () => [],
      }
    );

    expect(result.resolvedSourceMode).toBe('remote');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      sourceType: 'public-card',
      sourceId: 'card-common-1',
      displayName: '潮汐',
      strengthTier: 'common',
    });
  });

  test('在线来源不可用时回退本地预设池，并切换为 preset-only 模式', async () => {
    const { selectArenaEnemySnapshot } = await import('@/lib/challenge/worlds/arena/enemy-source');

    const result = await selectArenaEnemySnapshot(
      {
        tier: 'elite',
        sourceMode: 'online-first',
        runSeed: 'run-b',
        selectionSeed: 'run-b:L4-N1',
      },
      {
        loadRankedEntities: async () => {
          throw new Error('leaderboard unavailable');
        },
        loadPublicCardById: async () => null,
        loadPresetPool: () => [
          createMockArenaCard({
            id: 'preset-elite-1',
            name: '雪绒',
            powerLevel: 'flower',
            isPreset: true,
          }),
        ],
      }
    );

    expect(result.resolvedSourceMode).toBe('preset-only');
    expect(result.enemySnapshot).toMatchObject({
      sourceType: 'preset',
      sourceId: 'preset-elite-1',
      displayName: '雪绒',
      strengthTier: 'elite',
    });
  });

  test('请求档位会强制收敛最终 snapshot 的 strengthTier，而不是沿用源卡自身 powerLevel', async () => {
    const { resolveArenaEnemyCandidates } = await import('@/lib/challenge/worlds/arena/enemy-source');

    const result = await resolveArenaEnemyCandidates(
      {
        tier: 'boss',
        sourceMode: 'online-first',
        runSeed: 'run-tier-clamp',
      },
      {
        loadRankedEntities: async () => [
          {
            entityType: 'data_card',
            entityId: 'card-leaf-high-rating',
            displayName: '高分叶阶角色',
          },
        ],
        loadPublicCardById: async () =>
          createMockArenaCard({
            id: 'card-leaf-high-rating',
            name: '高分叶阶角色',
            powerLevel: 'leaf',
          }),
        loadPresetPool: () => [],
      }
    );

    expect(result.candidates[0]).toMatchObject({
      sourceId: 'card-leaf-high-rating',
      strengthTier: 'boss',
    });
    expect(result.candidates[0]?.promptSummary).toContain('强度档：boss');
  });

  test('preset-only 模式会跳过在线来源并稳定返回本地候选', async () => {
    const { resolveArenaEnemyCandidates } = await import('@/lib/challenge/worlds/arena/enemy-source');

    let onlineCalled = false;
    const result = await resolveArenaEnemyCandidates(
      {
        tier: 'boss',
        sourceMode: 'preset-only',
        runSeed: 'run-c',
      },
      {
        loadRankedEntities: async () => {
          onlineCalled = true;
          return [];
        },
        loadPublicCardById: async () => null,
        loadPresetPool: () => [
          createMockArenaCard({
            id: 'preset-boss-1',
            name: '鹅',
            powerLevel: 'gemScepter',
            isPreset: true,
          }),
        ],
      }
    );

    expect(onlineCalled).toBe(false);
    expect(result.resolvedSourceMode).toBe('preset-only');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.strengthTier).toBe('boss');
  });

  test('当本地池已经是快照时会原样复用，不再重复归一化', async () => {
    const { resolveArenaEnemyCandidates } = await import('@/lib/challenge/worlds/arena/enemy-source');

    const snapshot = createMockEnemySnapshot({
      sourceType: 'season-entity',
      sourceId: 'season:s1:card-1',
      displayName: '赛季幽灵',
      strengthTier: 'common',
    });

    const result = await resolveArenaEnemyCandidates(
      {
        tier: 'common',
        sourceMode: 'preset-only',
        runSeed: 'run-d',
      },
      {
        loadRankedEntities: async () => [],
        loadPublicCardById: async () => null,
        loadPresetPool: () => [snapshot],
      }
    );

    expect(result.candidates).toEqual([snapshot]);
  });

  test('当候选池直接提供 EnemySnapshotV1 时，仍会对 strengthTier 与摘要文案做档位收敛', async () => {
    const { resolveArenaEnemyCandidates } = await import('@/lib/challenge/worlds/arena/enemy-source');

    const snapshot: EnemySnapshotV1 = {
      ...createMockEnemySnapshot({
        sourceType: 'season-entity',
        sourceId: 'season:s1:card-2',
        displayName: '错档快照',
        strengthTier: 'common',
      }),
      promptSummary: '错档快照的竞技场挑战快照；强度档：common',
      tags: ['common', 'season-ranked'],
    };

    const result = await resolveArenaEnemyCandidates(
      {
        tier: 'boss',
        sourceMode: 'preset-only',
        runSeed: 'run-snapshot-clamp',
      },
      {
        loadRankedEntities: async () => [],
        loadPublicCardById: async () => null,
        loadPresetPool: () => [snapshot],
      }
    );

    expect(result.candidates[0]).toMatchObject({
      sourceId: 'season:s1:card-2',
      strengthTier: 'boss',
      tags: ['boss', 'season-ranked'],
    });
    expect(result.candidates[0]?.promptSummary).toContain('强度档：boss');
  });
});
