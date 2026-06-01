import { describe, expect, it } from 'vitest';

import { buildQuestionnaireFlow, resolveQuestionnaireReferences } from '@/lib/questionnaires';

type TestQuestionItem = {
  key: string;
  questionnaireId: string;
  questionnaireScopeId: string;
  question: Record<string, unknown>;
};

describe('问卷实例作用域', () => {
  it('displayIf 在重复问卷 id 时优先绑定当前实例', () => {
    const items: TestQuestionItem[] = [
      {
        key: 'shared::mode',
        questionnaireId: 'shared',
        questionnaireScopeId: 'shared',
        question: { id: 'mode', question: '模式' },
      },
      {
        key: 'shared::child',
        questionnaireId: 'shared',
        questionnaireScopeId: 'shared',
        question: {
          id: 'child',
          question: '第一份条件题',
          displayIf: {
            questionnaireId: 'shared',
            questionId: 'mode',
            operator: 'equals',
            value: 'show',
          },
        },
      },
      {
        key: 'shared-copy::mode',
        questionnaireId: 'shared',
        questionnaireScopeId: 'shared-copy',
        question: { id: 'mode', question: '模式' },
      },
      {
        key: 'shared-copy::child',
        questionnaireId: 'shared',
        questionnaireScopeId: 'shared-copy',
        question: {
          id: 'child',
          question: '第二份条件题',
          displayIf: {
            questionnaireId: 'shared',
            questionId: 'mode',
            operator: 'equals',
            value: 'show',
          },
        },
      },
    ];

    const result = buildQuestionnaireFlow(items as any, {
      'shared::mode': 'hide',
      'shared-copy::mode': 'show',
    });

    expect(result.flow.map((item) => item.key)).toEqual([
      'shared::mode',
      'shared-copy::mode',
      'shared-copy::child',
    ]);
  });

  it('optionsFrom 在重复问卷 id 时不会串到别的实例', () => {
    const items: TestQuestionItem[] = [
      {
        key: 'shared::source',
        questionnaireId: 'shared',
        questionnaireScopeId: 'shared',
        question: {
          id: 'source',
          question: '第一份选项源',
          options: ['A', 'B'],
        },
      },
      {
        key: 'shared::target',
        questionnaireId: 'shared',
        questionnaireScopeId: 'shared',
        question: {
          id: 'target',
          question: '第一份目标题',
          optionsFrom: {
            questionnaireId: 'shared',
            questionId: 'source',
          },
        },
      },
      {
        key: 'shared-copy::source',
        questionnaireId: 'shared',
        questionnaireScopeId: 'shared-copy',
        question: {
          id: 'source',
          question: '第二份选项源',
          options: ['X', 'Y'],
        },
      },
      {
        key: 'shared-copy::target',
        questionnaireId: 'shared',
        questionnaireScopeId: 'shared-copy',
        question: {
          id: 'target',
          question: '第二份目标题',
          optionsFrom: {
            questionnaireId: 'shared',
            questionId: 'source',
          },
        },
      },
    ];

    const resolved = resolveQuestionnaireReferences(items as any);

    expect(resolved[1]?.question.options).toEqual(['A', 'B']);
    expect(resolved[3]?.question.options).toEqual(['X', 'Y']);
  });

  it('toEnd 只结束当前问卷实例，不会截断后续问卷', () => {
    const items: TestQuestionItem[] = [
      {
        key: 'cloud::intro',
        questionnaireId: 'cloud',
        questionnaireScopeId: 'cloud',
        question: {
          id: 'intro',
          question: '云端入口题',
          jump: {
            when: {
              questionId: 'intro',
              operator: 'equals',
              value: '',
            },
            toEnd: true,
          },
        },
      },
      {
        key: 'cloud::tail',
        questionnaireId: 'cloud',
        questionnaireScopeId: 'cloud',
        question: {
          id: 'tail',
          question: '云端尾题',
        },
      },
      {
        key: 'preset::start',
        questionnaireId: 'preset',
        questionnaireScopeId: 'preset',
        question: {
          id: 'start',
          question: '预设起始题',
        },
      },
    ];

    const result = buildQuestionnaireFlow(items as any, {});

    expect(result.flow.map((item) => item.key)).toEqual([
      'cloud::intro',
      'preset::start',
    ]);
  });
});
