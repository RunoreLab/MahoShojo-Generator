import { describe, expect, it } from 'vitest';
import {
  createGenerateMagicalGirlService,
  MAGICAL_GIRL_NAME_MAX_LENGTH,
  type GenerateMagicalGirlServiceDependencies,
  type MagicalGirlGenerationResult,
} from '../src/generate-magical-girl';

const generatedResult: MagicalGirlGenerationResult = {
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

type DependencyState = {
  generatedInputs: Array<{ realName: string; language: string }>;
  signedPayloads: unknown[];
  recordedRequests: Request[];
  errors: Array<{ error: unknown; nameLength: number }>;
};

const createDependencies = (
  overrides: Partial<GenerateMagicalGirlServiceDependencies> = {},
): { dependencies: GenerateMagicalGirlServiceDependencies; state: DependencyState } => {
  const state: DependencyState = {
    generatedInputs: [],
    signedPayloads: [],
    recordedRequests: [],
    errors: [],
  };
  const dependencies: GenerateMagicalGirlServiceDependencies = {
    checkRateLimit: async () => null,
    enforceSafety: async () => null,
    generate: async (input) => {
      state.generatedInputs.push(input);
      return generatedResult;
    },
    sign: async (payload) => {
      state.signedPayloads.push(payload);
      return 'signed-value';
    },
    recordActivity: (request) => {
      state.recordedRequests.push(request);
    },
    logError: (error, context) => {
      state.errors.push({ error, nameLength: context.nameLength });
    },
    retryAfterSeconds: 60,
    ...overrides,
  };
  return { dependencies, state };
};

const createRequest = (body: unknown, method = 'POST'): Request => new Request(
  'https://example.com/api/generate-magical-girl',
  {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  },
);

describe('generate magical girl hosted application service', () => {
  it('只接受 POST，并在解析前保留既有 405 响应', async () => {
    const { dependencies, state } = createDependencies();
    const service = createGenerateMagicalGirlService(dependencies);

    const response = await service(createRequest(null, 'GET'));

    expect(response.status).toBe(405);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ error: 'Method not allowed' });
    expect(state.generatedInputs).toHaveLength(0);
  });

  it('拒绝空名字和超长名字，且不调用限速、安全或生成依赖', async () => {
    const calls: string[] = [];
    const { dependencies } = createDependencies({
      checkRateLimit: async () => {
        calls.push('rate-limit');
        return null;
      },
      enforceSafety: async () => {
        calls.push('safety');
        return null;
      },
      generate: async () => {
        calls.push('generate');
        return generatedResult;
      },
    });
    const service = createGenerateMagicalGirlService(dependencies);

    const emptyResponse = await service(createRequest({ name: '   ' }));
    const tooLongResponse = await service(createRequest({
      name: 'a'.repeat(MAGICAL_GIRL_NAME_MAX_LENGTH + 1),
    }));

    expect(emptyResponse.status).toBe(400);
    expect(await emptyResponse.json()).toEqual({ error: 'Name is required' });
    expect(tooLongResponse.status).toBe(400);
    expect(await tooLongResponse.json()).toEqual({ error: '名字太长啦，你怎么回事！' });
    expect(calls).toEqual([]);
  });

  it('按限速、安全、生成、签名和活动记录顺序执行同一业务核心', async () => {
    const calls: string[] = [];
    const { dependencies, state } = createDependencies({
      checkRateLimit: async () => {
        calls.push('rate-limit');
        return null;
      },
      enforceSafety: async (_request, input) => {
        calls.push(`safety:${input.name}:${input.language}`);
        return null;
      },
      generate: async (input) => {
        calls.push(`generate:${input.realName}:${input.language}`);
        state.generatedInputs.push(input);
        return generatedResult;
      },
      sign: async (payload) => {
        calls.push('sign');
        state.signedPayloads.push(payload);
        return 'signed-value';
      },
      recordActivity: (request) => {
        calls.push('activity');
        state.recordedRequests.push(request);
      },
    });
    const service = createGenerateMagicalGirlService(dependencies);
    const request = createRequest({ name: '  小满  ', language: ' zh-CN ' });

    const response = await service(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(calls).toEqual([
      'rate-limit',
      'safety:小满:zh-CN',
      'generate:小满:zh-CN',
      'activity',
      'sign',
    ]);
    expect(state.signedPayloads).toEqual([{
      ...generatedResult,
      templateId: '魔法少女/心之花/魔法少女（名字生成）',
    }]);
    expect(state.recordedRequests).toEqual([request]);
    expect(await response.json()).toEqual({
      ...generatedResult,
      templateId: '魔法少女/心之花/魔法少女（名字生成）',
      signature: 'signed-value',
    });
  });

  it('限速或安全检查返回响应时不会继续产生生成副作用', async () => {
    const rateLimited = new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 });
    const safetyRejected = new Response(JSON.stringify({ error: 'unsafe' }), { status: 400 });
    const rateLimitCase = createDependencies({
      checkRateLimit: async () => rateLimited,
    });
    const safetyCase = createDependencies({
      enforceSafety: async () => safetyRejected,
    });

    const rateLimitResponse = await createGenerateMagicalGirlService(rateLimitCase.dependencies)(
      createRequest({ name: '小满' }),
    );
    const safetyResponse = await createGenerateMagicalGirlService(safetyCase.dependencies)(
      createRequest({ name: '小满' }),
    );

    expect(rateLimitResponse).toBe(rateLimited);
    expect(safetyResponse).toBe(safetyRejected);
    expect(rateLimitCase.state.generatedInputs).toHaveLength(0);
    expect(safetyCase.state.generatedInputs).toHaveLength(0);
  });

  it('生成失败时只记录固定错误与名字长度', async () => {
    const failure = new Error('magical-girl-name-provider-url-canary');
    const { dependencies, state } = createDependencies({
      generate: async () => {
        throw failure;
      },
      retryAfterSeconds: 17,
    });
    const service = createGenerateMagicalGirlService(dependencies);

    const response = await service(createRequest({ name: '小满' }));

    expect(response.status).toBe(500);
    expect(state.errors).toEqual([{
      error: expect.objectContaining({ message: 'HOSTED_GENERATION_FAILED' }),
      nameLength: 2,
    }]);
    expect(await response.json()).toEqual({
      error: '生成失败，当前服务器可能正忙，请稍后重试',
      message: '服务器内部错误',
      retryAfterSeconds: 17,
    });
    expect(JSON.stringify(state.errors)).not.toMatch(/小满|magical-girl-name-provider-url-canary/u);
  });
});
