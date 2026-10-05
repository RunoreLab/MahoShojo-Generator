// 用户 AI 配置选择的公共形状。
//
// `UserAIProviderConfig` 同时是共源选择器（`@mahoshojo/ui-web/ai-provider`）的输出形状与
// Web BYOK 请求 payload 的输入形状；字段名与可选性是既有 wire/UI 兼容面的一部分。
//
// `apiKey` 是明文 BYOK 字段：它只在用户自己的宿主里流转（Web 浏览器 localStorage →
// 转发请求体；Desktop 侧不经过本类型传递，凭据始终走 OS secret store，见 DESK-ONLINE-003）。

import type { UserGenerationOverrides } from './types';

export interface UserAIProviderConfig {
  providerId: string;
  modelId: string;
  apiKey: string;
  maxOutputTokens?: number;
  generationOverrides?: UserGenerationOverrides;
}

export const MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS = 1_000_000;

export const normalizeCustomProviderMaxOutputTokens = (value: unknown): number | undefined => {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value)) return undefined;
  if (value <= 0 || value > MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS) return undefined;
  return value;
};
