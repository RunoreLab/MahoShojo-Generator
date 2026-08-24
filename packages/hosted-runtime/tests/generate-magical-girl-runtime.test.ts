import { describe, expect, it } from 'vitest';

import {
  createGenerateMagicalGirlRuntime,
  MAGICAL_GIRL_ACTION_TYPE,
  MAGICAL_GIRL_GENERATION_SCHEMA,
  MAGICAL_GIRL_PROVIDER_MODE,
  buildMagicalGirlGenerationPrompt,
  type AIGeneratedMagicalGirl,
  type GenerateMagicalGirlRuntimeDependencies,
} from '@mahoshojo/hosted-runtime/generate-magical-girl-runtime';

const generatedResult: AIGeneratedMagicalGirl = {
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

const createRequest = (body: unknown): Request => new Request(
  'https://example.test/api/generate-magical-girl',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  },
);

describe('generate magical girl hosted runtime', () => {
  it('唯一持有输出 schema 与 prompt 构建规则', () => {
    expect(MAGICAL_GIRL_GENERATION_SCHEMA.parse(generatedResult)).toEqual(generatedResult);
    expect(buildMagicalGirlGenerationPrompt({ realName: '小满', language: 'zh-CN' })).toBe(
      '请为名叫"小满"的人设计一个魔法少女角色。真实姓名：小满\n\n【重要指令】请你必须使用【zh-CN】进行内容创作。',
    );
    expect(() => MAGICAL_GIRL_GENERATION_SCHEMA.parse({
      ...generatedResult,
      appearance: { ...generatedResult.appearance, mainColor: '不存在的颜色' },
    })).toThrow();
    expect(MAGICAL_GIRL_GENERATION_SCHEMA.shape.spell.description).toContain(
      '在此寄讬吾真红的金光吧',
    );
  });

  it('以固定 action/provider 按限速、安全、AI、活动、签名顺序执行', async () => {
    const events: string[] = [];
    const dependencies: GenerateMagicalGirlRuntimeDependencies = {
      checkRateLimit: async ({ actionType, providerMode }) => {
        events.push(`rate-limit:${actionType}:${providerMode}`);
        return null;
      },
      enforceSafety: async ({ name, language }) => {
        events.push(`safety:${name}:${language}`);
        return null;
      },
      generateWithAI: async (input, config, options) => {
        events.push(`ai:${input.realName}:${input.language}`);
        expect(config.schema).toBe(MAGICAL_GIRL_GENERATION_SCHEMA);
        expect(config.promptBuilder(input)).toBe(buildMagicalGirlGenerationPrompt(input));
        expect(options).toEqual({
          channelContext: { providerId: 'system', modelId: 'default' },
        });
        return generatedResult;
      },
      recordActivity: () => {
        events.push('activity');
      },
      sign: async () => {
        events.push('signature');
        return 'signed-value';
      },
      logError: () => undefined,
      cooldownMs: 60_000,
    };
    const runtime = createGenerateMagicalGirlRuntime(dependencies);

    const response = await runtime.service(createRequest({
      name: '  小满  ',
      language: ' zh-CN ',
    }));

    expect(MAGICAL_GIRL_ACTION_TYPE).toBe('magical_girl_generate');
    expect(MAGICAL_GIRL_PROVIDER_MODE).toBe('system');
    expect(events).toEqual([
      'rate-limit:magical_girl_generate:system',
      'safety:小满:zh-CN',
      'ai:小满:zh-CN',
      'activity',
      'signature',
    ]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...generatedResult,
      templateId: '魔法少女/心之花/魔法少女（名字生成）',
      signature: 'signed-value',
    });
  });

  it('快照依赖并冻结 runtime，保留失败 wire 与 cooldown 换算', async () => {
    const failure = new Error('upstream failed');
    const errors: unknown[] = [];
    const dependencies: GenerateMagicalGirlRuntimeDependencies = {
      checkRateLimit: async () => null,
      enforceSafety: async () => null,
      generateWithAI: async () => {
        throw failure;
      },
      recordActivity: () => undefined,
      sign: async () => null,
      logError: (error) => {
        errors.push(error);
      },
      cooldownMs: 60_001,
    };
    const runtime = createGenerateMagicalGirlRuntime(dependencies);
    dependencies.cooldownMs = 1;

    const response = await runtime.service(createRequest({ name: '小满' }));

    expect(Object.isFrozen(runtime)).toBe(true);
    expect(errors).toEqual([failure]);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: '生成失败，当前服务器可能正忙，请稍后重试',
      message: 'upstream failed',
      retryAfterSeconds: 61,
    });
  });
});
