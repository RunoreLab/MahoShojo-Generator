import React from 'react';
import { beforeEach, describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import '@/tests/helpers/fake-indexeddb';

import { AI_SESSION_DB_NAME } from '@/lib/ai-session/types';
import { __resetAiSessionDbForTest } from '@/lib/ai-session/storage';
import type { ChallengeNodeRecord, ChallengeUnlockRecord, RunStateV1 } from '@/lib/challenge/types';

const createRunState = (
  status: RunStateV1['status'],
  overrides: Partial<RunStateV1> = {}
): RunStateV1 => ({
  version: 1,
  runId: 'run-unlock',
  worldPresetId: 'arena',
  runSeed: 'run-seed-unlock',
  status,
  playerSnapshot: null,
  worldState: {
    version: 1,
    schemaId: 'arena-v1',
    tracks: {
      hp: { current: status === 'failed' ? 0 : 40, max: 100 },
      radiance: { current: 20, max: 100 },
      currency: { current: 18, max: null },
    },
    temporaryStatuses: [],
    runFlags: [],
    persistentItemIds: [],
    consumableIds: [],
  },
  mapState: null,
  pendingRewardChoice: null,
  currentNodeId: overrides.currentNodeId ?? 'L1-N1',
  visitedNodeCount: 3,
  checkpointSeq: 2,
  usedBootstrapReroll: false,
  startedAt: 10,
  updatedAt: 20,
  ...overrides,
});

const createNodeRecord = (
  input: Partial<ChallengeNodeRecord> & Pick<ChallengeNodeRecord, 'nodeId' | 'nodeType' | 'runId'>
): ChallengeNodeRecord => ({
  id: `node-${input.nodeId}`,
  runId: input.runId,
  nodeId: input.nodeId,
  visitIndex: input.visitIndex ?? 1,
  nodeType: input.nodeType,
  status: input.status ?? 'resolved',
  encounterSnapshot: input.encounterSnapshot ?? null,
  playerInput: input.playerInput ?? null,
  resolverEnvelope: input.resolverEnvelope ?? null,
  adjudicationResultDigest: input.adjudicationResultDigest ?? null,
  storyText: input.storyText ?? null,
  createdAt: input.createdAt ?? 10,
  resolvedAt: input.resolvedAt ?? 20,
});

describe('challenge unlocks', () => {
  beforeEach(async () => {
    await __resetAiSessionDbForTest();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(AI_SESSION_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'));
      request.onblocked = () => resolve();
    });
  });

  test('grantChallengeUnlocks 会在首次失败、首次击败精英、首次通关时写入最小解锁闭包', async () => {
    const { grantChallengeUnlocks } = await import('@/lib/challenge/unlocks');

    const firstFailure = await grantChallengeUnlocks({
      runId: 'run-failure',
      worldPresetId: 'arena',
      runState: createRunState('failed', { runId: 'run-failure' }),
      nodeRecord: createNodeRecord({
        runId: 'run-failure',
        nodeId: 'L3-N2',
        nodeType: 'battle',
      }),
      now: 100,
    });
    const eliteVictory = await grantChallengeUnlocks({
      runId: 'run-elite',
      worldPresetId: 'arena',
      runState: createRunState('in_progress', {
        runId: 'run-elite',
        worldState: {
          ...createRunState('in_progress').worldState!,
          runFlags: ['elite_defeated'],
        },
      }),
      nodeRecord: createNodeRecord({
        runId: 'run-elite',
        nodeId: 'L4-N1',
        nodeType: 'elite',
      }),
      now: 200,
    });
    const firstCompletion = await grantChallengeUnlocks({
      runId: 'run-completed',
      worldPresetId: 'arena',
      runState: createRunState('completed', { runId: 'run-completed' }),
      nodeRecord: createNodeRecord({
        runId: 'run-completed',
        nodeId: 'L8-N1',
        nodeType: 'boss',
      }),
      now: 300,
    });

    expect(firstFailure.map((item) => item.unlockKey)).toContain('arena.start_action_option.moon-slice');
    expect(eliteVictory.map((item) => item.unlockKey)).toContain('arena.start_action_option.guard-weave');
    expect(firstCompletion.map((item) => item.unlockKey)).toContain('arena.start_persistent_item_option.starlit-ribbon');
  });

  test('grantChallengeUnlocks 会在首次遭遇敌人与首次完成事件时写入敌人/事件记录，并自动去重', async () => {
    const { grantChallengeUnlocks, listChallengeUnlocksByWorld } = await import('@/lib/challenge/unlocks');

    const enemyUnlocks = await grantChallengeUnlocks({
      runId: 'run-enemy',
      worldPresetId: 'arena',
      runState: createRunState('in_progress', { runId: 'run-enemy' }),
      nodeRecord: createNodeRecord({
        runId: 'run-enemy',
        nodeId: 'L1-N1',
        nodeType: 'battle',
        encounterSnapshot: {
          version: 1,
          nodeId: 'L1-N1',
          templateId: 'arena-battle-L1-N1',
          kind: 'battle',
          inputMode: 'recommended-action-plus-free-intent',
          enemySnapshot: {
            version: 1,
            sourceType: 'preset',
            sourceId: 'preset:snowy',
            displayName: '雪绒',
            strengthTier: 'common',
            combatProfile: {},
            tags: ['游击'],
            promptSummary: '善于高速游走。',
          },
          rewardOptions: [],
          eventOptions: [],
          shopOffers: [],
        },
      }),
      now: 100,
    });

    const eventUnlocks = await grantChallengeUnlocks({
      runId: 'run-event',
      worldPresetId: 'arena',
      runState: createRunState('in_progress', { runId: 'run-event' }),
      nodeRecord: createNodeRecord({
        runId: 'run-event',
        nodeId: 'L2-N1',
        nodeType: 'event',
        encounterSnapshot: {
          version: 1,
          nodeId: 'L2-N1',
          templateId: 'arena-event-L2-N1',
          kind: 'event',
          inputMode: 'choice-only',
          enemySnapshot: null,
          rewardOptions: [],
          eventOptions: [],
          shopOffers: [],
        },
      }),
      now: 200,
    });

    await grantChallengeUnlocks({
      runId: 'run-enemy-repeat',
      worldPresetId: 'arena',
      runState: createRunState('in_progress', { runId: 'run-enemy-repeat' }),
      nodeRecord: createNodeRecord({
        runId: 'run-enemy-repeat',
        nodeId: 'L3-N2',
        nodeType: 'battle',
        encounterSnapshot: {
          version: 1,
          nodeId: 'L3-N2',
          templateId: 'arena-battle-L3-N2',
          kind: 'battle',
          inputMode: 'recommended-action-plus-free-intent',
          enemySnapshot: {
            version: 1,
            sourceType: 'preset',
            sourceId: 'preset:snowy',
            displayName: '雪绒',
            strengthTier: 'common',
            combatProfile: {},
            tags: ['游击'],
            promptSummary: '善于高速游走。',
          },
          rewardOptions: [],
          eventOptions: [],
          shopOffers: [],
        },
      }),
      now: 300,
    });

    const allUnlocks = await listChallengeUnlocksByWorld('arena');

    expect(enemyUnlocks.map((item) => item.unlockType)).toContain('enemy-log');
    expect(eventUnlocks.map((item) => item.unlockType)).toContain('event-log');
    expect(allUnlocks.filter((item) => item.unlockKey === 'arena.enemy_log.preset:snowy')).toHaveLength(1);
  });

  test('ChallengeUnlockPanel 会展示四类本地解锁，并显示最近解锁列表', async () => {
    const { ChallengeUnlockPanel } = await import('@/components/challenge/ChallengeUnlockPanel');

    const unlocks: ChallengeUnlockRecord[] = [
      {
        id: 'unlock-1',
        worldPresetId: 'arena',
        runId: 'run-a',
        unlockType: 'enemy-log',
        unlockKey: 'arena.enemy_log.preset:snowy',
        title: '敌人记录：雪绒',
        description: '记录了雪绒的基础战斗印象。',
        sourceNodeId: 'L1-N1',
        createdAt: 100,
      },
      {
        id: 'unlock-2',
        worldPresetId: 'arena',
        runId: 'run-b',
        unlockType: 'event-log',
        unlockKey: 'arena.event_log.arena-event-L2-N1',
        title: '事件记录：追踪异常波动',
        description: '记录了一次特殊事件的处理经验。',
        sourceNodeId: 'L2-N1',
        createdAt: 110,
      },
      {
        id: 'unlock-3',
        worldPresetId: 'arena',
        runId: 'run-c',
        unlockType: 'start-action-option',
        unlockKey: 'arena.start_action_option.moon-slice',
        title: '起始动作：月痕斩',
        description: '首次失败后解锁的起始动作候选。',
        sourceNodeId: null,
        createdAt: 120,
      },
      {
        id: 'unlock-4',
        worldPresetId: 'arena',
        runId: 'run-d',
        unlockType: 'start-persistent-item-option',
        unlockKey: 'arena.start_persistent_item_option.starlit-ribbon',
        title: '起始奇物：星辉缎带',
        description: '首次通关后解锁的起始奇物候选。',
        sourceNodeId: null,
        createdAt: 130,
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(ChallengeUnlockPanel, { unlocks })
    );

    expect(html).toContain('敌人记录');
    expect(html).toContain('事件记录');
    expect(html).toContain('起始动作候选');
    expect(html).toContain('起始奇物候选');
    expect(html).toContain('最近解锁');
    expect(html).toContain('星辉缎带');
  });
});
