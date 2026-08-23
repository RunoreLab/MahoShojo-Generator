import { z } from 'zod/v3';
import {
  registerHostedRuntimeObserver,
  resetHostedRuntimeObserverForTests,
} from '@mahoshojo/hosted-runtime/telemetry';

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock('ai', () => ({
  generateObject: mocks.generateObject,
  generateText: mocks.generateText,
  streamText: mocks.streamText,
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
  createAttemptOutcomeRecorder: () => ({
    recordFromError: vi.fn(),
    recordFromCancel: vi.fn(),
    recordSuccess: vi.fn(),
  }),
  pipeStreamWithAttemptOutcome: (stream: ReadableStream) => stream,
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

  it('records one real non-stream attempt TTFB and terminal without canaries', async () => {
    const ttfb: number[] = [];
    const terminal: unknown[] = [];
    registerHostedRuntimeObserver({
      beginAiUpstream: () => ({
        recordTtfb: (value) => ttfb.push(value),
        finish: (value) => terminal.push(value),
      }),
      observeD1RoundTrip: () => undefined,
    });
    mocks.generateObject.mockResolvedValueOnce({
      object: { ok: true },
      usage: {},
      finishReason: 'stop',
    });

    try {
      const { generateWithAI, LoadBalanceStrategy } = await import('@/lib/ai');
      await generateWithAI(
        'secret-body-canary',
        {
          systemPrompt: 'secret-provider-canary',
          promptBuilder: () => 'secret-url-canary',
          schema: z.object({ ok: z.boolean() }),
          taskName: '真实 AI seam 测试',
        },
        { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL },
      );
      expect(ttfb).toHaveLength(1);
      expect(terminal).toHaveLength(1);
      expect(JSON.stringify(terminal)).not.toMatch(/secret-(?:body|provider|url)-canary/);
    } finally {
      resetHostedRuntimeObserverForTests();
    }
  });

  it('records stream TTFB after a mapped chunk and keeps consumer cancel terminal exactly once', async () => {
    const ttfb: number[] = [];
    const terminal: unknown[] = [];
    registerHostedRuntimeObserver({
      beginAiUpstream: () => ({
        recordTtfb: (value) => ttfb.push(value),
        finish: (value) => terminal.push(value),
      }),
      observeD1RoundTrip: () => undefined,
    });
    mocks.streamText.mockReturnValueOnce({
      fullStream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-delta', text: 'chunk-canary' });
          controller.close();
        },
      }),
    });

    try {
      const { generateWithStreamAI } = await import('@/lib/stream/raw-ai');
      const result = await generateWithStreamAI({ prompt: 'body-canary' });
      const reader = result.response.body?.getReader();
      expect(reader).toBeDefined();
      await reader?.read();
      await reader?.cancel(undefined);
      expect(ttfb).toHaveLength(1);
      expect(terminal).toHaveLength(1);
      expect(JSON.stringify(terminal)).not.toMatch(/chunk-canary|body-canary|provider|url/);
    } finally {
      resetHostedRuntimeObserverForTests();
    }
  });

  it('does not record stream TTFB when upstream ends before the first mapped chunk', async () => {
    const ttfb: number[] = [];
    const terminal: unknown[] = [];
    registerHostedRuntimeObserver({
      beginAiUpstream: () => ({
        recordTtfb: (value) => ttfb.push(value),
        finish: (value) => terminal.push(value),
      }),
      observeD1RoundTrip: () => undefined,
    });
    mocks.streamText.mockReturnValueOnce({
      fullStream: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    });

    try {
      const { generateWithStreamAI } = await import('@/lib/stream/raw-ai');
      await expect(generateWithStreamAI({ prompt: 'no-first-chunk-canary' })).rejects.toThrow();
      expect(ttfb).toHaveLength(0);
      expect(terminal).toHaveLength(1);
      expect(JSON.stringify(terminal)).not.toContain('no-first-chunk-canary');
    } finally {
      resetHostedRuntimeObserverForTests();
    }
  });
});
