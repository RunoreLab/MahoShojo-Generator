import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { advanceMapVisibility } from '@/lib/challenge/map';
import { acceptBootstrapSnapshot } from '@/lib/challenge/progression';
import type { ChallengeCheckpointRecord, ChallengeNodeRecord, ChallengeRunRecord, EncounterSnapshotV1 } from '@/lib/challenge/types';
import { buildArenaBootstrapSnapshot } from '@/lib/challenge/worlds/arena/bootstrap';

const mockCharacterCard = {
  id: 'card-mist-lamp',
  codename: '雾灯',
  magicalGirl: {
    codename: '雾灯',
  },
  magicConstruct: {
    name: '雾灯杖',
    description: '擅长中距离压制与空间整理。',
  },
  blooming: {
    powerLevel: 'leaf',
  },
  analysis: {
    personalityAnalysis: '克制谨慎，重视观察窗口。',
    abilityReasoning: '偏向中距离压制与节奏控制。',
    coreTraits: ['冷静', '谨慎'],
    predictionBasis: '长期独处与巡夜经验让她更擅长试探与拉扯。',
  },
  buildState: {
    primaryRuleId: 'arena-trpg-lite',
    rules: [
      {
        ruleId: 'arena-trpg-lite',
        version: '1.0.0',
        blockResults: {
          powerLevel: 'leaf',
          coreAttributes: {
            STR: 44,
            CON: 46,
            AGI: 40,
            MAG: 52,
            WILL: 48,
            PER: 32,
            CHM: 28,
          },
          specialties: ['magic-bullet', 'magic-shield'],
        },
        derived: {
          HP: 9,
          MP: 13,
          Radiance: 10,
        },
      },
    ],
  },
};

const createAcceptedRunState = () => {
  const bootstrap = buildArenaBootstrapSnapshot(mockCharacterCard, { snapshotSeed: 'seed-a' });
  return acceptBootstrapSnapshot(
    {
      runId: 'run-page-1',
      worldPresetId: 'arena',
      playerSnapshot: bootstrap.playerSnapshot,
      initialWorldState: bootstrap.initialWorldState,
      usedBootstrapReroll: false,
      startedAt: 100,
    },
    {
      snapshotSeed: 'seed-a',
      createRunSeed: () => 'run-seed-page',
      now: 120,
    }
  ).runState;
};

const createBattleEncounter = (): EncounterSnapshotV1 => ({
  version: 1,
  nodeId: 'L1-N1',
  templateId: 'arena-battle-placeholder',
  kind: 'battle',
  inputMode: 'recommended-action-plus-free-intent',
  enemySnapshot: {
    version: 1,
    sourceType: 'preset',
    sourceId: 'preset-snowy',
    displayName: '雪绒',
    strengthTier: 'common',
    combatProfile: {},
    tags: ['游击', '机动'],
    promptSummary: '善于高速游走与试探的竞技场魔法少女。',
  },
  rewardOptions: [],
  eventOptions: [],
  shopOffers: [],
});

describe('challenge page', () => {
  test('路由首屏显示本轮挑战与世界入口，且 SSR 渲染路径不会因本地存储崩溃', async () => {
    const { default: Challenge } = await import('@/pages/challenge');
    const html = renderToStaticMarkup(<Challenge />);

    expect(html).toContain('本轮挑战');
    expect(html).toContain('魔法少女竞技场');
    expect(html).toContain('继续挑战');
  });

  test('ChallengeBootstrapPanel 显示竞技场快照摘要与一次免费重掷', async () => {
    const { ChallengeBootstrapPanel } = await import('@/components/challenge/ChallengeBootstrapPanel');
    const bootstrap = buildArenaBootstrapSnapshot(mockCharacterCard, { snapshotSeed: 'seed-a' });

    const html = renderToStaticMarkup(
      <ChallengeBootstrapPanel
        worldTitle="魔法少女竞技场"
        playerSnapshot={bootstrap.playerSnapshot}
        usedBootstrapReroll={false}
        onReroll={() => {}}
        onAccept={() => {}}
        onBack={() => {}}
      />
    );

    expect(html).toContain('竞技场快照确认');
    expect(html).toContain('一次免费重掷');
    expect(html).toContain('战斗定位');
    expect(html).toContain('关键动作倾向');
  });

  test('ChallengeMapPage 显示 14 个节点与当前状态摘要', async () => {
    const { ChallengeMapPage } = await import('@/components/challenge/ChallengeMapPage');
    const runState = createAcceptedRunState();

    const html = renderToStaticMarkup(
      <ChallengeMapPage
        worldTitle="魔法少女竞技场"
        runState={runState}
        latestNodeSummary="上一节点：平稳推进"
        onEnterNode={() => {}}
      />
    );

    expect(html).toContain('挑战地图');
    expect(html).toContain('节点总数 14');
    expect(html).toContain('当前状态');
    expect(html).toContain('L1-N1');
  });

  test('地图可进入节点只允许当前路径的下一层，不允许跳层', async () => {
    const { getSelectableNodeIdsForMap } = await import('@/components/challenge/hooks/useChallengeController');

    const initialRunState = createAcceptedRunState();
    expect(getSelectableNodeIdsForMap(initialRunState)).toEqual(['L1-N1', 'L1-N2']);

    const advancedRunState = {
      ...initialRunState,
      visitedNodeCount: 1,
      mapState: initialRunState.mapState ? advanceMapVisibility(initialRunState.mapState, 'L1-N1') : null,
    };
    expect(getSelectableNodeIdsForMap(advancedRunState)).toEqual(['L2-N1', 'L2-N2']);
  });

  test('deriveChallengeResumeState 会优先恢复 entered 节点的冻结快照与输入草稿', async () => {
    const { deriveChallengeResumeState } = await import('@/components/challenge/hooks/useChallengeController');

    const runState = {
      ...createAcceptedRunState(),
      currentNodeId: 'L1-N1',
    };
    const runRecord: ChallengeRunRecord = {
      id: 'run-resume-entered',
      worldPresetId: 'arena',
      status: 'in_progress',
      snapshotSeed: 'snap-a',
      runSeed: 'run-seed-page',
      usedBootstrapReroll: false,
      playerSnapshot: runState.playerSnapshot,
      runState,
      currentStateDigest: null,
      currentNodeId: 'L1-N1',
      visitedNodeCount: 0,
      lastResolvedNodeId: null,
      lastCheckpointId: 'checkpoint-a',
      startedAt: 100,
      updatedAt: 120,
      finishedAt: null,
    };
    const latestNodeRecord: ChallengeNodeRecord = {
      id: 'node-entered-1',
      runId: 'run-resume-entered',
      nodeId: 'L1-N1',
      visitIndex: 1,
      nodeType: 'battle',
      status: 'entered',
      encounterSnapshot: createBattleEncounter(),
      playerInput: {
        recommendedActionId: 'bait-counter',
        optionId: '',
        note: '先观察她的起手，再抓回合差。',
      },
      resolverEnvelope: null,
      adjudicationResultDigest: null,
      storyText: null,
      createdAt: 121,
      resolvedAt: null,
    };

    const resumeState = deriveChallengeResumeState({
      runRecord,
      latestCheckpoint: null,
      latestNodeRecord,
    });

    expect(resumeState.stage).toBe('node');
    expect(resumeState.currentEncounter?.nodeId).toBe('L1-N1');
    expect(resumeState.note).toBe('先观察她的起手，再抓回合差。');
    expect(resumeState.selectedRecommendedActionId).toBe('bait-counter');
  });

  test('deriveChallengeResumeState 会在 run record 落后时优先采用最新 checkpoint 快照', async () => {
    const { deriveChallengeResumeState } = await import('@/components/challenge/hooks/useChallengeController');

    const staleRunState = createAcceptedRunState();
    const resolvedRunState = {
      ...staleRunState,
      visitedNodeCount: 1,
      currentNodeId: 'L1-N1',
      mapState: staleRunState.mapState ? advanceMapVisibility(staleRunState.mapState, 'L1-N1') : null,
    };
    const runRecord: ChallengeRunRecord = {
      id: 'run-resume-checkpoint',
      worldPresetId: 'arena',
      status: 'in_progress',
      snapshotSeed: 'snap-b',
      runSeed: 'run-seed-page',
      usedBootstrapReroll: false,
      playerSnapshot: staleRunState.playerSnapshot,
      runState: staleRunState,
      currentStateDigest: null,
      currentNodeId: null,
      visitedNodeCount: 0,
      lastResolvedNodeId: null,
      lastCheckpointId: 'checkpoint-node',
      startedAt: 100,
      updatedAt: 120,
      finishedAt: null,
    };
    const latestCheckpoint: ChallengeCheckpointRecord = {
      id: 'checkpoint-node',
      runId: 'run-resume-checkpoint',
      seq: 2,
      kind: 'node_resolved',
      snapshot: {
        runState: resolvedRunState,
        playerSnapshot: resolvedRunState.playerSnapshot,
        lastResolvedNodeId: 'L1-N1',
        pendingRewardChoice: null,
      },
      createdAt: 130,
    };

    const resumeState = deriveChallengeResumeState({
      runRecord,
      latestCheckpoint,
      latestNodeRecord: null,
    });

    expect(resumeState.stage).toBe('map');
    expect(resumeState.runState?.visitedNodeCount).toBe(1);
    expect(resumeState.runState?.currentNodeId).toBeNull();
  });

  test('NodeResolutionPanel 为战斗节点显示推荐动作、自由意图与结算入口', async () => {
    const { NodeResolutionPanel } = await import('@/components/challenge/NodeResolutionPanel');

    const html = renderToStaticMarkup(
      <NodeResolutionPanel
        encounter={createBattleEncounter()}
        latestStoryText=""
        isResolving={false}
        note=""
        selectedOptionId=""
        selectedRecommendedActionId="advance-pressure"
        onRecommendedActionChange={() => {}}
        onSelectOption={() => {}}
        onNoteChange={() => {}}
        onResolve={() => {}}
        onBackToMap={() => {}}
      />
    );

    expect(html).toContain('雪绒');
    expect(html).toContain('推荐动作');
    expect(html).toContain('自由意图');
    expect(html).toContain('提交结算');
  });

  test('ChallengeSummaryPage 显示本轮结果与返回大厅入口', async () => {
    const { ChallengeSummaryPage } = await import('@/components/challenge/ChallengeSummaryPage');
    const runState = {
      ...createAcceptedRunState(),
      status: 'completed' as const,
      visitedNodeCount: 8,
    };

    const html = renderToStaticMarkup(
      <ChallengeSummaryPage
        worldTitle="魔法少女竞技场"
        runState={runState}
        summaryText="雾灯成功穿过整轮赛程，最终守住了舞台。"
        onBackToLobby={() => {}}
      />
    );

    expect(html).toContain('本轮挑战结算');
    expect(html).toContain('挑战成功');
    expect(html).toContain('已完成节点 8');
    expect(html).toContain('返回大厅');
  });
});
