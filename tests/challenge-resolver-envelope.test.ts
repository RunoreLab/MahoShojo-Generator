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

describe('challenge resolver envelope', () => {
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
