// 选择器的宿主无关解析与持久化逻辑。
//
// 这些函数从 `apps/web/components/AiProviderSelector.tsx` 逐语义抽出：存储 key 形状、
// 旧 `maxOutputTokens` key 的迁移、模型选择回退链、provider 级可用性聚合全部保持
// 原语义不变；差别只是 `window.localStorage` 换成注入的 `AiProviderStoragePort`。

import {
  CUSTOM_AI_MODEL_OPTION_VALUE,
  canUseCustomModelId,
  type AIProviderOption,
} from '@mahoshojo/ai-core/provider-catalog';
import {
  UserGenerationOverridesSchema,
  normalizeCustomProviderMaxOutputTokens,
  type UserGenerationOverrides,
} from '@mahoshojo/ai-core/generation-settings';

import type { AiChannelAvailabilityEntry, AiProviderStoragePort } from './contract';

/** 选择器在宿主 KV 里的 key 布局；`storageNamespace` 保持原 `arena.customProvider` 等约定。 */
export interface AiProviderStorageKeys {
  selectedProvider: string;
  apiKeyPrefix: string;
  modelPrefix: string;
  customModelPrefix: string;
  maxOutputTokensPrefix: string;
  generationOverridesPrefix: string;
}

export const createAiProviderStorageKeys = (storageNamespace: string): AiProviderStorageKeys => ({
  selectedProvider: `${storageNamespace}.selected`,
  apiKeyPrefix: `${storageNamespace}.apiKey.`,
  modelPrefix: `${storageNamespace}.model.`,
  customModelPrefix: `${storageNamespace}.customModel.`,
  maxOutputTokensPrefix: `${storageNamespace}.maxOutputTokens.`,
  generationOverridesPrefix: `${storageNamespace}.generationOverrides.`,
});

export const getApiKeyStorageKey = (keys: AiProviderStorageKeys, providerId: string): string =>
  `${keys.apiKeyPrefix}${providerId}`;
export const getModelStorageKey = (keys: AiProviderStorageKeys, providerId: string): string =>
  `${keys.modelPrefix}${providerId}`;
export const getCustomModelStorageKey = (keys: AiProviderStorageKeys, providerId: string): string =>
  `${keys.customModelPrefix}${providerId}`;
export const getMaxOutputTokensStorageKey = (keys: AiProviderStorageKeys, providerId: string): string =>
  `${keys.maxOutputTokensPrefix}${providerId}`;
export const getGenerationOverridesKey = (
  keys: AiProviderStorageKeys,
  providerId: string,
  modelId: string,
): string => `${keys.generationOverridesPrefix}${providerId}.${modelId}`;

export interface ModelSelectionResolution {
  selectedModel: string;
  customModelId: string;
}

/**
 * 把持久化的 (model, customModelId) 解析成当前选择。
 * 回退链与旧组件一致：custom 标记 → 目录命中 → 未收录 modelId 折成自定义 → provider 默认。
 */
export const resolveModelSelection = (
  provider: AIProviderOption,
  storedModel: string,
  storedCustomModelId: string,
): ModelSelectionResolution => {
  const defaultModel = provider.models[0]?.value || '';
  const normalizedModel = storedModel.trim();
  const normalizedCustomModelId = storedCustomModelId.trim();

  if (normalizedModel === CUSTOM_AI_MODEL_OPTION_VALUE && canUseCustomModelId(provider)) {
    return {
      selectedModel: CUSTOM_AI_MODEL_OPTION_VALUE,
      customModelId: normalizedCustomModelId,
    };
  }

  if (provider.models.some((model) => model.value === normalizedModel)) {
    return {
      selectedModel: normalizedModel,
      customModelId: normalizedCustomModelId,
    };
  }

  if (normalizedModel && canUseCustomModelId(provider)) {
    return {
      selectedModel: CUSTOM_AI_MODEL_OPTION_VALUE,
      customModelId: normalizedModel,
    };
  }

  return {
    selectedModel: defaultModel,
    customModelId: normalizedCustomModelId,
  };
};

/** 当前生效的 modelId（自定义模式取手填值）。 */
export const resolveEffectiveModelId = (
  provider: AIProviderOption,
  selectedModel: string,
  customModelId: string,
): string =>
  selectedModel === CUSTOM_AI_MODEL_OPTION_VALUE
    ? customModelId.trim()
    : selectedModel || provider.models[0]?.value || '';

/** 生成覆盖的按 (provider, model) 维度 key，供 emit 门控复用同一表达。 */
export const buildGenerationOverridesScopeKey = (providerId: string, modelId: string): string =>
  `${providerId}::${modelId}`;

export interface ReadGenerationOverridesResult {
  overrides: UserGenerationOverrides | undefined;
  migrated: boolean;
}

/**
 * 读取某 provider+model 的生成覆盖：优先新 key，兼容读取旧 provider 级 maxOutputTokens 并回写。
 * 存储不可用 / JSON 非法 / schema 不符一律按「无覆盖」处理，损坏缓存会被移除避免反复复活。
 */
export const readGenerationOverrides = (
  storage: AiProviderStoragePort,
  keys: AiProviderStorageKeys,
  providerId: string,
  modelId: string,
): ReadGenerationOverridesResult => {
  try {
    const newKey = getGenerationOverridesKey(keys, providerId, modelId);
    const stored = storage.getItem(newKey);
    if (stored) {
      try {
        const parsed = UserGenerationOverridesSchema.safeParse(JSON.parse(stored));
        if (parsed.success) {
          return { overrides: parsed.data, migrated: false };
        }
      } catch {
        // 非法 JSON，同样按损坏缓存处理
      }
      // 合法 JSON 但不符合当前 schema 也视为损坏缓存，避免非法值反复复活并最终导致服务端 400。
      storage.removeItem(newKey);
    }
    const legacy = storage.getItem(getMaxOutputTokensStorageKey(keys, providerId));
    if (legacy) {
      const parsed = normalizeCustomProviderMaxOutputTokens(Number(legacy));
      if (typeof parsed === 'number') {
        const overrides: UserGenerationOverrides = { maxOutputTokens: parsed };
        storage.setItem(newKey, JSON.stringify(overrides));
        // 迁移成功后立即删除旧 key，避免“恢复默认”后旧值复活、或传播到其他模型。
        storage.removeItem(getMaxOutputTokensStorageKey(keys, providerId));
        return { overrides, migrated: true };
      }
    }
    return { overrides: undefined, migrated: false };
  } catch {
    return { overrides: undefined, migrated: false };
  }
};

/** 保存某 provider+model 的生成覆盖；空覆盖删除 key。 */
export const writeGenerationOverrides = (
  storage: AiProviderStoragePort,
  keys: AiProviderStorageKeys,
  providerId: string,
  modelId: string,
  overrides: UserGenerationOverrides | undefined,
): void => {
  try {
    const newKey = getGenerationOverridesKey(keys, providerId, modelId);
    if (
      overrides &&
      (typeof overrides.maxOutputTokens === 'number' ||
        typeof overrides.temperature === 'number' ||
        overrides.thinking)
    ) {
      storage.setItem(newKey, JSON.stringify(overrides));
    } else {
      storage.removeItem(newKey);
    }
  } catch {
    // 存储不可用时忽略（与旧组件语义一致）
  }
};

/**
 * 把一个 provider 下所有已知模型的可用性聚合为单条 provider 徽章条目。
 * 与旧组件一致：优先 1h 数据，无则回退 24h reference；无任何数据时给出 unknown 占位。
 */
export const summarizeProviderAvailability = (
  provider: AIProviderOption,
  availabilityMap: ReadonlyMap<string, AiChannelAvailabilityEntry>,
): AiChannelAvailabilityEntry | undefined => {
  const entries = provider.models
    .map((model) => availabilityMap.get(`${provider.id}:${model.value}`))
    .filter((entry): entry is AiChannelAvailabilityEntry => entry !== undefined);

  if (entries.length === 0) return undefined;

  let rateSum = 0;
  let rateCount = 0;
  let hasAnyRate = false;

  for (const entry of entries) {
    // 优先取 1h 数据，无则回退 24h reference
    const rate = entry.primary.successRate ?? entry.reference?.successRate ?? null;
    if (rate !== null) {
      rateSum += rate;
      rateCount++;
      hasAnyRate = true;
    }
  }

  if (!hasAnyRate) {
    return {
      providerId: provider.id,
      modelId: '',
      primary: { window: 'none', successRate: null, status: 'unknown' },
    };
  }

  const avgRate = rateSum / rateCount;
  const status: AiChannelAvailabilityEntry['primary']['status'] =
    avgRate >= 0.9 ? 'healthy' : avgRate >= 0.7 ? 'degraded' : 'poor';
  return {
    providerId: provider.id,
    modelId: '',
    primary: { window: '1h', successRate: avgRate, status },
  };
};
