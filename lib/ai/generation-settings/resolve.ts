// lib/ai/generation-settings/resolve.ts
// 统一生成参数解析：用户覆盖 → 任务默认 → Provider 默认 → 模型能力过滤 → 最终请求参数。
//
// 规则：
// - 已知模型 unsupported：不发送（避免 400），并由 diagnostics.omitted 说明。
// - 未知模型 unknown：开放，用户显式设置的参数尝试发送；错误由上游原样透传，禁止静默删除重试。
// - 最终请求通过 spread 展开，未发送的参数以 undefined 省略，绝不发送 `temperature: undefined`。

import { getModelGenerationCapabilities } from './model-capabilities';
import { buildThinkingOptions } from './provider-adapters';
import type {
  GenerationProviderDefaults,
  GenerationTaskDefaults,
  GenerationProviderOptions,
  ResolvedGenerationSettings,
  UserGenerationOverrides,
} from './types';

const clamp = (value: number, min?: number, max?: number): number => {
  let result = value;
  if (typeof min === 'number' && result < min) result = min;
  if (typeof max === 'number' && result > max) result = max;
  return result;
};

const sanitizeMaxOutputTokens = (value: number | undefined): number | undefined => {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value)) return undefined;
  if (value <= 0) return undefined;
  return value;
};

export interface ResolveGenerationSettingsInput {
  providerId: string;
  modelId: string;
  taskDefaults?: GenerationTaskDefaults;
  providerDefaults?: GenerationProviderDefaults;
  userOverrides?: UserGenerationOverrides;
}

export const resolveGenerationSettings = (
  input: ResolveGenerationSettingsInput,
): ResolvedGenerationSettings => {
  const { providerId, modelId, taskDefaults, providerDefaults, userOverrides } = input;

  const capabilities = getModelGenerationCapabilities(providerId, modelId);
  const omitted: ResolvedGenerationSettings['diagnostics']['omitted'] = [];
  const warnings: string[] = [];

  const standardOptions: ResolvedGenerationSettings['standardOptions'] = {};
  let providerOptions: GenerationProviderOptions | undefined;

  const thinkingOverride = userOverrides?.thinking;
  const thinkingCapability = capabilities.thinking;
  const thinkingMode: 'default' | 'disabled' | 'enabled' = thinkingOverride?.mode ?? 'default';
  const deepSeekThinkingActive =
    thinkingCapability.adapter === 'deepseek-thinking-toggle' && thinkingMode !== 'disabled';

  // ---- Temperature ----
  const hasUserTemperatureOverride = typeof userOverrides?.temperature === 'number';
  const temperatureCandidate = hasUserTemperatureOverride
    ? userOverrides.temperature
    : taskDefaults?.temperature;
  if (typeof temperatureCandidate === 'number') {
    if (capabilities.temperature.support === 'unsupported') {
      omitted.push({ field: 'temperature', reason: 'unsupported' });
    } else if (capabilities.temperature.support === 'unknown' && !hasUserTemperatureOverride) {
      // 未知模型不自动继承任务默认 temperature；仅用户显式设置时开放尝试发送，
      // 避免新模型因不再接受 sampling 参数而直接返回 400。
    } else if (deepSeekThinkingActive) {
      // DeepSeek 官方说明：Thinking 模式下 temperature 会被接受但不生效。
      omitted.push({ field: 'temperature', reason: 'ignored-in-thinking-mode' });
    } else {
      standardOptions.temperature = clamp(
        temperatureCandidate,
        capabilities.temperature.min,
        capabilities.temperature.max,
      );
    }
  }

  // ---- Max Output Tokens ----
  const maxOutputTokensCandidate = sanitizeMaxOutputTokens(
    userOverrides?.maxOutputTokens ??
      taskDefaults?.maxOutputTokens ??
      providerDefaults?.defaultMaxOutputTokens,
  );
  if (typeof maxOutputTokensCandidate === 'number') {
    if (capabilities.maxOutputTokens.support === 'unsupported') {
      omitted.push({ field: 'maxOutputTokens', reason: 'unsupported' });
    } else {
      standardOptions.maxOutputTokens = clamp(
        maxOutputTokensCandidate,
        undefined,
        capabilities.maxOutputTokens.max,
      );
    }
  }

  // ---- Thinking ----
  // 语义：
  // - mode 'disabled'：显式关闭。对支持显式关闭的模型（Gemini budget / OpenAI none / DeepSeek toggle）
  //   发送关闭参数，而不是“不发送”（不发送 = 模型默认开启）。
  // - mode 'default'（或未设置）：跟随模型默认。对 Google 项目默认开启思考并回流 reasoning。
  // - mode 'enabled'：显式开启，发送档位参数。
  if (thinkingCapability.support === 'unsupported') {
    if (thinkingOverride && thinkingOverride.mode !== 'default') {
      omitted.push({ field: 'thinking', reason: 'unsupported' });
    }
  } else if (thinkingCapability.support === 'supported') {
    const effort = thinkingOverride?.mode === 'enabled' ? thinkingOverride.effort : undefined;
    if (thinkingMode === 'disabled' && thinkingCapability.canDisable === false) {
      omitted.push({ field: 'thinking', reason: 'cannot-disable' });
    } else {
      let effectiveEffort = effort;
      if (
        thinkingMode === 'enabled' &&
        effort &&
        thinkingCapability.efforts &&
        !thinkingCapability.efforts.includes(effort)
      ) {
        warnings.push(`模型 ${modelId} 不支持 thinking 档位 ${effort}，已忽略强度设置`);
        effectiveEffort = undefined;
      }
      const options = buildThinkingOptions(
        thinkingCapability.adapter ?? 'unknown',
        thinkingMode,
        effectiveEffort,
      );
      if (options) {
        providerOptions = { ...(providerOptions ?? {}), ...options };
      }
    }
  } else {
    // support === 'unknown'：无法确定参数格式，不发送 thinking 参数（不可控）。
  }

  return {
    standardOptions,
    ...(providerOptions ? { providerOptions } : {}),
    diagnostics: { omitted, warnings },
  };
};