import type { UserAIProviderConfig } from '@/components/AiProviderSelector';

export type CustomProviderPayload = {
  providerId: string;
  modelId: string;
  apiKey: string;
};

export const isUsingUserProvidedKey = (config: UserAIProviderConfig | null | undefined): boolean =>
  config?.providerId !== 'system' && Boolean(config?.apiKey?.trim());

export const buildCustomProviderPayload = (
  config: UserAIProviderConfig | null | undefined
): CustomProviderPayload | undefined => {
  if (!config) return undefined;
  if (config.modelId === 'default') return undefined;
  if (config.providerId !== 'system' && !config.apiKey?.trim()) return undefined;
  return { providerId: config.providerId, modelId: config.modelId, apiKey: config.apiKey };
};

