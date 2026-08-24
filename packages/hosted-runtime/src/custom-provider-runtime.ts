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
  loadBalanceStrategy?: 'sequential' | 'custom';
  providerOverride?: RuntimeProviderOverride;
  generationSettingsContext?: {
    providerId: string;
    userOverrides?: CustomProviderRequest['generationOverrides'];
  };
};

export type CustomProviderRuntimeResult =
  | {
    options: CustomProviderRuntimeOptions;
    modelOverride?: string;
    response?: undefined;
  }
  | { options?: undefined; response: Response };

export type CustomProviderRuntimePolicy = {
  /**
   * 默认保持新 runtime 已审计的 sequential 行为；legacy composition
   * 必须显式选择 custom，避免自定义通道失败后轮询系统 Provider。
   */
  nonSystemLoadBalanceStrategy?: 'sequential' | 'custom';
  /** Legacy composition 会把空 baseUrl 的 canonical model 放入 generation config。 */
  exposeEmptyBaseUrlModelOverride?: boolean;
  /** 兼容入口用于恢复空 baseUrl 回落系统通道的结构化可观测事件。 */
  onEmptyBaseUrl?(_input: { providerId: string; model: string }): void;
};

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
  policy: CustomProviderRuntimePolicy = {},
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
  const nonSystemLoadBalanceStrategy = provider.id !== 'system'
    ? policy.nonSystemLoadBalanceStrategy
    : undefined;
  const baseUrl = provider.baseUrl?.trim() ?? '';
  if (!baseUrl) {
    policy.onEmptyBaseUrl?.({
      providerId: provider.id,
      model: modelResolution.modelId,
    });
    return {
      options: {
        channelContext: {
          providerId: payload.providerId,
          modelId: modelResolution.modelId === 'default'
            ? payload.modelId
            : modelResolution.modelId,
        },
        ...(nonSystemLoadBalanceStrategy
          ? { loadBalanceStrategy: nonSystemLoadBalanceStrategy }
          : {}),
        generationSettingsContext,
      },
      ...(policy.exposeEmptyBaseUrlModelOverride
        && modelResolution.modelId !== 'default'
        ? { modelOverride: modelResolution.modelId }
        : {}),
    };
  }

  return {
    options: {
      // 可用性统计延续 legacy channel identity；Provider override 单独使用 canonical model。
      channelContext: {
        providerId: payload.providerId,
        modelId: payload.modelId,
      },
      loadBalanceStrategy: nonSystemLoadBalanceStrategy ?? 'sequential',
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
