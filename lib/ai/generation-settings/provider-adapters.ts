// lib/ai/generation-settings/provider-adapters.ts
// 把统一用户语义（Thinking 档位）转换为各 Provider 的最终请求参数。
// UI 只暴露统一档位，绝不暴露 reasoning_effort / thinkingLevel 等 Provider 实现细节。

import type { ThinkingAdapter, ThinkingEffort } from './types';

/**
 * Google Gemini 的 thinking 参数。
 * 默认开启思考（includeThoughts），用户可附加档位（thinkingLevel）。
 */
export const buildGoogleThinkingOptions = (
  effort?: ThinkingEffort,
): Record<string, unknown> => ({
  google: {
    thinkingConfig: {
      includeThoughts: true,
      ...(effort ? { thinkingLevel: effort } : {}),
    },
  },
});

/**
 * 将统一 thinking 档位转换为 AI SDK 的 providerOptions。
 * 返回 undefined 表示该档位 / 适配器无法映射（不发送）。
 */
export const buildThinkingProviderOptions = (
  adapter: ThinkingAdapter,
  effort?: ThinkingEffort,
): Record<string, unknown> | undefined => {
  if (!effort) {
    // 开启 thinking 但未指定强度：交给模型默认。
    return undefined;
  }

  switch (adapter) {
    case 'google':
      return buildGoogleThinkingOptions(effort);
    case 'openai':
      return { openai: { reasoningEffort: effort } };
    case 'deepseek':
      return { deepseek: { reasoningEffort: effort } };
    case 'unknown':
    default:
      return undefined;
  }
};

/** 仅用于日志 / 诊断：把档位映射为可读标签。 */
export const THINKING_EFFORT_LABELS: Record<ThinkingEffort, string> = {
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
};