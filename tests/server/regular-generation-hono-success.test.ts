import { describe, expect, it, vi } from 'vitest';
import type { HonoServerConfig } from '@/server/config';
import type { RedisService } from '@/server/redis/runtime';

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  generateWithAI: vi.fn(async (_input: unknown, _config: unknown, options: any) => {
    mocks.events.push('generate');
    options.telemetry.model = 'scenario-test-model';
    return {
      title: '测试情景',
      scenario_type: '日常',
      description: '测试描述',
      elements: {
        scene: { time: '清晨', place: '车站', features: '薄雾' },
        roles: [],
        events: '一次重逢',
        atmosphere: '温暖',
        development: ['继续交谈'],
      },
    };
  }),
  generateSignature: vi.fn(async () => {
    mocks.events.push('signature');
    return 'test-signature';
  }),
  recordActivity: vi.fn((request: Request) => {
    mocks.events.push('activity');
    expect(request.headers.get('x-mahoshojo-activity-token')).toBe('activity-token');
  }),
}));

vi.mock('@/lib/ai', () => ({
  LoadBalanceStrategy: { CUSTOM: 'custom', SEQUENTIAL: 'sequential' },
  generateWithAI: mocks.generateWithAI,
}));
vi.mock('@/lib/ai/availability', () => ({
  buildChannelContextFromPayload: vi.fn(() => undefined),
}));
vi.mock('@/lib/ai/public-rate-limit', () => ({
  acquirePublicAiRateLimit: vi.fn(async () => ({ allowed: true })),
  buildPublicAiRateLimitResponse: vi.fn(),
  inferPublicAiProviderMode: vi.fn(() => 'system'),
}));
vi.mock('@/lib/content-safety/server', () => ({
  enforceTextSafety: vi.fn(async () => null),
}));
vi.mock('@/lib/logger', () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));
vi.mock('@/lib/signature', () => ({
  generateSignature: mocks.generateSignature,
}));
vi.mock('@/lib/user-activity/record', () => ({
  recordUserActivityFromRequest: mocks.recordActivity,
}));

import { createHonoApp } from '@/server/app';

const config: HonoServerConfig = {
  host: '127.0.0.1',
  port: 8787,
  nodeEnv: 'test',
  redisUrl: null,
  redisRequired: false,
  d1Required: false,
  corsOrigins: ['http://localhost:3000'],
  authMode: 'hybrid',
};

const redis: RedisService = {
  connect: async () => undefined,
  close: async () => undefined,
  getStatus: () => ({ configured: false, connected: false, ready: false, lastError: null }),
  ping: async () => false,
  consumeFixedWindow: async () => null,
};

describe('常规生成 Hono production composition', () => {
  it('经 dispatcher 保留 Scenario 签名、AI meta、活动 header 与副作用顺序', async () => {
    mocks.events.length = 0;
    const app = createHonoApp(config, redis);
    const response = await app.request('/api/generate-scenario', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mahoshojo-AI-Meta': 'true',
        'X-Mahoshojo-Activity-Token': 'activity-token',
      },
      body: JSON.stringify({
        answers: { 时间: '清晨', 地点: '车站' },
        language: 'zh-CN',
        fieldsToKeepEmpty: [],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-backend-runtime')).toBe('hono-node');
    expect(await response.json()).toEqual({
      data: {
        title: '测试情景',
        scenario_type: '日常',
        description: '测试描述',
        elements: {
          scene: { time: '清晨', place: '车站', features: '薄雾' },
          roles: [],
          events: '一次重逢',
          atmosphere: '温暖',
          development: ['继续交谈'],
        },
        metadata: {
          created_at: expect.any(String),
          signature: 'test-signature',
        },
      },
      aiMeta: { aiModel: 'scenario-test-model' },
    });
    expect(mocks.events).toEqual(['generate', 'activity', 'signature']);
    expect(mocks.generateSignature).toHaveBeenCalledOnce();
    expect(mocks.recordActivity).toHaveBeenCalledOnce();
  });
});
