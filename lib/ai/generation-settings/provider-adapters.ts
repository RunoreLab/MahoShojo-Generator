// lib/ai/generation-settings/provider-adapters.ts
// 把统一用户语义（Thinking 档位 / 开关）转换为各 Provider 的最终请求参数。
// UI 只暴露统一档位，绝不暴露 thinkingBudget / reasoningEffort 等 Provider 实现细节。
//
// 各控制机制：
// - google-thinking-budget：Gemini 2.5 系列，用 thinkingBudget（token 数）控制；0 即关闭。
// - google-thinking-level：Gemini 3.x 系列，用 thinkingLevel 控制。
// - openai-reasoning-effort：OpenAI reasoning 模型，用 reasoningEffort；'none' 即关闭。
// - deepseek-thinking-toggle：DeepSeek，用 thinking.type 开关。
//
// 关键语义：对支持显式关闭的模型，“关闭”必须发送关闭参数，而不是不发送（不发送 =
// 模型默认开启 thinking）。

import type { GenerationProviderOptions, ThinkingAdapter, ThinkingEffort } from './types';

export type ThinkingMode = 'default' | 'disabled' | 'enabled';

/** effort → Gemini 2.5 thinkingBudget（token 数），仅作合理估算。 */
const GOOGLE_THINKING_BUDGETS: Record<ThinkingEffort, number> = {
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
  max: 65536,
};

/**
 * 根据控制机制与用户意图生成 AI SDK providerOptions。
 * 返回 undefined 表示无需额外发送（跟随模型默认）。
 */
export const buildThinkingOptions = (
  adapter: ThinkingAdapter,
  mode: ThinkingMode,
  effort?: ThinkingEffort,
): GenerationProviderOptions | undefined => {
  switch (adapter) {
    case 'google-thinking-budget': {
      // Gemini 2.5：默认开启思考并回流 reasoning；disabled 用 thinkingBudget:0 真正关闭。
      if (mode === 'disabled') {
        return { google: { thinkingConfig: { thinkingBudget: 0 } } };
      }
      if (mode === 'enabled') {
        return {
          google: {
            thinkingConfig: {
              includeThoughts: true,
              ...(effort ? { thinkingBudget: GOOGLE_THINKING_BUDGETS[effort] } : {}),
            },
          },
        };
      }
      // default：跟随项目默认回流 reasoning。
      return { google: { thinkingConfig: { includeThoughts: true } } };
    }
    case 'google-thinking-level': {
      // Gemini 3.x：default 回流 reasoning；disabled 用 thinkingLevel:'none' 关闭。
      if (mode === 'disabled') {
        return { google: { thinkingConfig: { thinkingLevel: 'none' } } };
      }
      if (mode === 'enabled') {
        return {
          google: {
            thinkingConfig: {
              includeThoughts: true,
              ...(effort ? { thinkingLevel: effort } : {}),
            },
          },
        };
      }
      return { google: { thinkingConfig: { includeThoughts: true } } };
    }
    case 'openai-reasoning-effort': {
      // OpenAI：'none' 关闭 reasoning；其余为档位。
      if (mode === 'disabled') {
        return { openai: { reasoningEffort: 'none' } };
      }
      if (mode === 'enabled') {
        return { openai: { reasoningEffort: effort ?? 'medium' } };
      }
      return undefined;
    }
    case 'deepseek-thinking-toggle': {
      // DeepSeek：thinking.type 开关。
      if (mode === 'disabled') {
        return { deepseek: { thinking: { type: 'disabled' } } };
      }
      if (mode === 'enabled') {
        return { deepseek: { thinking: { type: 'enabled' } } };
      }
      return undefined;
    }
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