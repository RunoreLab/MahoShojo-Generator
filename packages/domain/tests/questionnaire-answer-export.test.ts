import { describe, expect, test } from 'vitest';

import {
  buildQuestionnaireAnswerExportText,
  collectQuestionnaireAnswerExportItems,
} from '@mahoshojo/domain/questionnaire-answer-export';
import { parseBulkQuestionnaireAnswers } from '@mahoshojo/domain/questionnaire-bulk-parser';

describe('buildQuestionnaireAnswerExportText', () => {
  test('produces the Web backup text shape with questionnaire label', () => {
    const text = buildQuestionnaireAnswerExportText({
      title: '魔法少女问卷答案备份',
      items: [
        { index: 0, question: '信念？', answer: '守护' },
        { index: 2, question: '武器？', answer: '长笛', questionnaireTitle: '附加问卷' },
      ],
      total: 3,
      questionnaireLabel: '默认问卷 + 附加问卷',
      now: new Date('2026-01-02T03:04:05Z'),
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('【魔法少女问卷答案备份】');
    expect(lines.some((line) => line.startsWith('导出时间：'))).toBe(true);
    expect(lines).toContain('已填写：2 / 3');
    expect(lines).toContain('问卷：默认问卷 + 附加问卷');
    expect(lines).toContain('Q1: 信念？');
    expect(lines).toContain('A: 守护');
    expect(lines).toContain('Q3（附加问卷）: 武器？');
    expect(text.endsWith('A: 长笛')).toBe(true);
  });

  test('omits the questionnaire line when label is empty', () => {
    const text = buildQuestionnaireAnswerExportText({
      title: '备份',
      items: [{ index: 0, question: 'Q', answer: 'A' }],
      total: 1,
    });
    expect(text).not.toContain('问卷：');
  });

  test('exported text re-imports through the bulk parser (qa format)', () => {
    const items = [
      { index: 0, question: '信念？', answer: '守护' },
      { index: 1, question: '颜色？', answer: '蓝色' },
    ];
    const text = buildQuestionnaireAnswerExportText({ title: '备份', items, total: 2 });
    const parsed = parseBulkQuestionnaireAnswers(text, { expectedCount: 2 });
    expect(parsed.format).toBe('qa');
    expect(parsed.entries.filter((entry) => entry.value === '守护')).toHaveLength(1);
    expect(parsed.entries.filter((entry) => entry.value === '蓝色')).toHaveLength(1);
  });
});

describe('collectQuestionnaireAnswerExportItems', () => {
  test('collects only non-empty answers with flow order and title', () => {
    const items = collectQuestionnaireAnswerExportItems(
      [
        { key: 'q1', question: '第一题', questionnaireTitle: '默认' },
        { key: 'q2', question: '第二题' },
        { key: 'q3', question: '第三题' },
      ],
      { q1: '答案一', q2: '   ', q3: '答案三' },
    );
    expect(items).toEqual([
      { index: 0, question: '第一题', answer: '答案一', questionnaireTitle: '默认' },
      { index: 2, question: '第三题', answer: '答案三' },
    ]);
  });
});
