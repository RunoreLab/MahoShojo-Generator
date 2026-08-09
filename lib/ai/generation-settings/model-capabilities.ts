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

const SUPPORTED_TEMPERATURE_WITHOUT_KNOWN_MAX: ModelGenerationCapabilities['temperature'] = {
  support: 'supported',
  min: 0,
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
  canDisable = true,
): ModelGenerationCapabilities['thinking'] => ({
  support: 'supported',
  ...(efforts && efforts.length > 0 ? { efforts } : {}),
  adapter,
  canDisable,
});

const UNKNOWN_THINKING: ModelGenerationCapabilities['thinking'] = {
  support: 'unknown',
  adapter: 'unknown',
};

// Gemini 3 Flash / Flash-Lite 支持 minimal/low/medium/high；3.1 Pro 不支持 minimal。
const GEMINI_3_FLASH_THINKING_LEVELS: ThinkingEffort[] = ['minimal', 'low', 'medium', 'high'];
const GEMINI_3_PRO_THINKING_LEVELS: ThinkingEffort[] = ['low', 'medium', 'high'];
const GEMMA_4_THINKING_LEVELS: ThinkingEffort[] = ['high'];

// OpenRouter /api/v1/models（2026-08-09 快照）明确给出的 reasoning_effort 档位。
// `none` 由统一的 disabled 模式表达，不放入 efforts 列表。
const OPENROUTER_GPT_5_4_5_5_EFFORTS: ThinkingEffort[] = ['low', 'medium', 'high', 'xhigh'];
const OPENROUTER_GPT_5_6_EFFORTS: ThinkingEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const OPENROUTER_CLAUDE_OPUS_4_8_EFFORTS: ThinkingEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const OPENROUTER_CLAUDE_SONNET_4_6_EFFORTS: ThinkingEffort[] = ['low', 'medium', 'high', 'max'];
const OPENROUTER_QWEN_3_8_MAX_EFFORTS: ThinkingEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];

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
 *   Flash/Flash-Lite 可用 thinkingBudget=0 关闭；2.5 Pro 不能关闭 Thinking。
 * - Gemini 3.x：3.6/3.5 Flash-Lite 起移除 sampling 参数（temperature unsupported）；
 *   thinking 用 google-thinking-level，不能完全关闭；maxOutputTokens=65_536。
 * - Gemma 4（Gemini API 托管）：Thinking 严格二元控制；high=开启、minimal=关闭。
 * - DeepSeek V4：1M 是上下文长度，最大输出为 384K；thinking 用 deepseek-thinking-toggle（thinking.type）。
 * - OpenRouter：仅按其 /api/v1/models 当前明确公布的 supported_parameters / reasoning 元数据登记；
 *   reasoning_effort 复用 openai-reasoning-effort，因为本项目 OpenRouter 通道走 @ai-sdk/openai Chat API。
 * - system 是逻辑路由器，只登记安全的标准参数能力，不绑定 Google/DeepSeek 专属 adapter。
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
  })],
  // Pro：thinkingBudget 范围 128–32_768，官方明确不支持 thinkingBudget=0。
  [buildKey('google-cloudflare', 'gemini-2.5-pro'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(65_536),
    thinking: buildThinking('google-thinking-budget', GEMINI_2_5_BUDGET_EFFORTS, false),
  })],
  [buildKey('system', 'gemini-2.5-pro'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(65_536),
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
    maxOutputTokens: buildMaxOutputTokens(65_536),
    thinking: buildThinking('google-thinking-level', GEMINI_3_FLASH_THINKING_LEVELS, false),
  })],
  [buildKey('system', 'gemini-3.6-flash'), buildCapabilities({
    temperature: { support: 'unsupported' },
    maxOutputTokens: buildMaxOutputTokens(65_536),
  })],
  [buildKey('google-cloudflare', 'gemini-3.5-flash-lite'), buildCapabilities({
    temperature: { support: 'unsupported' },
    maxOutputTokens: buildMaxOutputTokens(65_536),
    thinking: buildThinking('google-thinking-level', GEMINI_3_FLASH_THINKING_LEVELS, false),
  })],
  [buildKey('system', 'gemini-3.5-flash-lite'), buildCapabilities({
    temperature: { support: 'unsupported' },
    maxOutputTokens: buildMaxOutputTokens(65_536),
  })],
  // 3.1 Pro 仍支持 temperature，但 thinkingLevel 仅 low/medium/high，且不能完全关闭。
  [buildKey('google-cloudflare', 'gemini-3.1-pro-preview'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(65_536),
    thinking: buildThinking('google-thinking-level', GEMINI_3_PRO_THINKING_LEVELS, false),
  })],


  // ---- Gemma 4（Gemini API 托管）----
  // Google 明确规定 Gemma 4 Thinking 只有 high=开启 / minimal=关闭两态。
  // 官方公开页未稳定给出 hosted endpoint 的具体 outputTokenLimit / maxTemperature，
  // 因而这里只登记“支持”，不猜测数值上限。
  [buildKey('google-cloudflare', 'gemma-4-31b-it'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE_WITHOUT_KNOWN_MAX,
    maxOutputTokens: buildMaxOutputTokens(),
    thinking: buildThinking('google-thinking-binary-level', GEMMA_4_THINKING_LEVELS),
  })],
  [buildKey('system', 'gemma-4-31b-it'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE_WITHOUT_KNOWN_MAX,
    maxOutputTokens: buildMaxOutputTokens(),
  })],
  [buildKey('google-cloudflare', 'gemma-4-26b-a4b-it'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE_WITHOUT_KNOWN_MAX,
    maxOutputTokens: buildMaxOutputTokens(),
    thinking: buildThinking('google-thinking-binary-level', GEMMA_4_THINKING_LEVELS),
  })],
  [buildKey('system', 'gemma-4-26b-a4b-it'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE_WITHOUT_KNOWN_MAX,
    maxOutputTokens: buildMaxOutputTokens(),
  })],

  // ---- DeepSeek（deepseek-thinking-toggle）----
  [buildKey('system', 'deepseek-v4-flash-0731'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(384_000),
  })],
  [buildKey('system', 'deepseek-v4-pro'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(384_000),
  })],

  // DeepSeek 官方 API canonical modelId；同时保留旧 catalog ID 的能力别名以兼容 UI/localStorage。
  [buildKey('deepseek', 'deepseek-v4-flash'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(384_000),
    thinking: buildThinking('deepseek-thinking-toggle'),
  })],
  [buildKey('deepseek', 'deepseek-v4-flash-0731'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(384_000),
    thinking: buildThinking('deepseek-thinking-toggle'),
  })],
  [buildKey('deepseek', 'deepseek-v4-pro'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(384_000),
    thinking: buildThinking('deepseek-thinking-toggle'),
  })],

  // ---- OpenRouter（2026-08-09 /api/v1/models 快照）----
  // 仅登记当前 catalog 中、且网关明确公布 supported_parameters / reasoning 元数据的组合。
  // OpenRouter 在 Chat Completions 上接受 temperature 0–2；是否可用仍以单模型 supported_parameters 为准。

  // Gemini 3.x：OpenRouter 仍接受 temperature，并通过 reasoning_effort 统一映射 thinkingLevel。
  [buildKey('openrouter', 'google/gemini-3.1-pro-preview'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(65_536),
    thinking: buildThinking('openai-reasoning-effort', GEMINI_3_PRO_THINKING_LEVELS, false),
  })],
  [buildKey('openrouter', 'google/gemini-3.5-flash-lite'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(65_536),
    thinking: buildThinking('openai-reasoning-effort', GEMINI_3_FLASH_THINKING_LEVELS, false),
  })],

  // Gemini 2.5：网关声明支持 temperature / max_tokens / reasoning，
  // 但没有 reasoning_effort，因此当前 adapter 无法可靠控制 Thinking，保持 unknown。
  [buildKey('openrouter', 'google/gemini-2.5-pro'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(65_536),
  })],
  [buildKey('openrouter', 'google/gemini-2.5-flash'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(65_535),
  })],
  [buildKey('openrouter', 'google/gemini-2.5-flash-lite'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(65_535),
  })],

  // GPT 5.4 / 5.5 / 5.6：网关元数据未列 temperature，避免发送；
  // 最大输出均为 128K，且 reasoning_effort 可用 `none` 关闭。
  [buildKey('openrouter', 'openai/gpt-5.4'), buildCapabilities({
    temperature: { support: 'unsupported' },
    maxOutputTokens: buildMaxOutputTokens(128_000),
    thinking: buildThinking('openai-reasoning-effort', OPENROUTER_GPT_5_4_5_5_EFFORTS),
  })],
  [buildKey('openrouter', 'openai/gpt-5.5'), buildCapabilities({
    temperature: { support: 'unsupported' },
    maxOutputTokens: buildMaxOutputTokens(128_000),
    thinking: buildThinking('openai-reasoning-effort', OPENROUTER_GPT_5_4_5_5_EFFORTS),
  })],
  [buildKey('openrouter', 'openai/gpt-5.6-luna'), buildCapabilities({
    temperature: { support: 'unsupported' },
    maxOutputTokens: buildMaxOutputTokens(128_000),
    thinking: buildThinking('openai-reasoning-effort', OPENROUTER_GPT_5_6_EFFORTS),
  })],
  [buildKey('openrouter', 'openai/gpt-5.6-terra'), buildCapabilities({
    temperature: { support: 'unsupported' },
    maxOutputTokens: buildMaxOutputTokens(128_000),
    thinking: buildThinking('openai-reasoning-effort', OPENROUTER_GPT_5_6_EFFORTS),
  })],
  [buildKey('openrouter', 'openai/gpt-5.6-sol'), buildCapabilities({
    temperature: { support: 'unsupported' },
    maxOutputTokens: buildMaxOutputTokens(128_000),
    thinking: buildThinking('openai-reasoning-effort', OPENROUTER_GPT_5_6_EFFORTS),
  })],

  // Claude：网关同时声明 temperature、128K 输出与 reasoning_effort；supported_efforts 不含 none，
  // 因而当前 reasoningEffort adapter 只开放强度，不提供显式关闭。
  [buildKey('openrouter', 'anthropic/claude-opus-4.8'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(128_000),
    thinking: buildThinking('openai-reasoning-effort', OPENROUTER_CLAUDE_OPUS_4_8_EFFORTS, false),
  })],
  [buildKey('openrouter', 'anthropic/claude-sonnet-4.6'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(128_000),
    thinking: buildThinking('openai-reasoning-effort', OPENROUTER_CLAUDE_SONNET_4_6_EFFORTS, false),
  })],

  // Grok 4.5：reasoning 为 mandatory，不能显式关闭；网关未给出 completion 数字上限。
  [buildKey('openrouter', 'x-ai/grok-4.5'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(),
    thinking: buildThinking('openai-reasoning-effort', GEMINI_3_PRO_THINKING_LEVELS, false),
  })],

  // Qwen 3.8 Max：mandatory reasoning，支持 minimal..xhigh，最大输出 131072。
  [buildKey('openrouter', 'qwen/qwen3.8-max'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(131_072),
    thinking: buildThinking('openai-reasoning-effort', OPENROUTER_QWEN_3_8_MAX_EFFORTS, false),
  })],

  // Qwen 3.7 Max / 3.6 Plus：支持 temperature / max_tokens，但没有 reasoning_effort。
  [buildKey('openrouter', 'qwen/qwen3.7-max'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(131_072),
  })],
  [buildKey('openrouter', 'qwen/qwen3.6-plus'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(65_536),
  })],

  // DeepSeek V4：标准参数可确定；Thinking 开启时 temperature 被忽略这一条件语义
  // 当前 capability schema 只在 deepseek-thinking-toggle adapter 上表达，因此 OpenRouter 路径暂不登记 Thinking。
  [buildKey('openrouter', 'deepseek/deepseek-v4-flash'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(393_216),
  })],
  [buildKey('openrouter', 'deepseek/deepseek-v4-flash-0731'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(384_000),
  })],
  [buildKey('openrouter', 'deepseek/deepseek-v4-pro'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(384_000),
  })],

  // Kimi：K3 / K2.x 当前均确认 temperature / max_tokens；只有 K3 暴露 reasoning_effort，
  // 但 K3 的 effort 集合不含 adapter 默认的 medium，先不登记 Thinking，避免 enabled 无 effort 时构造非法请求。
  [buildKey('openrouter', 'moonshotai/kimi-k3'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(),
  })],
  [buildKey('openrouter', 'moonshotai/kimi-k2.7-code'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(262_144),
  })],
  [buildKey('openrouter', 'moonshotai/kimi-k2.6'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(262_144),
  })],

  // MiniMax M3：网关声明 temperature / max_tokens，最大输出 512K；未声明 reasoning_effort。
  [buildKey('openrouter', 'minimax/minimax-m3'), buildCapabilities({
    temperature: SUPPORTED_TEMPERATURE,
    maxOutputTokens: buildMaxOutputTokens(512_000),
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