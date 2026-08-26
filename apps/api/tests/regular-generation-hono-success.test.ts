import { describe, expect, it, vi } from 'vitest';
import { registerHostedRuntimeObserver } from '@mahoshojo/hosted-runtime/telemetry';
import type { HonoServerConfig } from '#/config';
import type { RedisService } from '#/redis/runtime';
import { HonoRuntimeTelemetry } from '#/telemetry/runtime';

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  generateWithAI: vi.fn(async (_input: unknown, config: unknown, options: any) => {
    mocks.events.push('generate');
    const taskName = (config as { taskName?: string })?.taskName;
    if (taskName === '生成魔法少女') {
      return {
        flowerName: '铃兰',
        flowerDescription: '幸福归来',
        appearance: {
          height: '155cm',
          weight: '45kg',
          hairColor: '银白色',
          hairStyle: '及腰长发',
          eyeColor: '碧绿色',
          skinTone: '白皙',
          wearing: '白绿礼服',
          specialFeature: '安静微笑',
          mainColor: '绿色',
          firstPageColor: '#E8FFF0',
          secondPageColor: '#5BAF72',
        },
        spell: '测试咒语',
      };
    }
    options.telemetry.model = taskName === '生成残兽档案'
      ? 'canshou-test-model'
      : taskName === '生成魔法少女详细信息'
        ? 'creator-test-model'
        : taskName === '角色成长升华'
          ? 'sublimation-test-model'
        : 'scenario-test-model';
    if (taskName === '生成残兽档案') {
      return { name: '测试残兽', coreConcept: '测试核心' };
    }
    if (taskName === '生成魔法少女详细信息') {
      return { codename: '测试花名' };
    }
    if (taskName === '角色成长升华') {
      return {
        updatedCharacterData: {
          name: '测试角色「新生」',
          content: '# 测试角色\n\n完成成长。',
        },
        sublimationEvent: { title: '新生', impact: '完成成长' },
      };
    }
    if (taskName === 'generate-game-card') {
      options.telemetry.model = 'game-card-test-model';
      return {
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
        description: '测试卡面',
        themeColor: '#ffffff',
      };
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

vi.mock('@mahoshojo/hosted-runtime/node-runtime/structured-ai', () => ({
  createNodeStructuredAiRuntime: vi.fn(() => ({
    generateWithAI: mocks.generateWithAI,
  })),
}));
vi.mock('@mahoshojo/hosted-runtime/node-runtime/raw-stream-ai', () => ({
  createNodeRawStreamAiRuntime: vi.fn(() => ({
    generateWithStreamAI: mocks.generateWithStreamAI,
  })),
}));
vi.mock('@mahoshojo/hosted-runtime/node-runtime/public-rate-limit', () => ({
  createPublicAiRateLimiter: vi.fn(() => ({
    acquirePublicAiRateLimit: vi.fn(async () => ({ allowed: true })),
  })),
  buildPublicAiRateLimitResponse: vi.fn(),
  OFFICIAL_KEY_QUESTIONNAIRE_CHARACTER_COOLDOWN_MS: 30_000,
}));
vi.mock('@mahoshojo/hosted-runtime/node-runtime/content-safety', () => ({
  createContentSafetyService: vi.fn(() => ({
    enforceTextSafety: vi.fn(async () => null),
  })),
}));
vi.mock('@mahoshojo/hosted-runtime/node-runtime/env-signature', () => ({
  createEnvSignatureService: vi.fn(() => ({
    generateSignature: mocks.generateSignature,
    verifySignature: vi.fn(async () => true),
  })),
  generateSignature: mocks.generateSignature,
  verifySignature: vi.fn(async () => true),
}));
vi.mock('@mahoshojo/hosted-runtime/node-runtime/data-ports', () => ({
  createNodeDataPorts: vi.fn(() => ({
    touchUserLastActivity: vi.fn(async () => true),
    recordUserActivityFromRequest: mocks.recordActivity,
    recordAiChannelOutcome: vi.fn(async () => undefined),
    getDataCardById: vi.fn(async (id: string) => ({
      id,
      type: 'questionnaire',
      tagIds: [],
      data: JSON.stringify({
        id: id === 'canshou-card' ? 'canshou-native' : 'creator-native',
        title: id === 'canshou-card' ? '残兽原生问卷' : 'Creator 原生问卷',
        kind: id === 'canshou-card' ? 'canshou' : 'magical-girl',
        nativeAllowed: true,
        questions: [{ id: 'q-1', question: '核心问题？', maxLength: 80 }],
      }),
    })),
    getAuthorizedDataCardById: vi.fn(async (_request: Request, id: string) => ({
      id,
      type: 'questionnaire',
      tagIds: [],
      data: JSON.stringify({
        id: id === 'canshou-card' ? 'canshou-native' : 'creator-native',
        title: id === 'canshou-card' ? '残兽原生问卷' : 'Creator 原生问卷',
        kind: id === 'canshou-card' ? 'canshou' : 'magical-girl',
        nativeAllowed: true,
        questions: [{ id: 'q-1', question: '核心问题？', maxLength: 80 }],
      }),
    })),
  })),
}));

import { createHonoApp } from '#/app';

const config: HonoServerConfig = {
  host: '127.0.0.1',
  port: 8787,
  nodeEnv: 'test',
  redisUrl: null,
  redisKeyPrefix: '',
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
  it('四路 adapter 将固定 Hono placement lifecycle 交给 runtime telemetry', async () => {
    const telemetry = new HonoRuntimeTelemetry();
    const unregister = registerHostedRuntimeObserver(telemetry);
    try {
      const app = createHonoApp(config, redis, telemetry);
      const response = await app.request('/api/generate-magical-girl-details', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Mahoshojo-Activity-Token': 'activity-token',
        },
        body: JSON.stringify({
          answers: ['telemetry-payload-must-not-appear'],
          questionnaires: [{
            id: 'details-test',
            title: 'Details 测试问卷',
            kind: 'magical-girl',
            questions: [{ id: 'q-1', question: '为何而战？' }],
          }],
        }),
      });
      const responsePayload = await response.clone().json();
      expect(response.status, JSON.stringify(responsePayload)).toBe(200);

      const snapshot = telemetry.snapshot();
      expect(snapshot.hostedGeneration).toMatchObject({
        byOperation: { 'generate-magical-girl-details': 1 },
        byPlacement: { honoPrimary: 1, nextDr: 0 },
        outcomes: { success: 1 },
      });
      expect(JSON.stringify(snapshot)).not.toContain('telemetry-payload-must-not-appear');
    } finally {
      unregister();
    }
  });

  it('经 dispatcher 复用名字生成的 AI、活动与签名 composition', async () => {
    mocks.events.length = 0;
    const app = createHonoApp(config, redis);
    const response = await app.request('/api/generate-magical-girl', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mahoshojo-Activity-Token': 'activity-token',
      },
      body: JSON.stringify({ name: '  小满  ', language: ' zh-CN ' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-backend-runtime')).toBe('hono-node');
    expect(await response.json()).toEqual({
      flowerName: '铃兰',
      flowerDescription: '幸福归来',
      appearance: {
        height: '155cm',
        weight: '45kg',
        hairColor: '银白色',
        hairStyle: '及腰长发',
        eyeColor: '碧绿色',
        skinTone: '白皙',
        wearing: '白绿礼服',
        specialFeature: '安静微笑',
        mainColor: '绿色',
        firstPageColor: '#E8FFF0',
        secondPageColor: '#5BAF72',
      },
      spell: '测试咒语',
      templateId: '魔法少女/心之花/魔法少女（名字生成）',
      signature: 'test-signature',
    });
    expect(mocks.events).toEqual(['generate', 'activity', 'signature']);
    expect(mocks.generateSignature).toHaveBeenCalledOnce();
    expect(mocks.recordActivity).toHaveBeenCalledOnce();
  });

  it('经 dispatcher 复用 Game Card 的 AI、输出策略、活动与 AI meta composition', async () => {
    mocks.events.length = 0;
    const app = createHonoApp(config, redis);
    const response = await app.request('/api/generate-game-card', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mahoshojo-AI-Meta': 'true',
        'X-Mahoshojo-Activity-Token': 'activity-token',
      },
      body: JSON.stringify({
        sourceCardJson: '{"templateId":"魔法少女/心之花/魔法少女（名字生成）"}',
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-backend-runtime')).toBe('hono-node');
    expect(await response.json()).toEqual({
      data: {
        faceData: {
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
          description: '测试卡面',
          themeColor: '#ffffff',
        },
        sourceCardKind: 'magical-girl',
      },
      aiMeta: { aiModel: 'game-card-test-model' },
    });
    expect(mocks.events).toEqual(['generate', 'activity']);
    expect(mocks.generateSignature).not.toHaveBeenCalled();
    expect(mocks.recordActivity).toHaveBeenCalledOnce();
  });

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

  it('经 dispatcher 保留 Details AI meta、问卷答案与活动顺序', async () => {
    mocks.events.length = 0;
    const app = createHonoApp(config, redis);
    const response = await app.request('/api/generate-magical-girl-details', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mahoshojo-AI-Meta': 'true',
        'X-Mahoshojo-Activity-Token': 'activity-token',
      },
      body: JSON.stringify({
        answers: ['守护同伴'],
        questionnaires: [{
          id: 'details-test',
          title: 'Details 测试问卷',
          kind: 'magical-girl',
          questions: [{ id: 'q-1', question: '为何而战？' }],
        }],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-backend-runtime')).toBe('hono-node');
    expect(await response.json()).toEqual({
      data: {
        codename: '测试花名',
        templateId: '魔法少女/心之花/魔法少女（问卷生成）',
        userAnswers: [{ question: '为何而战？', answer: '守护同伴', questionId: 'q-1' }],
      },
      aiMeta: { aiModel: 'creator-test-model' },
    });
    expect(mocks.events).toEqual(['generate', 'activity']);
  });

  it('经 dispatcher 保留 Sublimation finalize、签名、AI meta 与活动顺序', async () => {
    mocks.events.length = 0;
    const app = createHonoApp(config, redis);
    const response = await app.request('/api/generate-sublimation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mahoshojo-AI-Meta': 'true',
        'X-Mahoshojo-Activity-Token': 'activity-token',
      },
      body: JSON.stringify({
        templateId: '通用角色',
        name: '测试角色',
        content: '# 测试角色',
        targetTemplate: 'general',
        writeArenaHistory: false,
        writeCurrentState: false,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-backend-runtime')).toBe('hono-node');
    expect(await response.json()).toEqual({
      data: {
        sublimatedData: {
          templateId: '通用角色',
          name: '测试角色「新生」',
          content: '# 测试角色\n\n完成成长。',
          signature: 'test-signature',
        },
        unchangedFields: [],
        targetTemplate: 'general',
      },
      aiMeta: { aiModel: 'sublimation-test-model' },
    });
    expect(mocks.events).toEqual(['generate', 'activity', 'signature']);
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
    {
      name: 'Details stream',
      path: '/api/generate-magical-girl-details-stream',
      body: {
        answers: ['守护同伴'],
        questionnaires: [{
          id: 'details-test',
          title: 'Details 测试问卷',
          kind: 'magical-girl',
          questions: [{ id: 'q-1', question: '为何而战？' }],
        }],
      },
    },
    {
      name: 'Sublimation stream',
      path: '/api/generate-sublimation-stream',
      body: {
        templateId: '通用角色',
        name: '测试角色',
        content: '# 测试角色',
        targetTemplate: 'general',
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

  it.each([
    {
      operation: 'generate-magical-girl-details-stream',
      path: '/api/generate-magical-girl-details-stream',
      body: {
        answers: ['守护同伴'],
        questionnaires: [{
          id: 'details-test',
          title: 'Details 测试问卷',
          kind: 'magical-girl',
          questions: [{ id: 'q-1', question: '为何而战？' }],
        }],
      },
    },
    {
      operation: 'generate-sublimation-stream',
      path: '/api/generate-sublimation-stream',
      body: {
        templateId: '通用角色',
        name: '测试角色',
        content: '# 测试角色',
        targetTemplate: 'general',
      },
    },
  ] as const)('Hono $operation 在 stream body 自然完成后记录真实 success 终态', async ({
    operation,
    path,
    body,
  }) => {
    const telemetry = new HonoRuntimeTelemetry();
    const unregister = registerHostedRuntimeObserver(telemetry);
    try {
      const app = createHonoApp(config, redis, telemetry);
      const response = await app.request(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Mahoshojo-Activity-Token': 'activity-token',
        },
        body: JSON.stringify(body),
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('hono-stream-body');
      expect(telemetry.snapshot().hostedGeneration).toMatchObject({
        byOperation: { [operation]: 1 },
        byPlacement: { honoPrimary: 1, nextDr: 0 },
        outcomes: { success: 1 },
      });
    } finally {
      unregister();
    }
  });

  it('Hono stream body cancel 只记录一次 cancelled 终态并向上游传播取消', async () => {
    let upstreamCancelCount = 0;
    mocks.generateWithStreamAI.mockImplementationOnce(async (_input: unknown, options: any) => {
      mocks.events.push('generate-stream');
      mocks.streamAbortSignals.push(options.abortSignal);
      options.telemetry.model = 'stream-cancel-test-model';
      return {
        response: new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial-stream-body'));
          },
          cancel() {
            upstreamCancelCount += 1;
          },
        }), {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
        usagePromise: Promise.resolve({}),
      };
    });

    const telemetry = new HonoRuntimeTelemetry();
    const unregister = registerHostedRuntimeObserver(telemetry);
    try {
      const app = createHonoApp(config, redis, telemetry);
      const response = await app.request('/api/generate-magical-girl-details-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Mahoshojo-Activity-Token': 'activity-token',
        },
        body: JSON.stringify({
          answers: ['守护同伴'],
          questionnaires: [{
            id: 'details-test',
            title: 'Details 测试问卷',
            kind: 'magical-girl',
            questions: [{ id: 'q-1', question: '为何而战？' }],
          }],
        }),
      });

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      expect(new TextDecoder().decode((await reader?.read())?.value)).toBe('partial-stream-body');
      await reader?.cancel('hono-client-cancel');

      expect(upstreamCancelCount).toBe(1);
      expect(telemetry.snapshot().hostedGeneration).toMatchObject({
        byOperation: { 'generate-magical-girl-details-stream': 1 },
        byPlacement: { honoPrimary: 1, nextDr: 0 },
        outcomes: { success: 0, rejected: 0, failure: 0, cancelled: 1 },
      });
    } finally {
      unregister();
    }
  });

  it('Hono upstream stream read error 只记录一次 failure 终态并保留读取错误', async () => {
    const upstreamError = new Error('hono-upstream-read-error');
    mocks.generateWithStreamAI.mockImplementationOnce(async (_input: unknown, options: any) => {
      mocks.events.push('generate-stream');
      mocks.streamAbortSignals.push(options.abortSignal);
      options.telemetry.model = 'stream-error-test-model';
      return {
        response: new Response(new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.error(upstreamError);
          },
        }), {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
        usagePromise: Promise.resolve({}),
      };
    });

    const telemetry = new HonoRuntimeTelemetry();
    const unregister = registerHostedRuntimeObserver(telemetry);
    try {
      const app = createHonoApp(config, redis, telemetry);
      const response = await app.request('/api/generate-sublimation-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Mahoshojo-Activity-Token': 'activity-token',
        },
        body: JSON.stringify({
          templateId: '通用角色',
          name: '测试角色',
          content: '# 测试角色',
          targetTemplate: 'general',
        }),
      });

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      await expect(reader?.read()).rejects.toThrow('hono-upstream-read-error');
      expect(telemetry.snapshot().hostedGeneration).toMatchObject({
        byOperation: { 'generate-sublimation-stream': 1 },
        byPlacement: { honoPrimary: 1, nextDr: 0 },
        outcomes: { success: 0, rejected: 0, failure: 1, cancelled: 0 },
      });
    } finally {
      unregister();
    }
  });
});
