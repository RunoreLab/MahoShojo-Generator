import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { AI_META_REQUEST_HEADER } from '@/lib/ai/meta-response';
import { buildCreatorPromptInput, validateCreatorRequest } from '@/lib/creator/server';

const arenaRule = {
  ruleId: 'arena-trpg-lite',
  version: '1.0.0',
  blockResults: {
    powerLevel: 'seed',
    coreAttributes: {
      STR: 12,
      CON: 18,
      AGI: 10,
      MAG: 16,
      WILL: 20,
      PER: 8,
      CHM: 6,
    },
    specialties: ['magic-burst'],
  },
  derived: {
    HP: 3,
    MP: 4,
    Radiance: 4,
  },
  validationSummary: {
    valid: true,
    issues: [],
    missingRequiredBlockKeys: [],
  },
} as const;

const resolvePreset = (ruleId: string) => {
  if (ruleId === 'requires-questionnaire-rule') {
    return {
      id: 'requires-questionnaire-rule',
      version: '1.0.0',
      supportedTemplates: ['general'],
      allowStandalone: false,
      mainRuleEligible: true,
      projectionPolicy: 'primary-structured' as const,
      blocks: [],
    };
  }

  if (ruleId === 'reference-only-rule') {
    return {
      id: 'reference-only-rule',
      version: '1.0.0',
      supportedTemplates: ['general'],
      allowStandalone: true,
      mainRuleEligible: false,
      projectionPolicy: 'reference-only' as const,
      blocks: [],
    };
  }

  return null;
};

const handlerState = {
  freeCalls: [] as Array<{ body: Record<string, unknown>; headers: Record<string, string> }>,
  streamCalls: [] as Array<{ body: Record<string, unknown>; headers: Record<string, string> }>,
};

mock.module('@/pages/api/generate-free', () => ({
  default: async (req: Request) => {
    const body = (await req.json()) as Record<string, unknown>;
    handlerState.freeCalls.push({
      body,
      headers: Object.fromEntries(req.headers.entries()),
    });

    const schema = body.schema;
    const card =
      schema === 'general-scenario'
        ? {
            templateId: '通用情景',
            title: '测试情景',
            content: '# 测试情景\n\n用于 creator API 测试。',
          }
        : {
            templateId: '通用角色',
            name: '测试角色',
            content: '# 测试角色\n\n用于 creator API 测试。',
          };

    if (req.headers.get(AI_META_REQUEST_HEADER) === 'true') {
      return new Response(
        JSON.stringify({
          data: card,
          aiMeta: {
            aiModel: 'mock-free-model',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(JSON.stringify(card), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
}));

mock.module('@/pages/api/generate-free-stream', () => ({
  default: async (req: Request) => {
    const body = (await req.json()) as Record<string, unknown>;
    handlerState.streamCalls.push({
      body,
      headers: Object.fromEntries(req.headers.entries()),
    });

    return new Response('data: {"type":"done"}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  },
}));

describe('creator server', () => {
  beforeEach(() => {
    handlerState.freeCalls = [];
    handlerState.streamCalls = [];
  });

  test('freeformBrief 优先于问卷说明，但不覆盖结构化规则事实', () => {
    const built = buildCreatorPromptInput({
      template: 'general',
      freeformBrief: '写成冷淡口吻',
      questionnaires: [{ questionnaireId: 'q-1', title: '背景问卷' }],
      questionnaireAnswers: [{ questionnaireId: 'q-1', question: '你是谁', answer: '观测者' }],
      buildRules: [arenaRule],
      primaryRuleId: 'arena-trpg-lite',
    });

    expect(built.userIntent).toContain('冷淡口吻');
    expect(built.questionnaireSummary).toContain('背景问卷');
    expect(built.buildRuleProjection.primary?.template).toBe('general');
    expect(built.buildRuleProjection.primary?.facts.blockResults.powerLevel).toBe('seed');
  });

  test('没有问卷和规则时要求 freeformBrief 非空', () => {
    expect(() =>
      validateCreatorRequest({
        template: 'general',
        freeformBrief: '',
        questionnaires: [],
        questionnaireAnswers: [],
        buildRules: [],
      })
    ).toThrow('FREEFORM_BRIEF_REQUIRED');
  });

  test('存在规则时要求 primaryRuleId', () => {
    expect(() =>
      validateCreatorRequest({
        template: 'general',
        freeformBrief: 'x',
        questionnaires: [],
        questionnaireAnswers: [],
        buildRules: [arenaRule],
      })
    ).toThrow('PRIMARY_RULE_REQUIRED');
  });

  test('primaryRuleId 必须存在于 buildRules', () => {
    expect(() =>
      validateCreatorRequest({
        template: 'general',
        freeformBrief: 'x',
        questionnaires: [],
        questionnaireAnswers: [],
        buildRules: [arenaRule],
        primaryRuleId: 'missing-rule',
      })
    ).toThrow('PRIMARY_RULE_NOT_SELECTED');
  });

  test('规则不支持当前模板时拒绝请求', () => {
    expect(() =>
      validateCreatorRequest({
        template: 'scenario',
        freeformBrief: 'x',
        questionnaires: [],
        questionnaireAnswers: [],
        buildRules: [arenaRule],
        primaryRuleId: 'arena-trpg-lite',
      })
    ).toThrow('RULE_TEMPLATE_UNSUPPORTED');
  });

  test('allowStandalone=false 的规则缺少问卷时拒绝请求', () => {
    expect(() =>
      validateCreatorRequest(
        {
          template: 'general',
          freeformBrief: 'x',
          questionnaires: [],
          questionnaireAnswers: [],
          buildRules: [
            {
              ...arenaRule,
              ruleId: 'requires-questionnaire-rule',
            },
          ],
          primaryRuleId: 'requires-questionnaire-rule',
        },
        { resolvePreset }
      )
    ).toThrow('QUESTIONNAIRE_REQUIRED_FOR_RULE');
  });

  test('primaryRuleId 对应规则必须允许作为主规则', () => {
    expect(() =>
      validateCreatorRequest(
        {
          template: 'general',
          freeformBrief: 'x',
          questionnaires: [{ questionnaireId: 'q-1' }],
          questionnaireAnswers: [],
          buildRules: [
            {
              ...arenaRule,
              ruleId: 'reference-only-rule',
            },
          ],
          primaryRuleId: 'reference-only-rule',
        },
        { resolvePreset }
      )
    ).toThrow('PRIMARY_RULE_INELIGIBLE');
  });

  test('规则 runtime 非法时拒绝请求', () => {
    expect(() =>
      validateCreatorRequest({
        template: 'general',
        freeformBrief: 'x',
        questionnaires: [],
        questionnaireAnswers: [],
        buildRules: [
          {
            ...arenaRule,
            validationSummary: {
              valid: false,
              issues: [
                {
                  code: 'required-missing' as const,
                  blockKey: 'coreAttributes',
                  message: 'coreAttributes is required.',
                },
              ],
              missingRequiredBlockKeys: ['coreAttributes'],
            },
          },
        ],
        primaryRuleId: 'arena-trpg-lite',
      })
    ).toThrow('BUILD_RULE_VALIDATION_FAILED');
  });
});

describe('creator api handlers', () => {
  beforeEach(() => {
    handlerState.freeCalls = [];
    handlerState.streamCalls = [];
  });

  test('creator non-stream 成功时保留 aiMeta 包装并写入 creationInputs / buildState', async () => {
    const { default: handler } = await import('@/pages/api/creator/generate');
    const response = await handler(
      new Request('https://example.com/api/creator/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [AI_META_REQUEST_HEADER]: 'true',
        },
        body: JSON.stringify({
          template: 'general',
          freeformBrief: '写成冷淡口吻',
          questionnaires: [{ questionnaireId: 'q-1', title: '背景问卷' }],
          questionnaireAnswers: [
            { questionnaireId: 'q-1', question: '你是谁', answer: '观测者' },
          ],
          buildRules: [arenaRule],
          primaryRuleId: 'arena-trpg-lite',
        }),
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data?: Record<string, any>;
      aiMeta?: { aiModel?: string } | null;
    };
    expect(payload.aiMeta?.aiModel).toBe('mock-free-model');
    expect(payload.data?.creationInputs?.template).toBe('general');
    expect(payload.data?.creationInputs?.questionnaires).toEqual([
      { questionnaireId: 'q-1', title: '背景问卷' },
    ]);
    expect(payload.data?.buildState).toEqual({
      primaryRuleId: 'arena-trpg-lite',
      rules: [arenaRule],
    });
    expect(handlerState.freeCalls).toHaveLength(1);
    expect(handlerState.freeCalls[0]?.body.schema).toBe('general');
    expect(String(handlerState.freeCalls[0]?.body.prompt ?? '')).toContain('冷淡口吻');
    expect(String(handlerState.freeCalls[0]?.body.prompt ?? '')).toContain('背景问卷');
    expect(String(handlerState.freeCalls[0]?.body.prompt ?? '')).toContain('powerLevel');
  });

  test('creator non-stream 在没有规则时不写空 buildState', async () => {
    const { default: handler } = await import('@/pages/api/creator/generate');
    const response = await handler(
      new Request('https://example.com/api/creator/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          template: 'general',
          freeformBrief: '写一个安静的图书管理员',
          questionnaires: [],
          questionnaireAnswers: [],
          buildRules: [],
        }),
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, any>;
    expect(payload.creationInputs?.buildRules).toEqual([]);
    expect(payload.buildState).toBeUndefined();
  });

  test('creator non-stream 在规则校验失败时返回结构化错误并阻止下游生成', async () => {
    const { default: handler } = await import('@/pages/api/creator/generate');
    const response = await handler(
      new Request('https://example.com/api/creator/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          template: 'scenario',
          freeformBrief: '写成竞技场登场介绍',
          questionnaires: [],
          questionnaireAnswers: [],
          buildRules: [arenaRule],
          primaryRuleId: 'arena-trpg-lite',
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'RULE_TEMPLATE_UNSUPPORTED',
    });
    expect(handlerState.freeCalls).toHaveLength(0);
  });

  test('creator non-stream 会基于 blockResults 重算规则结果，而不是信任客户端 derived', async () => {
    const { default: handler } = await import('@/pages/api/creator/generate');
    const response = await handler(
      new Request('https://example.com/api/creator/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [AI_META_REQUEST_HEADER]: 'true',
        },
        body: JSON.stringify({
          template: 'general',
          freeformBrief: '写一个沉默的图书管理员',
          questionnaires: [],
          questionnaireAnswers: [],
          buildRules: [
            {
              ...arenaRule,
              derived: {
                HP: 999,
                MP: 999,
                Radiance: 999,
              },
            },
          ],
          primaryRuleId: 'arena-trpg-lite',
        }),
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data?: {
        buildState?: {
          rules?: Array<{ derived?: Record<string, number> }>;
        };
      };
    };
    expect(payload.data?.buildState?.rules?.[0]?.derived).toEqual({
      HP: 3,
      MP: 4,
      Radiance: 4,
    });
    expect(String(handlerState.freeCalls[0]?.body.prompt ?? '')).toContain('"HP": 3');
    expect(String(handlerState.freeCalls[0]?.body.prompt ?? '')).not.toContain('999');
  });

  test('creator non-stream 对无效 blockResults 返回结构化错误并阻止下游生成', async () => {
    const { default: handler } = await import('@/pages/api/creator/generate');
    const response = await handler(
      new Request('https://example.com/api/creator/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          template: 'general',
          freeformBrief: '写一个沉默的图书管理员',
          questionnaires: [],
          questionnaireAnswers: [],
          buildRules: [
            {
              ...arenaRule,
              blockResults: {
                powerLevel: 'seed',
              },
              derived: {
                HP: 999,
                MP: 999,
                Radiance: 999,
              },
            },
          ],
          primaryRuleId: 'arena-trpg-lite',
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'BUILD_RULE_VALIDATION_FAILED',
      ruleId: 'arena-trpg-lite',
    });
    expect(handlerState.freeCalls).toHaveLength(0);
  });

  test('creator stream 仅允许 general / general-scenario', async () => {
    const { default: handler } = await import('@/pages/api/creator/generate-stream');
    const response = await handler(
      new Request('https://example.com/api/creator/generate-stream', {
        method: 'POST',
        body: JSON.stringify({
          template: 'scenario',
          freeformBrief: 'x',
          questionnaires: [],
          questionnaireAnswers: [],
          buildRules: [],
        }),
        headers: { 'Content-Type': 'application/json' },
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'STREAM_TEMPLATE_UNSUPPORTED',
    });
    expect(handlerState.streamCalls).toHaveLength(0);
  });

  test('creator stream 对合法模板桥接旧流式接口', async () => {
    const { default: handler } = await import('@/pages/api/creator/generate-stream');
    const response = await handler(
      new Request('https://example.com/api/creator/generate-stream', {
        method: 'POST',
        body: JSON.stringify({
          template: 'general-scenario',
          freeformBrief: '写成诡异便利店的开场',
          questionnaires: [],
          questionnaireAnswers: [],
          buildRules: [],
        }),
        headers: { 'Content-Type': 'application/json' },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(await response.text()).toContain('"done"');
    expect(handlerState.streamCalls).toHaveLength(1);
    expect(handlerState.streamCalls[0]?.body.schema).toBe('general-scenario');
    expect(String(handlerState.streamCalls[0]?.body.prompt ?? '')).toContain(
      '诡异便利店的开场'
    );
  });
});
