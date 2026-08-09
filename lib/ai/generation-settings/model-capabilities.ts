// lib/ai/generation-settings/model-capabilities.ts
// 模型能力注册表：描述某 Provider 下某模型支持什么生成能力。
//
// 键必须是 providerId + modelId，因为同一个 modelId 在不同 Provider 下能力可能不同
// （OpenAI 官方 / KouriChat / Chatbox / OpenRouter ...）。
//
// 策略（恪守“不猜测”）：
// - 仅登记经过验证的 providerId + modelId（或明确 model family）。
// - 其余一律返回 unknown（开放）：temperature 尝试透传；thinking 因无法确定参数格式，
//   由 Resolver 视为不可控（不发送）。
// - 禁止仅凭 Provider 接口“长得像某家”就给新模型乱塞参数。

import type { ModelGenerationCapabilities, ThinkingAdapter, ThinkingEffort } from './types';

const buildKey = (providerId: string, modelId: string): string => `${providerId}::${modelId}`;

const SUPPORTED_TEMPERATURE: ModelGenerationCapabilities['temperature'] = {
  support: 'supported',
  min: 0,
  max: 2,
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
): ModelGenerationCapabilities['thinking'] => ({
  support: 'supported',
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
 * 首期登记（仅已验证）：
 * - Gemini 2.5：temperature 仍受支持（仅 3.6/3.5 Flash-Lite 起移除 sampling 参数）；
 *   thinking 用 google-thinking-budget（thinkingBudget 控制）。
 * - DeepSeek V4：temperature 受支持；thinking 用 deepseek-thinking-toggle（thinking.type）。
 * - 其余模型 / 自定义 modelId：不登记 → unknown（开放 / 不可乱猜）。
 */
const CAPABILITIES = new Map<string, ModelGenerationCapabilities>([
  [buildKey('google-cloudflare', 'gemini-2.5-flash'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(1_000_000),
    thinking: buildThinking('google-thinking-budget', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
  })],
  [buildKey('system', 'gemini-2.5-flash'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(1_000_000),
    thinking: buildThinking('google-thinking-budget', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
  })],

  [buildKey('deepseek', 'deepseek-v4-flash'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(1_000_000),
    thinking: buildThinking('deepseek-thinking-toggle'),
  })],
  [buildKey('deepseek', 'deepseek-v4-pro'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(1_000_000),
    thinking: buildThinking('deepseek-thinking-toggle'),
  })],
]);

/**
 * 读取某 Provider 下某模型的能力。
 * 未登记时返回全 unknown（开放），不猜测。
 */
export const getModelGenerationCapabilities = (
  providerId: string,
  modelId: string,
): ModelGenerationCapabilities => {
  if (!providerId || !modelId) {
    return buildCapabilities({});
  }
  return CAPABILITIES.get(buildKey(providerId, modelId)) ?? buildCapabilities({});
};