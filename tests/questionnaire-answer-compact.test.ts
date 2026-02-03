import { describe, expect, it } from 'bun:test';
import { compactQuestionnaireAnswerItems } from '@/lib/questionnaires';

describe('问卷答案瘦身', () => {
  it('会移除 questionnaireId / questionnaireTitle，但保留 questionId 与 Q/A', () => {
    const input = [
      {
        question: '你叫什么？',
        answer: '小红',
        questionId: 'MG-1',
        questionnaireId: 'magical-girl-default',
        questionnaireTitle: '魔法少女预设问卷',
      },
      {
        question: '你喜欢什么？',
        answer: '苹果',
        questionId: 'MG-2',
      },
    ];

    const result = compactQuestionnaireAnswerItems(input);

    expect(result).toEqual([
      { question: '你叫什么？', answer: '小红', questionId: 'MG-1' },
      { question: '你喜欢什么？', answer: '苹果', questionId: 'MG-2' },
    ]);

    expect(input[0]).toHaveProperty('questionnaireId', 'magical-girl-default');
    expect(input[0]).toHaveProperty('questionnaireTitle', '魔法少女预设问卷');
    expect(result[0]).not.toBe(input[0]);
  });
});

