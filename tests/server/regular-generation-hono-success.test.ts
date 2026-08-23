import { describe, expect, it, vi } from 'vitest';
import type { HonoServerConfig } from '@/server/config';
import type { RedisService } from '@/server/redis/runtime';

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  generateWithAI: vi.fn(async (_input: unknown, config: unknown, options: any) => {
    mocks.events.push('generate');
    const taskName = (config as { taskName?: string })?.taskName;
    options.telemetry.model = taskName === '生成残兽档案'
      ? 'canshou-test-model'
      : taskName === '生成魔法少女详细信息'
        ? 'creator-test-model'
        : 'scenario-test-model';
    if (taskName === '生成残兽档案') {
      return { name: '测试残兽', coreConcept: '测试核心' };
    }
    if (taskName === '生成魔法少女详细信息') {
      return { codename: '测试花名' };
    }
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
  streamAbortSignals: [] as AbortSignal[],
  generateWithStreamAI: vi.fn(async (_input: unknown, options: any) => {
    mocks.events.push('generate-stream');
    mocks.streamAbortSignals.push(options.abortSignal);
    options.telemetry.model = 'stream-test-model';
    return {
      response: new Response('hono-stream-body', {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Upstream-Stream': 'preserved',
        },
      }),
      usagePromise: Promise.resolve({}),
    };
  }),
}));

vi.mock('@/lib/ai', () => ({
  LoadBalanceStrategy: { CUSTOM: 'custom', SEQUENTIAL: 'sequential' },
  generateWithAI: mocks.generateWithAI,
}));
vi.mock('@/lib/ai/availability', () => ({
  buildChannelContextFromPayload: vi.fn(() => undefined),
}));
vi.mock('@/lib/stream/raw-ai', () => ({
  LoadBalanceStrategy: { CUSTOM: 'custom', SEQUENTIAL: 'sequential' },
  generateWithStreamAI: mocks.generateWithStreamAI,
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
vi.mock('@/lib/database/data-cards', () => ({
  getDataCardById: vi.fn(async (id: string) => ({
    type: 'questionnaire',
    data: JSON.stringify({
      id: id === 'canshou-card' ? 'canshou-native' : 'creator-native',
      title: id === 'canshou-card' ? '残兽原生问卷' : 'Creator 原生问卷',
      kind: id === 'canshou-card' ? 'canshou' : 'magical-girl',
      nativeAllowed: true,
      questions: [{ id: 'q-1', question: '核心问题？', maxLength: 80 }],
    }),
  })),
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

  it.each([
    {
      name: 'Creator',
      path: '/api/creator/generate',
      dataCardId: 'creator-card',
      questionnaireId: 'creator-native',
      kind: 'magical-girl',
      body: {
        template: 'magical-girl',
        primaryRuleId: 'arena-trpg-lite',
        buildRules: [{
          ruleId: 'arena-trpg-lite',
          version: '1.0.0',
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
        }],
      },
      expected: {
        codename: '测试花名',
        templateId: '魔法少女/心之花/魔法少女（问卷生成）',
        creationInputs: {
          template: 'magical-girl',
          freeformBrief: null,
          primaryRuleId: 'arena-trpg-lite',
          buildRules: [expect.objectContaining({
            ruleId: 'arena-trpg-lite',
            version: '1.0.0',
            blockResults: expect.any(Object),
            derived: expect.objectContaining({ HP: expect.any(Number) }),
            validationSummary: expect.objectContaining({ valid: true }),
          })],
        },
        buildState: {
          primaryRuleId: 'arena-trpg-lite',
          rules: [expect.objectContaining({
            ruleId: 'arena-trpg-lite',
            blockResults: expect.any(Object),
            derived: expect.objectContaining({ HP: expect.any(Number) }),
            validationSummary: expect.objectContaining({ valid: true }),
          })],
        },
      },
      aiModel: 'creator-test-model',
    },
    {
      name: '残兽',
      path: '/api/generate-canshou',
      dataCardId: 'canshou-card',
      questionnaireId: 'canshou-native',
      kind: 'canshou',
      body: {},
      expected: {
        name: '测试残兽',
        coreConcept: '测试核心',
        templateId: '魔法少女/心之花/残兽（问卷生成）',
      },
      aiModel: 'canshou-test-model',
    },
  ])('经 dispatcher 保留 $name 原生问卷、签名、AI meta、活动与顺序', async ({
    path,
    dataCardId,
    questionnaireId,
    kind,
    body,
    expected,
    aiModel,
  }) => {
    mocks.events.length = 0;
    const app = createHonoApp(config, redis);
    const response = await app.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mahoshojo-AI-Meta': 'true',
        'X-Mahoshojo-Activity-Token': 'activity-token',
      },
      body: JSON.stringify({
        ...body,
        allowNativeSignature: true,
        questionnaireSelections: [{
          source: 'database',
          kind,
          dataCardId,
        }],
        answers: [{
          question: '客户端提交的问题文本',
          answer: '测试答案',
          questionId: 'q-1',
          questionnaireId,
        }],
        questionnaires: [],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-backend-runtime')).toBe('hono-node');
    expect(await response.json()).toEqual({
      data: {
        ...expected,
        userAnswers: [{
          question: '核心问题？',
          answer: '测试答案',
          questionId: 'q-1',
        }],
        signature: 'test-signature',
      },
      aiMeta: { aiModel },
    });
    expect(mocks.events).toEqual(['generate', 'activity', 'signature']);
    expect(mocks.generateSignature).toHaveBeenCalledOnce();
    expect(mocks.recordActivity).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: 'Creator stream',
      path: '/api/creator/generate-stream',
      body: {
        template: 'general',
        freeformBrief: '生成一个测试角色',
        answers: [],
        questionnaires: [],
      },
    },
    {
      name: '残兽 stream',
      path: '/api/generate-canshou-stream',
      body: {
        answers: [{
          question: '核心概念？',
          answer: '测试残兽',
          questionId: 'q-1',
          questionnaireId: 'canshou-test',
        }],
        questionnaires: [{
          id: 'canshou-test',
          title: '测试残兽问卷',
          kind: 'canshou',
          questions: [{ id: 'q-1', question: '核心概念？' }],
        }],
      },
    },
  ])('经 Hono dispatcher 保留 $name 原始 body/header 与 abort signal', async ({ path, body }) => {
    mocks.events.length = 0;
    mocks.streamAbortSignals.length = 0;
    const app = createHonoApp(config, redis);
    const controller = new AbortController();
    const response = await app.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mahoshojo-Activity-Token': 'activity-token',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-backend-runtime')).toBe('hono-node');
    expect(response.headers.get('x-upstream-stream')).toBe('preserved');
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe('hono-stream-body');
    expect(mocks.events).toEqual(['generate-stream', 'activity']);
    expect(mocks.streamAbortSignals).toHaveLength(1);
    expect(mocks.streamAbortSignals[0]).toBeInstanceOf(AbortSignal);
    expect(mocks.streamAbortSignals[0]?.aborted).toBe(false);
    controller.abort('hono-caller-abort');
    expect(mocks.streamAbortSignals[0]?.aborted).toBe(true);
  });
});
