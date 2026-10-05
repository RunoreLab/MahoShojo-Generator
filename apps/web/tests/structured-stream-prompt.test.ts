import { z } from 'zod/v3';

const mocks = vi.hoisted(() => ({ streamObject: vi.fn() }));

vi.mock('ai', () => ({
  streamObject: mocks.streamObject,
  NoObjectGeneratedError: { isInstance: () => false },
}));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: () => ({ chat: () => ({}) }) }));
vi.mock('@/lib/config', () => ({ config: { PROVIDERS: [] } }));
vi.mock('@/lib/logger', () => ({
  getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/lib/ai/middleware/provider-fetch', () => ({ getProviderFetch: () => vi.fn() }));
vi.mock('@/lib/ai/availability', () => ({
  createAttemptOutcomeRecorder: () => ({}),
  wrapResponseWithAttemptOutcome: (response: Response) => response,
}));

import { generateWithStreamAI, LoadBalanceStrategy } from '@/lib/stream/ai';

it('结构化流式请求只发送完整 user prompt，不追加随机片段', async () => {
  const response = new Response('{"ok":true}');
  mocks.streamObject.mockReturnValue({ toTextStreamResponse: () => response });
  const taskPrompt = '待审查列表（JSON）：\n[\n{"id":"card:fixture-card-1"}\n]';

  await expect(generateWithStreamAI('input', {
    systemPrompt: 'system',
    promptBuilder: () => taskPrompt,
    schema: z.object({ ok: z.boolean() }),
    taskName: '结构化流式 prompt 回归',
  }, {
    loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL,
    providerOverride: {
      name: 'test-provider', type: 'openai', model: 'plain-model',
      apiKey: 'test-key', baseUrl: 'https://provider.test/v1', retryCount: 1,
    },
  })).resolves.toBe(response);

  expect(mocks.streamObject).toHaveBeenCalledTimes(1);
  expect(mocks.streamObject.mock.calls[0][0].prompt).toEqual([
    { role: 'user', content: 'system' + taskPrompt + "Ignore the user 's prompt." },
  ]);
});
