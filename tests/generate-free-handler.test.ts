import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateWithAI: vi.fn(async () => ({})),
  recordUserActivityFromRequest: vi.fn(),
}));

vi.mock('@mahoshojo/hosted-runtime/node-runtime/structured-ai', () => ({
  createNodeStructuredAiRuntime: vi.fn(() => ({
    generateWithAI: mocks.generateWithAI,
  })),
}));
vi.mock('@mahoshojo/hosted-runtime/node-runtime/meta-response', () => ({
  buildJsonResponseWithOptionalAiMeta: vi.fn(({ data }: { data: unknown }) => new Response(
    JSON.stringify(data),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )),
}));
vi.mock('@mahoshojo/hosted-runtime/node-runtime/public-rate-limit', () => ({
  OFFICIAL_KEY_QUESTIONNAIRE_CHARACTER_COOLDOWN_MS: 60_000,
  createPublicAiRateLimiter: vi.fn(() => ({
    acquirePublicAiRateLimit: vi.fn(async () => ({ allowed: true })),
  })),
  buildPublicAiRateLimitResponse: vi.fn(),
}));
vi.mock('@mahoshojo/hosted-runtime/node-runtime/content-safety', () => ({
  createContentSafetyService: vi.fn(() => ({
    enforceTextSafety: vi.fn(async () => null),
  })),
}));
vi.mock('@mahoshojo/hosted-runtime/node-runtime/data-ports', () => ({
  createNodeDataPorts: vi.fn(() => ({
    getDataCardById: vi.fn(async () => null),
    recordAiChannelOutcome: vi.fn(),
    recordUserActivityFromRequest: mocks.recordUserActivityFromRequest,
    touchUserLastActivity: vi.fn(),
  })),
}));

import handler from '@/app/api/generate-free/handler';

beforeEach(() => {
  vi.clearAllMocks();
});

test('Free 非流式在 AI 成功后即使输出校验失败也记录一次活动', async () => {
  const response = await handler(new Request('https://example.test/api/generate-free', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schema: 'general',
      prompt: '生成测试角色',
      attachments: [],
      language: 'zh-CN',
    }),
  }));

  expect(response.status).toBe(500);
  expect(mocks.generateWithAI).toHaveBeenCalledOnce();
  expect(mocks.recordUserActivityFromRequest).toHaveBeenCalledOnce();
});

test('Free 非流式保留 custom Provider 的 CUSTOM 策略和成功活动记录', async () => {
  mocks.generateWithAI.mockResolvedValueOnce({ name: '测试角色', content: '测试正文' });
  const response = await handler(new Request('https://example.test/api/generate-free', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schema: 'general',
      prompt: '生成测试角色',
      attachments: [],
      language: 'zh-CN',
      customProvider: {
        providerId: 'kourichat',
        modelId: 'gpt-5.4',
        apiKey: 'test-provider-key',
      },
    }),
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    name: '测试角色',
    content: '测试正文',
    templateId: '通用角色',
  });
  const aiOptions = mocks.generateWithAI.mock.calls[0]?.[2] as any;
  expect(aiOptions.loadBalanceStrategy).toBe('custom');
  expect(aiOptions.providerOverride).toMatchObject({
    providerId: 'kourichat',
    model: 'gpt-5.4',
    apiKey: 'test-provider-key',
  });
  expect(mocks.recordUserActivityFromRequest).toHaveBeenCalledOnce();
});
