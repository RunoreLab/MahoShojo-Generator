import { beforeEach, describe, expect, test } from 'bun:test';

import { useBattleStore } from '@/components/arena/stores/useBattleStore';

describe('battle lite defaults', () => {
  beforeEach(() => {
    useBattleStore.setState((state) => ({
      ...state,
      selectedLanguage: 'en-US',
      storyLength: 'long',
      arenaFreeRankingEnabled: true,
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
        userGuidance: '保留这个字段',
      },
    }));
  });

  test('applyBattleLiteDefaults 会把隐藏高级项收敛到简洁页默认值', () => {
    useBattleStore.getState().applyBattleLiteDefaults();
    const state = useBattleStore.getState();

    expect(state.selectedLanguage).toBe('zh-CN');
    expect(state.storyLength).toBe('default');
    expect(state.arenaFreeRankingEnabled).toBe(false);
    expect(state.selectedQuestionnaires).toEqual([]);
    expect(state.auxScenarios).toEqual([]);
    expect(state.settings.readNarrativeHistory).toBe(false);
    expect(state.settings.writeNarrativeHistory).toBe(false);
    expect(state.settings.battleReportCardWidthMode).toBe('manual');
    expect(state.settings.battleReportCardWidthPx).toBe(500);
    expect(state.settings.userGuidance).toBe('保留这个字段');
  });
});
