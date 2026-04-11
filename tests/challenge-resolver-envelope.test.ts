import { describe, expect, test } from 'bun:test';

import type {
  ChallengeNodeType,
  EncounterSnapshotV1,
  PlayerSnapshotV1,
  RewardOptionV1,
  RunStateV1,
} from '@/lib/challenge/types';

const createPlayerSnapshot = (): PlayerSnapshotV1 => ({
  version: 1,
  sourceType: 'local-card',
  sourceId: 'player-1',
  displayName: '雾灯',
  snapshotSeed: 'snapshot-a',
  strengthTier: 'common',
  baseTrackSnapshot: {
    hp: { current: 100, max: 100 },
    radiance: { current: 80, max: 100 },
    currency: { current: 20, max: null },
  },
  combatProfile: {},
  tags: ['谨慎'],
  promptSummary: '雾灯擅长观察窗口与节奏控制。',
});

const createRunState = (nodeType: ChallengeNodeType, overrides: Partial<RunStateV1> = {}): RunStateV1 => ({
  version: 1,
  runId: 'run-envelope-1',
  worldPresetId: 'arena',
  runSeed: 'run-seed-envelope',
  status: 'in_progress',
  playerSnapshot: createPlayerSnapshot(),
  worldState: {
    version: 1,
    schemaId: 'arena-v1',
    tracks: {
      hp: { current: 20, max: 100 },
      radiance: { current: 40, max: 100 },
      currency: { current: 18, max: null },
    },
    temporaryStatuses: ['exposed'],
    runFlags: [],
    persistentItemIds: [],
    consumableIds: [],
  },
  mapState: {
    version: 1,
    rootNodeId: 'ROOT',
    totalLayers: 1,
    bossNodeId: 'L1-N1',
    nodes: [
      {
        version: 1,
        nodeId: 'L1-N1',
        layer: 1,
        nodeType,
        visibility: 'focused',
        riskHint: 'high',
        rewardHint: 'mid',
        encounterRef: `arena:${nodeType}:L1-N1`,
      },
    ],
    edges: [],
  },
  pendingRewardChoice: null,
  currentNodeId: 'L1-N1',
  visitedNodeCount: 0,
  checkpointSeq: 1,
  usedBootstrapReroll: false,
  startedAt: 1,
  updatedAt: 1,
  ...overrides,
});

const createEncounter = (
  nodeType: Extract<ChallengeNodeType, 'battle' | 'elite' | 'boss'>,
  rewardOptions: RewardOptionV1[] = []
): EncounterSnapshotV1 => ({
  version: 1,
  nodeId: 'L1-N1',
  templateId: `arena-${nodeType}-L1-N1`,
  kind: nodeType,
  inputMode: 'recommended-action-plus-free-intent',
  enemySnapshot: {
    version: 1,
    sourceType: 'preset',
    sourceId: 'enemy-1',
    displayName: nodeType === 'boss' ? '千日红' : '雪绒',
    strengthTier: nodeType === 'boss' ? 'boss' : nodeType === 'elite' ? 'elite' : 'common',
    combatProfile: {},
    tags: [nodeType],
    promptSummary: '对手擅长压迫与节奏争夺。',
  },
  rewardOptions,
  eventOptions: [],
  shopOffers: [],
});

const createEventEncounter = (): EncounterSnapshotV1 => ({
  version: 1,
  nodeId: 'L1-N1',
  templateId: 'arena-event-L1-N1',
  kind: 'event',
  inputMode: 'free-intent',
  enemySnapshot: null,
  rewardOptions: [],
  eventOptions: [],
  shopOffers: [],
});

const createWorldStateTracks = (input?: Partial<RunStateV1['worldState']>): NonNullable<RunStateV1['worldState']> => ({
  version: 1,
  schemaId: 'arena-v1',
  tracks: {
    hp: { current: 20, max: 100 },
    radiance: { current: 40, max: 100 },
    currency: { current: 18, max: null },
  },
  temporaryStatuses: ['exposed'],
  runFlags: [],
  persistentItemIds: [],
  consumableIds: [],
  ...input,
});

describe('challenge resolver envelope', () => {
  test('buildChallengeResolverEnvelope 不再输出 recommendedOutcome', async () => {
    const { buildChallengeResolverEnvelope } = await import('@/lib/challenge/resolver-envelope');

    const envelope = buildChallengeResolverEnvelope({
      runState: createRunState('battle'),
      encounter: createEncounter('battle'),
      playerInput: {
        recommendedActionId: 'bait-counter',
        note: '先观察，再动手。',
      },
    });

    expect(envelope).not.toHaveProperty('recommendedOutcome');
  });

  test('validateAdjudicationAgainstEnvelope 会拒绝越界的 track delta 与非法状态', async () => {
    const { buildChallengeResolverEnvelope, validateAdjudicationAgainstEnvelope } = await import(
      '@/lib/challenge/resolver-envelope'
    );

    const envelope = buildChallengeResolverEnvelope({
      runState: createRunState('battle'),
      encounter: createEncounter('battle'),
      playerInput: {
        recommendedActionId: 'bait-counter',
        note: '先观察对方起手，再抓反击窗口。',
      },
    });

    expect(() =>
      validateAdjudicationAgainstEnvelope(envelope, {
        outcome: 'victory',
        trackDeltas: { hp: -999 },
        addStatuses: ['unknown-status'],
        removeStatuses: [],
        rewardOptionId: null,
        summary: '越界结果',
      })
    ).toThrow('超出 envelope');
  });

  test('system fallback 完整 adjudication 不受 note 文本变化影响', async () => {
    const { buildChallengeResolverEnvelope, buildSystemFallbackResolution } = await import('@/lib/challenge/resolver-envelope');

    const runState = createRunState('battle');
    const encounter = createEncounter('battle');

    const resolveAdjudication = (note: string) => {
      const playerInput = { recommendedActionId: 'bait-counter', note };
      const resolverEnvelope = buildChallengeResolverEnvelope({ runState, encounter, playerInput });
      return buildSystemFallbackResolution({ runState, encounter, playerInput, resolverEnvelope }).adjudication;
    };

    expect(resolveAdjudication('先观察再出手')).toEqual(resolveAdjudication('鲁莽正面强冲'));
    expect(resolveAdjudication('先观察再出手')).toEqual(resolveAdjudication('稳住节奏后再诱导'));
  });

  test('system fallback 完整 adjudication 不受 recommendedActionId 变化影响', async () => {
    const { buildChallengeResolverEnvelope, buildSystemFallbackResolution } = await import('@/lib/challenge/resolver-envelope');

    const runState = createRunState('boss');
    const encounter = createEncounter('boss');

    const resolveAdjudication = (recommendedActionId: string) => {
      const playerInput = { recommendedActionId, note: '保持阵型。' };
      const resolverEnvelope = buildChallengeResolverEnvelope({ runState, encounter, playerInput });
      return buildSystemFallbackResolution({ runState, encounter, playerInput, resolverEnvelope }).adjudication;
    };

    expect(resolveAdjudication('advance-pressure')).toEqual(resolveAdjudication('focus-barrier'));
  });

  test('system fallback 在缺少敌方快照或关键 track 时会保守回落到 costly_victory', async () => {
    const { buildChallengeResolverEnvelope, buildSystemFallbackResolution } = await import('@/lib/challenge/resolver-envelope');

    const resolveOutcome = (input: { runState: RunStateV1; encounter: EncounterSnapshotV1 }) => {
      const playerInput = {
        recommendedActionId: 'bait-counter',
        note: '先观察再出手。',
      };
      const resolverEnvelope = buildChallengeResolverEnvelope({
        runState: input.runState,
        encounter: input.encounter,
        playerInput,
      });
      return buildSystemFallbackResolution({
        runState: input.runState,
        encounter: input.encounter,
        playerInput,
        resolverEnvelope,
      }).adjudication.outcome;
    };

    expect(
      resolveOutcome({
        runState: createRunState('battle'),
        encounter: {
          ...createEncounter('battle'),
          enemySnapshot: null,
        },
      })
    ).toBe('costly_victory');

    expect(
      resolveOutcome({
        runState: createRunState('elite', {
          worldState: {
            ...createRunState('elite').worldState!,
            tracks: {
              radiance: { current: 40, max: 100 },
              currency: { current: 18, max: null },
            },
          },
        }),
        encounter: createEncounter('elite'),
      })
    ).toBe('costly_victory');

    expect(
      resolveOutcome({
        runState: createRunState('boss', {
          worldState: {
            ...createRunState('boss').worldState!,
            tracks: {
              hp: { current: 20, max: 100 },
              currency: { current: 18, max: null },
            },
          },
        }),
        encounter: createEncounter('boss'),
      })
    ).toBe('costly_victory');

    expect(
      resolveOutcome({
        runState: createRunState('event'),
        encounter: createEventEncounter(),
      })
    ).toBe('costly_victory');
  });

  test('system fallback 会按 deterministic 评分表给出 battle/elite/boss/event outcome', async () => {
    const { buildChallengeResolverEnvelope, buildSystemFallbackResolution } = await import('@/lib/challenge/resolver-envelope');

    const resolveOutcome = (input: { runState: RunStateV1; encounter: EncounterSnapshotV1 }) => {
      const playerInput = {
        recommendedActionId: 'bait-counter',
        note: '无论怎么写都不该影响 deterministic fallback。',
      };
      const resolverEnvelope = buildChallengeResolverEnvelope({
        runState: input.runState,
        encounter: input.encounter,
        playerInput,
      });
      return buildSystemFallbackResolution({
        runState: input.runState,
        encounter: input.encounter,
        playerInput,
        resolverEnvelope,
      }).adjudication.outcome;
    };

    expect(
      resolveOutcome({
        runState: createRunState('battle', {
          playerSnapshot: {
            ...createPlayerSnapshot(),
            strengthTier: 'boss',
          },
          worldState: createWorldStateTracks({
            tracks: {
              hp: { current: 90, max: 100 },
              radiance: { current: 70, max: 100 },
              currency: { current: 18, max: null },
            },
            temporaryStatuses: [],
          }),
        }),
        encounter: createEncounter('battle'),
      })
    ).toBe('victory');

    expect(
      resolveOutcome({
        runState: createRunState('battle', {
          worldState: createWorldStateTracks({
            tracks: {
              hp: { current: 18, max: 100 },
              radiance: { current: 10, max: 100 },
              currency: { current: 18, max: null },
            },
            temporaryStatuses: ['shaken'],
          }),
        }),
        encounter: {
          ...createEncounter('battle'),
          enemySnapshot: {
            ...createEncounter('battle').enemySnapshot!,
            strengthTier: 'boss',
          },
        },
      })
    ).toBe('defeat');

    expect(
      resolveOutcome({
        runState: createRunState('elite', {
          playerSnapshot: {
            ...createPlayerSnapshot(),
            strengthTier: 'elite',
          },
          worldState: createWorldStateTracks({
            tracks: {
              hp: { current: 55, max: 100 },
              radiance: { current: 40, max: 100 },
              currency: { current: 18, max: null },
            },
            temporaryStatuses: [],
          }),
        }),
        encounter: createEncounter('elite'),
      })
    ).toBe('costly_victory');

    expect(
      resolveOutcome({
        runState: createRunState('boss', {
          playerSnapshot: {
            ...createPlayerSnapshot(),
            strengthTier: 'boss',
          },
          worldState: createWorldStateTracks({
            tracks: {
              hp: { current: 20, max: 100 },
              radiance: { current: 90, max: 100 },
              currency: { current: 18, max: null },
            },
            temporaryStatuses: [],
          }),
        }),
        encounter: createEncounter('boss'),
      })
    ).toBe('defeat');

    expect(
      resolveOutcome({
        runState: createRunState('event', {
          worldState: createWorldStateTracks({
            tracks: {
              hp: { current: 90, max: 100 },
              radiance: { current: 90, max: 100 },
              currency: { current: 18, max: null },
            },
            temporaryStatuses: [],
          }),
        }),
        encounter: {
          ...createEventEncounter(),
          enemySnapshot: {
            version: 1,
            sourceType: 'preset',
            sourceId: 'enemy-event-1',
            displayName: '镜砂',
            strengthTier: 'common',
            combatProfile: {},
            tags: ['event'],
            promptSummary: '擅长制造错位感。',
          },
        },
      })
    ).toBe('victory');
  });

  test('event fallback 在 defeat 路径下会复用 battle preset，并裁到 event envelope 范围内', async () => {
    const { buildChallengeResolverEnvelope, buildSystemFallbackResolution, validateAdjudicationAgainstEnvelope } = await import(
      '@/lib/challenge/resolver-envelope'
    );

    const runState = createRunState('event', {
      worldState: createWorldStateTracks({
        tracks: {
          hp: { current: 10, max: 100 },
          radiance: { current: 10, max: 100 },
          currency: { current: 18, max: null },
        },
        temporaryStatuses: ['shaken'],
      }),
    });
    const encounter: EncounterSnapshotV1 = {
      ...createEventEncounter(),
      enemySnapshot: {
        version: 1,
        sourceType: 'preset',
        sourceId: 'enemy-event-2',
        displayName: '夜纱',
        strengthTier: 'boss',
        combatProfile: {},
        tags: ['event'],
        promptSummary: '擅长诱导与误导。',
      },
    };
    const playerInput = {
      recommendedActionId: 'bait-counter',
      note: '保持观察。',
    };

    const resolverEnvelope = buildChallengeResolverEnvelope({
      runState,
      encounter,
      playerInput,
    });
    const fallback = buildSystemFallbackResolution({
      runState,
      encounter,
      playerInput,
      resolverEnvelope,
    });

    expect(fallback.adjudication.outcome).toBe('defeat');
    expect(fallback.adjudication.trackDeltas).toEqual({
      hp: -20,
      radiance: -18,
      currency: 0,
    });
    expect(() => validateAdjudicationAgainstEnvelope(resolverEnvelope, fallback.adjudication)).not.toThrow();
  });

  test('当首轮与次轮 meta 校验都失败时，会降级为系统 fallback 结算', async () => {
    const { adjudicateChallengeNode } = await import('@/lib/challenge/server/adjudicate-stream');
    const attemptErrors: string[] = [];

    const result = await adjudicateChallengeNode(
      {
        runState: createRunState('elite'),
        encounter: createEncounter('elite'),
        playerInput: {
          recommendedActionId: 'advance-pressure',
          note: '直接硬拼把节奏抢下来。',
        },
      },
      {
        generateAttempt: async () => ({
          markdown: [
            '这是一段会被判定越界的正文。',
            '<!-- MAHOSHOJO_ARENA_META {"version":1,"adjudication":{"outcome":"victory","trackDeltas":{"hp":-999},"addStatuses":[],"removeStatuses":[],"rewardOptionId":null,"summary":"越界"}} -->',
          ].join('\n'),
        }),
        onAttemptError: (error) => {
          attemptErrors.push(error.message);
        },
      }
    );

    expect(result.finalSource).toBe('system-fallback');
    expect(result.adjudication.outcome).toBeDefined();
    expect(result.storyMarkdown.includes('MAHOSHOJO_ARENA_META')).toBe(false);
    expect(attemptErrors).toHaveLength(2);
  });

  test('校验通过后的 AI 裁定会先应用 clamp 后的 trackDeltas，再同步 run status 与 checkpoint', async () => {
    const { adjudicateChallengeNode } = await import('@/lib/challenge/server/adjudicate-stream');

    const result = await adjudicateChallengeNode(
      {
        runState: createRunState('boss'),
        encounter: createEncounter('boss'),
        playerInput: {
          recommendedActionId: 'focus-barrier',
          note: '先稳住，再抓她压上的那一下。',
        },
      },
      {
        generateAttempt: async () => ({
          markdown: [
            '雾灯在关键时刻稳住姿态，顶住了千日红的连续压迫，并在交换后完成反杀。',
            '<!-- MAHOSHOJO_ARENA_META {"version":1,"adjudication":{"outcome":"victory","trackDeltas":{"hp":-24,"radiance":-18,"currency":30},"addStatuses":[],"removeStatuses":["exposed"],"rewardOptionId":null,"summary":"付出代价后完成终局取胜。"}} -->',
          ].join('\n'),
        }),
      }
    );

    expect(result.finalSource).toBe('ai');
    expect(result.nextRunState.worldState?.tracks.hp.current).toBeGreaterThanOrEqual(0);
    expect(result.nextRunState.status).toBe('completed');
    expect(result.checkpoints.at(-1)?.kind).toBe('finished');
  });
});
