// Thinking 档位的可读标签。
// 仅用于日志 / 诊断 / UI 展示：把统一档位映射为中文可读标签。
// 历史上住在 hosted-runtime 的 provider-adapters.ts，D5.0b 起 UI 也要用同一份标签，
// 权威定义上移到这里；hosted-runtime 继续 re-export 保持旧导入路径可用。

import type { ThinkingEffort } from './types';

/** 仅用于日志 / 诊断 / UI：把档位映射为可读标签。 */
export const THINKING_EFFORT_LABELS: Record<ThinkingEffort, string> = {
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
};
