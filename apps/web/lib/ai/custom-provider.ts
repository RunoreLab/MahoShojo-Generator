import {
  MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS,
  normalizeCustomProviderMaxOutputTokens,
  type UserAIProviderConfig,
} from '@mahoshojo/ai-core/generation-settings';
import type { UserGenerationOverrides } from '@/lib/ai/generation-settings/types';

// `UserAIProviderConfig` 与 normalize/上限常量的权威定义已上移到 ai-core
// （D5.0b 共源：Desktop 与同一份选择器逻辑共用）；这里保留 re-export 兼容既有导入。
export { MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS, normalizeCustomProviderMaxOutputTokens };
export type { UserAIProviderConfig } from '@mahoshojo/ai-core/generation-settings';

export type CustomProviderPayload = {
  providerId: string;
  modelId: string;
  apiKey: string;
  maxOutputTokens?: number;
  generationOverrides?: UserGenerationOverrides;
};

export const isUsingUserProvidedKey = (config: UserAIProviderConfig | null | undefined): boolean =>
  config?.providerId !== 'system' && Boolean(config?.apiKey?.trim());

export const isDeepSeekV4Model = (modelId: string | null | undefined): boolean => {
  const normalized = modelId?.trim();
  if (!normalized) return false;
  return /(?:^|[\/])deepseek[-_]v4[-_]/i.test(normalized);
};

/**
 * 是否存在有意义的生成覆盖项。
 * 空的 generationOverrides（{}）不算，避免为 system/default 发送无意义的 payload。
 */
const hasMeaningfulGenerationOverrides = (
  overrides: UserGenerationOverrides | undefined,
): boolean => {
  if (!overrides) return false;
  if (typeof overrides.maxOutputTokens === 'number') return true;
  if (typeof overrides.temperature === 'number') return true;
  if (overrides.thinking) return true;
  return false;
};

export const buildCustomProviderPayload = (
  config: UserAIProviderConfig | null | undefined
): CustomProviderPayload | undefined => {
  if (!config) return undefined;
  const isSystemDefault = config.providerId === 'system' && config.modelId === 'default';
  if (config.providerId !== 'system' && config.modelId === 'default') return undefined;
  if (config.providerId !== 'system' && !config.apiKey?.trim()) return undefined;
  // system/default 仅在没有自定义生成覆盖时折叠；否则仍发 payload，让 Resolver 应用覆盖项。
  if (isSystemDefault) {
    const hasLegacyMax =
      typeof normalizeCustomProviderMaxOutputTokens(config.maxOutputTokens) === 'number';
    if (!hasMeaningfulGenerationOverrides(config.generationOverrides) && !hasLegacyMax) {
      return undefined;
    }
  }
  const maxOutputTokens = normalizeCustomProviderMaxOutputTokens(config.maxOutputTokens);
  return {
    providerId: config.providerId,
    modelId: config.modelId,
    apiKey: config.apiKey,
    ...(typeof maxOutputTokens === 'number' ? { maxOutputTokens } : {}),
    ...(config.generationOverrides ? { generationOverrides: config.generationOverrides } : {}),
  };
};

export const buildCustomProviderRequestPayload = (
  config: UserAIProviderConfig | null | undefined
): CustomProviderPayload | undefined => {
  const payload = buildCustomProviderPayload(config);
  if (!payload) return undefined;
  return {
    ...payload,
    apiKey: payload.apiKey.trim(),
  };
};
