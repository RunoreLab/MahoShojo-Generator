import { beforeEach, describe, expect, vi, test } from 'vitest';

const state = vi.hoisted(() => ({
  safetyCalls: [] as Array<Record<string, unknown>>,
  blockedTexts: new Set<string>(),
}));

vi.mock('@mahoshojo/hosted-runtime/node-runtime/public-rate-limit', () => ({
  OFFICIAL_KEY_QUESTIONNAIRE_CHARACTER_COOLDOWN_MS: 60_000,
  createPublicAiRateLimiter: vi.fn(() => ({
    acquirePublicAiRateLimit: vi.fn(async () => ({
      allowed: true,
      retryAfterSeconds: 0,
      identityScope: 'ip',
    })),
  })),
  buildPublicAiRateLimitResponse: (result: Record<string, unknown>) =>
    new Response(JSON.stringify(result), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }),
}));

vi.mock('@mahoshojo/hosted-runtime/node-runtime/content-safety', () => ({
  createContentSafetyService: vi.fn(() => ({
    enforceTextSafety: vi.fn(async (input: Record<string, unknown>) => {
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
    }),
  })),
}));

vi.mock('@mahoshojo/hosted-runtime/node-runtime/data-ports', () => ({
  createNodeDataPorts: vi.fn(() => ({
    getDataCardById: vi.fn(async () => null),
    recordAiChannelOutcome: vi.fn(),
    recordUserActivityFromRequest: vi.fn(),
    touchUserLastActivity: vi.fn(),
  })),
}));

vi.mock('@mahoshojo/hosted-runtime/node-runtime/structured-ai', () => ({
  createNodeStructuredAiRuntime: vi.fn(() => ({
    generateWithAI: vi.fn(async () => ({
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
    })),
  })),
}));

vi.mock('@mahoshojo/hosted-runtime/node-runtime/raw-stream-ai', () => ({
  createNodeRawStreamAiRuntime: vi.fn(() => ({
    generateWithStreamAI: vi.fn(async () => {
      throw new Error('stream ai should not run in request guard tests');
    }),
  })),
}));

vi.mock('@mahoshojo/hosted-runtime/node-runtime/env-signature', () => ({
  generateSignature: vi.fn(async () => 'test-signature'),
  verifySignature: vi.fn(async () => false),
  createEnvSignatureService: vi.fn(() => ({
    generateSignature: vi.fn(async () => 'test-signature'),
    verifySignature: vi.fn(async () => false),
  })),
}));

describe('creator request guards', () => {
  beforeEach(() => {
    state.safetyCalls = [];
    state.blockedTexts = new Set<string>();
  });

  test('非流式 creator API 返回的卡片不会在 creationInputs 中重复保存问卷与答案', async () => {
    const { default: handler } = await import('@/app/api/creator/generate/handler');
    const response = await handler(
      new Request('https://example.com/api/creator/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: 'magical-girl',
          freeformBrief: '写成冷淡的观察记录体。',
          answers: [
            {
              question: '你是谁？',
              answer: '雾灯',
              questionId: 'q-1',
            },
          ],
          questionnaires: [
            {
              id: 'mg-64',
              title: '64题版问卷',
              kind: 'magical-girl',
              questions: [
                {
                  id: 'q-1',
                  question: '你是谁？',
                  required: true,
                  maxLength: 80,
                },
              ],
            },
          ],
        }),
      }),
    );

    const payload = (await response.json()) as {
      userAnswers?: Array<Record<string, unknown>>;
      creationInputs?: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(payload.userAnswers).toHaveLength(1);
    expect(payload.creationInputs?.template).toBe('magical-girl');
    expect(payload.creationInputs?.freeformBrief).toBe('写成冷淡的观察记录体。');
    expect(payload.creationInputs?.questionnaires).toBeUndefined();
    expect(payload.creationInputs?.questionnaireAnswers).toBeUndefined();
  });

  test('非流式 creator API 拒绝不受支持的通用模板', async () => {
    const { default: handler } = await import('@/app/api/creator/generate/handler');
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
    const { default: handler } = await import('@/app/api/creator/generate-stream/handler');
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

    const { default: handler } = await import('@/app/api/creator/generate/handler');
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
    expect(payload.shouldRedirect).toBe(true);
    expect(payload.reason).toBe('在自由补充说明中使用了危险符文');
    expect(state.safetyCalls.some((call) => call.text === '危险补充说明')).toBe(true);
  });

  test('流式 creator API 会对 freeformBrief 做服务端安全检查', async () => {
    state.blockedTexts.add('危险流式补充说明');

    const { default: handler } = await import('@/app/api/creator/generate-stream/handler');
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
    expect(payload.shouldRedirect).toBe(true);
    expect(payload.reason).toBe('在自由补充说明中使用了危险符文');
    expect(state.safetyCalls.some((call) => call.text === '危险流式补充说明')).toBe(true);
  });
});
