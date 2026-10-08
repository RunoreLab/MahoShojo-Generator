/**
 * `/api/creator/generate(-stream)` 提交请求体对拍（G3-r1 共源收口）：
 * Web `CreatorPage.handleSubmit` 实际调用的 `buildWebCreatorGenerationRequestBody`
 * 必须与 domain 共源组装器逐字段一致，唯一差异是追加的 `customProvider`。
 */
import { describe, expect, test } from 'vitest';

import { buildCreatorGenerationRequestBody } from '@mahoshojo/domain/creator/request-body';
import type { QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';

import { buildWebCreatorGenerationRequestBody } from '@/lib/creator/request-body';

const selections: QuestionnaireSelection[] = [
  {
    source: 'preset',
    selectionId: 'builtin:mg-q',
    questionnaire: {
      id: 'mg-q',
      kind: 'magical-girl',
      title: '默认问卷',
      nativeAllowed: true,
      loreMarkdown: '# 设定',
      questions: [{ id: 'q1', question: '你的信念？', required: true }],
    },
  },
];

const baseInput = {
  template: 'magical-girl' as const,
  freeformBrief: '想要百合主题',
  answers: [{ question: '你的信念？', answer: '守护', questionId: 'q1', questionnaireId: 'mg-q' }],
  selections,
  allowNativeSignature: true,
  language: 'zh-CN',
  buildRules: [{ ruleId: 'arena-trpg-lite', version: '1.0.0', inputs: { archetype: '守护者' } }],
  primaryRuleId: 'arena-trpg-lite',
};

describe('Web creator request body 与共源组装器对拍（G3-r1）', () => {
  test('业务字段与共源组装器序列化完全一致，仅追加 customProvider', () => {
    const customProvider = {
      providerId: 'openrouter',
      modelId: 'model-x',
      apiKey: 'sk-test',
      maxOutputTokens: 4096,
    };
    const body = buildWebCreatorGenerationRequestBody({ ...baseInput, customProvider });
    const canonical = buildCreatorGenerationRequestBody(baseInput);

    // 业务字段逐一与共源输出对拍（不是重写字面量——真实调用方对真实组装器）。
    const { customProvider: _provider, ...businessFields } = body;
    expect(businessFields).toEqual(canonical);
    expect(JSON.stringify(businessFields)).toBe(JSON.stringify(canonical));
    expect(body.customProvider).toEqual(customProvider);
    expect(Object.keys(body)).toEqual([
      'template', 'freeformBrief', 'answers', 'questionnaireSelections', 'questionnaires',
      'allowNativeSignature', 'language', 'buildRules', 'primaryRuleId', 'customProvider',
    ]);
  });

  test('未配置自定义 Provider 时字段随序列化省略（与原提交行为一致）', () => {
    const body = buildWebCreatorGenerationRequestBody({ ...baseInput, customProvider: undefined });
    const serialized = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
    expect(serialized).not.toHaveProperty('customProvider');
    expect(serialized.primaryRuleId).toBe('arena-trpg-lite');
    expect(serialized.questionnaireSelections).toEqual([
      { source: 'preset', kind: 'magical-girl', presetId: 'mg-q' },
    ]);
  });
});
