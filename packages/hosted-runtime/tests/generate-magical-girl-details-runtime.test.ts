import { describe, expect, it, vi } from 'vitest';

import {
  createGenerateMagicalGirlDetailsRuntime,
  type GenerateMagicalGirlDetailsRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-magical-girl-details-runtime';
import {
  createGenerateMagicalGirlDetailsStreamRuntime,
  type GenerateMagicalGirlDetailsStreamRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-magical-girl-details-stream-runtime';

const generatedDetails = {
  codename: '潮汐花',
  appearance: { outfit: '蓝白礼服', accessories: '贝壳', colorScheme: '蓝白', overallLook: '沉静' },
  magicConstruct: { name: '潮镜', form: '手镜', basicAbilities: ['折射'], description: '映照记忆' },
  wonderlandRule: { name: '潮间', description: '潮汐往复', tendency: '守护', activation: '举镜' },
  blooming: { name: '潮镜繁开', evolvedAbilities: ['回潮'], evolvedForm: '巨镜', evolvedOutfit: '长裙', powerLevel: '强花' },
  analysis: { personalityAnalysis: '坚韧', abilityReasoning: '守护', coreTraits: ['坚定'], predictionBasis: '问卷', background: { belief: '守护', bonds: '同伴' } },
};

const questionnaire = {
  id: 'native-details',
  title: '原生问卷',
  kind: 'magical-girl' as const,
  nativeAllowed: true,
  loreMarkdown: '潮汐会保存记忆',
  questions: [{ id: 'q-1', question: '你想守护什么？', required: true, maxLength: 8 }],
};

const request = (body: unknown, signal?: AbortSignal) => new Request(
  'https://example.test/api/generate-magical-girl-details?format=sse',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mahoshojo-AI-Meta': 'true' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  },
);

const providerPorts = {
  findProvider: () => ({
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    type: 'deepseek' as const,
  }),
  resolveModel: () => ({ modelId: 'canonical-model' }),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
};

describe('generate magical girl details hosted runtime', () => {
  it('只用服务端 native 问卷覆盖客户端文本，并在字数合规时签名', async () => {
    const events: string[] = [];
    const dependencies: GenerateMagicalGirlDetailsRuntimeDependencies = {
      ...providerPorts,
      presetIndex: { presets: [] },
      loadPreset: async () => null,
      loadDataCard: async () => ({ type: 'questionnaire', data: JSON.stringify(questionnaire) }),
      getRandomFlowers: () => '潮汐花：守护',
      checkRateLimit: async ({ actionType, providerMode }) => {
        events.push(`rate:${actionType}:${providerMode}`);
        return null;
      },
      enforceSafety: async ({ text }) => {
        events.push(`safety:${text}`);
        return null;
      },
      generateWithAI: async (input, config, options) => {
        events.push(`generate:${input.answers[0]?.question}`);
        expect(config.schema.safeParse(generatedDetails).success).toBe(true);
        expect(config.promptBuilder(input)).toContain('【设定来源：原生问卷】\n潮汐会保存记忆');
        expect(options.loadBalanceStrategy).toBe('custom');
        options.telemetry.model = 'canonical-model';
        return generatedDetails;
      },
      sign: async () => {
        events.push('sign');
        return 'native-signature';
      },
      recordActivity: () => events.push('activity'),
      buildResponse: ({ data, telemetry }) => new Response(JSON.stringify({ data, model: telemetry.model })),
      logError: vi.fn(),
    };

    const response = await createGenerateMagicalGirlDetailsRuntime(dependencies).service(request({
      allowNativeSignature: true,
      questionnaireSelections: [{ source: 'database', kind: 'magical-girl', dataCardId: 'card-1' }],
      questionnaires: [{ ...questionnaire, questions: [{ ...questionnaire.questions[0], question: '客户端伪造问题' }] }],
      answers: [{ questionnaireId: questionnaire.id, questionId: 'q-1', question: '客户端伪造问题', answer: '同伴' }],
      customProvider: { providerId: 'deepseek', modelId: 'alias', apiKey: 'secret-canary' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        ...generatedDetails,
        templateId: '魔法少女/心之花/魔法少女（问卷生成）',
        userAnswers: [{ question: '你想守护什么？', answer: '同伴', questionId: 'q-1' }],
        signature: 'native-signature',
      },
      model: 'canonical-model',
    });
    expect(events).toEqual([
      'rate:magical_girl_details_generate:custom',
      'safety:同伴',
      'generate:你想守护什么？',
      'activity',
      'sign',
    ]);
    expect(JSON.stringify(events)).not.toContain('secret-canary');
  });

  it('超过服务端 maxLength 时继续生成但不签名', async () => {
    const sign = vi.fn(async () => 'must-not-sign');
    const dependencies = {
      ...providerPorts,
      presetIndex: { presets: [] },
      loadPreset: async () => null,
      loadDataCard: async () => ({ type: 'questionnaire', data: JSON.stringify(questionnaire) }),
      getRandomFlowers: () => '',
      checkRateLimit: async () => null,
      enforceSafety: async () => null,
      generateWithAI: async () => generatedDetails,
      sign,
      recordActivity: vi.fn(),
      buildResponse: ({ data }: { data: Record<string, unknown> }) => new Response(JSON.stringify(data)),
      logError: vi.fn(),
    } satisfies GenerateMagicalGirlDetailsRuntimeDependencies;

    const response = await createGenerateMagicalGirlDetailsRuntime(dependencies).service(request({
      allowNativeSignature: true,
      questionnaireSelections: [{ source: 'database', kind: 'magical-girl', dataCardId: 'card-1' }],
      answers: [{ questionnaireId: questionnaire.id, questionId: 'q-1', answer: '一段明显超过八个字符的回答' }],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('signature');
    expect(sign).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: '缺少 selection',
      selections: [],
      loadDataCard: async () => ({ type: 'questionnaire', data: JSON.stringify(questionnaire) }),
    },
    {
      name: '数据库 loader 抛错',
      selections: [{ source: 'database', kind: 'magical-girl', dataCardId: 'card-1' }],
      loadDataCard: async () => { throw new Error('private-loader-failure'); },
    },
    {
      name: '数据库 payload 非法',
      selections: [{ source: 'database', kind: 'magical-girl', dataCardId: 'card-1' }],
      loadDataCard: async () => ({ type: 'questionnaire', data: '{' }),
    },
    {
      name: '服务端问卷 ID 与答案不匹配',
      selections: [{ source: 'database', kind: 'magical-girl', dataCardId: 'card-1' }],
      loadDataCard: async () => ({
        type: 'questionnaire',
        data: JSON.stringify({ ...questionnaire, id: 'other-questionnaire' }),
      }),
    },
  ])('$name 时仍可生成但 fail closed 不签名', async ({ selections, loadDataCard }) => {
    const sign = vi.fn(async () => 'must-not-sign');
    const generateWithAI = vi.fn(async () => generatedDetails);
    const recordActivity = vi.fn();
    const dependencies = {
      ...providerPorts,
      presetIndex: { presets: [] },
      loadPreset: async () => null,
      loadDataCard,
      getRandomFlowers: () => '',
      checkRateLimit: async () => null,
      enforceSafety: async () => null,
      generateWithAI,
      sign,
      recordActivity,
      buildResponse: ({ data }: { data: Record<string, unknown> }) => (
        new Response(JSON.stringify(data))
      ),
      logError: vi.fn(),
    } satisfies GenerateMagicalGirlDetailsRuntimeDependencies;

    const response = await createGenerateMagicalGirlDetailsRuntime(dependencies).service(request({
      allowNativeSignature: true,
      questionnaireSelections: selections,
      questionnaires: [questionnaire],
      answers: [{
        questionnaireId: questionnaire.id,
        questionId: 'q-1',
        answer: '同伴',
      }],
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).not.toHaveProperty('signature');
    expect(generateWithAI).toHaveBeenCalledOnce();
    expect(recordActivity).toHaveBeenCalledOnce();
    expect(sign).not.toHaveBeenCalled();
  });

  it('stream 透传 abort signal、reasoning SSE 与 questionnaire lore', async () => {
    const controller = new AbortController();
    const upstream = new Response('markdown');
    const bridged = new Response('sse', { headers: { 'Content-Type': 'text/event-stream' } });
    const bridge = { onReasoningEvent: vi.fn(), toResponse: vi.fn(() => bridged) };
    const incomingRequest = request({
      questionnaires: [questionnaire],
      answers: [{ questionId: 'q-1', answer: '同伴' }],
    }, controller.signal);
    const dependencies: GenerateMagicalGirlDetailsStreamRuntimeDependencies = {
      ...providerPorts,
      getRandomFlowers: () => '潮汐花：守护',
      checkRateLimit: async () => null,
      enforceSafety: async () => null,
      shouldUseReasoningSse: () => true,
      createReasoningSseBridge: () => bridge,
      generateWithStreamAI: async (config, options) => {
        expect(config.prompt).toContain('潮汐会保存记忆');
        expect(options.abortSignal).toBe(incomingRequest.signal);
        return { response: upstream, usagePromise: Promise.resolve({ outputTokens: 1 }) };
      },
      recordActivity: vi.fn(),
      logError: vi.fn(),
    };

    const response = await createGenerateMagicalGirlDetailsStreamRuntime(dependencies).service(
      incomingRequest,
    );

    expect(response).toBe(bridged);
    expect(bridge.toResponse).toHaveBeenCalledWith(upstream, expect.objectContaining({ aiModel: null }));
  });
});
