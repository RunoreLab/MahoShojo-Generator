import { describe, expect, it } from 'vitest';

import {
  createGenerateCanshouRuntime,
  type GenerateCanshouRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-canshou-runtime';

const generatedCanshou = {
  name: '潮痕兽',
  coreConcept: '遗忘',
  coreEmotion: '执着',
  evolutionStage: '蛹',
  appearance: '覆满盐晶',
  materialAndSkin: '潮湿岩壳',
  featuresAndAppendages: '鳍状附肢',
  attackMethod: '盐雾侵蚀',
  specialAbility: '抹除足迹',
  origin: '沉船记忆聚合',
  birthEnvironment: '废弃港口',
  researcherNotes: '避免长时间凝视',
};

const databaseQuestionnaire = {
  id: 'native-canshou',
  title: '原生残兽问卷',
  kind: 'canshou',
  nativeAllowed: true,
  loreMarkdown: '潮水能够保留情绪',
  questions: [{
    id: 'q-1',
    question: '目击了什么？',
    required: true,
    maxLength: 20,
  }],
};

const createRequest = (body: unknown): Request => new Request(
  'https://example.test/api/generate-canshou',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mahoshojo-AI-Meta': 'true',
    },
    body: JSON.stringify(body),
  },
);

describe('generate canshou hosted runtime', () => {
  it('只信任原生 DataCard 问卷，规范化答案后按 activity→signature→AI meta finalize', async () => {
    const events: string[] = [];
    const dependencies: GenerateCanshouRuntimeDependencies = {
      presetIndex: { presets: [] },
      canshouLore: '残兽不可被视为普通动物',
      findProvider: () => ({
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        type: 'deepseek',
      }),
      resolveModel: () => ({ modelId: 'canonical-model' }),
      loadPreset: async () => null,
      loadDataCard: async (id) => {
        events.push(`data-card:${id}`);
        return {
          type: 'questionnaire',
          data: JSON.stringify(databaseQuestionnaire),
        };
      },
      checkRateLimit: async ({ actionType, providerMode }) => {
        events.push(`rate-limit:${actionType}:${providerMode}`);
        return null;
      },
      enforceSafety: async ({ text }) => {
        events.push(`safety:${text}`);
        return null;
      },
      generateWithAI: async (input, config, options) => {
        events.push(`generate:${input.answers[0]?.question}`);
        const prompt = config.promptBuilder(input);
        expect(config.schema.safeParse(generatedCanshou).success).toBe(true);
        expect(config.systemPrompt).toContain('残兽不可被视为普通动物');
        expect(prompt).toContain('【参考设定】\n【设定来源：原生残兽问卷】\n潮水能够保留情绪');
        expect(prompt).toContain('Q: 目击了什么？\nA: 盐雾里的影子');
        expect(options.loadBalanceStrategy).toBe('custom');
        options.telemetry.model = 'canonical-model';
        return generatedCanshou;
      },
      sign: async (payload) => {
        events.push(`sign:${payload.templateId}`);
        return 'native-signature';
      },
      recordActivity: () => events.push('activity'),
      buildResponse: ({ data, telemetry }) => {
        events.push(`response:${String(telemetry.model)}`);
        return new Response(JSON.stringify({ data, aiMeta: { aiModel: telemetry.model } }));
      },
      logInfo: () => events.push('info'),
      logWarn: () => events.push('warn'),
      logError: () => events.push('error'),
    };
    const runtime = createGenerateCanshouRuntime(dependencies);

    const response = await runtime.service(createRequest({
      allowNativeSignature: true,
      language: 'zh-CN',
      questionnaires: [{
        ...databaseQuestionnaire,
        title: '客户端伪造标题',
        questions: [{ ...databaseQuestionnaire.questions[0], question: '客户端伪造问题' }],
      }],
      questionnaireSelections: [{
        source: 'database',
        kind: 'canshou',
        dataCardId: 'card-1',
      }],
      answers: [{
        questionnaireId: 'native-canshou',
        questionId: 'q-1',
        question: '客户端伪造问题',
        answer: '盐雾里的影子',
      }],
      customProvider: {
        providerId: 'deepseek',
        modelId: 'alias-model',
        apiKey: 'top-secret-key',
      },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        ...generatedCanshou,
        templateId: '魔法少女/心之花/残兽（问卷生成）',
        userAnswers: [{
          question: '目击了什么？',
          answer: '盐雾里的影子',
          questionId: 'q-1',
        }],
        signature: 'native-signature',
      },
      aiMeta: { aiModel: 'canonical-model' },
    });
    expect(events).toEqual([
      'data-card:card-1',
      'rate-limit:canshou_generate:custom',
      'safety:盐雾里的影子',
      'generate:目击了什么？',
      'activity',
      'sign:魔法少女/心之花/残兽（问卷生成）',
      'response:canonical-model',
    ]);
    expect(JSON.stringify(events)).not.toContain('top-secret-key');
  });
});
