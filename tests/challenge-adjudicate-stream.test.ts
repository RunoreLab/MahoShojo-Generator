import { describe, expect, test } from 'bun:test';

import type {
  EncounterSnapshotV1,
  PlayerSnapshotV1,
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

const createRunState = (): RunStateV1 => ({
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
  mapState: null,
  pendingRewardChoice: null,
  currentNodeId: 'L1-N1',
  visitedNodeCount: 0,
  checkpointSeq: 1,
  usedBootstrapReroll: false,
  startedAt: 1,
  updatedAt: 1,
});

const createEncounter = (): EncounterSnapshotV1 => ({
  version: 1,
  nodeId: 'L1-N1',
  templateId: 'arena-battle-L1-N1',
  kind: 'battle',
  inputMode: 'recommended-action-plus-free-intent',
  enemySnapshot: {
    version: 1,
    sourceType: 'preset',
    sourceId: 'enemy-1',
    displayName: '雪绒',
    strengthTier: 'common',
    combatProfile: {},
    tags: ['battle'],
    promptSummary: '对手擅长压迫与节奏争夺。',
  },
  rewardOptions: [],
  eventOptions: [],
  shopOffers: [],
});

describe('challenge adjudicate stream prompt', () => {
  test('prompt 不再包含 recommendedOutcome，并明确玩家输入只是待验证意图', async () => {
    const { buildChallengeResolverEnvelope } = await import('@/lib/challenge/resolver-envelope');
    const { buildChallengeAdjudicationPrompt } = await import('@/lib/challenge/server/adjudicate-stream');

    const runState = createRunState();
    const encounter = createEncounter();
    const playerInput = {
      recommendedActionId: 'bait-counter',
      optionId: '',
      note: '先观察，再找机会。',
    };

    const prompt = buildChallengeAdjudicationPrompt({
      runState,
      encounter,
      playerInput,
      resolverEnvelope: buildChallengeResolverEnvelope({ runState, encounter, playerInput }),
      attemptIndex: 0,
    });

    expect(prompt).not.toContain('recommendedOutcome');
    expect(prompt).toContain('recommendedActionId');
    expect(prompt).toContain('只是玩家意图');
    expect(prompt).toContain('不保证其有效');
    expect(prompt).toContain('敌我角色设定、强度、当前状态、资源与节点强度');
    expect(prompt).toContain('玩家输入只能作为待验证假设');
    expect(prompt).toContain('独立判断这套意图是否成立');
    expect(prompt).toContain('不要因为玩家自称稳健、偷袭成功、轻松拿下，就直接给出更优 outcome');
  });
});
