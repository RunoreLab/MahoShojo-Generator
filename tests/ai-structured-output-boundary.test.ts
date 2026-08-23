import { z } from 'zod/v3';

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock('ai', () => ({
  generateObject: mocks.generateObject,
  generateText: mocks.generateText,
  NoObjectGeneratedError: { isInstance: () => false },
}));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => ({ chat: () => ({}) }),
}));
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => () => ({}),
}));
vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: () => () => ({}),
}));
vi.mock('@/lib/config', () => ({
  config: {
    PROVIDERS: [{
      name: 'test-provider',
      apiKey: 'test-key',
      baseUrl: 'https://example.invalid/v1',
      model: 'test-model',
      type: 'openai',
      retryCount: 1,
      skipProbability: 0,
      providerId: 'system',
    }],
    LOAD_BALANCE_STRATEGY: 'sequential',
  },
}));
vi.mock('@/lib/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));
vi.mock('@/lib/ai/middleware/provider-fetch', () => ({
  getProviderFetch: () => fetch,
}));
vi.mock('@/lib/ai/generation-settings/resolve', () => ({
  resolveGenerationSettings: () => ({
    standardOptions: {},
    diagnostics: { omitted: [], warnings: [] },
  }),
}));
vi.mock('@/lib/ai/utils/error-extraction', () => ({
  enhanceErrorWithUpstreamMessage: (error: unknown) => error,
}));
vi.mock('@/lib/ai/availability', () => ({
  classifySuccess: () => ({}),
  classifyOutcome: () => ({}),
  recordAiChannelOutcome: vi.fn(),
}));
vi.mock('@/lib/ai/reasoning-normalizer', () => ({
  buildReasoningSummary: () => null,
}));

describe('Hosted structured output acceptance boundary', () => {
  it('rejects unsafe keys from the normal generateObject success path', async () => {
    mocks.generateObject.mockResolvedValueOnce({
      object: JSON.parse('{"payload":{"constructor":{"sentinel":"must-not-leak"}}}'),
      usage: {},
      finishReason: 'stop',
    });
    const { generateWithAI, LoadBalanceStrategy } = await import('@/lib/ai');

    const execution = generateWithAI(
      'input',
      {
        systemPrompt: 'system',
        promptBuilder: () => 'prompt',
        schema: z.object({ payload: z.record(z.unknown()) }),
        taskName: '边界测试',
      },
      { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL },
    );

    await expect(execution).rejects.toThrow('边界测试失败');
    await expect(execution).rejects.not.toThrow('must-not-leak');
  });
});
