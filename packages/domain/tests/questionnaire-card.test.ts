import { describe, expect, test } from 'vitest';

import {
  isQuestionnaireDataCard,
  isQuestionnairePayload,
  normalizeQuestionnaireDataCard,
  parseDataCardPayload,
} from '@mahoshojo/domain/questionnaire-card';
import { normalizeQuestionnaireDefinition } from '@mahoshojo/domain/questionnaire-definition';

const QUESTIONNAIRE_PAYLOAD = {
  kind: 'magical-girl',
  title: '示例问卷',
  questions: [{ id: 'q1', question: '你的名字？' }],
};

const NARRATIVE_HISTORY_PAYLOAD = {
  templateId: 'narrative-history',
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  entries: [],
};

describe('parseDataCardPayload', () => {
  test('接受 JSON 字符串与普通对象，拒绝数组与非法 JSON', () => {
    expect(parseDataCardPayload(JSON.stringify(QUESTIONNAIRE_PAYLOAD))?.title).toBe('示例问卷');
    expect(parseDataCardPayload(QUESTIONNAIRE_PAYLOAD)?.title).toBe('示例问卷');
    expect(parseDataCardPayload('[]')).toBeNull();
    expect(parseDataCardPayload('{bad json')).toBeNull();
    expect(parseDataCardPayload(null)).toBeNull();
    expect(parseDataCardPayload(42)).toBeNull();
  });
});

describe('isQuestionnairePayload / isQuestionnaireDataCard', () => {
  test('识别显式 questionnaire 卡与问卷正文', () => {
    expect(isQuestionnairePayload(QUESTIONNAIRE_PAYLOAD)).toBe(true);
    expect(isQuestionnairePayload(JSON.stringify(QUESTIONNAIRE_PAYLOAD))).toBe(true);
    expect(isQuestionnaireDataCard({ type: 'questionnaire', data: '{}' })).toBe(true);
  });

  test('识别 type=character 的旧版问卷卡', () => {
    const legacy = { type: 'character', data: QUESTIONNAIRE_PAYLOAD };
    expect(isQuestionnaireDataCard(legacy)).toBe(true);
  });

  test('拒绝非问卷正文、叙事历史卡与非对象输入', () => {
    expect(isQuestionnairePayload({ kind: 'magical-girl', title: '空', questions: [] })).toBe(false);
    expect(isQuestionnairePayload(NARRATIVE_HISTORY_PAYLOAD)).toBe(false);
    expect(isQuestionnaireDataCard({ type: 'character', data: NARRATIVE_HISTORY_PAYLOAD })).toBe(false);
    expect(isQuestionnaireDataCard({ type: 'character', data: { not: 'a questionnaire' } })).toBe(false);
    expect(isQuestionnaireDataCard('questionnaire')).toBe(false);
    expect(isQuestionnaireDataCard(null)).toBe(false);
  });
});

describe('normalizeQuestionnaireDataCard', () => {
  test('显式 questionnaire 卡原样返回', () => {
    const card = { id: 'c1', type: 'questionnaire', data: '{}' };
    expect(normalizeQuestionnaireDataCard(card)).toEqual(card);
  });

  test('旧版 character 问卷卡归一化为 questionnaire + isLegacyQuestionnaire', () => {
    const card = { id: 'c2', type: 'character', data: QUESTIONNAIRE_PAYLOAD, name: '旧卡' };
    const normalized = normalizeQuestionnaireDataCard(card);
    expect(normalized).toEqual({
      ...card,
      type: 'questionnaire',
      isLegacyQuestionnaire: true,
    });
    expect(card.type).toBe('character');
  });

  test('非问卷卡返回 null', () => {
    expect(normalizeQuestionnaireDataCard({ type: 'scenario', data: {} })).toBeNull();
  });
});

describe('normalizeQuestionnaireDefinition', () => {
  test('归一化问卷定义并保留条件/跳转/引用字段', () => {
    const definition = normalizeQuestionnaireDefinition({
      kind: 'magical-girl',
      title: '动态问卷',
      questions: [
        { id: 'q1', question: '第一题', required: true },
        {
          id: 'q2',
          question: '第二题',
          displayIf: { questionId: 'q1', operator: 'notEmpty' },
          jump: { when: { questionId: 'q1', operator: 'equals', value: 'x' }, toEnd: true },
          optionsFrom: { questionId: 'q3' },
        },
        { id: 'q3', question: '第三题', options: ['a', 'b'] },
      ],
    });
    expect(definition?.kind).toBe('magical-girl');
    expect(definition?.questions).toHaveLength(3);
    expect(definition?.questions[1]?.displayIf).toBeTruthy();
    expect(definition?.questions[1]?.jump).toBeTruthy();
    expect(definition?.questions[1]?.optionsFrom).toEqual({ questionId: 'q3', key: undefined, questionnaireId: undefined });
  });

  test('无题目且无 loreMarkdown 时拒绝', () => {
    expect(normalizeQuestionnaireDefinition({ kind: 'magical-girl', questions: [] })).toBeNull();
    expect(normalizeQuestionnaireDefinition({ kind: 'magical-girl', loreMarkdown: '设定' })?.loreMarkdown).toBe('设定');
    expect(normalizeQuestionnaireDefinition({ kind: 'other-kind', questions: ['q'] })).toBeNull();
  });

  test('logoUrl 站外地址走媒体白名单准入', () => {
    const allowed = normalizeQuestionnaireDefinition({
      kind: 'magical-girl',
      questions: ['q'],
      logoUrl: 'https://i.imgur.com/logo.png',
    });
    expect(allowed?.logoUrl).toBe('https://i.imgur.com/logo.png');

    const denied = normalizeQuestionnaireDefinition({
      kind: 'magical-girl',
      questions: ['q'],
      logoUrl: 'https://untrusted.example.com/logo.png',
    });
    expect(denied?.logoUrl).toBeUndefined();

    const relative = normalizeQuestionnaireDefinition({
      kind: 'magical-girl',
      questions: ['q'],
      logoUrl: '/questionnaire-logo.svg',
    });
    expect(relative?.logoUrl).toBe('/questionnaire-logo.svg');
  });
});
