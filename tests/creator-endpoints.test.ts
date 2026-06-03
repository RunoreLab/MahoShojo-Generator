import { beforeEach, describe, expect, test } from 'vitest';

import { __resetPublicAiRateLimitForTest } from '@/lib/ai/public-rate-limit';

describe('creator endpoints', () => {
  beforeEach(() => {
    __resetPublicAiRateLimitForTest();
  });

  test('非流式 creator API 允许仅凭 freeformBrief 进入后续校验', async () => {
    const { default: handler } = await import('@/app/api/creator/generate/handler');
    const response = await handler(
      new Request('https://example.com/api/creator/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: 'magical-girl',
          freeformBrief: '请写成冷淡的观察记录体。',
          answers: [],
          questionnaires: [],
          questionnaireSelections: [],
          customProvider: {},
        }),
      }),
    );

    const payload = (await response.json()) as { error?: string };
    expect(response.status).toBe(400);
    expect(payload.error).toBe('自定义 AI 供应商配置无效');
  });

  test('非流式 creator API 允许 canshou 模板仅凭 freeformBrief 进入后续校验', async () => {
    const { default: handler } = await import('@/app/api/creator/generate/handler');
    const response = await handler(
      new Request('https://example.com/api/creator/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: 'canshou',
          freeformBrief: '请写成冷静的研究记录体。',
          answers: [],
          questionnaires: [],
          questionnaireSelections: [],
          customProvider: {},
        }),
      }),
    );

    const payload = (await response.json()) as { error?: string; message?: string };
    expect(response.status).toBe(400);
    expect(payload.error).toBe('自定义 AI 供应商配置无效');
    expect(payload.message).toBeUndefined();
  });

  test('非流式 creator API 拒绝伪造的规则运行时快照', async () => {
    const { default: handler } = await import('@/app/api/creator/generate/handler');
    const response = await handler(
      new Request('https://example.com/api/creator/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: 'magical-girl',
          freeformBrief: '保持冷淡口吻。',
          answers: [],
          questionnaires: [],
          questionnaireSelections: [],
          buildRules: [
            {
              ruleId: 'arena-trpg-lite',
              version: '1.0.0',
              blockResults: {
                powerLevel: 'seed',
              },
              derived: {
                HP: 999,
              },
              validationSummary: {
                valid: true,
                issues: [],
                missingRequiredBlockKeys: [],
              },
            },
          ],
          primaryRuleId: 'arena-trpg-lite',
          customProvider: {},
        }),
      }),
    );

    const payload = (await response.json()) as { error?: string; message?: string };
    expect(response.status).toBe(400);
    expect(payload.error).toBe('创作请求无效');
    expect(payload.message).toBe('BUILD_RULE_INPUTS_REQUIRED');
  });

  test('流式 creator API 允许仅凭独立规则输入进入后续校验', async () => {
    const { default: handler } = await import('@/app/api/creator/generate-stream/handler');
    const response = await handler(
      new Request('https://example.com/api/creator/generate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: 'general',
          freeformBrief: '',
          answers: [],
          questionnaires: [],
          buildRules: [
            {
              ruleId: 'arena-trpg-lite',
              version: '1.0.0',
              inputs: {
                powerLevel: 'seed',
                coreAttributes: {
                  STR: 40,
                  CON: 40,
                  AGI: 40,
                  MAG: 40,
                  WILL: 40,
                  PER: 40,
                  CHM: 40,
                },
                specialties: [],
              },
            },
          ],
          primaryRuleId: 'arena-trpg-lite',
          customProvider: {},
        }),
      }),
    );

    const payload = (await response.json()) as { error?: string };
    expect(response.status).toBe(400);
    expect(payload.error).toBe('自定义 AI 供应商配置无效');
  });

  test('流式 creator API 拒绝伪造的规则运行时快照', async () => {
    const { default: handler } = await import('@/app/api/creator/generate-stream/handler');
    const response = await handler(
      new Request('https://example.com/api/creator/generate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: 'general',
          freeformBrief: '',
          answers: [],
          questionnaires: [],
          buildRules: [
            {
              ruleId: 'arena-trpg-lite',
              version: '1.0.0',
              blockResults: {
                powerLevel: 'seed',
                coreAttributes: {
                  STR: 999,
                },
                specialties: ['magic-bullet'],
              },
              derived: {
                HP: 999,
                MP: 999,
                Radiance: 999,
              },
              validationSummary: {
                valid: true,
                issues: [],
                missingRequiredBlockKeys: [],
              },
            },
          ],
          primaryRuleId: 'arena-trpg-lite',
          customProvider: {},
        }),
      }),
    );

    const payload = (await response.json()) as { error?: string; message?: string };
    expect(response.status).toBe(400);
    expect(payload.error).toBe('创作请求无效');
    expect(payload.message).toBe('BUILD_RULE_INPUTS_REQUIRED');
  });

  test('流式 creator API 拒绝缺少 inputs 的畸形规则载荷', async () => {
    const { default: handler } = await import('@/app/api/creator/generate-stream/handler');
    const response = await handler(
      new Request('https://example.com/api/creator/generate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: 'general',
          freeformBrief: '',
          answers: [],
          questionnaires: [],
          buildRules: [
            {
              ruleId: 'arena-trpg-lite',
              version: '1.0.0',
            },
          ],
          primaryRuleId: 'arena-trpg-lite',
          customProvider: {},
        }),
      }),
    );

    const payload = (await response.json()) as { error?: string; message?: string };
    expect(response.status).toBe(400);
    expect(payload.error).toBe('创作请求无效');
    expect(payload.message).toBe('BUILD_RULE_INPUTS_REQUIRED');
  });

  test('流式 creator API 拒绝顶层非数组的 buildRules 载荷', async () => {
    const { default: handler } = await import('@/app/api/creator/generate-stream/handler');
    const response = await handler(
      new Request('https://example.com/api/creator/generate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: 'general',
          freeformBrief: '写成档案体。',
          answers: [],
          questionnaires: [],
          buildRules: {
            ruleId: 'arena-trpg-lite',
            version: '1.0.0',
            inputs: {
              powerLevel: 'seed',
            },
          },
          primaryRuleId: 'arena-trpg-lite',
          customProvider: {},
        }),
      }),
    );

    const payload = (await response.json()) as { error?: string; message?: string };
    expect(response.status).toBe(400);
    expect(payload.error).toBe('创作请求无效');
    expect(payload.message).toBe('BUILD_RULE_LIST_INVALID');
  });
});
