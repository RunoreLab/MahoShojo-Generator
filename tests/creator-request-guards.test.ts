import { beforeEach, describe, expect, mock, test } from 'bun:test';

const state = {
  safetyCalls: [] as Array<Record<string, unknown>>,
  blockedTexts: new Set<string>(),
};

mock.module('@/lib/ai/public-rate-limit', () => ({
  acquirePublicAiRateLimit: async () => ({
    allowed: true,
    retryAfterSeconds: 0,
    identityScope: 'ip',
  }),
  buildPublicAiRateLimitResponse: (result: Record<string, unknown>) =>
    new Response(JSON.stringify(result), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }),
  inferPublicAiProviderMode: () => 'system',
}));

mock.module('@/lib/content-safety/server', () => ({
  enforceTextSafety: async (input: Record<string, unknown>) => {
    state.safetyCalls.push(input);
    const text = typeof input.text === 'string' ? input.text : '';
    if (!state.blockedTexts.has(text)) return null;
    return new Response(
      JSON.stringify({
        error: '输入内容不合规',
        shouldRedirect: true,
        reason: '在自由补充说明中使用了危险符文',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  },
}));

mock.module('@/lib/user-activity/record', () => ({
  recordUserActivityFromRequest: () => {},
}));

mock.module('@/lib/ai', () => ({
  generateWithAI: async () => ({
    codename: '测试魔法少女',
    appearance: {
      outfit: '',
      accessories: '',
      colorScheme: '',
      overallLook: '',
    },
    magicConstruct: {
      name: '',
      form: '',
      basicAbilities: [],
      description: '',
    },
    wonderlandRule: {
      name: '',
      description: '',
      tendency: '',
      activation: '',
    },
    blooming: {
      name: '',
      evolvedAbilities: [],
      evolvedForm: '',
      evolvedOutfit: '',
      powerLevel: '',
    },
    analysis: {
      personalityAnalysis: '',
      abilityReasoning: '',
      coreTraits: [],
      predictionBasis: '',
      background: {
        belief: '',
        bonds: '',
      },
    },
  }),
  LoadBalanceStrategy: {
    CUSTOM: 'custom',
    SEQUENTIAL: 'sequential',
  },
}));

mock.module('@/lib/stream/raw-ai', () => ({
  generateWithStreamAI: async () => {
    throw new Error('stream ai should not run in request guard tests');
  },
  LoadBalanceStrategy: {
    CUSTOM: 'custom',
    SEQUENTIAL: 'sequential',
  },
}));

mock.module('@/lib/signature', () => ({
  generateSignature: async () => 'test-signature',
}));

describe('creator request guards', () => {
  beforeEach(() => {
    state.safetyCalls = [];
    state.blockedTexts = new Set<string>();
  });

  test('非流式 creator API 拒绝不受支持的通用模板', async () => {
    const { default: handler } = await import('@/pages/api/creator/generate');
    const response = await handler(
      new Request('https://example.com/api/creator/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: 'general',
          freeformBrief: '写成档案体。',
          answers: [],
          questionnaires: [],
        }),
      }),
    );

    const payload = (await response.json()) as { error?: string; message?: string };
    expect(response.status).toBe(400);
    expect(payload.error).toBe('创作请求无效');
    expect(payload.message).toBe('CREATOR_TEMPLATE_MODE_UNSUPPORTED');
  });

  test('流式 creator API 拒绝结构化模板', async () => {
    const { default: handler } = await import('@/pages/api/creator/generate-stream');
    const response = await handler(
      new Request('https://example.com/api/creator/generate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: 'magical-girl',
          freeformBrief: '写成冷调记录体。',
          answers: [],
          questionnaires: [],
        }),
      }) as any,
    );

    const payload = (await response.json()) as { error?: string; message?: string };
    expect(response.status).toBe(400);
    expect(payload.error).toBe('创作请求无效');
    expect(payload.message).toBe('CREATOR_TEMPLATE_MODE_UNSUPPORTED');
  });

  test('非流式 creator API 会对 freeformBrief 做服务端安全检查', async () => {
    state.blockedTexts.add('危险补充说明');

    const { default: handler } = await import('@/pages/api/creator/generate');
    const response = await handler(
      new Request('https://example.com/api/creator/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: 'magical-girl',
          freeformBrief: '  危险补充说明  ',
          answers: [],
          questionnaires: [],
        }),
      }),
    );

    const payload = (await response.json()) as { shouldRedirect?: boolean; reason?: string };
    expect(response.status).toBe(400);
    expect(payload.shouldRedirect).toBeTrue();
    expect(payload.reason).toBe('在自由补充说明中使用了危险符文');
    expect(state.safetyCalls.some((call) => call.text === '危险补充说明')).toBe(true);
  });

  test('流式 creator API 会对 freeformBrief 做服务端安全检查', async () => {
    state.blockedTexts.add('危险流式补充说明');

    const { default: handler } = await import('@/pages/api/creator/generate-stream');
    const response = await handler(
      new Request('https://example.com/api/creator/generate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: 'general',
          freeformBrief: '  危险流式补充说明  ',
          answers: [],
          questionnaires: [],
        }),
      }) as any,
    );

    const payload = (await response.json()) as { shouldRedirect?: boolean; reason?: string };
    expect(response.status).toBe(400);
    expect(payload.shouldRedirect).toBeTrue();
    expect(payload.reason).toBe('在自由补充说明中使用了危险符文');
    expect(state.safetyCalls.some((call) => call.text === '危险流式补充说明')).toBe(true);
  });
});
