import type { AIProvider } from './types';
import { parseHostedApiDeploymentTarget } from '@mahoshojo/hosted-api/deployment-target';

const hasNonEmptyText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const hasValidModel = (model: AIProvider['model']): boolean =>
  typeof model === 'string'
    ? model.trim().length > 0
    : Array.isArray(model) && model.some(hasNonEmptyText);

const safeBaseUrl = (
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
): string | null => {
  if (!hasNonEmptyText(value)) return null;
  try {
    const url = new URL(value.trim());
    const deploymentTarget = parseHostedApiDeploymentTarget(env.HOSTED_API_ENVIRONMENT);
    const localHttp = (deploymentTarget === 'local' || deploymentTarget === 'test')
      && url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !localHttp)
      || url.username
      || url.password
      || url.search
      || url.hash
    ) return null;
    const allowedOrigins = (env.AI_PROVIDER_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (allowedOrigins.length > 0 && !allowedOrigins.includes(url.origin)) return null;
    return url.toString().replace(/\/$/u, '');
  } catch {
    return null;
  }
};

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
            && safeBaseUrl(provider.baseUrl, env) !== null
            && hasNonEmptyText(provider.type)
            && (hasNonEmptyText(provider.apiKey) || canBeAnonymous);
        })
        .map((provider) => ({
          ...provider,
          baseUrl: safeBaseUrl(provider.baseUrl, env)!,
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
  const normalizedBaseUrl = safeBaseUrl(baseUrl, env);
  if (!normalizedBaseUrl) return [];
  return [{
    name: 'default_provider',
    apiKey,
    baseUrl: normalizedBaseUrl,
    model: env.AI_MODEL || 'gemini-2.0-flash',
    type: normalizedBaseUrl.includes('googleapis.com') ? 'google' : 'openai',
    retryCount: 1,
    skipProbability: 0,
  }];
};
