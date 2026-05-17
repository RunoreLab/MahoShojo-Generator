import type { UserAIProviderConfig } from '@/components/AiProviderSelector';

export type CustomProviderPayload = {
  providerId: string;
  modelId: string;
  apiKey: string;
  maxOutputTokens?: number;
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

export const buildCustomProviderPayload = (
  config: UserAIProviderConfig | null | undefined
): CustomProviderPayload | undefined => {
  if (!config) return undefined;
  if (config.modelId === 'default') return undefined;
  if (config.providerId !== 'system' && !config.apiKey?.trim()) return undefined;
  const maxOutputTokens = normalizeCustomProviderMaxOutputTokens(config.maxOutputTokens);
  return {
    providerId: config.providerId,
    modelId: config.modelId,
    apiKey: config.apiKey,
    ...(typeof maxOutputTokens === 'number' ? { maxOutputTokens } : {}),
  };
};
