import type { CustomProviderRequest } from '@mahoshojo/hosted-api/regular-generation';

export type CustomProviderMode = 'system' | 'custom';

export type CustomProviderCatalogEntry = {
  id: string;
  name: string;
  baseUrl?: string;
  type: 'openai' | 'google' | 'deepseek';
  mode?: 'json' | 'auto' | 'tool';
};

export type CustomProviderModelResolution = {
  modelId: string;
};

export interface CustomProviderRuntimeDependencies {
  findProvider(_providerId: string): CustomProviderCatalogEntry | null;
  resolveModel(
    _provider: CustomProviderCatalogEntry,
    _modelId: string,
  ): CustomProviderModelResolution | null;
}

export type RuntimeProviderOverride = {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  type: CustomProviderCatalogEntry['type'];
  mode: NonNullable<CustomProviderCatalogEntry['mode']>;
  retryCount: number;
  skipProbability: number;
  defaultMaxOutputTokens?: number;
  providerId: string;
  generationOverrides?: CustomProviderRequest['generationOverrides'];
};

export type CustomProviderRuntimeOptions = {
  channelContext: {
    providerId: string;
    modelId: string;
  };
  loadBalanceStrategy?: 'sequential';
  providerOverride?: RuntimeProviderOverride;
  generationSettingsContext?: {
    providerId: string;
    userOverrides?: CustomProviderRequest['generationOverrides'];
  };
};

export type CustomProviderRuntimeResult =
  | { options: CustomProviderRuntimeOptions; response?: undefined }
  | { options?: undefined; response: Response };

export const inferCustomProviderMode = (payload: unknown): CustomProviderMode => {
  if (!payload || typeof payload !== 'object') return 'system';
  const providerId = typeof (payload as { providerId?: unknown }).providerId === 'string'
    ? (payload as { providerId: string }).providerId.trim()
    : '';
  return providerId && providerId !== 'system' ? 'custom' : 'system';
};

const errorResponse = (error: string): Response => new Response(
  JSON.stringify({ error }),
  { status: 400 },
);

export const resolveCustomProviderRuntime = (
  payload: CustomProviderRequest | undefined,
  dependencies: CustomProviderRuntimeDependencies,
): CustomProviderRuntimeResult => {
  if (!payload) {
    return {
      options: {
        channelContext: { providerId: 'system', modelId: 'default' },
      },
    };
  }

  const provider = dependencies.findProvider(payload.providerId);
  if (!provider) {
    return { response: errorResponse('未知的模型供应商 ID') };
  }

  const modelResolution = dependencies.resolveModel(provider, payload.modelId);
  if (!modelResolution) {
    return { response: errorResponse('未知的模型 ID') };
  }

  const apiKey = payload.apiKey.trim();
  if (!apiKey && provider.id !== 'system') {
    return { response: errorResponse('API Key 不能为空') };
  }

  const generationSettingsContext: NonNullable<
    CustomProviderRuntimeOptions['generationSettingsContext']
  > = {
    providerId: payload.providerId,
    ...(payload.generationOverrides
      ? { userOverrides: payload.generationOverrides }
      : {}),
  };
  const baseUrl = provider.baseUrl?.trim() ?? '';
  if (!baseUrl) {
    return {
      options: {
        channelContext: {
          providerId: payload.providerId,
          modelId: modelResolution.modelId === 'default'
            ? payload.modelId
            : modelResolution.modelId,
        },
        generationSettingsContext,
      },
    };
  }

  return {
    options: {
      // 可用性统计延续 legacy channel identity；Provider override 单独使用 canonical model。
      channelContext: {
        providerId: payload.providerId,
        modelId: payload.modelId,
      },
      loadBalanceStrategy: 'sequential',
      providerOverride: {
        name: provider.name,
        apiKey,
        baseUrl,
        model: modelResolution.modelId,
        type: provider.type,
        mode: provider.mode || 'auto',
        retryCount: 1,
        skipProbability: 0,
        ...(typeof payload.maxOutputTokens === 'number'
          ? { defaultMaxOutputTokens: payload.maxOutputTokens }
          : {}),
        providerId: payload.providerId,
        ...(payload.generationOverrides
          ? { generationOverrides: payload.generationOverrides }
          : {}),
      },
      generationSettingsContext,
    },
  };
};
