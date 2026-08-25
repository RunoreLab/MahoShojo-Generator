import React from 'react';
// JSX test coverage for the card forge surface.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquirePublicAiRateLimit: vi.fn(async () => ({ allowed: true })),
  buildJsonResponseWithOptionalAiMeta: vi.fn(({ data }: { data: unknown }) =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
  enforceTextSafety: vi.fn(async () => null),
  quickCheck: vi.fn(async () => ({
    hasSensitiveWords: false,
    detectedWords: [],
    filteredText: '',
    originalText: '',
    shouldRedirectToArrested: false,
    matchDetails: [],
  })),
  generateWithAI: vi.fn(async () => ({
    cardName: '测试卡牌',
    rarity: 'common',
    cardType: 'character',
    element: 'neutral',
    cost: 1,
    attack: 1,
    defense: 1,
    hp: 1,
    effects: [{ type: '被动', description: '测试效果' }],
    traits: ['测试'],
    flavorText: '测试',
    powerLevel: 'C',
    themeColor: '#ffffff',
  })),
  recordUserActivityFromRequest: vi.fn(),
}));

vi.mock('@mahoshojo/hosted-runtime/node-runtime/structured-ai', () => ({
  createNodeStructuredAiRuntime: vi.fn(() => ({
    generateWithAI: mocks.generateWithAI,
  })),
}));
vi.mock('@mahoshojo/hosted-runtime/node-runtime/meta-response', () => ({
  buildJsonResponseWithOptionalAiMeta: mocks.buildJsonResponseWithOptionalAiMeta,
}));
vi.mock('@mahoshojo/hosted-runtime/node-runtime/public-rate-limit', () => ({
  OFFICIAL_KEY_QUESTIONNAIRE_CHARACTER_COOLDOWN_MS: 60_000,
  createPublicAiRateLimiter: vi.fn(() => ({
    acquirePublicAiRateLimit: mocks.acquirePublicAiRateLimit,
  })),
  buildPublicAiRateLimitResponse: vi.fn(),
}));
vi.mock('@mahoshojo/hosted-runtime/node-runtime/content-safety', () => ({
  createContentSafetyService: vi.fn(() => ({
    enforceTextSafety: mocks.enforceTextSafety,
  })),
}));
vi.mock('@mahoshojo/hosted-runtime/node-runtime/sensitive-word-filter', () => ({
  quickCheck: mocks.quickCheck,
  quickCheckForServer: mocks.quickCheck,
}));
vi.mock('@mahoshojo/hosted-runtime/node-runtime/data-ports', () => ({
  createNodeDataPorts: vi.fn(() => ({
    getDataCardById: vi.fn(async () => null),
    recordAiChannelOutcome: vi.fn(),
    recordUserActivityFromRequest: mocks.recordUserActivityFromRequest,
    touchUserLastActivity: vi.fn(),
  })),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import { handler } from '@/app/api/generate-game-card/handler';
import { CardForgePage } from '@/components/card-forge/CardForgePage';

beforeEach(() => {
  vi.clearAllMocks();
});

test('卡牌生成接口允许超过 50000 字符的数据卡输入进入生成流程', async () => {
  const sourceCardJson = 'a'.repeat(50_001);
  const response = await handler(
    new Request('https://example.test/api/generate-game-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceCardJson }),
    }),
  );

  expect(response.status).toBe(200);
  expect(mocks.generateWithAI).toHaveBeenCalledOnce();
});

test('卡牌生成响应会对屏蔽词做递归遮罩', async () => {
  mocks.generateWithAI.mockResolvedValueOnce({
    cardName: '来自中国',
    rarity: 'common',
    cardType: 'character',
    element: 'neutral',
    cost: 1,
    attack: 1,
    defense: 1,
    hp: 1,
    effects: [{ type: '被动', description: '守护中国' }],
    traits: ['测试'],
    flavorText: '安全文本',
    powerLevel: 'C',
    themeColor: '#ffffff',
  });

  const response = await handler(
    new Request('https://example.test/api/generate-game-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceCardJson: '{"safe":true}' }),
    }),
  );
  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(payload.faceData.cardName).toBe('来自【国度】');
  expect(payload.faceData.effects[0].description).toBe('守护【国度】');
});

test('卡牌生成响应命中敏感词时拒绝返回卡面', async () => {
  mocks.quickCheck.mockResolvedValueOnce({
    hasSensitiveWords: true,
    detectedWords: ['测试敏感词'],
    filteredText: '',
    originalText: '',
    shouldRedirectToArrested: true,
    matchDetails: [],
  });

  const response = await handler(
    new Request('https://example.test/api/generate-game-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceCardJson: '{"safe":true}' }),
    }),
  );

  expect(response.status).toBe(400);
  expect(mocks.buildJsonResponseWithOptionalAiMeta).not.toHaveBeenCalled();
});

test('卡牌生成保留 custom Provider 的 legacy SEQUENTIAL 策略', async () => {
  const response = await handler(
    new Request('https://example.test/api/generate-game-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceCardJson: '{"safe":true}',
        customProvider: {
          providerId: 'kourichat',
          modelId: 'gpt-5.4',
          apiKey: 'test-provider-key',
        },
      }),
    }),
  );

  expect(response.status).toBe(200);
  const aiOptions = mocks.generateWithAI.mock.calls[0]?.[2] as any;
  expect(aiOptions.loadBalanceStrategy).toBe('sequential');
  expect(aiOptions.providerOverride).toMatchObject({
    providerId: 'kourichat',
    model: 'gpt-5.4',
    apiKey: 'test-provider-key',
  });
  expect(mocks.recordUserActivityFromRequest).toHaveBeenCalledOnce();
});

test('DeepSeek legacy alias 仅规范化 Provider override，availability channel 保留原 modelId', async () => {
  const response = await handler(
    new Request('https://example.test/api/generate-game-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceCardJson: '{"safe":true}',
        customProvider: {
          providerId: 'deepseek',
          modelId: 'deepseek-v4-flash-0731',
          apiKey: ' test-provider-key ',
        },
      }),
    }),
  );

  expect(response.status).toBe(200);
  const aiOptions = mocks.generateWithAI.mock.calls[0]?.[2] as any;
  expect(aiOptions.providerOverride).toMatchObject({
    providerId: 'deepseek',
    model: 'deepseek-v4-flash',
    apiKey: 'test-provider-key',
  });
  expect(aiOptions.channelContext).toEqual({
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash-0731',
  });
});

test('卡牌工坊展示 Token 指示器', () => {
  const html = renderToStaticMarkup(<CardForgePage />);

  expect(html).toContain('tokens');
  expect(html).toContain('估算仅供参考');
});

test('卡牌尚未生成时仍展示卡面存档导入入口并禁用导出', () => {
  const html = renderToStaticMarkup(<CardForgePage />);

  expect(html).toContain('卡面存档');
  expect(html).toContain('导入卡面 JSON');
  expect(html).toMatch(/<button[^>]*disabled[^>]*>导出卡面 JSON/);
});
