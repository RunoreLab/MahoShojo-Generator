import { describe, expect, it } from 'vitest';

import {
  GAME_CARD_ACTION_TYPE,
  createGenerateGameCardRuntime,
  type GenerateGameCardRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-game-card-runtime';
import {
  GAME_CARD_GENERATION_CONFIG,
} from '@mahoshojo/ai-core/game-card-generation';
import type { GameCardFaceData } from '@mahoshojo/contracts/game-card';

const generatedFaceData: GameCardFaceData = {
  cardName: '测试卡牌',
  cardType: 'character',
  rarity: 'common',
  cost: 1,
  element: 'neutral',
  attack: 1,
  defense: 1,
  hp: 1,
  effects: [{ type: '被动', description: '守护中国' }],
  traits: ['测试'],
  flavorText: '测试',
  powerLevel: 'C',
  description: '测试卡面',
  themeColor: '#ffffff',
};

const createRequest = (body: unknown): Request => new Request(
  'https://example.test/api/generate-game-card',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mahoshojo-AI-Meta': 'true',
    },
    body: JSON.stringify(body),
  },
);

describe('generate game card hosted runtime', () => {
  it('以固定 action 按 input safety→rate-limit→generate→output-policy→activity→response 执行，且无签名步骤', async () => {
    const events: string[] = [];
    const dependencies: GenerateGameCardRuntimeDependencies = {
      findProvider: () => ({
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        type: 'deepseek',
        mode: 'auto',
      }),
      resolveModel: () => ({ modelId: 'deepseek-v4-flash' }),
      enforceSafety: async ({ text, sensitiveWordReason, aiPromptTemplate }) => {
        events.push(`safety:${text}:${sensitiveWordReason}:${aiPromptTemplate}`);
        return null;
      },
      checkRateLimit: async ({ actionType, providerMode }) => {
        events.push(`rate-limit:${actionType}:${providerMode}`);
        return null;
      },
      generateWithAI: async (input, config, options) => {
        events.push(`generate:${input.sourceCardJson}:${input.customInstructions}`);
        expect(config).toBe(GAME_CARD_GENERATION_CONFIG);
        expect(options.channelContext).toEqual({
          providerId: 'deepseek',
          modelId: 'deepseek-v4-flash-0731',
        });
        expect(options.providerOverride?.model).toBe('deepseek-v4-flash');
        options.telemetry.model = 'deepseek-v4-flash';
        return generatedFaceData;
      },
      isSensitiveWordFilterEnabled: true,
      checkOutputSafety: async (serialized) => {
        events.push(`output-safety:${serialized.includes('测试卡牌')}`);
        return { hasSensitiveWords: false, detectedWords: [] };
      },
      applyShieldWords: (faceData) => {
        events.push('shield-words');
        return {
          ...faceData,
          effects: [{ type: '被动', description: '守护【国度】' }],
        };
      },
      recordActivity: () => events.push('activity'),
      buildResponse: ({ data, telemetry }) => {
        events.push(`response:${String(telemetry.model)}`);
        return new Response(JSON.stringify({ data, aiMeta: { aiModel: telemetry.model } }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
      logInfo: (message, meta) => events.push(`info:${message}:${meta.sourceCardKind}`),
      logWarn: () => events.push('warn'),
      logError: () => events.push('error'),
    };
    const runtime = createGenerateGameCardRuntime(dependencies);

    const response = await runtime.service(createRequest({
      sourceCardJson: '{"templateId":"魔法少女/心之花/魔法少女（名字生成）"}',
      customInstructions: '保持简洁',
      customProvider: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash-0731',
        apiKey: 'key',
      },
    }));

    expect(GAME_CARD_ACTION_TYPE).toBe('free_generate');
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        faceData: {
          ...generatedFaceData,
          effects: [{ type: '被动', description: '守护【国度】' }],
        },
        sourceCardKind: 'magical-girl',
      },
      aiMeta: { aiModel: 'deepseek-v4-flash' },
    });
    expect(events).toEqual([
      'safety:{"templateId":"魔法少女/心之花/魔法少女（名字生成）"}保持简洁:卡牌生成输入含敏感词:free',
      'rate-limit:free_generate:custom',
      'generate:{"templateId":"魔法少女/心之花/魔法少女（名字生成）"}:保持简洁',
      'output-safety:true',
      'shield-words',
      'activity',
      'info:卡牌卡面生成成功:magical-girl',
      'response:deepseek-v4-flash',
    ]);
  });

  it('输出敏感词 fail closed，不产生活动或响应构建副作用', async () => {
    const events: string[] = [];
    const dependencies: GenerateGameCardRuntimeDependencies = {
      findProvider: () => null,
      resolveModel: () => null,
      enforceSafety: async () => null,
      checkRateLimit: async () => null,
      generateWithAI: async () => generatedFaceData,
      isSensitiveWordFilterEnabled: true,
      checkOutputSafety: async () => ({
        hasSensitiveWords: true,
        detectedWords: ['测试敏感词'],
      }),
      applyShieldWords: (faceData) => faceData,
      recordActivity: () => events.push('activity'),
      buildResponse: () => {
        events.push('response');
        return new Response(null);
      },
      logInfo: () => events.push('info'),
      logWarn: (message, meta) => events.push(
        `warn:${message}:${meta.detectedWords?.join(',')}`,
      ),
      logError: () => events.push('error'),
    };
    const runtime = createGenerateGameCardRuntime(dependencies);

    const response = await runtime.service(createRequest({ sourceCardJson: '{}' }));

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({
      error: '卡牌卡面生成结果不合规',
      shouldRedirect: true,
    });
    expect(events).toEqual([
      'warn:卡牌卡面生成结果含敏感词，已拒绝返回:测试敏感词',
    ]);
  });

  it('快照依赖并保留 providerMode trim 与 Provider 错误短路', async () => {
    const providerModes: string[] = [];
    const dependencies: GenerateGameCardRuntimeDependencies = {
      findProvider: () => null,
      resolveModel: () => null,
      enforceSafety: async () => null,
      checkRateLimit: async ({ providerMode }) => {
        providerModes.push(providerMode);
        return null;
      },
      generateWithAI: async () => generatedFaceData,
      isSensitiveWordFilterEnabled: false,
      checkOutputSafety: async () => ({ hasSensitiveWords: false, detectedWords: [] }),
      applyShieldWords: (faceData) => faceData,
      recordActivity: () => undefined,
      buildResponse: () => new Response(null),
      logInfo: () => undefined,
      logWarn: () => undefined,
      logError: () => undefined,
    };
    const runtime = createGenerateGameCardRuntime(dependencies);
    dependencies.findProvider = () => ({
      id: 'unknown',
      name: 'late mutation',
      baseUrl: '',
      type: 'openai',
    });

    const response = await runtime.service(createRequest({
      sourceCardJson: '{}',
      customProvider: {
        providerId: ' system ',
        modelId: 'default',
        apiKey: '',
      },
    }));

    expect(providerModes).toEqual(['system']);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '未知的模型供应商 ID' });
  });
});
