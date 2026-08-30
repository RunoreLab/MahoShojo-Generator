import { beforeEach, describe, expect, test } from 'vitest';

import { useBattleStore } from '@/components/arena/stores/useBattleStore';

const resetStore = () => {
  useBattleStore.setState(useBattleStore.getInitialState(), true);
};

describe('useBattleStore adjudication event cleanup', () => {
  beforeEach(() => {
    resetStore();
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
});
