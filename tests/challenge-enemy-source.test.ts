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
  appearance: {
    outfit: `${input.name}的战斗服`,
    accessories: '银色发饰',
    colorScheme: '白蓝',
    overallLook: '整洁利落',
  },
  magicConstruct: {
    name: `${input.name}的魔装`,
    form: '长杖',
    basicAbilities: ['tempo-control', 'mid-range'],
    description: `${input.name}擅长用稳定节奏处理竞技场局面。`,
  },
  wonderlandRule: {
    name: `${input.name}的心象规则`,
    description: '维持距离时更容易掌握节奏。',
    tendency: 'control',
    activation: '持续观察对手动作',
  },
  blooming: {
    name: `${input.name}的盛放`,
    evolvedAbilities: ['pressure-shift'],
    evolvedForm: '高压形态',
    evolvedOutfit: '礼装强化版',
    powerLevel: input.powerLevel,
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
  test('data_card 补卡失败时会被跳过，而不是降为 season-entity', async () => {
    const { resolveArenaEnemyCandidates } = await import('@/lib/challenge/worlds/arena/enemy-source');

    const result = await resolveArenaEnemyCandidates(
      {
        tier: 'elite',
        sourceMode: 'online-first',
        runSeed: 'run-skip-missing-card',
        limit: 6,
      },
      {
        loadRankedEntities: async () => [
          {
            entityType: 'data_card',
            entityId: 'missing-card',
            displayName: '失联敌人',
          },
          {
            entityType: 'preset',
            entityId: 'preset-elite-1',
            displayName: '雪绒',
          },
          {
            entityType: 'preset',
            entityId: 'preset-elite-2',
            displayName: '镜砂',
          },
          {
            entityType: 'preset',
            entityId: 'preset-elite-3',
            displayName: '夜纱',
          },
        ],
        loadPresetById: async (entityId) =>
          entityId === 'preset-elite-1' || entityId === 'preset-elite-2' || entityId === 'preset-elite-3'
            ? createMockArenaCard({
                id: entityId,
                name:
                  entityId === 'preset-elite-1'
                    ? '雪绒'
                    : entityId === 'preset-elite-2'
                      ? '镜砂'
                      : '夜纱',
                powerLevel: 'flower',
                isPreset: true,
              })
            : null,
        loadPublicCardsByIds: async () => new Map(),
        loadPresetPool: () => [],
      }
    );

    expect(result.resolvedSourceMode).toBe('remote');
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.some((item) => item.sourceType === 'season-entity')).toBe(false);
    expect(result.candidates.map((item) => item.sourceType)).toEqual(['preset', 'preset', 'preset']);
  });

  test('第一窗口不足时会触发第二窗口扩扫，并只保留通过 renderability 的条目', async () => {
    const { resolveArenaEnemyCandidates } = await import('@/lib/challenge/worlds/arena/enemy-source');

    const windowCalls: Array<{ limit: number; offset: number }> = [];
    const result = await resolveArenaEnemyCandidates(
      {
        tier: 'common',
        sourceMode: 'online-first',
        runSeed: 'run-second-window',
        limit: 6,
      },
      {
        loadRankedEntityWindow: async ({ limit, offset }) => {
          windowCalls.push({ limit, offset });
          if (offset === 0) {
            return [
              { entityType: 'data_card', entityId: 'unrenderable-card', displayName: '残缺敌人' },
            ];
          }
          return [
            { entityType: 'data_card', entityId: 'card-common-2', displayName: '潮汐' },
            { entityType: 'preset', entityId: 'preset-common-1', displayName: '白蔷薇' },
            { entityType: 'data_card', entityId: 'card-common-3', displayName: '镜砂' },
          ];
        },
        loadPublicCardsByIds: async (ids) => {
          const map = new Map<string, unknown>();
          ids.forEach((id) => {
            if (id === 'unrenderable-card') {
              map.set(id, {
                id,
                name: '残缺敌人',
                data: JSON.stringify({ codename: '残缺敌人' }),
                updatedAt: '2026-04-05T11:00:00.000Z',
              });
            }
            if (id === 'card-common-2') {
              map.set(id, {
                id,
                name: '潮汐',
                data: JSON.stringify(createMockArenaCard({ id, name: '潮汐', powerLevel: 'leaf' })),
                updatedAt: '2026-04-05T11:00:00.000Z',
              });
            }
            if (id === 'card-common-3') {
              map.set(id, {
                id,
                name: '镜砂',
                data: JSON.stringify(createMockArenaCard({ id, name: '镜砂', powerLevel: 'leaf' })),
                updatedAt: '2026-04-05T11:00:00.000Z',
              });
            }
          });
          return map;
        },
        loadPresetById: async (entityId) =>
          entityId === 'preset-common-1'
            ? createMockArenaCard({
                id: 'preset-common-1',
                name: '白蔷薇',
                powerLevel: 'leaf',
                isPreset: true,
              })
            : null,
        loadPresetPool: () => [],
      }
    );

    expect(windowCalls).toEqual([
      { limit: 18, offset: 0 },
      { limit: 12, offset: 18 },
    ]);
    expect(result.resolvedSourceMode).toBe('remote');
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.map((item) => item.sourceId)).toEqual(['card-common-2', 'preset-common-1', 'card-common-3']);
    expect(result.candidates.some((item) => item.displayName === '残缺敌人')).toBe(false);
  });

  test('两段窗口后仍低于最低阈值时会整体回退 preset-only', async () => {
    const { resolveArenaEnemyCandidates } = await import('@/lib/challenge/worlds/arena/enemy-source');

    const result = await resolveArenaEnemyCandidates(
      {
        tier: 'boss',
        sourceMode: 'online-first',
        runSeed: 'run-remote-threshold',
        limit: 6,
      },
      {
        loadRankedEntityWindow: async ({ offset }) =>
          offset === 0
            ? [{ entityType: 'data_card', entityId: 'card-boss-1', displayName: '高塔' }]
            : [{ entityType: 'data_card', entityId: 'card-boss-2', displayName: '深井' }],
        loadPublicCardsByIds: async (ids) => {
          const map = new Map<string, unknown>();
          ids.forEach((id, index) => {
            map.set(id, {
              id,
              name: `Boss-${index + 1}`,
              data: JSON.stringify(
                createMockArenaCard({
                  id,
                  name: `Boss-${index + 1}`,
                  powerLevel: 'gemScepter',
                })
              ),
              updatedAt: '2026-04-05T11:00:00.000Z',
            });
          });
          return map;
        },
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

    expect(result.resolvedSourceMode).toBe('preset-only');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.sourceType).toBe('preset');
  });

  test('普通敌人优先使用在线候选，并归一化为 common 敌人快照', async () => {
    const { resolveArenaEnemyCandidates } = await import('@/lib/challenge/worlds/arena/enemy-source');

    const result = await resolveArenaEnemyCandidates(
      {
        tier: 'common',
        sourceMode: 'online-first',
        runSeed: 'run-a',
        limit: 6,
      },
      {
        loadRankedEntities: async () => [
          {
            entityType: 'data_card',
            entityId: 'card-common-1',
            displayName: '潮汐',
          },
          {
            entityType: 'data_card',
            entityId: 'card-common-2',
            displayName: '镜砂',
          },
          {
            entityType: 'data_card',
            entityId: 'card-common-3',
            displayName: '夜纱',
          },
        ],
        loadPublicCardsByIds: async (ids) =>
          new Map(
            ids.map((id, index) => [
              id,
              {
                id,
                name: index === 0 ? '潮汐' : index === 1 ? '镜砂' : '夜纱',
                data: JSON.stringify(
                  createMockArenaCard({
                    id,
                    name: index === 0 ? '潮汐' : index === 1 ? '镜砂' : '夜纱',
                    powerLevel: 'leaf',
                  }),
                ),
                updatedAt: '2026-04-05T11:00:00.000Z',
              },
            ]),
          ),
        loadPresetPool: () => [],
      }
    );

    expect(result.resolvedSourceMode).toBe('remote');
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]).toMatchObject({
      sourceType: 'public-card',
      sourceId: 'card-common-1',
      displayName: '潮汐',
      strengthTier: 'common',
    });
    expect(
      result.candidates
        .filter((candidate) => candidate.sourceType === 'public-card')
        .every((candidate) => result.resolvedSourceCardsById.has(candidate.sourceId))
    ).toBe(true);
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
        limit: 6,
      },
      {
        loadRankedEntities: async () => [
          {
            entityType: 'data_card',
            entityId: 'card-leaf-high-rating',
            displayName: '高分叶阶角色',
          },
          {
            entityType: 'data_card',
            entityId: 'card-leaf-high-rating-2',
            displayName: '高分叶阶角色 2',
          },
          {
            entityType: 'data_card',
            entityId: 'card-leaf-high-rating-3',
            displayName: '高分叶阶角色 3',
          },
        ],
        loadPublicCardsByIds: async (ids) =>
          new Map(
            ids.map((id, index) => [
              id,
              {
                id,
                name: index === 0 ? '高分叶阶角色' : index === 1 ? '高分叶阶角色 2' : '高分叶阶角色 3',
                data: JSON.stringify(
                  createMockArenaCard({
                    id,
                    name: index === 0 ? '高分叶阶角色' : index === 1 ? '高分叶阶角色 2' : '高分叶阶角色 3',
                    powerLevel: 'leaf',
                  }),
                ),
                updatedAt: '2026-04-05T11:00:00.000Z',
              },
            ]),
          ),
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
