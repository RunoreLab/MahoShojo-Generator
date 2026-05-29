import { describe, expect, test } from 'vitest';

import { parseQuestionnaireDataCardPayload } from '@/lib/questionnaires';

describe('parseQuestionnaireDataCardPayload', () => {
  test('兼容 data/dataJson/data_json/dataJSON 并输出对象', () => {
    const variants = [
      { key: 'data', value: JSON.stringify({ id: 'q-data', questions: [] }) },
      { key: 'dataJson', value: JSON.stringify({ id: 'q-dataJson', questions: [] }) },
      { key: 'data_json', value: JSON.stringify({ id: 'q-data_json', questions: [] }) },
      { key: 'dataJSON', value: JSON.stringify({ id: 'q-dataJSON', questions: [] }) },
    ] as const;

    variants.forEach(({ key, value }) => {
      const payload = parseQuestionnaireDataCardPayload({ [key]: value });
      expect(payload.id).toBe(`q-${key}`);
      expect(Array.isArray(payload.questions)).toBe(true);
    });
  });

  test('当多个字段并存时优先读取 canonical data', () => {
    const payload = parseQuestionnaireDataCardPayload({
      data: JSON.stringify({ id: 'from-data', questions: [] }),
      data_json: JSON.stringify({ id: 'from-data-json', questions: [] }),
    });
    expect(payload.id).toBe('from-data');
  });

  test('兼容直接问卷对象与嵌套 questionnaire 对象', () => {
    const inlinePayload = parseQuestionnaireDataCardPayload({
      id: 'inline-questionnaire',
      questions: [],
    });
    expect(inlinePayload.id).toBe('inline-questionnaire');

    const nestedPayload = parseQuestionnaireDataCardPayload({
      questionnaire: {
        id: 'nested-questionnaire',
        questions: [],
      },
    });
    expect(nestedPayload.id).toBe('nested-questionnaire');
  });

  test('不支持的输入会抛出统一错误', () => {
    expect(() => parseQuestionnaireDataCardPayload(null)).toThrow('问卷数据卡内容为空或格式不受支持');
    expect(() => parseQuestionnaireDataCardPayload({ data: '' })).toThrow('问卷数据卡内容为空或格式不受支持');
    expect(() => parseQuestionnaireDataCardPayload({ data: '[]' })).toThrow('问卷数据卡内容为空或格式不受支持');
  });
});
