import type { AIProvider } from './types';

const hasNonEmptyText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const hasValidModel = (model: AIProvider['model']): boolean =>
  typeof model === 'string'
    ? model.trim().length > 0
    : Array.isArray(model) && model.some(hasNonEmptyText);

export const parseAIProvidersFromEnv = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): AIProvider[] => {
  if (env.AI_PROVIDERS_CONFIG) {
    try {
      const providers = JSON.parse(env.AI_PROVIDERS_CONFIG) as AIProvider[];
      return providers
        .filter((provider) => {
          const canBeAnonymous = provider.allowAnonymous === true && provider.type === 'openai';
          return hasValidModel(provider.model)
            && hasNonEmptyText(provider.baseUrl)
            && hasNonEmptyText(provider.type)
            && (hasNonEmptyText(provider.apiKey) || canBeAnonymous);
        })
        .map((provider) => ({
          ...provider,
          retryCount: provider.retryCount ?? 1,
          skipProbability: provider.skipProbability ?? 0,
        }));
    } catch {
      // Legacy fallback below deliberately avoids logging the env payload.
    }
  }

  const apiKey = env.AI_API_KEY;
  if (!apiKey) return [];
  const baseUrl = env.AI_BASE_URL || 'https://api.openai.com/v1';
  return [{
    name: 'default_provider',
    apiKey,
    baseUrl,
    model: env.AI_MODEL || 'gemini-2.0-flash',
    type: baseUrl.includes('googleapis.com') ? 'google' : 'openai',
    retryCount: 1,
    skipProbability: 0,
  }];
};
