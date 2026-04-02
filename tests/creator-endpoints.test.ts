import { beforeEach, describe, expect, test } from 'bun:test';

import { __resetPublicAiRateLimitForTest } from '@/lib/ai/public-rate-limit';
import { evaluateBuildRuleState } from '@/lib/creator/build-rule-runtime';

describe('creator endpoints', () => {
  beforeEach(() => {
    __resetPublicAiRateLimitForTest();
  });

  test('非流式 creator API 允许仅凭 freeformBrief 进入后续校验', async () => {
    const { default: handler } = await import('@/pages/api/creator/generate');
    const response = await handler(
      new Request('https://example.com/api/creator/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: 'general',
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

  test('流式 creator API 允许仅凭独立规则快照进入后续校验', async () => {
    const arenaRule = evaluateBuildRuleState({
      ruleId: 'arena-trpg-lite',
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
    });

    const { default: handler } = await import('@/pages/api/creator/generate-stream');
    const response = await handler(
      new Request('https://example.com/api/creator/generate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: 'general',
          freeformBrief: '',
          answers: [],
          questionnaires: [],
          buildRules: [arenaRule],
          primaryRuleId: 'arena-trpg-lite',
          customProvider: {},
        }),
      }),
    );

    const payload = (await response.json()) as { error?: string };
    expect(response.status).toBe(400);
    expect(payload.error).toBe('自定义 AI 供应商配置无效');
  });
});
