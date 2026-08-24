import { describe, expect, it } from 'vitest';

import {
  createGenerateCreatorRuntime,
  type GenerateCreatorRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-creator-runtime';

const buildRule = {
  ruleId: 'rule-primary',
  version: '1',
  blockResults: { power: 3 },
  derived: { defense: 2 },
  validationSummary: {
    valid: true,
    issues: [],
    missingRequiredBlockKeys: [],
  },
};

const presetQuestionnaire = {
  id: 'native-magical-girl',
  title: '原生魔法少女问卷',
  kind: 'magical-girl',
  nativeAllowed: true,
  loreMarkdown: '原生世界观事实',
  questions: [{
    id: 'q-1',
    question: '你守护什么？',
    required: true,
    maxLength: 20,
  }],
};

const generatedMagicalGirl = {
  codename: '雾灯',
  appearance: {
    outfit: '白色风衣',
    accessories: '银色灯坠',
    colorScheme: '银白',
    overallLook: '安静而坚定',
  },
  magicConstruct: {
    name: '雾灯',
    form: '提灯',
    basicAbilities: ['照明'],
    description: '驱散迷雾',
  },
  wonderlandRule: {
    name: '归途',
    description: '迷失者看见回家的路',
    tendency: '守护',
    activation: '点亮提灯',
  },
  blooming: {
    name: '雾灯长明',
    evolvedAbilities: ['长明'],
    evolvedForm: '灯塔',
    evolvedOutfit: '银白披风',
    powerLevel: '强花',
  },
  analysis: {
    personalityAnalysis: '重视承诺',
    abilityReasoning: '源自守护意愿',
    coreTraits: ['坚定'],
    predictionBasis: '问卷答案',
    background: { belief: '带人回家', bonds: '失散的家人' },
  },
};

const createRequest = (body: unknown): Request => new Request(
  'https://example.test/api/creator/generate',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mahoshojo-AI-Meta': 'true',
    },
    body: JSON.stringify(body),
  },
);

describe('generate creator hosted runtime', () => {
  it('持有原生问卷信任、build rule、prompt/schema 与持久化/签名 finalize 顺序', async () => {
    const events: string[] = [];
    const dependencies: GenerateCreatorRuntimeDependencies = {
      presetIndex: {
        presets: [{
          id: 'native-magical-girl',
          kind: 'magical-girl',
          path: '/questionnaires/presets/native-magical-girl.json',
        }],
      },
      canshouLore: '残兽基础设定',
      findProvider: () => ({
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        type: 'deepseek',
      }),
      resolveModel: () => ({ modelId: 'canonical-model' }),
      loadPreset: async (_requestUrl, path) => {
        events.push(`preset:${path}`);
        return presetQuestionnaire;
      },
      loadDataCard: async () => null,
      resolveBuildRules: (raw) => {
        events.push(`build-rules:${Array.isArray(raw) ? raw.length : -1}`);
        return Array.isArray(raw) && raw.length > 0 ? [buildRule] : [];
      },
      validateCreatorRequest: (input) => {
        events.push(`validate:${input.template}:${input.primaryRuleId}`);
      },
      buildCreatorPromptInput: (input) => {
        events.push(`prompt-input:${input.questionnaireAnswers?.[0]?.question}`);
        return {
          template: input.template,
          userIntent: input.freeformBrief ?? '',
          questionnaireSummary: '问卷摘要',
          buildRuleProjection: {
            primary: input.buildRules.length > 0
              ? {
                  ruleId: 'rule-primary',
                  template: input.template,
                  facts: buildRule,
                  summary: '力量固定为 3',
                }
              : null,
            references: [],
          },
        };
      },
      buildPersistedCreationInputs: (input) => ({
        template: input.template,
        freeformBrief: input.freeformBrief,
        buildRules: input.buildRules,
        ...('primaryRuleId' in input ? { primaryRuleId: input.primaryRuleId } : {}),
      }),
      getRandomFlowers: () => '雾灯花：守望',
      checkRateLimit: async ({ actionType, providerMode }) => {
        events.push(`rate-limit:${actionType}:${providerMode}`);
        return null;
      },
      enforceSafety: async ({ text, sensitiveWordReason }) => {
        events.push(`safety:${text}:${sensitiveWordReason}`);
        return null;
      },
      generateWithAI: async (input, config, options) => {
        events.push(`generate:${input.answers[0]?.question}`);
        const prompt = config.promptBuilder(input);
        expect(config.taskName).toBe('生成魔法少女详细信息');
        expect(config.schema.safeParse(generatedMagicalGirl).success).toBe(true);
        if (events.filter((event) => event.startsWith('generate:')).length === 1) {
          expect(prompt).toContain('【主规则事实】\n力量固定为 3');
        } else {
          expect(prompt).not.toContain('【主规则事实】');
        }
        expect(prompt).toContain('【参考设定】\n【设定来源：原生魔法少女问卷】\n原生世界观事实');
        expect(prompt).toContain('Q: 你守护什么？\nA: 迷路的人');
        expect(prompt).toContain('雾灯花：守望');
        expect(options.loadBalanceStrategy).toBe('custom');
        expect(options.providerOverride?.model).toBe('canonical-model');
        options.telemetry.model = 'canonical-model';
        return generatedMagicalGirl;
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
    const runtime = createGenerateCreatorRuntime(dependencies);

    const response = await runtime.service(createRequest({
      template: 'magical-girl',
      language: 'zh-CN',
      allowNativeSignature: true,
      freeformBrief: '保持克制的研究记录风格',
      primaryRuleId: 'rule-primary',
      buildRules: [{ ruleId: 'rule-primary', inputs: { power: 3 } }],
      questionnaires: [{
        ...presetQuestionnaire,
        title: '客户端伪造标题',
        questions: [{ ...presetQuestionnaire.questions[0], question: '客户端伪造问题' }],
      }],
      questionnaireSelections: [{
        source: 'preset',
        kind: 'magical-girl',
        presetId: 'native-magical-girl',
      }],
      answers: [{
        questionnaireId: 'native-magical-girl',
        questionId: 'q-1',
        question: '客户端伪造问题',
        answer: '迷路的人',
      }],
      customProvider: {
        providerId: 'deepseek',
        modelId: 'alias-model',
        apiKey: 'top-secret-key',
      },
    }));

    expect(Object.isFrozen(runtime)).toBe(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        ...generatedMagicalGirl,
        templateId: '魔法少女/心之花/魔法少女（问卷生成）',
        userAnswers: [{
          question: '你守护什么？',
          answer: '迷路的人',
          questionId: 'q-1',
        }],
        creationInputs: {
          template: 'magical-girl',
          freeformBrief: '保持克制的研究记录风格',
          buildRules: [buildRule],
          primaryRuleId: 'rule-primary',
        },
        buildState: { primaryRuleId: 'rule-primary', rules: [buildRule] },
        signature: 'native-signature',
      },
      aiMeta: { aiModel: 'canonical-model' },
    });
    expect(events).toEqual([
      'preset:/questionnaires/presets/native-magical-girl.json',
      'build-rules:1',
      'validate:magical-girl:rule-primary',
      'prompt-input:你守护什么？',
      'rate-limit:magical_girl_details_generate:custom',
      'safety:迷路的人:在问卷中使用了危险符文',
      'safety:保持克制的研究记录风格:在自由补充说明中使用了危险符文',
      'generate:你守护什么？',
      'activity',
      'sign:魔法少女/心之花/魔法少女（问卷生成）',
      'response:canonical-model',
    ]);
    expect(JSON.stringify(events)).not.toContain('top-secret-key');

    const noRuleResponse = await runtime.service(createRequest({
      template: 'magical-girl',
      language: 'zh-CN',
      allowNativeSignature: true,
      freeformBrief: '无 build rule',
      questionnaires: [presetQuestionnaire],
      questionnaireSelections: [{
        source: 'preset',
        kind: 'magical-girl',
        presetId: 'native-magical-girl',
      }],
      answers: [{
        questionnaireId: 'native-magical-girl',
        questionId: 'q-1',
        answer: '迷路的人',
      }],
      customProvider: {
        providerId: 'deepseek',
        modelId: 'alias-model',
        apiKey: 'top-secret-key',
      },
    }));
    const noRuleBody = await noRuleResponse.json() as {
      data: { creationInputs: Record<string, unknown>; buildState?: unknown };
    };
    expect(noRuleResponse.status).toBe(200);
    expect(noRuleBody.data.creationInputs).toEqual({
      template: 'magical-girl',
      freeformBrief: '无 build rule',
      buildRules: [],
    });
    expect(noRuleBody.data).not.toHaveProperty('buildState');
  });
});
