// lib/ai/generation-settings/model-capabilities.ts
// 模型能力注册表：描述某 Provider 下某模型支持什么生成能力。
//
// 键必须是 providerId + modelId，因为同一个 modelId 在不同 Provider 下能力可能不同
// （OpenAI 官方 / KouriChat / Chatbox / OpenRouter ...）。
//
// 未登记（unknown）：开放，交由用户显式设置并尝试发送，错误原样透传；禁止静默删除参数。

import type { ModelGenerationCapabilities, SupportState, ThinkingAdapter, ThinkingEffort } from './types';

const buildKey = (providerId: string, modelId: string): string => `${providerId}::${modelId}`;

const SUPPORTED_TEMPERATURE: ModelGenerationCapabilities['temperature'] = {
  support: 'supported',
  min: 0,
  max: 2,
};

const UNSUPPORTED_TEMPERATURE: ModelGenerationCapabilities['temperature'] = {
  support: 'unsupported',
};

const UNKNOWN_TEMPERATURE: ModelGenerationCapabilities['temperature'] = {
  support: 'unknown',
};

const buildMaxOutputTokens = (max?: number): ModelGenerationCapabilities['maxOutputTokens'] => ({
  support: 'supported',
  ...(typeof max === 'number' ? { max } : {}),
});

const UNKNOWN_MAX_OUTPUT_TOKENS: ModelGenerationCapabilities['maxOutputTokens'] = {
  support: 'unknown',
};

const buildThinking = (
  adapter: ThinkingAdapter,
  efforts?: ThinkingEffort[],
  support: SupportState = 'supported',
): ModelGenerationCapabilities['thinking'] => ({
  support,
  ...(efforts && efforts.length > 0 ? { efforts } : {}),
  adapter,
});

const UNKNOWN_THINKING: ModelGenerationCapabilities['thinking'] = {
  support: 'unknown',
  adapter: 'unknown',
};

const buildCapabilities = (capabilities: {
  temperature?: ModelGenerationCapabilities['temperature'];
  maxOutputTokens?: ModelGenerationCapabilities['maxOutputTokens'];
  thinking?: ModelGenerationCapabilities['thinking'];
}): ModelGenerationCapabilities => ({
  temperature: capabilities.temperature ?? UNKNOWN_TEMPERATURE,
  maxOutputTokens: capabilities.maxOutputTokens ?? UNKNOWN_MAX_OUTPUT_TOKENS,
  thinking: capabilities.thinking ?? UNKNOWN_THINKING,
});

/**
 * 能力注册表。键为 `${providerId}::${modelId}`。
 *
 * 首期登记原则：
 * - Google Gemini 系列：temperature 已在新模型被废弃/忽略，故登记 unsupported；thinking 支持，
 *   adapter=google，档位 minimal..high（不含 xhigh/max）。
 * - OpenAI 系（reasoning 模型）：thinking 支持，adapter=openai。
 * - DeepSeek：thinking 支持，adapter=deepseek。
 * - 其余模型 / 自定义 modelId：不登记 → unknown（开放）。
 */
const CAPABILITIES = new Map<string, ModelGenerationCapabilities>([
  // ---- Google / Gemini ----
  [buildKey('google-cloudflare', 'gemini-2.5-flash'), buildCapabilities({
    temperature: UNSUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(1_000_000),
    thinking: buildThinking('google', ['minimal', 'low', 'medium', 'high']),
  })],
  [buildKey('system', 'gemini-2.5-flash'), buildCapabilities({
    temperature: UNSUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(1_000_000),
    thinking: buildThinking('google', ['minimal', 'low', 'medium', 'high']),
  })],

  // ---- DeepSeek ----
  [buildKey('deepseek', 'deepseek-v4-flash'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(1_000_000),
    thinking: buildThinking('deepseek', ['low', 'medium', 'high']),
  })],
  [buildKey('deepseek', 'deepseek-v4-pro'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(1_000_000),
    thinking: buildThinking('deepseek', ['low', 'medium', 'high']),
  })],
]);

/**
 * 读取某 Provider 下某模型的能力。
 * 未登记时返回全 unknown（开放），由 Resolver 决定如何处理。
 */
export const getModelGenerationCapabilities = (
  providerId: string,
  modelId: string,
): ModelGenerationCapabilities => {
  if (!providerId || !modelId) {
    return buildCapabilities({});
  }
  const exact = CAPABILITIES.get(buildKey(providerId, modelId));
  if (exact) return exact;

  // 兜底：按 providerType 提供合理的默认能力（避免裸露的 if(model.includes(...)) 特判）。
  const type = inferProviderType(providerId);
  if (type === 'google') {
    return buildCapabilities({
      temperature: UNSUPPORTED_TEMPERATURE,
      thinking: buildThinking('google', ['minimal', 'low', 'medium', 'high']),
    });
  }
  if (type === 'deepseek') {
    return buildCapabilities({
      temperature: SUPPORTED_TEMPERATURE,
      thinking: buildThinking('deepseek', ['low', 'medium', 'high']),
    });
  }
  if (type === 'openai') {
    return buildCapabilities({
      temperature: SUPPORTED_TEMPERATURE,
      thinking: buildThinking('openai', ['minimal', 'low', 'medium', 'high']),
    });
  }
  return buildCapabilities({});
};

/** 从 providerId 推断 provider 类型（仅用于兜底默认能力，能力明细仍以注册表为准）。 */
export const inferProviderType = (
  providerId: string,
): 'openai' | 'google' | 'deepseek' | 'unknown' => {
  const id = providerId.trim().toLowerCase();
  if (id.includes('google') || id.includes('gemini')) return 'google';
  if (id.includes('deepseek')) return 'deepseek';
  if (id === 'openai' || id === 'system' || id === 'openrouter' || id === 'kourichat' || id === 'chatbox') {
    return 'openai';
  }
  return 'unknown';
};