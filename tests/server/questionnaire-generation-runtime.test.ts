import { describe, expect, it, vi } from 'vitest';

import {
  buildQuestionnaireLoreText,
  extractAnswerQuestionnaireIds,
  findOverLimitAnswer,
  normalizeQuestionnaireSelections,
  normalizeQuestionnaires,
  resolveAnswerItems,
  resolveNativeQuestionnaires,
} from '@/lib/hosted-api/questionnaire-generation-runtime';

const questionnaire = (overrides: Record<string, unknown> = {}) => ({
  id: 'mg-default',
  title: '默认问卷',
  kind: 'magical-girl',
  nativeAllowed: true,
  loreMarkdown: '世界观',
  questions: [
    {
      id: 'q-1',
      question: '你的名字？',
      required: true,
      maxLength: 4,
    },
  ],
  ...overrides,
});

describe('questionnaire generation runtime', () => {
  it('只保留合法且规范化后的 selection 与 questionnaire 字段', () => {
    expect(normalizeQuestionnaireSelections([
      {
        source: 'preset',
        kind: 'magical-girl',
        presetId: '  default  ',
        dataCardId: ' ',
        useLore: false,
      },
      { source: 'remote', kind: 'magical-girl' },
      null,
    ])).toEqual([
      {
        source: 'preset',
        kind: 'magical-girl',
        presetId: 'default',
        useLore: false,
      },
    ]);

    expect(normalizeQuestionnaires([
      questionnaire({
        id: ' mg-default ',
        title: ' 默认问卷 ',
        useLore: false,
        questions: [null, { id: ' q-2 ', question: ' 第二题 ', maxLength: 4.9 }],
      }),
      { id: 'missing-kind', title: '无效', questions: [] },
    ])).toEqual([
      {
        id: 'mg-default',
        title: '默认问卷',
        kind: 'magical-girl',
        questions: [
          { id: 'Q-1', question: '问题 1', required: false, maxLength: null },
          { id: 'q-2', question: '第二题', required: false, maxLength: 4 },
        ],
      },
    ]);
  });

  it('按稳定优先级解析答案，并支持原生签名路径强制使用已加载问题事实', () => {
    const questionnaires = normalizeQuestionnaires([questionnaire()]);
    const rawAnswers = [{
      question: '客户端伪造问题',
      answer: '  雾灯  ',
      questionId: 'q-1',
      questionnaireId: 'mg-default',
      questionnaireTitle: '客户端伪造标题',
    }];

    expect(resolveAnswerItems(rawAnswers, questionnaires)).toEqual([{
      question: '客户端伪造问题',
      answer: '雾灯',
      questionId: 'q-1',
      questionnaireId: 'mg-default',
      questionnaireTitle: '客户端伪造标题',
    }]);
    expect(resolveAnswerItems(rawAnswers, questionnaires, {
      preferResolvedQuestionText: true,
    })).toEqual([{
      question: '你的名字？',
      answer: '雾灯',
      questionId: 'q-1',
      questionnaireId: 'mg-default',
      questionnaireTitle: '默认问卷',
    }]);
    expect([...extractAnswerQuestionnaireIds(rawAnswers)]).toEqual(['mg-default']);
    expect(findOverLimitAnswer([
      { question: '你的名字？', answer: '超过四个字符', questionId: 'q-1', questionnaireId: 'mg-default' },
    ], questionnaires)).toMatchObject({
      questionLabel: '你的名字？',
      limit: 4,
      length: 6,
      source: 'question',
    });
  });

  it('残兽旧流式路径可保留重复 questionId 的 first-match 兼容语义', () => {
    const questionnaires = normalizeQuestionnaires([
      questionnaire({ id: 'first', title: '第一份' }),
      questionnaire({ id: 'second', title: '第二份' }),
    ]);
    const answers = [
      { questionId: 'q-1', question: '你的名字？', answer: '甲' },
      { questionId: 'q-1', question: '客户端旧问题', answer: '乙' },
    ];

    expect(resolveAnswerItems(answers, questionnaires, {
      lookupMode: 'legacy-first-match',
    })[1]).toMatchObject({
      questionId: 'q-1',
      questionnaireId: 'first',
      questionnaireTitle: '第一份',
    });
  });

  it('只从安全 preset path 加载原生问卷，并按 useLore 删除 lore', async () => {
    const loadPreset = vi.fn(async () => questionnaire());
    const result = await resolveNativeQuestionnaires({
      requestUrl: 'https://example.test/api/generate',
      selections: normalizeQuestionnaireSelections([{
        source: 'preset',
        kind: 'magical-girl',
        presetId: 'default',
        useLore: false,
      }]),
      requiredQuestionnaireIds: new Set(['mg-default']),
      presetEntries: [{
        id: 'default',
        kind: 'magical-girl',
        path: '/questionnaires/presets/default.json',
      }],
      loadPreset,
      loadDataCard: vi.fn(),
    });

    expect(result).toEqual({
      allowed: true,
      questionnaires: [{
        id: 'mg-default',
        title: '默认问卷',
        kind: 'magical-girl',
        questions: [{
          id: 'q-1',
          question: '你的名字？',
          required: true,
          maxLength: 4,
        }],
      }],
    });
    expect(loadPreset).toHaveBeenCalledWith(
      'https://example.test/api/generate',
      '/questionnaires/presets/default.json',
    );
    expect(buildQuestionnaireLoreText(result.questionnaires)).toBe('');

    const unsafeLoader = vi.fn();
    const unsafe = await resolveNativeQuestionnaires({
      requestUrl: 'https://example.test/api/generate',
      selections: normalizeQuestionnaireSelections([{
        source: 'preset',
        kind: 'magical-girl',
        presetId: 'unsafe',
      }]),
      requiredQuestionnaireIds: new Set(),
      presetEntries: [{
        id: 'unsafe',
        kind: 'magical-girl',
        path: '/questionnaires/presets/../secret.json',
      }],
      loadPreset: unsafeLoader,
      loadDataCard: vi.fn(),
    });
    expect(unsafe).toEqual({ allowed: false, questionnaires: [] });
    expect(unsafeLoader).not.toHaveBeenCalled();
  });

  it('数据库问卷必须显式 nativeAllowed=true，且 required answer id 必须完整加载', async () => {
    const baseOptions = {
      requestUrl: 'https://example.test/api/generate',
      selections: normalizeQuestionnaireSelections([{
        source: 'database',
        kind: 'magical-girl',
        dataCardId: 'card-1',
      }]),
      presetEntries: [],
      loadPreset: vi.fn(),
    };

    const denied = await resolveNativeQuestionnaires({
      ...baseOptions,
      requiredQuestionnaireIds: new Set(),
      loadDataCard: vi.fn(async () => ({
        type: 'questionnaire',
        data: JSON.stringify(questionnaire({ nativeAllowed: undefined })),
      })),
    });
    expect(denied).toEqual({ allowed: false, questionnaires: [] });

    const missingRequired = await resolveNativeQuestionnaires({
      ...baseOptions,
      requiredQuestionnaireIds: new Set(['another-questionnaire']),
      loadDataCard: vi.fn(async () => ({
        type: 'questionnaire',
        data: JSON.stringify(questionnaire()),
      })),
    });
    expect(missingRequired).toEqual({ allowed: false, questionnaires: [] });
  });

  it('不可信 selection 仅可在无 lore 且与已提交答案无关时跳过', async () => {
    const resolve = (requiredQuestionnaireIds: Set<string>, useLore: boolean) => resolveNativeQuestionnaires({
      requestUrl: 'https://example.test/api/generate',
      selections: normalizeQuestionnaireSelections([
        {
          source: 'preset',
          kind: 'magical-girl',
          presetId: 'trusted',
        },
        {
          source: 'upload',
          kind: 'magical-girl',
          useLore,
        },
      ]),
      requiredQuestionnaireIds,
      presetEntries: [{
        id: 'trusted',
        kind: 'magical-girl',
        path: '/questionnaires/presets/trusted.json',
      }],
      loadPreset: vi.fn(async () => questionnaire()),
      loadDataCard: vi.fn(),
    });

    await expect(resolve(new Set(['mg-default']), false)).resolves.toMatchObject({ allowed: true });
    await expect(resolve(new Set(['mg-default']), true)).resolves.toEqual({
      allowed: false,
      questionnaires: [],
    });
    await expect(resolve(new Set(), false)).resolves.toEqual({
      allowed: false,
      questionnaires: [],
    });
  });
});
