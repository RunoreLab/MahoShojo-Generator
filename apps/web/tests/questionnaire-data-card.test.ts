import { describe, expect, test } from 'vitest';

import {
  isQuestionnaireDataCard,
  normalizeQuestionnaireDataCard,
} from '@/lib/questionnaire-data-card';

const questionnairePayload = {
  kind: 'magical-girl',
  title: '测试问卷',
  questions: [{ id: 'q1', question: '代号是什么？' }],
};

describe('questionnaire data-card compatibility', () => {
  test('识别内容为问卷但元数据误标为 character 的旧卡', () => {
    const card = {
      id: 'legacy-questionnaire',
      type: 'character',
      data: JSON.stringify(questionnairePayload),
    };

    expect(isQuestionnaireDataCard(card)).toBe(true);
    expect(normalizeQuestionnaireDataCard(card)).toMatchObject({
      id: 'legacy-questionnaire',
      type: 'questionnaire',
      isLegacyQuestionnaire: true,
    });
  });

  test('不把普通角色内容投影为问卷', () => {
    const card = {
      id: 'character-card',
      type: 'character',
      data: JSON.stringify({
        name: '测试角色',
        description: '角色内容',
      }),
    };

    expect(isQuestionnaireDataCard(card)).toBe(false);
    expect(normalizeQuestionnaireDataCard(card)).toBeNull();
  });

  test('不把其他数据卡类型的问卷形内容投影为遗留问卷', () => {
    const questionnairePayloadCard = (type: string) => ({
      id: `${type}-card`,
      type,
      data: JSON.stringify(questionnairePayload),
    });

    expect(isQuestionnaireDataCard(questionnairePayloadCard('scenario'))).toBe(false);
    expect(isQuestionnaireDataCard(questionnairePayloadCard('history'))).toBe(false);
    expect(normalizeQuestionnaireDataCard(questionnairePayloadCard('scenario'))).toBeNull();
  });

  test('保留已经正确标记的问卷卡，不添加遗留标记', () => {
    const card = {
      id: 'questionnaire-card',
      type: 'questionnaire',
      data: JSON.stringify(questionnairePayload),
    };

    expect(normalizeQuestionnaireDataCard(card)).toEqual(card);
  });
});
