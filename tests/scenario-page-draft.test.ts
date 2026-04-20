import { describe, expect, test } from 'bun:test';

import { buildScenarioPageDraftPayload, restoreScenarioPageDraft } from '@/lib/scenario-page-draft';

describe('scenario page draft helpers', () => {
  test('builds payload for answers and editable general scenario draft', () => {
    const payload = buildScenarioPageDraftPayload({
      answers: {
        '故事发生的场景是怎样的？': '黄昏钟楼',
        '场景中有需要出现的角色（NPC）吗？': '',
      },
      scenarioTitleHint: '深夜访谈',
      fieldsToKeepEmpty: ['elements.scene.time'],
      isAdvancedVisible: true,
      selectedLanguage: 'zh-CN',
      generationMode: 'stream',
      generalScenarioDraft: {
        templateId: '通用情景',
        title: '钟楼邂逅',
        content: '## 开场\n月色照在断裂的钟面上。',
      },
      generalScenarioDraftEdited: true,
    });

    expect(payload?.answers).toEqual({
      '故事发生的场景是怎样的？': '黄昏钟楼',
    });
    expect(payload?.scenarioTitleHint).toBe('深夜访谈');
    expect(payload?.fieldsToKeepEmpty).toEqual(['elements.scene.time']);
    expect(payload?.generationMode).toBe('stream');
    expect(payload?.generalScenarioDraftEdited).toBe(true);
    expect(payload?.generalScenarioDraft?.title).toBe('钟楼邂逅');
  });

  test('returns null when every persisted field is empty or default', () => {
    expect(
      buildScenarioPageDraftPayload({
        answers: {},
        scenarioTitleHint: '',
        fieldsToKeepEmpty: [],
        isAdvancedVisible: false,
        selectedLanguage: 'zh-CN',
        generationMode: 'non-stream',
        generalScenarioDraft: null,
        generalScenarioDraftEdited: false,
      }),
    ).toBeNull();
  });

  test('restores only normalized scenario draft fields', () => {
    const restored = restoreScenarioPageDraft({
      answers: {
        '故事发生的场景是怎样的？': '黄昏钟楼',
        '场景中有需要出现的角色（NPC）吗？': '',
      },
      scenarioTitleHint: '深夜访谈',
      fieldsToKeepEmpty: ['elements.scene.time', 1, null],
      isAdvancedVisible: true,
      selectedLanguage: 'ja-JP',
      generationMode: 'stream',
      generalScenarioDraft: {
        templateId: '通用情景',
        title: '钟楼邂逅',
        content: '## 开场\n月色照在断裂的钟面上。',
      },
      generalScenarioDraftEdited: true,
      resultData: { title: '不应恢复' },
      userProviderConfig: { apiKey: 'secret' },
    });

    expect(restored).toEqual({
      answers: {
        '故事发生的场景是怎样的？': '黄昏钟楼',
      },
      scenarioTitleHint: '深夜访谈',
      fieldsToKeepEmpty: ['elements.scene.time'],
      isAdvancedVisible: true,
      selectedLanguage: 'ja-JP',
      generationMode: 'stream',
      generalScenarioDraft: {
        templateId: '通用情景',
        title: '钟楼邂逅',
        content: '## 开场\n月色照在断裂的钟面上。',
      },
      generalScenarioDraftEdited: true,
    });
  });

  test('returns null for broken payloads', () => {
    expect(restoreScenarioPageDraft(null)).toBeNull();
    expect(restoreScenarioPageDraft('broken')).toBeNull();
  });
});
