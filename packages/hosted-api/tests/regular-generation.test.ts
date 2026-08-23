import { describe, expect, it } from 'vitest';
import {
  createGenerateGameCardService,
} from '../src/generate-game-card';
import {
  createGenerateFreeService,
  createGenerateFreeStreamService,
} from '../src/generate-free';
import {
  createGenerateScenarioService,
  createGenerateScenarioStreamService,
} from '../src/generate-scenario';
import { completeStep, respondStep } from '../src/regular-generation';

const request = (path: string, body: unknown, method = 'POST'): Request => new Request(
  `https://example.test/api/${path}`,
  {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  },
);

const json = async (response: Response): Promise<unknown> => response.json();

describe('regular hosted generation services', () => {
  it('Game Card 保持 safety -> rate-limit -> generate -> output -> activity -> response 顺序', async () => {
    const calls: string[] = [];
    const service = createGenerateGameCardService({
      enforceSafety: async (_request, input) => {
        calls.push(`safety:${input.sourceCardJson}:${input.customInstructions}`);
        return null;
      },
      checkRateLimit: async () => {
        calls.push('rate-limit');
        return null;
      },
      generate: async () => {
        calls.push('generate');
        return completeStep({ cardName: '测试卡' });
      },
      applyOutputPolicy: async (_request, _input, generated) => {
        calls.push('output-policy');
        return completeStep({ faceData: generated, sourceCardKind: 'shojo' });
      },
      recordActivity: () => calls.push('activity'),
      logSuccess: () => calls.push('success-log'),
      buildResponse: (_request, _input, output) => {
        calls.push('response');
        return new Response(JSON.stringify(output), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
      logError: () => calls.push('error-log'),
    });

    const response = await service(request('generate-game-card', {
      sourceCardJson: '{"name":"测试"}',
      customInstructions: '保持简洁',
    }));

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      faceData: { cardName: '测试卡' },
      sourceCardKind: 'shojo',
    });
    expect(calls).toEqual([
      'safety:{"name":"测试"}:保持简洁',
      'rate-limit',
      'generate',
      'output-policy',
      'activity',
      'success-log',
      'response',
    ]);
  });

  it('Game Card 的安全和输出策略短路不会产生后续副作用', async () => {
    const calls: string[] = [];
    const rejected = new Response(JSON.stringify({ error: 'unsafe' }), { status: 400 });
    const service = createGenerateGameCardService({
      enforceSafety: async () => rejected,
      checkRateLimit: async () => {
        calls.push('rate-limit');
        return null;
      },
      generate: async () => {
        calls.push('generate');
        return completeStep({});
      },
      applyOutputPolicy: async () => {
        calls.push('output-policy');
        return completeStep({});
      },
      recordActivity: () => calls.push('activity'),
      logSuccess: () => calls.push('success-log'),
      buildResponse: () => new Response(null),
      logError: () => calls.push('error-log'),
    });

    const response = await service(request('generate-game-card', { sourceCardJson: '{}' }));

    expect(response).toBe(rejected);
    expect(calls).toEqual([]);
  });

  it('Game Card 保持既有 method、请求校验和异常 wire', async () => {
    const errors: unknown[] = [];
    const dependencies = {
      enforceSafety: async () => null,
      checkRateLimit: async () => null,
      generate: async () => {
        throw new Error('upstream failed');
      },
      applyOutputPolicy: async () => completeStep({}),
      recordActivity: () => undefined,
      logSuccess: () => undefined,
      buildResponse: () => new Response(null),
      logError: (error: unknown) => errors.push(error),
    };
    const service = createGenerateGameCardService(dependencies);

    const methodResponse = await service(request('generate-game-card', null, 'GET'));
    const invalidResponse = await service(request('generate-game-card', { sourceCardJson: '' }));
    const failureResponse = await service(request('generate-game-card', { sourceCardJson: '{}' }));

    expect(methodResponse.status).toBe(405);
    expect(await json(methodResponse)).toEqual({ error: 'Method not allowed' });
    expect(invalidResponse.status).toBe(400);
    expect(await json(invalidResponse)).toMatchObject({ error: '请求参数无效' });
    expect(failureResponse.status).toBe(500);
    expect(await json(failureResponse)).toEqual({
      error: '卡牌卡面生成失败',
      message: 'Error: upstream failed',
    });
    expect(errors).toHaveLength(1);
  });

  it('Free 非流式保持 rate-limit -> safety -> generate -> normalize -> activity -> response 顺序', async () => {
    const calls: string[] = [];
    const service = createGenerateFreeService({
      checkRateLimit: async () => {
        calls.push('rate-limit');
        return null;
      },
      enforceSafety: async (_request, input, safetyText) => {
        calls.push(`safety:${input.schema}:${safetyText}`);
        return null;
      },
      generate: async (_request, input) => {
        calls.push(`generate:${input.prompt}`);
        return completeStep({ raw: true });
      },
      normalizeOutput: async () => {
        calls.push('normalize');
        return completeStep({ normalized: true });
      },
      recordActivity: () => calls.push('activity'),
      buildResponse: (_request, _input, output) => {
        calls.push('response');
        return new Response(JSON.stringify(output));
      },
      logError: () => calls.push('error-log'),
    });

    const response = await service(request('generate-free', {
      schema: 'general',
      prompt: '生成角色',
      attachments: [{ name: '设定.txt', content: '附件设定' }],
      language: 'zh-CN',
    }));

    expect(await json(response)).toEqual({ normalized: true });
    expect(calls).toEqual([
      'rate-limit',
      'safety:general:生成角色\n\n附件设定',
      'generate:生成角色',
      'normalize',
      'activity',
      'response',
    ]);
  });

  it('Free 流式把原始 AbortSignal 交给 executor 并原样返回 stream response', async () => {
    const calls: string[] = [];
    let capturedSignal: AbortSignal | null = null;
    const streamResponse = new Response('stream-body', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Stream': 'free' },
    });
    const service = createGenerateFreeStreamService({
      checkRateLimit: async () => {
        calls.push('rate-limit');
        return null;
      },
      enforceSafety: async () => {
        calls.push('safety');
        return null;
      },
      generate: async (incomingRequest) => {
        calls.push('generate');
        capturedSignal = incomingRequest.signal;
        return completeStep({ response: streamResponse });
      },
      recordActivity: () => calls.push('activity'),
      buildResponse: (_request, _input, output) => {
        calls.push('response');
        return output.response;
      },
      logError: () => calls.push('error-log'),
    });
    const controller = new AbortController();
    const incomingRequest = new Request('https://example.test/api/generate-free-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ schema: 'general', prompt: '生成角色', attachments: [] }),
    });

    const response = await service(incomingRequest);

    expect(capturedSignal).toBe(incomingRequest.signal);
    expect(response).toBe(streamResponse);
    expect(calls).toEqual(['rate-limit', 'safety', 'generate', 'activity', 'response']);
  });

  it('Free 请求校验保持 schema/附件上限，并允许 dependency 返回既有 Provider 错误', async () => {
    const providerError = new Response(JSON.stringify({ error: '未知的模型供应商 ID' }), { status: 400 });
    let generated = 0;
    const service = createGenerateFreeService({
      checkRateLimit: async () => null,
      enforceSafety: async () => null,
      generate: async () => {
        generated += 1;
        return respondStep(providerError);
      },
      normalizeOutput: async () => completeStep({}),
      recordActivity: () => undefined,
      buildResponse: () => new Response(null),
      logError: () => undefined,
    });

    const invalidResponse = await service(request('generate-free', {
      schema: 'not-supported',
      prompt: 'x',
      attachments: [],
    }));
    const providerResponse = await service(request('generate-free', {
      schema: 'general',
      prompt: 'x',
      attachments: [],
    }));

    expect(invalidResponse.status).toBe(400);
    expect(await json(invalidResponse)).toEqual({ error: '请求参数无效' });
    expect(providerResponse).toBe(providerError);
    expect(generated).toBe(1);
  });

  it('Scenario 非流式保持 activity 在签名/finalize 前，并保持短路响应', async () => {
    const calls: string[] = [];
    const service = createGenerateScenarioService({
      checkRateLimit: async () => {
        calls.push('rate-limit');
        return null;
      },
      enforceSafety: async (_request, input, safetyText) => {
        calls.push(`safety:${input.language}:${safetyText}`);
        return null;
      },
      generate: async () => {
        calls.push('generate');
        return completeStep({ scenarioData: { title: '测试情景' } });
      },
      recordActivity: () => calls.push('activity'),
      finalize: async (_request, _input, output) => {
        calls.push('sign-and-response');
        return new Response(JSON.stringify(output.scenarioData));
      },
      logError: () => calls.push('error-log'),
    });

    const response = await service(request('generate-scenario', {
      answers: { 时间: '清晨', 地点: '车站' },
      language: 'zh-CN',
      fieldsToKeepEmpty: [],
    }));

    expect(await json(response)).toEqual({ title: '测试情景' });
    expect(calls).toEqual([
      'rate-limit',
      'safety:zh-CN:清晨 车站',
      'generate',
      'activity',
      'sign-and-response',
    ]);
  });

  it('Scenario 流式复用相同业务顺序，invalid answers 不触发依赖', async () => {
    const calls: string[] = [];
    const service = createGenerateScenarioStreamService({
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
        return completeStep({ response: new Response('scenario-stream') });
      },
      recordActivity: () => calls.push('activity'),
      buildResponse: (_request, _input, output) => {
        calls.push('response');
        return output.response;
      },
      logError: () => calls.push('error-log'),
    });

    const invalidResponse = await service(request('generate-scenario-stream', { answers: [] }));
    expect(invalidResponse.status).toBe(400);
    expect(await json(invalidResponse)).toEqual({ error: 'Answers object is required' });
    expect(calls).toEqual([]);

    const validResponse = await service(request('generate-scenario-stream', {
      answers: { 核心: '一次重逢' },
    }));
    expect(await validResponse.text()).toBe('scenario-stream');
    expect(calls).toEqual(['rate-limit', 'safety', 'generate', 'activity', 'response']);
  });

  it('Scenario 非流式与流式保留各自既有错误 Content-Type', async () => {
    const dependencies = {
      checkRateLimit: async () => null,
      enforceSafety: async () => null,
      generate: async () => completeStep({}),
      recordActivity: () => undefined,
      logError: () => undefined,
    };
    const nonStream = createGenerateScenarioService({
      ...dependencies,
      finalize: () => new Response(null),
    });
    const stream = createGenerateScenarioStreamService({
      ...dependencies,
      buildResponse: () => new Response(null),
    });

    const nonStreamResponse = await nonStream(request('generate-scenario', null, 'GET'));
    const streamResponse = await stream(request('generate-scenario-stream', null, 'GET'));

    expect(nonStreamResponse.headers.get('content-type')).toBe('text/plain;charset=UTF-8');
    expect(streamResponse.headers.get('content-type')).toBe('application/json');
  });

  it('Scenario 保留 malformed JSON 的 500 wire 与非流式 JSON null 行为', async () => {
    const errors: unknown[] = [];
    const dependencies = {
      checkRateLimit: async () => null,
      enforceSafety: async () => null,
      generate: async () => completeStep({}),
      recordActivity: () => undefined,
      logError: (error: unknown) => errors.push(error),
    };
    const nonStream = createGenerateScenarioService({
      ...dependencies,
      finalize: () => new Response(null),
    });
    const stream = createGenerateScenarioStreamService({
      ...dependencies,
      buildResponse: () => new Response(null),
    });
    const malformedRequest = (path: string) => new Request(`https://example.test/api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });

    const nonStreamMalformed = await nonStream(malformedRequest('generate-scenario'));
    const streamMalformed = await stream(malformedRequest('generate-scenario-stream'));
    const nonStreamNull = await nonStream(request('generate-scenario', null));
    const streamNull = await stream(request('generate-scenario-stream', null));

    expect(nonStreamMalformed.status).toBe(500);
    expect(streamMalformed.status).toBe(500);
    expect(nonStreamNull.status).toBe(500);
    expect(streamNull.status).toBe(400);
    expect(errors).toHaveLength(3);
  });
});
