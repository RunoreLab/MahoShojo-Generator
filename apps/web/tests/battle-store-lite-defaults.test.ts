import { beforeEach, describe, expect, test } from 'vitest';

import { useBattleStore } from '@/components/arena/stores/useBattleStore';

describe('battle lite shared store contract', () => {
  beforeEach(() => {
    useBattleStore.setState((state) => ({
      ...state,
      selectedLanguage: 'en-US',
      storyLength: 'long',
      arenaFreeRankingEnabled: true,
      adjudicationEvents: [{ id: 'evt-1', label: '判定事件' } as any],
      selectedQuestionnaires: [
        {
          source: 'database',
          questionnaire: {
            id: 'q-demo',
            title: '测试问卷',
            questions: [],
          },
          selectionId: 'sel-demo',
          useLore: true,
        },
      ],
      auxScenarios: [
        {
          id: 'aux-1',
          content: { title: '辅助情景' },
          fileName: 'aux.json',
          isNative: false,
        },
      ],
      settings: {
        ...state.settings,
        readNarrativeHistory: true,
        writeNarrativeHistory: true,
        battleReportCardWidthMode: 'manual',
        battleReportCardWidthPx: 920,
      },
    }));
  });

  test('shared store 不再暴露 applyBattleLiteDefaults', () => {
    const state = useBattleStore.getState() as Record<string, unknown>;

    expect('applyBattleLiteDefaults' in state).toBe(false);
    expect(state.selectedLanguage).toBe('en-US');
    expect(state.storyLength).toBe('long');
    expect(Array.isArray(state.auxScenarios)).toBe(true);
    expect(Array.isArray(state.selectedQuestionnaires)).toBe(true);
    expect(Array.isArray(state.adjudicationEvents)).toBe(true);
  });
});
