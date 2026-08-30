import {
  QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS,
  buildQuestionnaireAnswerLookup,
  getAnswerLimitInfo,
  isAnswerOverLimit,
  normalizeUserAnswers,
  resolveQuestionnaireAnswerTarget,
} from '@mahoshojo/domain/questionnaire';

describe('questionnaire domain policy', () => {
  test('保留 legacy answer 输入兼容与稳定匹配优先级', () => {
    expect(normalizeUserAnswers(['  雾灯  '], ['你的名字？'])).toEqual([
      { question: '你的名字？', answer: '  雾灯  ' },
    ]);

    const first = {
      key: 'first::q-1',
      index: 0,
      question: '你的名字？',
      questionId: 'q-1',
      questionnaireId: 'first',
    };
    const second = { ...first, key: 'second::q-1', index: 1, questionnaireId: 'second' };
    const lookup = buildQuestionnaireAnswerLookup([first, second]);

    expect(resolveQuestionnaireAnswerTarget(lookup, {
      question: '你的名字？',
      questionId: 'q-1',
      questionnaireId: 'second',
    })).toBe(second);
    expect(resolveQuestionnaireAnswerTarget(lookup, {
      questionId: 'q-1',
    })).toBeNull();
  });

  test('统一应用 question/global answer limit', () => {
    expect(QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS).toBe(500);
    expect(getAnswerLimitInfo(4)).toEqual({ limit: 4, source: 'question' });
    expect(getAnswerLimitInfo(800)).toEqual({ limit: 500, source: 'global' });
    expect(isAnswerOverLimit('12345', 4)).toBe(true);
    expect(isAnswerOverLimit('   ', 1)).toBe(false);
  });
});
