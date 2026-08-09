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

// Gemini 3.x 用 thinkingLevel 控制。官方档位：minimal（3.5 Flash-Lite 默认）、low/medium（3.6 Flash 默认）、high。
const GEMINI_3_THINKING_LEVELS: ThinkingEffort[] = ['minimal', 'low', 'medium', 'high'];

// Gemini 2.5 系列用 thinkingBudget（token 数）控制；适配器把档位映射为 ≤ max 的预算值。
// 档位 max 对 2.5 Flash 无独立意义（预算上限即 24_576），统一不登记 max。
const GEMINI_2_5_BUDGET_EFFORTS: ThinkingEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];

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
 * 登记（仅已验证，未列出的保持 unknown 不猜测）：
 * - Gemini 2.5：temperature 受支持；thinking 用 google-thinking-budget（thinkingBudget 控制）。
 *   Flash/Flash-Lite：maxOutputTokens=65_536、thinkingBudget≤24_576；Pro：maxOutputTokens=65_536、
 *   thinkingBudget≤32_768（适配器保守映射到 ≤24_576，安全）。
 * - Gemini 3.x：3.6/3.5 Flash-Lite 起移除 sampling 参数（temperature unsupported）；
 *   thinking 用 google-thinking-level（low/medium/high）；maxOutputTokens=64_000。
 * - DeepSeek V4：temperature 受支持；thinking 用 deepseek-thinking-toggle（thinking.type）。
 * - 其余模型 / 自定义 modelId：不登记 → unknown（开放 / 不可乱猜）。
 */
const CAPABILITIES = new Map<string, ModelGenerationCapabilities>([
  // ---- Gemini 2.5（google-thinking-budget）----
  // Flash：maxOutputTokens=65_536、thinkingBudget 0–24_576（0 关闭）。
  [buildKey('google-cloudflare', 'gemini-2.5-flash'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(65_536),
    thinking: buildThinking('google-thinking-budget', GEMINI_2_5_BUDGET_EFFORTS),
  })],
  [buildKey('system', 'gemini-2.5-flash'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(65_536),
    thinking: buildThinking('google-thinking-budget', GEMINI_2_5_BUDGET_EFFORTS),
  })],
  // Pro：maxOutputTokens=65_536、thinkingBudget 0–32_768。适配器档位最大值 24_576 < 32_768，安全。
  [buildKey('google-cloudflare', 'gemini-2.5-pro'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(65_536),
    thinking: buildThinking('google-thinking-budget', GEMINI_2_5_BUDGET_EFFORTS),
  })],
  [buildKey('system', 'gemini-2.5-pro'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(65_536),
    thinking: buildThinking('google-thinking-budget', GEMINI_2_5_BUDGET_EFFORTS),
  })],
  // Flash-Lite：与 Flash 同协议，保守复用同一组限制。
  [buildKey('google-cloudflare', 'gemini-2.5-flash-lite'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(65_536),
    thinking: buildThinking('google-thinking-budget', GEMINI_2_5_BUDGET_EFFORTS),
  })],

  // ---- Gemini 3.x（google-thinking-level，档位 low/medium/high）----
  // 3.6/3.5 Flash-Lite 起移除 sampling 参数（temperature 不发送）。
  [buildKey('google-cloudflare', 'gemini-3.6-flash'), buildCapabilities({
    temperature: { support: 'unsupported' },
    maxOutputTokens: buildMaxOutputTokens(64_000),
    thinking: buildThinking('google-thinking-level', GEMINI_3_THINKING_LEVELS),
  })],
  [buildKey('system', 'gemini-3.6-flash'), buildCapabilities({
    temperature: { support: 'unsupported' },
    maxOutputTokens: buildMaxOutputTokens(64_000),
    thinking: buildThinking('google-thinking-level', GEMINI_3_THINKING_LEVELS),
  })],
  [buildKey('google-cloudflare', 'gemini-3.5-flash-lite'), buildCapabilities({
    temperature: { support: 'unsupported' },
    maxOutputTokens: buildMaxOutputTokens(64_000),
    thinking: buildThinking('google-thinking-level', GEMINI_3_THINKING_LEVELS),
  })],
  [buildKey('system', 'gemini-3.5-flash-lite'), buildCapabilities({
    temperature: { support: 'unsupported' },
    maxOutputTokens: buildMaxOutputTokens(64_000),
    thinking: buildThinking('google-thinking-level', GEMINI_3_THINKING_LEVELS),
  })],
  // 3.1 Pro 仍支持 temperature（仅 3.6/3.5 Lite 起移除 sampling）。
  [buildKey('google-cloudflare', 'gemini-3.1-pro-preview'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(64_000),
    thinking: buildThinking('google-thinking-level', GEMINI_3_THINKING_LEVELS),
  })],

  // ---- DeepSeek（deepseek-thinking-toggle）----
  [buildKey('system', 'deepseek-v4-flash-0731'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(1_000_000),
    thinking: buildThinking('deepseek-thinking-toggle'),
  })],
  [buildKey('system', 'deepseek-v4-pro'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(1_000_000),
    thinking: buildThinking('deepseek-thinking-toggle'),
  })],

  // DeepSeek 官方 provider：catalog 的 modelId 为 deepseek-v4-flash-0731（带正式版后缀）。
  [buildKey('deepseek', 'deepseek-v4-flash-0731'), buildCapabilities({
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