import { beforeEach, describe, expect, test } from 'vitest';

import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import { MAX_ARENA_REFERENCE_ITEMS } from '@/lib/arena/resource-budget';

const resetStore = () => {
  useBattleStore.setState(useBattleStore.getInitialState(), true);
};

const auxScenario = (index: number) => ({
  id: `aux-${index}`,
  content: { title: `辅助情景 ${index}` },
  fileName: `aux-${index}.json`,
  isNative: false,
});

describe('Arena 单人引用项共享预算', () => {
  beforeEach(resetStore);

  test('辅助情景可以超过旧的单类 10 项限制', () => {
    for (let index = 0; index < 12; index += 1) {
      useBattleStore.getState().addAuxScenario(auxScenario(index));
    }

    expect(useBattleStore.getState().auxScenarios).toHaveLength(12);
  });

  test('辅助情景、素材与问卷共同占用 256 项总预算', () => {
    useBattleStore.setState({
      auxScenarios: Array.from(
        { length: MAX_ARENA_REFERENCE_ITEMS - 2 },
        (_, index) => auxScenario(index),
      ),
      materials: [{
        id: 'material-1',
        name: '素材 1',
        content: {},
        fileName: null,
        sourceKind: 'raw-json',
        sourceType: 'raw-json',
        isNative: false,
      }],
      selectedQuestionnaires: [{
        source: 'preset',
        questionnaire: { id: 'q-1', title: '问卷 1', questions: [] },
      }],
    });

    useBattleStore.getState().addMaterial({
      id: 'material-overflow',
      name: '超限素材',
      content: {},
      fileName: null,
      sourceKind: 'raw-json',
      sourceType: 'raw-json',
      isNative: false,
    });
    useBattleStore.getState().addAuxScenario(auxScenario(MAX_ARENA_REFERENCE_ITEMS));
    useBattleStore.getState().addQuestionnaireSelection({
      source: 'preset',
      questionnaire: { id: 'q-overflow', title: '超限问卷', questions: [] },
    });

    const state = useBattleStore.getState();
    expect(state.auxScenarios).toHaveLength(MAX_ARENA_REFERENCE_ITEMS - 2);
    expect(state.materials).toHaveLength(1);
    expect(state.selectedQuestionnaires).toHaveLength(1);
  });
});
