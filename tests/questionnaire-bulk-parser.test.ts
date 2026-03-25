import { describe, expect, it } from 'bun:test';
import { parseBulkQuestionnaireAnswers } from '@/lib/questionnaire-bulk-parser';

describe('问卷答案粘贴解析器', () => {
  it('能从 Q/A 复制文本中提取答案（含问卷标题与空行分隔）', () => {
    const input = [
      'Q1（基础问卷）: 你叫什么？',
      'A: 小红',
      '',
      'Q2（基础问卷）: 你喜欢什么？',
      'A: 苹果',
    ].join('\n');

    const result = parseBulkQuestionnaireAnswers(input, { expectedCount: 2 });
    expect(result.format).toBe('qa');
    expect(result.entries.map(entry => entry.value)).toEqual(['小红', '苹果']);
    expect(result.entries[0]).toMatchObject({
      question: '你叫什么？',
      questionnaireTitle: '基础问卷',
    });
  });

  it('能保留空答案以避免序号错位（Q/A）', () => {
    const input = ['Q1: 第一题', 'A:', '', 'Q2: 第二题', 'A: 有内容'].join('\n');
    const result = parseBulkQuestionnaireAnswers(input);
    expect(result.format).toBe('qa');
    expect(result.entries.map(entry => entry.value)).toEqual(['', '有内容']);
  });

  it('能根据 Q 序号对齐答案（如 Q1/Q3）', () => {
    const input = [
      'Q1（基础问卷）: 第一题',
      'A: A1',
      '',
      'Q3（基础问卷）: 第三题',
      'A: A3',
    ].join('\n');

    const result = parseBulkQuestionnaireAnswers(input, { expectedCount: 4 });
    expect(result.format).toBe('qa');
    expect(result.entries.map(entry => entry.index)).toEqual([0, 2]);
    expect(result.entries.map(entry => entry.value)).toEqual(['A1', 'A3']);
  });

  it('能保留答案中的多行内容', () => {
    const input = [
      'Q: 形容一下',
      'A: 第一行',
      '第二行',
      '',
      'Q: 再来一个',
      'A: 单行',
    ].join('\n');

    const result = parseBulkQuestionnaireAnswers(input);
    expect(result.entries.map(entry => entry.value)).toEqual(['第一行\n第二行', '单行']);
  });

  it('能解析编号列表（逐行）', () => {
    const input = ['1. 小红', '2) 苹果', '3、香蕉'].join('\n');
    const result = parseBulkQuestionnaireAnswers(input);
    expect(result.entries.map(entry => entry.value)).toEqual(['小红', '苹果', '香蕉']);
  });

  it('能解析 JSON 数组', () => {
    const input = JSON.stringify(['小红', '苹果']);
    const result = parseBulkQuestionnaireAnswers(input);
    expect(result.format).toBe('json');
    expect(result.entries.map(entry => entry.value)).toEqual(['小红', '苹果']);
  });

  it('能解析包含 userAnswers 的 JSON 对象', () => {
    const input = JSON.stringify({ userAnswers: ['小红', '苹果'] });
    const result = parseBulkQuestionnaireAnswers(input);
    expect(result.format).toBe('json');
    expect(result.entries.map(entry => entry.value)).toEqual(['小红', '苹果']);
  });

  it('能保留 JSON 问卷答案对象中的匹配元数据', () => {
    const input = JSON.stringify({
      answerEntries: [
        {
          key: 'scope-1::MG-1',
          question: '你叫什么？',
          answer: '小红',
          questionId: 'MG-1',
          questionnaireId: 'mg-custom',
          questionnaireTitle: '自定义问卷',
        },
      ],
    });
    const result = parseBulkQuestionnaireAnswers(input);
    expect(result.format).toBe('json');
    expect(result.entries[0]).toMatchObject({
      key: 'scope-1::MG-1',
      question: '你叫什么？',
      value: '小红',
      questionId: 'MG-1',
      questionnaireId: 'mg-custom',
      questionnaireTitle: '自定义问卷',
    });
  });

  it('能按问题 id 映射 JSON 对象（如 MG-1/MG-2）', () => {
    const input = JSON.stringify({ 'MG-1': '小红', 'MG-2': '苹果' });
    const result = parseBulkQuestionnaireAnswers(input, { orderedQuestionIds: ['MG-1', 'MG-2'] });
    expect(result.format).toBe('json');
    expect(result.entries.map(entry => entry.value)).toEqual(['小红', '苹果']);
  });

  it('能解析带数字 key 的 JSON 对象', () => {
    const input = JSON.stringify({ 0: '小红', 1: '苹果' });
    const result = parseBulkQuestionnaireAnswers(input);
    expect(result.format).toBe('json');
    expect(result.entries.map(entry => entry.value)).toEqual(['小红', '苹果']);
  });
});
