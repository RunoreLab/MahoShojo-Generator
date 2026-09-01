import { beforeEach, describe, expect, test } from 'vitest';

import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import {
  ARENA_ADJUDICATION_DRAFT_VERSION,
  parseArenaAdjudicationDraft,
} from '@/lib/arena/adjudication-draft-persistence';

const resetStore = () => {
  useBattleStore.setState(useBattleStore.getInitialState(), true);
};

describe('useBattleStore adjudication event cleanup', () => {
  beforeEach(async () => {
    resetStore();
    localStorage.clear();
    await useBattleStore.persist.rehydrate();
    localStorage.clear();
  });

  test('removing a combatant clears only adjudication events from the same source', () => {
    useBattleStore.setState((state) => ({
      ...state,
      combatants: [
        {
          type: 'magical-girl',
          data: {},
          filename: 'card-a.json',
          isValid: true,
          isPreset: false,
          adjudicationSourceKey: 'data_card:card-a',
          sourceDataCardId: 'card-a',
        },
        {
          type: 'canshou',
          data: {},
          filename: 'card-b.json',
          isValid: true,
          isPreset: false,
          adjudicationSourceKey: 'data_card:card-b',
          sourceDataCardId: 'card-b',
        },
      ],
      adjudicationEvents: [
        { id: 'evt-a', description: 'A', type: 'binary', probability: 50, sourceKey: 'data_card:card-a' },
        { id: 'evt-b', description: 'B', type: 'binary', probability: 50, sourceKey: 'data_card:card-b' },
        { id: 'evt-manual', description: 'manual', type: 'binary', probability: 50 },
      ],
    }));

    useBattleStore.getState().removeCombatant('card-a');

    expect(useBattleStore.getState().combatants.map((item) => item.filename)).toEqual(['card-b.json']);
    expect(useBattleStore.getState().adjudicationEvents.map((event) => event.id)).toEqual(['evt-b', 'evt-manual']);
  });

  test('clearing a scenario removes its imported adjudication events', () => {
    useBattleStore.setState((state) => ({
      ...state,
      scenario: {
        content: { title: '主情景' },
        fileName: 'scenario.json',
        isNative: false,
        adjudicationSourceKey: 'file:scenario.json',
      },
      adjudicationEvents: [
        { id: 'evt-s', description: 'scenario', type: 'binary', probability: 50, sourceKey: 'file:scenario.json' },
        { id: 'evt-manual', description: 'manual', type: 'binary', probability: 50 },
      ],
    }));

    useBattleStore.getState().clearScenario();

    expect(useBattleStore.getState().scenario).toMatchObject({ content: null, fileName: null, isNative: false });
    expect(useBattleStore.getState().adjudicationEvents.map((event) => event.id)).toEqual(['evt-manual']);
  });

  test('clearAdjudicationEvents empties the panel events list', () => {
    useBattleStore.setState((state) => ({
      ...state,
      adjudicationEvents: [
        { id: 'evt-1', description: 'A', type: 'binary', probability: 50 },
      ],
    }));

    useBattleStore.getState().clearAdjudicationEvents();

    expect(useBattleStore.getState().adjudicationEvents).toEqual([]);
  });

  test('持久化手工判定草稿，但排除依赖未恢复卡片来源的事件', () => {
    useBattleStore.getState().setAdjudicationEvents([
      { id: 'evt-card', description: '卡片事件', type: 'binary', probability: 50, sourceKey: 'data_card:card-a' },
      { id: 'evt-manual', description: '手工草稿', type: 'binary', probability: 65 },
    ]);

    const persisted = JSON.parse(localStorage.getItem('arena-storage') ?? '{}');

    expect(persisted.state?.adjudicationEvents).toBeUndefined();
    expect(persisted.state?.adjudicationDraftV1).toMatchObject({
      version: ARENA_ADJUDICATION_DRAFT_VERSION,
      events: [
        { id: 'evt-manual', description: '手工草稿', type: 'binary', probability: 65 },
      ],
    });
    expect(persisted.state?.adjudicationDraftV1.updatedAt).toEqual(expect.any(Number));
  });

  test('generation repair Provider 快照只保留在内存，不进入持久化存储', () => {
    useBattleStore.getState().setLastGenerationRepairContext({
      generationId: 'generation-memory-only-001',
      customProvider: {
        providerId: 'openai-compatible',
        modelId: 'generation-model',
        apiKey: 'secret-generation-key',
        generationOverrides: {
          temperature: 0.7,
          thinking: { mode: 'enabled', effort: 'high' },
        },
      },
    });

    expect(useBattleStore.getState().lastGenerationRepairContext).toMatchObject({
      generationId: 'generation-memory-only-001',
      customProvider: { apiKey: 'secret-generation-key' },
    });
    const persistedRaw = localStorage.getItem('arena-storage') ?? '';
    const persisted = JSON.parse(persistedRaw);
    expect(persistedRaw).not.toContain('secret-generation-key');
    expect(persisted.state?.lastGenerationId).toBeUndefined();
    expect(persisted.state?.lastGenerationRepairContext).toBeUndefined();
    expect(persisted.state?.userProviderConfig).toBeUndefined();
  });

  test('恢复旧版本时主动剥离曾被错误持久化的 Provider secret 与 generation 上下文', async () => {
    localStorage.setItem('arena-storage', JSON.stringify({
      state: {
        lastGenerationId: 'generation-stale-secret-001',
        lastGenerationRepairContext: {
          generationId: 'generation-stale-secret-001',
          customProvider: {
            providerId: 'openai-compatible',
            modelId: 'stale-model',
            apiKey: 'stale-secret-key',
          },
        },
        repairAppliedGenerationId: 'generation-stale-secret-001',
        userProviderConfig: {
          providerId: 'openai-compatible',
          modelId: 'stale-model',
          apiKey: 'stale-secret-key',
        },
      },
      version: ARENA_ADJUDICATION_DRAFT_VERSION,
    }));

    await useBattleStore.persist.rehydrate();

    expect(useBattleStore.getState().lastGenerationId).toBeNull();
    expect(useBattleStore.getState().lastGenerationRepairContext).toBeNull();
    expect(useBattleStore.getState().repairAppliedGenerationId).toBeNull();
    expect(useBattleStore.getState().userProviderConfig).toBeNull();
  });

  test('恢复时隔离损坏事件，并过滤旧版本中依赖卡片来源的事件', async () => {
    localStorage.setItem('arena-storage', JSON.stringify({
      state: {
        adjudicationEvents: [
          { id: 'evt-card', description: '孤儿卡片事件', type: 'binary', probability: 50, sourceKey: 'data_card:deleted' },
          { id: 'evt-manual', description: '旧版手工草稿', type: 'binary', probability: 70 },
          { id: 'evt-bad', description: 42, type: 'binary', probability: 50 },
        ],
      },
      version: 0,
    }));

    await useBattleStore.persist.rehydrate();

    expect(useBattleStore.getState().adjudicationEvents).toEqual([
      { id: 'evt-manual', description: '旧版手工草稿', type: 'binary', probability: 70 },
    ]);
  });

  test('未知版本或非数组草稿不会进入运行时状态', () => {
    expect(parseArenaAdjudicationDraft({
      version: ARENA_ADJUDICATION_DRAFT_VERSION + 1,
      updatedAt: Date.now(),
      events: [],
    })).toEqual([]);
    expect(parseArenaAdjudicationDraft({
      version: ARENA_ADJUDICATION_DRAFT_VERSION,
      updatedAt: Date.now(),
      events: { id: 'not-an-array' },
    })).toEqual([]);
  });
});
