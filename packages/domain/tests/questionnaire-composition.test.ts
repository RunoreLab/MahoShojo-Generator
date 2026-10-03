import { describe, expect, it } from 'vitest';
import { compactQuestionnaireAnswerItems, formatQuestionnaireAnswers } from '@mahoshojo/domain/questionnaire';

describe('questionnaire composition', () => {
  it('按首次出现的问卷顺序分组并在各组内回退问题编号，保留答案空白', () => {
    expect(formatQuestionnaireAnswers([
      { questionnaireTitle: '  起点 ', question: '  愿望？ ', answer: ' 守护\n同伴 ' },
      { question: '', answer: '空组' },
      { questionnaireTitle: '进阶', question: ' ', answer: '成长' },
      { questionnaireTitle: '起点', question: '', answer: '继续' },
    ])).toBe('【起点】\nQ: 愿望？\nA:  守护\n同伴 \nQ: 问题 2\nA: 继续\nQ: 问题 1\nA: 空组\n【进阶】\nQ: 问题 1\nA: 成长');
    expect(formatQuestionnaireAnswers([])).toBe('');
  });

  it('只移除问卷分组信息，不修改输入或问题 ID', () => {
    const answers = [Object.freeze({ question: '愿望？', answer: '', questionId: 'q1', questionnaireId: 'a', questionnaireTitle: '起点' })];
    const compacted = compactQuestionnaireAnswerItems(answers);
    expect(compacted).toEqual([{ question: '愿望？', answer: '', questionId: 'q1' }]);
    expect(compacted[0]).not.toBe(answers[0]);
    expect(answers[0].questionnaireId).toBe('a');
    expect(compactQuestionnaireAnswerItems([])).toEqual([]);
  });
});
