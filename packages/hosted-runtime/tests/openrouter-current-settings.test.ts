import { getModelGenerationCapabilities } from '@mahoshojo/ai-core/generation-settings';
import { createNodeStructuredAiRuntime } from '../src/node-runtime';
import { resolveGenerationSettings } from '../src/node-runtime/generation-settings/resolve';
import { z } from 'zod/v3';

const noTemperatureModels = [
  ['openai/gpt-6.2-astra', false],
  ['openai/gpt-6.2-sol', false],
  ['openai/gpt-6.1-sol', false],
  ['openai/gpt-6.1-terra', true],
  ['openai/gpt-6-luna', true],
  ['anthropic/claude-fable-5.2', false],
  ['anthropic/claude-opus-5.5', false],
  ['anthropic/claude-sonnet-5.5', false],
  ['anthropic/claude-haiku-5.5', false],
] as const;

describe.each(noTemperatureModels)('OpenRouter %s 精确能力', (modelId, canDisable) => {
  it.each([undefined, 0.7])('任务默认和旧存用户 temperature=%s 均省略', (temperature) => {
    const result = resolveGenerationSettings({
      providerId: 'openrouter', modelId,
      taskDefaults: { temperature: 0.8 },
      userOverrides: { temperature, maxOutputTokens: 200_000 },
    });
    expect(result.standardOptions).toEqual({ maxOutputTokens: 128_000 });
    expect(result.diagnostics.omitted).toContainEqual({ field: 'temperature', reason: 'unsupported' });
    expect(getModelGenerationCapabilities('openrouter', modelId).thinking.efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('Chat SDK payload 省略 temperature，并按网关支持程度发送 none 档位', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: 'temperature-test', object: 'chat.completion', created: 1, model: modelId,
      choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }],
    }), { headers: { 'content-type': 'application/json' } }));
    const runtime = createNodeStructuredAiRuntime({ providers: [], fetch: fetchImpl });
    await expect(runtime.generateWithAI('input', {
      systemPrompt: 'Return JSON', promptBuilder: () => 'ok is true', schema: z.object({ ok: z.boolean() }),
      taskName: 'OpenRouter 参数', temperature: 0.8,
    }, {
      providerOverride: {
        name: 'OpenRouter', providerId: 'openrouter', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1',
        model: modelId, apiKey: 'mock-key', retryCount: 1,
        generationOverrides: { temperature: 1.2, thinking: { mode: 'disabled' } },
      },
    })).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).not.toHaveProperty('temperature');
    if (canDisable) expect(body.reasoning_effort).toBe('none');
    else expect(body).not.toHaveProperty('reasoning_effort');
  });
});

it('Kouri/Poe 同产品线保持未知，不抄 OpenRouter 限制', () => {
  for (const [providerId, modelId] of [['kourichat', 'gpt-6.1-sol'], ['poe', 'GPT-6.1-Sol']]) {
    expect(getModelGenerationCapabilities(providerId, modelId).temperature.support).toBe('unknown');
    expect(resolveGenerationSettings({ providerId, modelId, userOverrides: { temperature: 0.7 } }).standardOptions.temperature).toBe(0.7);
  }
});

it.each([
  ['gemini-4-carbon', 32_768, 'high'],
  ['gemini-4-argon', 32_768, 'high'],
  ['gemini-4-hydrogen', 65_536, 'xhigh'],
  ['gemini-4-neon', 65_536, 'xhigh'],
] as const)('%s 按 Google 原生和 OpenRouter 各自能力生成参数', (modelId, nativeMax, effort) => {
  const options = { temperature: 0.8, maxOutputTokens: 1_000_000, thinking: { mode: 'enabled' as const, effort } };
  const native = resolveGenerationSettings({ providerId: 'google-cloudflare', modelId, userOverrides: options });
  expect(native.standardOptions).toEqual({ maxOutputTokens: nativeMax });
  expect(native.providerOptions).toEqual({ google: { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } } });

  const gateway = resolveGenerationSettings({ providerId: 'openrouter', modelId: `google/${modelId}`, userOverrides: options });
  expect(gateway.standardOptions).toEqual({ temperature: 0.8, maxOutputTokens: 943_718 });
  expect(gateway.providerOptions).toEqual({ openai: { reasoningEffort: effort } });
});


it.each([
  ['x-ai/grok-4.7', 450_000],
  ['deepseek/deepseek-v4.1-flash', 943_718],
  ['qwen/qwen3.8-flash', 131_072],
] as const)('%s 已证支持温度，使用真实输出上限', (modelId, max) => {
  const result = resolveGenerationSettings({
    providerId: 'openrouter', modelId, taskDefaults: { temperature: 0.8 },
    userOverrides: { maxOutputTokens: 1_000_000 },
  });
  expect(result.standardOptions).toEqual({ temperature: 0.8, maxOutputTokens: max });
  if (modelId !== 'x-ai/grok-4.7') {
    expect(resolveGenerationSettings({
      providerId: 'openrouter', modelId, userOverrides: { thinking: { mode: 'enabled' } },
    }).providerOptions).toBeUndefined();
  }
});
