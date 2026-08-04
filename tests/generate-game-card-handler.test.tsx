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

vi.mock('@/lib/ai', () => ({
  LoadBalanceStrategy: { CUSTOM: 'custom', SEQUENTIAL: 'sequential' },
  generateWithAI: mocks.generateWithAI,
}));
vi.mock('@/lib/ai/availability', () => ({
  buildChannelContextFromPayload: vi.fn(() => undefined),
}));
vi.mock('@/lib/ai/meta-response', () => ({
  buildJsonResponseWithOptionalAiMeta: mocks.buildJsonResponseWithOptionalAiMeta,
}));
vi.mock('@/lib/ai/public-rate-limit', () => ({
  acquirePublicAiRateLimit: mocks.acquirePublicAiRateLimit,
  buildPublicAiRateLimitResponse: vi.fn(),
  inferPublicAiProviderMode: vi.fn(() => 'system'),
}));
vi.mock('@/lib/content-safety/server', () => ({
  enforceTextSafety: mocks.enforceTextSafety,
}));
vi.mock('@/lib/logger', () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn() })),
}));
vi.mock('@/lib/user-activity/record', () => ({
  recordUserActivityFromRequest: mocks.recordUserActivityFromRequest,
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
