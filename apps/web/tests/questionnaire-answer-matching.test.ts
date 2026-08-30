import { describe, expect, it } from 'vitest';

import {
  buildQuestionnaireAnswerLookup,
  collectStoredQuestionnaireAnswerItems,
  resolveQuestionnaireAnswerTarget,
  type QuestionnaireAnswerMatchTarget,
} from '@/lib/questionnaires';

describe('问卷答案匹配', () => {
  const targets: QuestionnaireAnswerMatchTarget[] = [
    {
      key: 'scope-a::MG-1',
      index: 0,
      question: '你的名字是什么？',
      questionId: 'MG-1',
      questionnaireId: 'mg-v2',
      questionnaireTitle: '新版问卷',
    },
    {
      key: 'scope-a::MG-3',
      index: 1,
      question: '你会如何面对危险？',
      questionId: 'MG-3',
      questionnaireId: 'mg-v2',
      questionnaireTitle: '新版问卷',
    },
    {
      key: 'scope-b::Q-1',
      index: 2,
      question: '你的名字是什么？',
      questionId: 'Q-1',
      questionnaireId: 'lore-b',
      questionnaireTitle: '支线问卷',
    },
  ];

  it('题号变化时会优先按题目内容匹配', () => {
    const lookup = buildQuestionnaireAnswerLookup(targets);
    const matched = resolveQuestionnaireAnswerTarget(lookup, {
      question: '你会如何面对危险？',
      questionId: 'MG-1',
      questionnaireId: 'mg-v1',
    });

    expect(matched?.key).toBe('scope-a::MG-3');
  });

  it('题号相同但题目内容不一致时不会误配', () => {
    const lookup = buildQuestionnaireAnswerLookup(targets);
    const matched = resolveQuestionnaireAnswerTarget(lookup, {
      question: '旧版第一题',
      questionId: 'MG-1',
      questionnaireId: 'mg-v2',
    });

    expect(matched).toBeNull();
  });

  it('题目文本重复时可结合问卷标题定位', () => {
    const lookup = buildQuestionnaireAnswerLookup(targets);
    const matched = resolveQuestionnaireAnswerTarget(lookup, {
      question: '你的名字是什么？',
      questionnaireTitle: '支线问卷',
    });

    expect(matched?.key).toBe('scope-b::Q-1');
  });

  it('纯逐行导入仍可按序号兜底', () => {
    const lookup = buildQuestionnaireAnswerLookup(targets);
    const matched = resolveQuestionnaireAnswerTarget(
      lookup,
      { index: 1 },
      { allowIndexFallback: true }
    );

    expect(matched?.key).toBe('scope-a::MG-3');
  });

  it('草稿持久化会写入题目元数据', () => {
    const entries = collectStoredQuestionnaireAnswerItems(targets, {
      'scope-a::MG-1': '朝雾',
      'scope-a::MG-3': '',
      'scope-b::Q-1': '夜航',
    });

    expect(entries).toEqual([
      {
        key: 'scope-a::MG-1',
        question: '你的名字是什么？',
        answer: '朝雾',
        questionId: 'MG-1',
        questionnaireId: 'mg-v2',
        questionnaireTitle: '新版问卷',
      },
      {
        key: 'scope-b::Q-1',
        question: '你的名字是什么？',
        answer: '夜航',
        questionId: 'Q-1',
        questionnaireId: 'lore-b',
        questionnaireTitle: '支线问卷',
      },
    ]);
  });
});
