import type { UserGenerationOverrides } from '@/lib/ai/generation-settings/types';

export interface UserAIProviderConfig {
  providerId: string;
  modelId: string;
  apiKey: string;
  maxOutputTokens?: number;
  generationOverrides?: UserGenerationOverrides;
}

export type CustomProviderPayload = {
  providerId: string;
  modelId: string;
  apiKey: string;
  maxOutputTokens?: number;
  generationOverrides?: UserGenerationOverrides;
};

export const isUsingUserProvidedKey = (config: UserAIProviderConfig | null | undefined): boolean =>
  config?.providerId !== 'system' && Boolean(config?.apiKey?.trim());

export const MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS = 1_000_000;

export const normalizeCustomProviderMaxOutputTokens = (value: unknown): number | undefined => {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value)) return undefined;
  if (value <= 0 || value > MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS) return undefined;
  return value;
};

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
