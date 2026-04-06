import React from 'react';
import { beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import '@/tests/helpers/fake-indexeddb';

import { __resetAiSessionDbForTest } from '@/lib/ai-session/storage';
import { AI_SESSION_DB_NAME } from '@/lib/ai-session/types';
import { advanceMapVisibility } from '@/lib/challenge/map';
import { acceptBootstrapSnapshot } from '@/lib/challenge/progression';
import type { ChallengeCheckpointRecord, ChallengeNodeRecord, ChallengeRunRecord, EncounterSnapshotV1 } from '@/lib/challenge/types';
import { buildArenaBootstrapSnapshot } from '@/lib/challenge/worlds/arena/bootstrap';
import { clearPublicCardMemoryCacheForTest } from '@/lib/public-card-cache/shared-loader';

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
  beforeEach(async () => {
    clearPublicCardMemoryCacheForTest();
    await __resetAiSessionDbForTest();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(AI_SESSION_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'));
      request.onblocked = () => resolve();
    });
  });

  test('prepare 错误会按 code 分流到 selection / editor / global', async () => {
    const { getChallengePrepareErrorTarget } = await import('@/components/challenge/hooks/useChallengeController');
    const { createChallengeEntrantError } = await import('@/lib/challenge/entrant-import');

    expect(getChallengePrepareErrorTarget(createChallengeEntrantError('entrant-required'))).toBe('selection');
    expect(getChallengePrepareErrorTarget(createChallengeEntrantError('json-parse'))).toBe('editor');
    expect(getChallengePrepareErrorTarget(createChallengeEntrantError('single-card-only'))).toBe('editor');
    expect(getChallengePrepareErrorTarget(new Error('其他错误'))).toBe('global');
  });

  test('useChallengeController 初始不会预载试玩示例角色', async () => {
    const { useChallengeController } = await import('@/components/challenge/hooks/useChallengeController');

    function ControllerSnapshot() {
      const controller = useChallengeController();
      return (
        <pre>
          {JSON.stringify({
            entrantCards: controller.entrantCards,
            sourceMode: controller.sourceMode,
            selectedEntrantSummary: controller.selectedEntrantSummary,
            rawEditorText: controller.rawEditorText,
          })}
        </pre>
      );
    }

    const html = renderToStaticMarkup(<ControllerSnapshot />);

    expect(html).toContain('&quot;entrantCards&quot;:[]');
    expect(html).toContain('&quot;sourceMode&quot;:null');
    expect(html).toContain('&quot;selectedEntrantSummary&quot;:null');
    expect(html).toContain('&quot;rawEditorText&quot;:&quot;&quot;');
    expect(html).not.toContain('雾灯');
  });

  test('路由首屏显示本轮挑战与世界入口，且 SSR 渲染路径不会因本地存储崩溃', async () => {
    const { default: Challenge } = await import('@/pages/challenge');
    const html = renderToStaticMarkup(<Challenge />);

    expect(html).toContain('本轮挑战');
    expect(html).toContain('挑战模式');
    expect(html).toContain('魔法少女竞技场');
    expect(html).toContain('继续挑战');
    expect(html).toContain('在线角色库 / 随机匹配');
    expect(html).toContain('本地导入');
    expect(html).toContain('高级 JSON 编辑');
    expect(html).toContain('AI 裁定模型');
    expect(html).toContain('自定义 AI 能力提供商');
    expect(html).not.toContain('Challenge Mode');
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
    expect(html).toContain('标准级');
    expect(html).not.toContain('Bootstrap');
  });

  test('ChallengeMapPage 渲染挑战沙盘、图例与节点详情区，而不是节点卡片网格', async () => {
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
    expect(html).toContain('地图总览');
    expect(html).toContain('挑战沙盘');
    expect(html).toContain('地图图例');
    expect(html).toContain('节点情报');
    expect(html).toContain('节点总数 14');
    expect(html).toContain('当前状态');
    expect(html).toContain('L1-N1');
    expect(html).toContain('进入节点');
    expect(html).toContain('首领战');
    expect(html).not.toContain('14 节点路径图');
    expect(html).not.toContain('Map');
    expect(html).not.toContain('Route');
    expect(html).not.toContain('Boss');
    expect(html).not.toContain('Legend');
    expect(html).not.toContain('Detail');
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

  test('ChallengeMapPage 不会把 focused 但不可选的前瞻节点标成可进入', async () => {
    const { ChallengeMapPage } = await import('@/components/challenge/ChallengeMapPage');
    const { getSelectableNodeIdsForMap } = await import('@/components/challenge/hooks/useChallengeController');

    const initialRunState = createAcceptedRunState();
    const advancedRunState = {
      ...initialRunState,
      visitedNodeCount: 1,
      mapState: initialRunState.mapState ? advanceMapVisibility(initialRunState.mapState, 'L1-N1') : null,
    };

    const html = renderToStaticMarkup(
      <ChallengeMapPage
        worldTitle="魔法少女竞技场"
        runState={advancedRunState}
        latestNodeSummary="上一节点：平稳推进"
        onEnterNode={() => {}}
      />
    );

    const enterableBadgeCount = (html.match(/>可进入</g) ?? []).length;
    expect(enterableBadgeCount).toBe(getSelectableNodeIdsForMap(advancedRunState).length);
    expect(html).toContain('前方可见');
  });

  test('resolveEncounterForNode 会通过敌人候选接口冻结 battle 敌人快照，并在降级后写入 preset_only_enemy_mode', async () => {
    const { resolveEncounterForNode } = await import('@/components/challenge/hooks/useChallengeController');

    const runState = createAcceptedRunState();
    let requestedUrl = '';

    const result = await resolveEncounterForNode(runState, 'L1-N1', {
      fetcher: async (input) => {
        requestedUrl = typeof input === 'string' ? input : input.toString();
        return new Response(
          JSON.stringify({
            success: true,
            worldId: 'arena',
            tier: 'common',
            resolvedSourceMode: 'preset-only',
            enemySnapshot: {
              version: 1,
              sourceType: 'preset',
              sourceId: 'preset-b',
              displayName: '远端对手 B',
              strengthTier: 'common',
              combatProfile: {},
              tags: ['common', 'control'],
              promptSummary: '远端候选 B',
            },
            resolvedSourceCardLite: null,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      },
    });

    expect(requestedUrl).toContain('/api/challenge/enemy-candidates');
    expect(requestedUrl).toContain('sourceMode=online-first');
    expect(requestedUrl).toContain('selectionSeed=');
    expect(result.enemySourceMode).toBe('preset-only');
    expect(result.encounter.enemySnapshot?.displayName).toContain('远端对手');
    expect(result.encounter.enemySnapshot?.sourceId).not.toContain('arena-placeholder');
    expect(result.nextRunState.worldState?.runFlags).toContain('preset_only_enemy_mode');
  });

  test('resolveEncounterForNode 会拒绝 public-card + null sidecar 的 selection payload，并回退到本地占位敌人', async () => {
    const { resolveEncounterForNode } = await import('@/components/challenge/hooks/useChallengeController');

    const runState = createAcceptedRunState();
    const originalWarn = console.warn;
    console.warn = () => undefined;

    let result;
    try {
      result = await resolveEncounterForNode(runState, 'L1-N1', {
        fetcher: async () =>
          new Response(
            JSON.stringify({
              success: true,
              worldId: 'arena',
              tier: 'common',
              resolvedSourceMode: 'remote',
              enemySnapshot: {
                version: 1,
                sourceType: 'public-card',
                sourceId: 'public-card-without-sidecar',
                displayName: '坏 payload 对手',
                strengthTier: 'common',
                combatProfile: {},
                tags: ['common'],
                promptSummary: '这个 payload 不应被客户端接受。',
              },
              resolvedSourceCardLite: null,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          ),
      });
    } finally {
      console.warn = originalWarn;
    }

    expect(result.enemySourceMode).toBe('local-placeholder');
    expect(result.encounter.enemySnapshot?.sourceId).toContain('arena-placeholder:');
  });

  test('resolveEncounterForNode 在 run flag 已降级后会固定请求 preset-only 敌人来源', async () => {
    const { resolveEncounterForNode } = await import('@/components/challenge/hooks/useChallengeController');

    const baseRunState = createAcceptedRunState();
    const runState = {
      ...baseRunState,
      worldState: baseRunState.worldState
        ? {
            ...baseRunState.worldState,
            runFlags: [...baseRunState.worldState.runFlags, 'preset_only_enemy_mode'],
          }
        : null,
    };

    let requestedUrl = '';
    await resolveEncounterForNode(runState, 'L1-N2', {
      fetcher: async (input) => {
        requestedUrl = typeof input === 'string' ? input : input.toString();
        return new Response(
          JSON.stringify({
            success: true,
            worldId: 'arena',
            tier: 'common',
            resolvedSourceMode: 'preset-only',
            enemySnapshot: {
              version: 1,
              sourceType: 'preset',
              sourceId: 'preset-only-candidate',
              displayName: '本地预设对手',
              strengthTier: 'common',
              combatProfile: {},
              tags: ['common'],
              promptSummary: '本地预设候选',
            },
            resolvedSourceCardLite: null,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      },
    });

    expect(requestedUrl).toContain('sourceMode=preset-only');
    expect(requestedUrl).toContain('selectionSeed=');
  });

  test('resolveEncounterForNode 在敌人候选接口失败时会回退到本地占位敌人', async () => {
    const { resolveEncounterForNode } = await import('@/components/challenge/hooks/useChallengeController');

    const runState = createAcceptedRunState();
    const originalWarn = console.warn;
    console.warn = () => undefined;

    let result;
    try {
      result = await resolveEncounterForNode(runState, 'L1-N1', {
        fetcher: async () =>
          new Response(JSON.stringify({ error: 'upstream failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
      });
    } finally {
      console.warn = originalWarn;
    }

    expect(result.enemySourceMode).toBe('local-placeholder');
    expect(result.encounter.enemySnapshot?.sourceId).toContain('arena-placeholder:');
    expect(result.encounter.enemySnapshot?.strengthTier).toBe('common');
    expect(result.nextRunState.worldState?.runFlags ?? []).not.toContain('preset_only_enemy_mode');
  });

  test('selection sidecar 会写入共享缓存，并让后续 public-card fallback 命中缓存而不再请求单卡 API', async () => {
    const { fetchChallengePublicCardById, resolveEncounterForNode } = await import('@/components/challenge/hooks/useChallengeController');

    const runState = createAcceptedRunState();
    const sidecar = {
      id: 'card-selection-cache-1',
      name: '共享侧载敌人',
      data: JSON.stringify({
        templateId: '通用角色',
        name: '共享侧载敌人',
        content: '这张卡来自 selection sidecar。',
      }),
      updatedAt: '2026-04-05T12:00:00.000Z',
    } as const;

    const resolved = await resolveEncounterForNode(runState, 'L1-N1', {
      fetcher: async () =>
        new Response(
          JSON.stringify({
            success: true,
            worldId: 'arena',
            tier: 'common',
            resolvedSourceMode: 'remote',
            enemySnapshot: {
              version: 1,
              sourceType: 'public-card',
              sourceId: sidecar.id,
              displayName: sidecar.name,
              strengthTier: 'common',
              combatProfile: {},
              tags: ['common'],
              promptSummary: '来自 selection sidecar 的对手。',
            },
            resolvedSourceCardLite: sidecar,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    });

    expect(resolved.enemySourceCardLite?.id).toBe(sidecar.id);

    clearPublicCardMemoryCacheForTest();

    let networkFetchCount = 0;
    const card = await fetchChallengePublicCardById(sidecar.id, {
      fetcher: async () => {
        networkFetchCount += 1;
        return new Response(
          JSON.stringify({
            success: true,
            card: {
              id: sidecar.id,
              name: '不应再次命中的网络卡',
              data: sidecar.data,
              updated_at: sidecar.updatedAt,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
    });

    expect((card as { name?: string } | null)?.name).toBe(sidecar.name);
    expect(networkFetchCount).toBe(0);
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
        onUserProviderConfigChange={() => {}}
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

  test('NodeResolutionPanel 在结算中会显示流式正文预览', async () => {
    const { NodeResolutionPanel } = await import('@/components/challenge/NodeResolutionPanel');

    const html = renderToStaticMarkup(
      <NodeResolutionPanel
        encounter={createBattleEncounter()}
        latestStoryText="雾灯先稳住脚步，正在读取雪绒的换气节奏。"
        isResolving
        note="先观察，再抓窗口。"
        selectedOptionId=""
        selectedRecommendedActionId="bait-counter"
        onUserProviderConfigChange={() => {}}
        onRecommendedActionChange={() => {}}
        onSelectOption={() => {}}
        onNoteChange={() => {}}
        onResolve={() => {}}
        onBackToMap={() => {}}
      />
    );

    expect(html).toContain('结算中...');
    expect(html).toContain('雾灯先稳住脚步');
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

  test('ChallengeSummaryPage 会展示本轮新解锁', async () => {
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
        summaryText="雾灯成功穿过整轮赛程。"
        newUnlocks={[
          {
            id: 'unlock-1',
            worldPresetId: 'arena',
            runId: 'run-page-1',
            unlockType: 'start-persistent-item-option',
            unlockKey: 'arena.start_persistent_item_option.starlit-ribbon',
            title: '起始奇物：星辉缎带',
            description: '首次通关后解锁的起始奇物候选。',
            sourceNodeId: null,
            createdAt: 200,
          },
        ]}
        onBackToLobby={() => {}}
      />
    );

    expect(html).toContain('本轮新解锁');
    expect(html).toContain('星辉缎带');
  });
});
