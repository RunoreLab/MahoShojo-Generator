import { describe, expect, test } from 'vitest';

import { generateChallengeMap } from '@/lib/challenge/map';
import {
  applySelectedRewardOption,
  buildRestEncounterSnapshot,
  buildShopEncounterSnapshot,
  finalizeNodeResolution,
  resolveSystemNode,
  setPendingRewardChoiceFromEnvelope,
  writeRunFlagsAfterNode,
} from '@/lib/challenge/progression';

const createBaseRunState = () => ({
  version: 1 as const,
  runId: 'run-1',
  worldPresetId: 'arena' as const,
  runSeed: 'run-a',
  status: 'in_progress' as const,
  playerSnapshot: null,
  worldState: {
    version: 1 as const,
    schemaId: 'arena-v1',
    tracks: {
      hp: { current: 60, max: 100 },
      radiance: { current: 40, max: 100 },
      currency: { current: 50, max: null },
    },
    temporaryStatuses: [],
    runFlags: [],
    persistentItemIds: [],
    consumableIds: [],
  },
  mapState: generateChallengeMap({ runSeed: 'run-a', worldPresetId: 'arena' }),
  pendingRewardChoice: null,
  currentNodeId: 'L2-N1',
  visitedNodeCount: 1,
  checkpointSeq: 1,
  usedBootstrapReroll: false,
  startedAt: 1,
  updatedAt: 1,
});

const withCurrentNode = (
  runState: ReturnType<typeof createBaseRunState>,
  nodeId: string,
  nodeType: 'battle' | 'elite' | 'event' | 'rest' | 'shop' | 'boss'
) => ({
  ...runState,
  currentNodeId: nodeId,
  mapState: runState.mapState
    ? {
        ...runState.mapState,
        nodes: runState.mapState.nodes.map((node) =>
          node.nodeId === nodeId ? { ...node, nodeType } : node
        ),
      }
    : null,
});

describe('challenge progression', () => {
  test('rest 节点固定提供静养/调律/稳态整理三项，且稳态整理在没有负面状态时禁用', () => {
    const encounter = buildRestEncounterSnapshot(createBaseRunState());

    expect(encounter.eventOptions.map((item) => item.label)).toEqual(['静养', '调律', '稳态整理']);
    expect(encounter.eventOptions.find((item) => item.label === '稳态整理')?.disabled).toBe(true);
  });

  test('shop 节点固定生成 3 个货品，只允许买 0 或 1 个，槽位满时对应货品禁用', () => {
    const runState = {
      ...createBaseRunState(),
      worldState: {
        ...createBaseRunState().worldState,
        persistentItemIds: ['item-a', 'item-b', 'item-c'],
      },
    };

    const encounter = buildShopEncounterSnapshot(runState);

    expect(encounter.shopOffers).toHaveLength(3);
    expect(
      encounter.shopOffers.every((offer) =>
        ['add_consumable', 'add_persistent_item', 'add_status', 'clear_negative_status'].includes(offer.reward.kind)
      )
    ).toBe(true);
    expect(
      encounter.shopOffers.some((offer) => offer.reward.kind === 'add_persistent_item' && offer.disabled)
    ).toBe(true);
  });

  test('setPendingRewardChoiceFromEnvelope 会在 choose-one 模式下挂起奖励选择', () => {
    const next = setPendingRewardChoiceFromEnvelope(createBaseRunState(), {
      rewardSelectionMode: 'choose-one',
      rewardOptionIds: ['reward-a', 'reward-b'],
      sourceNodeId: 'node-1',
    });

    expect(next.pendingRewardChoice?.selectionMode).toBe('choose-one');
    expect(next.pendingRewardChoice?.rewardOptionIds).toEqual(['reward-a', 'reward-b']);
  });

  test('applySelectedRewardOption 会在玩家选定奖励后写入 tracks，并在完成后生成 reward_applied checkpoint', () => {
    const result = applySelectedRewardOption(
      {
        ...createBaseRunState(),
        pendingRewardChoice: {
          selectionMode: 'choose-one',
          rewardOptionIds: ['reward-a', 'reward-b'],
          sourceNodeId: 'node-1',
        },
      },
      {
        version: 1,
        rewardOptionId: 'reward-a',
        kind: 'adjust_track',
        label: '急救包',
        payload: {
          trackId: 'hp',
          amount: 20,
        },
      }
    );

    expect(result.nextRunState.worldState?.tracks.hp.current).toBe(80);
    expect(result.nextRunState.pendingRewardChoice).toBeNull();
    expect(result.checkpointKind).toBe('reward_applied');
    expect(result.checkpoint.seq).toBe(2);
  });

  test('checkpoint seq 会随 bootstrap 后的节点结算与奖励应用单调递增', () => {
    const resolved = finalizeNodeResolution(withCurrentNode(createBaseRunState(), 'L2-N1', 'battle'), {
      outcome: 'victory',
      trackDeltas: { hp: -10 },
      addStatuses: [],
      removeStatuses: [],
      rewardSelectionMode: 'choose-one',
      rewardOptionIds: ['reward-a', 'reward-b'],
    });
    const rewarded = applySelectedRewardOption(
      {
        ...resolved.nextRunState,
        pendingRewardChoice: {
          selectionMode: 'choose-one',
          rewardOptionIds: ['reward-a', 'reward-b'],
          sourceNodeId: 'L2-N1',
        },
      },
      {
        version: 1,
        rewardOptionId: 'reward-a',
        kind: 'adjust_track',
        label: '恢复包',
        payload: {
          trackId: 'hp',
          amount: 15,
        },
      }
    );
    const nextResolved = finalizeNodeResolution(
      withCurrentNode({ ...rewarded.nextRunState, currentNodeId: 'L3-N1' }, 'L3-N1', 'battle'),
      {
        outcome: 'victory',
        trackDeltas: { hp: -5 },
        addStatuses: [],
        removeStatuses: [],
        rewardSelectionMode: 'none',
        rewardOptionIds: [],
      }
    );

    expect(resolved.checkpoints[0]?.seq).toBe(2);
    expect(rewarded.checkpoint.seq).toBe(3);
    expect(nextResolved.checkpoints[0]?.seq).toBe(4);
  });

  test('普通节点 defeat 或 hp 归零时会立刻 failed，并写 finished checkpoint', () => {
    const result = finalizeNodeResolution(withCurrentNode(createBaseRunState(), 'L2-N1', 'battle'), {
      outcome: 'defeat',
      trackDeltas: { hp: -999 },
      addStatuses: [],
      removeStatuses: [],
      rewardSelectionMode: 'none',
      rewardOptionIds: [],
    });

    expect(result.nextRunState.status).toBe('failed');
    expect(result.checkpoints.at(-1)?.kind).toBe('finished');
  });

  test('只有 boss 节点 victory / costly_victory 才会把挑战标记为 completed', () => {
    const result = finalizeNodeResolution(withCurrentNode(createBaseRunState(), 'L8-N1', 'boss'), {
      outcome: 'victory',
      trackDeltas: { hp: -8 },
      addStatuses: [],
      removeStatuses: [],
      rewardSelectionMode: 'none',
      rewardOptionIds: [],
    });

    expect(result.nextRunState.status).toBe('completed');
    expect(result.checkpoints.at(-1)?.kind).toBe('finished');
  });

  test('敌人来源降级后会写入并固定 preset_only_enemy_mode', () => {
    const next = writeRunFlagsAfterNode(createBaseRunState(), {
      enemySourceMode: 'preset-only',
      nodeType: 'battle',
      layer: 2,
      outcome: 'victory',
    });

    expect(next.worldState.runFlags).toContain('preset_only_enemy_mode');
  });

  test('精英胜利后写入 elite_defeated，推进到 L7 后写入 boss_gate_unlocked', () => {
    const afterElite = writeRunFlagsAfterNode(createBaseRunState(), {
      nodeType: 'elite',
      layer: 6,
      outcome: 'victory',
    });
    const afterGate = writeRunFlagsAfterNode(afterElite, {
      nodeType: 'battle',
      layer: 7,
      outcome: 'victory',
    });

    expect(afterElite.worldState.runFlags).toContain('elite_defeated');
    expect(afterGate.worldState.runFlags).toContain('boss_gate_unlocked');
  });

  test('resolveSystemNode 会推进 visitedNodeCount、更新地图可见性，并执行 effect patch 的奖励挂起', () => {
    const runState = withCurrentNode(createBaseRunState(), 'L3-N1', 'event');
    const result = resolveSystemNode(runState, {
      encounter: {
        version: 1,
        nodeId: 'L3-N1',
        templateId: 'event-reward-choice',
        kind: 'event',
        inputMode: 'choice-only',
        enemySnapshot: null,
        rewardOptions: [
          {
            version: 1,
            rewardOptionId: 'reward-a',
            kind: 'add_status',
            label: '获得鼓舞',
            payload: { statusId: 'inspired' },
          },
          {
            version: 1,
            rewardOptionId: 'reward-b',
            kind: 'adjust_track',
            label: '稳定心神',
            payload: { trackId: 'radiance', amount: 15 },
          },
        ],
        eventOptions: [
          {
            version: 1,
            optionId: 'option-a',
            label: '谨慎接触',
            notePolicy: 'none',
            effectPatch: {
              version: 1,
              trackDeltas: { currency: 5 },
              addStatuses: [],
              removeStatuses: [],
              rewardSelectionMode: 'choose-one',
              rewardOptionIds: ['reward-a', 'reward-b'],
            },
          },
        ],
        shopOffers: [],
      },
      eventOptionId: 'option-a',
    });

    expect(result.nextRunState.visitedNodeCount).toBe(2);
    expect(result.nextRunState.pendingRewardChoice?.selectionMode).toBe('choose-one');
    expect(result.nextRunState.mapState?.nodes.find((node) => node.nodeId === 'L3-N1')?.visibility).toBe('resolved');
    expect(result.checkpoints.map((item) => item.kind)).toContain('node_resolved');
  });

  test('resolveSystemNode 在 auto 奖励模式下会直接应用奖励并写 reward_applied checkpoint', () => {
    const runState = withCurrentNode(createBaseRunState(), 'L4-N1', 'event');
    const result = resolveSystemNode(runState, {
      encounter: {
        version: 1,
        nodeId: 'L4-N1',
        templateId: 'event-reward-auto',
        kind: 'event',
        inputMode: 'choice-only',
        enemySnapshot: null,
        rewardOptions: [
          {
            version: 1,
            rewardOptionId: 'reward-auto',
            kind: 'adjust_track',
            label: '临时修复',
            payload: { trackId: 'hp', amount: 20 },
          },
        ],
        eventOptions: [
          {
            version: 1,
            optionId: 'option-auto',
            label: '顺势整备',
            notePolicy: 'none',
            effectPatch: {
              version: 1,
              trackDeltas: {},
              addStatuses: [],
              removeStatuses: [],
              rewardSelectionMode: 'auto',
              rewardOptionIds: ['reward-auto'],
            },
          },
        ],
        shopOffers: [],
      },
      eventOptionId: 'option-auto',
    });

    expect(result.nextRunState.pendingRewardChoice).toBeNull();
    expect(result.nextRunState.worldState?.tracks.hp.current).toBe(80);
    expect(result.checkpoints.map((item) => item.kind)).toEqual(['node_resolved', 'reward_applied']);
  });

  test('setPendingRewardChoiceFromEnvelope 会校验奖励模式与 rewardOptionIds 数量契约', () => {
    expect(() =>
      setPendingRewardChoiceFromEnvelope(createBaseRunState(), {
        rewardSelectionMode: 'auto',
        rewardOptionIds: ['reward-a', 'reward-b'],
        sourceNodeId: 'node-1',
      })
    ).toThrow('CHALLENGE_REWARD_SELECTION_INVALID:auto');

    expect(() =>
      setPendingRewardChoiceFromEnvelope(createBaseRunState(), {
        rewardSelectionMode: 'choose-one',
        rewardOptionIds: ['reward-a'],
        sourceNodeId: 'node-1',
      })
    ).toThrow('CHALLENGE_REWARD_SELECTION_INVALID:choose-one');
  });

  test('resolveSystemNode 的 shop 购买会扣除 currency、应用奖励并追加 reward_applied checkpoint', () => {
    const runState = withCurrentNode(createBaseRunState(), 'L4-N2', 'shop');
    const encounter = buildShopEncounterSnapshot(runState);
    const consumableOffer = encounter.shopOffers.find((offer) => offer.reward.kind === 'add_consumable');

    expect(consumableOffer).toBeTruthy();

    const result = resolveSystemNode(runState, {
      encounter,
      shopOfferId: consumableOffer?.offerId,
    });

    expect(result.nextRunState.worldState?.tracks.currency.current).toBe(38);
    expect(result.nextRunState.worldState?.consumableIds).toContain('moon-drop');
    expect(result.checkpoints.map((item) => item.kind)).toEqual(['node_resolved', 'reward_applied']);
  });
});
