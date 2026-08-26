import { describe, expect, it, vi } from 'vitest';

import {
  createGenerateSublimationRuntime,
  type GenerateSublimationRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-sublimation-runtime';
import {
  createGenerateSublimationStreamRuntime,
  type GenerateSublimationStreamRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-sublimation-stream-runtime';

const originalCharacter = {
  codename: '白百合',
  appearance: { outfit: '白裙', accessories: '', colorScheme: '白', overallLook: '沉静' },
  magicConstruct: { name: '星纱', form: '丝带', basicAbilities: ['守护'], description: '星光丝带' },
  wonderlandRule: { name: '月庭', description: '月下守护', tendency: '守护', activation: '祈愿' },
  blooming: { name: '铃兰繁开', evolvedAbilities: ['星潮'], evolvedForm: '长枪', evolvedOutfit: '礼裙', powerLevel: '强花' },
  analysis: { personalityAnalysis: '坚韧', abilityReasoning: '守护', coreTraits: ['坚定'], predictionBasis: '经历', background: { belief: '守护', bonds: '同伴' } },
  userAnswers: [{ question: '你的真实名字是？', answer: '小白' }],
  signature: 'valid-signature',
  arena_history: {
    attributes: { world_line_id: 'world-old', sublimation_count: 0 },
    entries: [{ id: 1, type: 'battle', title: '旧战斗', impact: '成长' }],
  },
  current_state: { summary: '负伤', fields: [{ label: '体力', type: 'number', value: 30 }] },
  templateId: '魔法少女/心之花/魔法少女（问卷生成）',
};

const nativeLore = {
  id: 'lore-card',
  title: '原生设定',
  kind: 'magical-girl',
  nativeAllowed: true,
  loreMarkdown: '月光会回应守护者',
  questions: [],
};

const request = (body: unknown, signal?: AbortSignal) => new Request(
  'https://example.test/api/generate-sublimation?format=sse',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mahoshojo-AI-Meta': 'true' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  },
);

const providerPorts = {
  findProvider: () => null,
  resolveModel: () => null,
  logInfo: vi.fn(),
  logWarn: vi.fn(),
};

describe('generate sublimation hosted runtime', () => {
  it('服务端验证原卡与 native lore 后 finalize history/current_state 并重签', async () => {
    const events: string[] = [];
    const dependencies: GenerateSublimationRuntimeDependencies = {
      ...providerPorts,
      logInfo: () => events.push('convert'),
      presetIndex: { presets: [] },
      defaultQuestions: { magicalGirl: ['你的真实名字是？'], canshou: ['核心概念？'] },
      allowGuidedNativeSigning: false,
      loadPreset: async () => null,
      loadDataCard: async () => ({ type: 'questionnaire', data: JSON.stringify(nativeLore) }),
      checkRateLimit: async ({ actionType }) => {
        events.push(`rate:${actionType}`);
        return null;
      },
      enforceSafety: async ({ text }) => {
        expect(text).toContain('白百合');
        expect(text).toContain('客户端设定不得覆盖');
        expect(text).not.toContain('valid-signature');
        expect(text).not.toContain('小白');
        events.push('safety');
        return null;
      },
      generateWithAI: async (_input, config, options) => {
        const updatedCharacterData = {
          codename: '白百合「新月」',
          appearance: originalCharacter.appearance,
          magicConstruct: { name: 'AI 不得改名', form: '月刃', basicAbilities: ['守护'], description: '新形态' },
          wonderlandRule: originalCharacter.wonderlandRule,
          blooming: originalCharacter.blooming,
          analysis: originalCharacter.analysis,
          current_state: { summary: '恢复', fields: [{ label: '体力', value: 999 }] },
        };
        const prompt = config.promptBuilder(null);
        expect(prompt).toContain('月光会回应守护者');
        expect(prompt).not.toContain('valid-signature');
        expect(config.schema.safeParse({
          updatedCharacterData,
          sublimationEvent: { title: '新月之夜', impact: '学会守护' },
        }).success).toBe(true);
        options.telemetry.model = 'system-model';
        events.push('generate');
        return {
          updatedCharacterData,
          sublimationEvent: { title: '新月之夜', impact: '学会守护' },
        };
      },
      verify: async () => {
        events.push('verify');
        return true;
      },
      sign: async () => {
        events.push('sign');
        return 'new-signature';
      },
      recordActivity: () => events.push('activity'),
      buildResponse: ({ data, telemetry }) => new Response(JSON.stringify({ data, model: telemetry.model })),
      now: () => new Date('2026-08-26T00:00:00.000Z'),
      createWorldLineId: () => 'world-new',
      logError: vi.fn(),
    };

    const response = await createGenerateSublimationRuntime(dependencies).service(request({
      ...originalCharacter,
      extraUnknown: '转换时才处理的扩展字段',
      targetTemplate: 'magical-girl',
      questionnaireSelections: [{ source: 'database', kind: 'magical-girl', dataCardId: 'lore-1' }],
      questionnaires: [{ ...nativeLore, loreMarkdown: '客户端设定不得覆盖' }],
      readArenaHistory: true,
      writeArenaHistory: true,
      readCurrentState: true,
      writeCurrentState: true,
      arenaHistoryRetentionStrategy: 'keep-all',
    }));

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      data: { sublimatedData: Record<string, any> };
    };
    expect(payload.data.sublimatedData).toEqual(expect.objectContaining({
      codename: '白百合「新月」',
      signature: 'new-signature',
      magicConstruct: expect.objectContaining({ name: '星纱' }),
      current_state: expect.objectContaining({
        summary: '恢复',
        fields: originalCharacter.current_state.fields,
        updated_at: '2026-08-26T00:00:00.000Z',
      }),
    }));
    expect(payload.data.sublimatedData.arena_history.entries).toHaveLength(2);
    expect(events).toEqual([
      'rate:sublimation_generate',
      'safety',
      'convert',
      'verify',
      'generate',
      'activity',
      'sign',
    ]);
  });

  it('非 native questionnaire lore 参与时 fail closed 删除签名', async () => {
    const sign = vi.fn(async () => 'must-not-sign');
    const dependencies = {
      ...providerPorts,
      presetIndex: { presets: [] },
      defaultQuestions: { magicalGirl: [], canshou: [] },
      allowGuidedNativeSigning: false,
      loadPreset: async () => null,
      loadDataCard: async () => null,
      checkRateLimit: async () => null,
      enforceSafety: async () => null,
      generateWithAI: async () => ({
        updatedCharacterData: { codename: '白百合「异乡」' },
        sublimationEvent: { title: '异乡', impact: '变化' },
      }),
      verify: async () => true,
      sign,
      recordActivity: vi.fn(),
      buildResponse: ({ data }: { data: Record<string, unknown> }) => new Response(JSON.stringify(data)),
      now: () => new Date('2026-08-26T00:00:00.000Z'),
      logError: vi.fn(),
    } satisfies GenerateSublimationRuntimeDependencies;
    const response = await createGenerateSublimationRuntime(dependencies).service(request({
      ...originalCharacter,
      questionnaireSelections: [{ source: 'upload', kind: 'magical-girl', useLore: true }],
      questionnaires: [{ ...nativeLore, nativeAllowed: false, loreMarkdown: '非原生 lore' }],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('sublimatedData.signature');
    expect(sign).not.toHaveBeenCalled();
  });

  it('客户端提供 lore 但没有服务端 selection 时保留生成参考并拒绝签名', async () => {
    const sign = vi.fn(async () => 'must-not-sign');
    const dependencies = {
      ...providerPorts,
      presetIndex: { presets: [] },
      defaultQuestions: { magicalGirl: [], canshou: [] },
      allowGuidedNativeSigning: false,
      loadPreset: async () => null,
      loadDataCard: async () => null,
      checkRateLimit: async () => null,
      enforceSafety: async () => null,
      generateWithAI: async (_input, config) => {
        expect(config.promptBuilder(null)).toContain('仅客户端提供的 lore');
        return {
          updatedCharacterData: { codename: '白百合「异乡」' },
          sublimationEvent: { title: '异乡', impact: '变化' },
        };
      },
      verify: async () => true,
      sign,
      recordActivity: vi.fn(),
      buildResponse: ({ data }: { data: Record<string, unknown> }) => new Response(JSON.stringify(data)),
      now: () => new Date('2026-08-26T00:00:00.000Z'),
      logError: vi.fn(),
    } satisfies GenerateSublimationRuntimeDependencies;
    const response = await createGenerateSublimationRuntime(dependencies).service(request({
      ...originalCharacter,
      questionnaires: [{ ...nativeLore, loreMarkdown: '仅客户端提供的 lore' }],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('sublimatedData.signature');
    expect(sign).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: '原卡 verify=false',
      verify: false,
      allowGuidedNativeSigning: false,
      userGuidance: undefined,
      shouldSign: false,
    },
    {
      name: 'guided signing 开关关闭',
      verify: true,
      allowGuidedNativeSigning: false,
      userGuidance: '向月光成长',
      shouldSign: false,
    },
    {
      name: 'guided signing 开关开启且无 narrative history',
      verify: true,
      allowGuidedNativeSigning: true,
      userGuidance: '向月光成长',
      shouldSign: true,
    },
  ])('$name 的签名边界由服务器决定', async ({
    verify,
    allowGuidedNativeSigning,
    userGuidance,
    shouldSign,
  }) => {
    const sign = vi.fn(async () => 'server-signature');
    const dependencies = {
      ...providerPorts,
      presetIndex: { presets: [] },
      defaultQuestions: { magicalGirl: [], canshou: [] },
      allowGuidedNativeSigning,
      loadPreset: async () => null,
      loadDataCard: async () => null,
      checkRateLimit: async () => null,
      enforceSafety: async () => null,
      generateWithAI: async () => ({
        updatedCharacterData: { codename: '白百合「新月」' },
        sublimationEvent: { title: '新月', impact: '成长' },
      }),
      verify: async () => verify,
      sign,
      recordActivity: vi.fn(),
      buildResponse: ({ data }: { data: Record<string, unknown> }) => (
        new Response(JSON.stringify(data))
      ),
      now: () => new Date('2026-08-26T00:00:00.000Z'),
      logError: vi.fn(),
    } satisfies GenerateSublimationRuntimeDependencies;

    const response = await createGenerateSublimationRuntime(dependencies).service(request({
      ...originalCharacter,
      ...(userGuidance ? { userGuidance } : {}),
      writeArenaHistory: false,
      writeCurrentState: false,
    }));
    const payload = await response.json() as { sublimatedData: Record<string, unknown> };

    expect(response.status).toBe(200);
    if (shouldSign) {
      expect(payload.sublimatedData).toHaveProperty('signature', 'server-signature');
    } else {
      expect(payload.sublimatedData).not.toHaveProperty('signature');
    }
    expect(sign).toHaveBeenCalledTimes(shouldSign ? 1 : 0);
  });

  it.each([
    {
      name: 'native lore loader 抛错',
      loadDataCard: async () => { throw new Error('private-loader-failure'); },
    },
    {
      name: 'native lore payload 非法',
      loadDataCard: async () => ({ type: 'questionnaire', data: '{' }),
    },
  ])('$name 时保留生成但绝不签名', async ({ loadDataCard }) => {
    const sign = vi.fn(async () => 'must-not-sign');
    const generateWithAI = vi.fn(async (_input, config) => {
      expect(config.promptBuilder(null)).toContain('客户端 lore 仅作为非原生参考');
      return {
        updatedCharacterData: { codename: '白百合「异乡」' },
        sublimationEvent: { title: '异乡', impact: '变化' },
      };
    });
    const dependencies = {
      ...providerPorts,
      presetIndex: { presets: [] },
      defaultQuestions: { magicalGirl: [], canshou: [] },
      allowGuidedNativeSigning: false,
      loadPreset: async () => null,
      loadDataCard,
      checkRateLimit: async () => null,
      enforceSafety: async () => null,
      generateWithAI,
      verify: async () => true,
      sign,
      recordActivity: vi.fn(),
      buildResponse: ({ data }: { data: Record<string, unknown> }) => (
        new Response(JSON.stringify(data))
      ),
      now: () => new Date('2026-08-26T00:00:00.000Z'),
      logError: vi.fn(),
    } satisfies GenerateSublimationRuntimeDependencies;

    const response = await createGenerateSublimationRuntime(dependencies).service(request({
      ...originalCharacter,
      questionnaireSelections: [{
        source: 'database',
        kind: 'magical-girl',
        dataCardId: 'private-lore',
      }],
      questionnaires: [{
        ...nativeLore,
        loreMarkdown: '客户端 lore 仅作为非原生参考',
      }],
      writeArenaHistory: false,
      writeCurrentState: false,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('sublimatedData.signature');
    expect(generateWithAI).toHaveBeenCalledOnce();
    expect(sign).not.toHaveBeenCalled();
  });

  it('general-scenario source 保持 canonical 类型且 content 不重复进入目标 skeleton', async () => {
    const marker = 'SCENARIO-CONTENT-MUST-NOT-BECOME-CHARACTER-APPENDIX';
    const dependencies = {
      ...providerPorts,
      presetIndex: { presets: [] },
      defaultQuestions: { magicalGirl: [], canshou: [] },
      allowGuidedNativeSigning: false,
      loadPreset: async () => null,
      loadDataCard: async () => null,
      checkRateLimit: async () => null,
      enforceSafety: async () => null,
      generateWithAI: async (_input, config) => {
        const prompt = config.promptBuilder(null);
        expect(prompt).toContain('原始素材类型：通用情景');
        expect(prompt.split(marker)).toHaveLength(2);
        return {
          updatedCharacterData: { codename: '雨夜舞台「新生」' },
          sublimationEvent: { title: '新生', impact: '变化' },
        };
      },
      verify: async () => false,
      sign: vi.fn(),
      recordActivity: vi.fn(),
      buildResponse: ({ data }: { data: Record<string, unknown> }) => (
        new Response(JSON.stringify(data))
      ),
      now: () => new Date('2026-08-26T00:00:00.000Z'),
      logError: vi.fn(),
    } satisfies GenerateSublimationRuntimeDependencies;

    const response = await createGenerateSublimationRuntime(dependencies).service(request({
      templateId: '通用情景',
      title: '雨夜舞台',
      content: marker,
      atmosphere: '沉静',
      sourceTemplate: 'general-scenario',
      targetTemplate: 'magical-girl',
      writeArenaHistory: false,
      writeCurrentState: false,
    }));

    expect(response.status).toBe(200);
  });

  it('stream 裁剪大字段并透传 Request.signal / reasoning SSE', async () => {
    const controller = new AbortController();
    const upstream = new Response('markdown');
    const usagePromise = Promise.resolve({ outputTokens: 3 });
    const bridged = new Response('sse');
    const bridge = { onReasoningEvent: vi.fn(), toResponse: vi.fn(() => bridged) };
    const incomingRequest = request({
      ...originalCharacter,
      userGuidance: '向前'.repeat(200),
      narrativeHistory: '历史'.repeat(10_000),
      questionnaires: [nativeLore],
    }, controller.signal);
    const dependencies: GenerateSublimationStreamRuntimeDependencies = {
      ...providerPorts,
      checkRateLimit: async () => null,
      enforceSafety: async () => null,
      shouldUseReasoningSse: () => true,
      createReasoningSseBridge: () => bridge,
      generateWithStreamAI: async (config, options) => {
        expect(config.prompt).not.toContain('valid-signature');
        expect(config.prompt.length).toBeLessThan(30_000);
        expect(options.abortSignal).toBe(incomingRequest.signal);
        expect(options.onReasoningEvent).toBe(bridge.onReasoningEvent);
        options.telemetry.model = 'sublimation-stream-model';
        return { response: upstream, usagePromise };
      },
      recordActivity: vi.fn(),
      logError: vi.fn(),
    };

    const response = await createGenerateSublimationStreamRuntime(dependencies).service(incomingRequest);

    expect(response).toBe(bridged);
    expect(bridge.toResponse).toHaveBeenCalledWith(upstream, {
      usagePromise,
      aiModel: 'sublimation-stream-model',
    });
  });
});
