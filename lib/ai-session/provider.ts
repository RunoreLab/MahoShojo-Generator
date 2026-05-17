import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import type { AIProvider } from '@/lib/config';
import { CustomProviderSchema } from '@/lib/arena/schemas';
import { LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/stream/raw-ai';
import { z } from 'zod/v3';

export type AiSessionCustomProvider = z.infer<typeof CustomProviderSchema>;
export type AiSessionResolvedProvider = {
  providerMode: 'system' | 'custom';
  providerId: string;
  modelId: string | null;
  providerOverride?: AIProvider;
  providerOptions?: GenerateWithAIOptions;
};

export const parseAiSessionCustomProvider = (
  payload: unknown
): { ok: true; value: AiSessionCustomProvider | null } | { ok: false; error: string } => {
  if (payload == null) {
    return { ok: true, value: null };
  }

  const parsed = CustomProviderSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: 'customProvider 无效' };
  }

  return { ok: true, value: parsed.data };
};

export const resolveAiSessionProvider = (
  customProvider: AiSessionCustomProvider | null
): { ok: true; value: AiSessionResolvedProvider } | { ok: false; error: string; status: number } => {
  if (!customProvider || customProvider.providerId.trim() === '') {
    return {
      ok: true,
      value: {
        providerMode: 'system',
        providerId: 'system',
        modelId: null,
      },
    };
  }

  const providerId = customProvider.providerId.trim();
  const modelId = customProvider.modelId.trim();
  const providerConfig = AI_PROVIDER_CATALOG.find((item) => item.id === providerId);
  if (!providerConfig) {
    return { ok: false, error: '未知的模型供应商 ID', status: 400 };
  }

  const modelResolution = resolveAIProviderModel(providerConfig, modelId);
  if (!modelResolution) {
    return { ok: false, error: '未知的模型 ID', status: 400 };
  }

  if (providerId === 'system') {
    return {
      ok: true,
      value: {
        providerMode: 'system',
        providerId: 'system',
        modelId: modelResolution.modelId,
      },
    };
  }

  const apiKey = customProvider.apiKey.trim();
  if (!apiKey) {
    return { ok: false, error: '缺少 API Key', status: 401 };
  }

  const baseUrl = providerConfig.baseUrl?.trim() ?? '';
  if (!baseUrl) {
    return { ok: false, error: '该供应商未配置 baseUrl，无法在自定义通道模式下使用', status: 400 };
  }

  const providerOverride: AIProvider = {
    name: providerConfig.name,
    apiKey,
    baseUrl,
    model: modelResolution.modelId,
    type: providerConfig.type,
    mode: providerConfig.mode || 'auto',
    retryCount: 1,
    skipProbability: 0,
    ...(typeof customProvider.maxOutputTokens === 'number'
      ? { defaultMaxOutputTokens: customProvider.maxOutputTokens }
      : {}),
  };

  return {
    ok: true,
    value: {
      providerMode: 'custom',
      providerId,
      modelId: modelResolution.modelId,
      providerOverride,
      providerOptions: {
        providerOverride,
        loadBalanceStrategy: LoadBalanceStrategy.CUSTOM,
      },
    },
  };
};
