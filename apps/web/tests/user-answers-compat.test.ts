import { describe, expect, it } from 'vitest';
import { extractQuestionTextsFromUserAnswers, normalizeUserAnswers } from '@/lib/questionnaires';
import { CanshouSchema, MagicalGirlSchema } from '@/lib/schemas';

describe('userAnswers 兼容层', () => {
  it('normalizeUserAnswers: 旧版 string[] 能用 fallbackQuestions 补齐问题', () => {
    const input = ['答案1', '答案2'];
    const fallback = ['问题1', '问题2'];
    expect(normalizeUserAnswers(input, fallback)).toEqual([
      { question: '问题1', answer: '答案1' },
      { question: '问题2', answer: '答案2' },
    ]);
  });

  it('normalizeUserAnswers: 新版对象数组会保留 question/answer', () => {
    const input = [
      { question: '你是谁？', answer: '我是我' },
      { question: '你想做什么？', answer: '想赢' },
    ];
    expect(normalizeUserAnswers(input, ['兜底1', '兜底2'])).toEqual([
      { question: '你是谁？', answer: '我是我', questionId: undefined, questionnaireId: undefined, questionnaireTitle: undefined },
      { question: '你想做什么？', answer: '想赢', questionId: undefined, questionnaireId: undefined, questionnaireTitle: undefined },
    ]);
  });

  it('extractQuestionTextsFromUserAnswers: 新版对象数组提取问题文本', () => {
    const input = [
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
    ];
    expect(extractQuestionTextsFromUserAnswers(input)).toEqual(['Q1', 'Q2']);
  });

  it('extractQuestionTextsFromUserAnswers: 旧版 string[] 不应误判为带问题', () => {
    expect(extractQuestionTextsFromUserAnswers(['A1', 'A2'])).toEqual([]);
  });

  it('extractQuestionTextsFromUserAnswers: record 形式优先使用值内 question，否则回退 key', () => {
    const input = {
      q1: 'A1',
      q2: { question: '真实问题2', answer: 'A2' },
    };
    expect(extractQuestionTextsFromUserAnswers(input)).toEqual(['q1', '真实问题2']);
  });

  it('数据卡 Schema: userAnswers 支持 record<string, string|object>', () => {
    const magical = MagicalGirlSchema.safeParse({
      codename: '测试魔法少女',
      userAnswers: {
        q1: { question: '问题1', answer: '答案1', questionId: 'MG-1' },
        q2: '答案2',
      },
    });
    expect(magical.success).toBe(true);

    const canshou = CanshouSchema.safeParse({
      name: '测试残兽',
      userAnswers: {
        q1: { question: '问题1', answer: '答案1', questionId: 'Q-1' },
        q2: '答案2',
      },
    });
    expect(canshou.success).toBe(true);
  });
});

