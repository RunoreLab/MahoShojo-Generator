import { describe, expect, it } from 'vitest';

import {
  applyQuestionnaireAnswerImportEntries,
  extractQuestionnaireAnswersFromCharacterCard,
} from '@/lib/questionnaire-answer-import';
import {
  buildQuestionnaireAnswerLookup,
  type QuestionnaireAnswerMatchTarget,
} from '@/lib/questionnaires';

const targets: QuestionnaireAnswerMatchTarget[] = [
  {
    key: 'scope-a::MG-1',
    index: 0,
    question: '你的名字是什么？',
    questionId: 'MG-1',
    questionnaireId: 'magical-girl-default',
    questionnaireTitle: '魔法少女默认问卷',
  },
  {
    key: 'scope-a::MG-2',
    index: 1,
    question: '你的魔法风格是什么？',
    questionId: 'MG-2',
    questionnaireId: 'magical-girl-default',
    questionnaireTitle: '魔法少女默认问卷',
  },
  {
    key: 'scope-a::MG-3',
    index: 2,
    question: '你会如何面对危险？',
    questionId: 'MG-3',
    questionnaireId: 'magical-girl-default',
    questionnaireTitle: '魔法少女默认问卷',
  },
];

describe('角色卡问卷答案导入', () => {
  it('从本仓库角色 JSON 的 userAnswers 中提取答案', () => {
    const result = extractQuestionnaireAnswersFromCharacterCard({
      codename: '朝雾',
      userAnswers: [
        {
          question: '你的名字是什么？',
          answer: '朝雾',
          questionId: 'MG-1',
          questionnaireId: 'magical-girl-default',
          questionnaireTitle: '魔法少女默认问卷',
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.source).toBe('userAnswers');
    expect(result.entries).toEqual([
      {
        index: 0,
        value: '朝雾',
        question: '你的名字是什么？',
        questionId: 'MG-1',
        questionnaireId: 'magical-girl-default',
        questionnaireTitle: '魔法少女默认问卷',
      },
    ]);
  });

  it('从万途互通 JSON 的 fields.mahoshojoUserAnswers 中提取答案', () => {
    const result = extractQuestionnaireAnswersFromCharacterCard({
      cardKind: 'character',
      name: '白塔信使',
      content: '万途互通正文。',
      fields: {
        mahoshojoUserAnswers: [
          { question: '你的魔法风格是什么？', answer: '灯塔与回声', questionId: 'MG-2' },
        ],
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.source).toBe('fields.mahoshojoUserAnswers');
    expect(result.entries[0]).toMatchObject({
      index: 0,
      value: '灯塔与回声',
      question: '你的魔法风格是什么？',
      questionId: 'MG-2',
    });
  });

  it('万途往返 JSON 优先使用 _mahoshojo.originalData.userAnswers', () => {
    const result = extractQuestionnaireAnswersFromCharacterCard({
      cardKind: 'character',
      name: '旧日余辉',
      content: '万途互通正文。',
      fields: {
        mahoshojoUserAnswers: [
          { question: '你的名字是什么？', answer: '互通层答案', questionId: 'MG-1' },
        ],
      },
      _mahoshojo: {
        version: 1,
        originalTemplate: 'magical-girl',
        originalData: {
          codename: '旧日余辉',
          userAnswers: [
            { question: '你的名字是什么？', answer: '原始模板答案', questionId: 'MG-1' },
          ],
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.source).toBe('_mahoshojo.originalData.userAnswers');
    expect(result.entries[0].value).toBe('原始模板答案');
  });

  it('没有保存问卷答案时返回明确错误', () => {
    const result = extractQuestionnaireAnswersFromCharacterCard({
      cardKind: 'character',
      name: '无问卷角色',
      content: '只有正文。',
    });

    expect(result).toEqual({
      success: false,
      error: '角色卡中没有可导入的问卷答案。',
    });
  });

  it('只填空题时不会覆盖当前已有答案', () => {
    const lookup = buildQuestionnaireAnswerLookup(targets);
    const result = applyQuestionnaireAnswerImportEntries({
      currentAnswersByKey: {
        'scope-a::MG-1': '已有名字',
      },
      targets,
      lookup,
      entries: [
        { index: 0, value: '导入名字', question: '你的名字是什么？', questionId: 'MG-1' },
        { index: 1, value: '镜面魔法', question: '你的魔法风格是什么？', questionId: 'MG-2' },
      ],
      mergeMode: 'fill-empty',
    });

    expect(result).toEqual({
      answersByKey: {
        'scope-a::MG-1': '已有名字',
        'scope-a::MG-2': '镜面魔法',
      },
      appliedCount: 1,
      ignoredCount: 0,
      overwrittenCount: 0,
    });
  });

  it('覆盖匹配题时会替换当前已有答案', () => {
    const lookup = buildQuestionnaireAnswerLookup(targets);
    const result = applyQuestionnaireAnswerImportEntries({
      currentAnswersByKey: {
        'scope-a::MG-1': '已有名字',
      },
      targets,
      lookup,
      entries: [
        { index: 0, value: '导入名字', question: '你的名字是什么？', questionId: 'MG-1' },
      ],
      mergeMode: 'overwrite',
    });

    expect(result).toEqual({
      answersByKey: {
        'scope-a::MG-1': '导入名字',
      },
      appliedCount: 1,
      ignoredCount: 0,
      overwrittenCount: 1,
    });
  });
});
