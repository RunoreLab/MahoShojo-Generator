// 受控选择逻辑：把 `AiProviderSelector` 的全部状态机抽成宿主无关 hook。
//
// 语义与原组件逐条对应：先 hydration，再监听外部同步事件，再按 provider 载入
// provider 级值，再按 provider+model 载入生成覆盖，emit 只在覆盖加载完成后进行。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  AI_PROVIDER_CATALOG,
  CUSTOM_AI_MODEL_OPTION_VALUE,
  type AIProviderOption,
} from '@mahoshojo/ai-core/provider-catalog';
import {
  getModelGenerationCapabilities,
  normalizeCustomProviderMaxOutputTokens,
  type ModelGenerationCapabilities,
  type UserAIProviderConfig,
  type UserGenerationOverrides,
} from '@mahoshojo/ai-core/generation-settings';

import type {
  AiChannelAvailabilityEntry,
  AiProviderStoragePort,
  AiProviderSyncDetail,
} from './contract';
import { maskApiKeyForDisplay } from './mask-api-key';
import {
  buildGenerationOverridesScopeKey,
  createAiProviderStorageKeys,
  getApiKeyStorageKey,
  getCustomModelStorageKey,
  getModelStorageKey,
  readGenerationOverrides,
  resolveEffectiveModelId,
  resolveModelSelection,
  writeGenerationOverrides,
} from './selection';

export const DEFAULT_AI_PROVIDER_STORAGE_NAMESPACE = 'arena.customProvider';

export interface UseAiProviderSelectionOptions {
  /** 宿主持久化端口；必填（本包不假设 localStorage 存在）。 */
  storage: AiProviderStoragePort;
  storageNamespace?: string;
  /** 可选 catalog 覆盖；缺省为 `AI_PROVIDER_CATALOG`。 */
  providers?: readonly AIProviderOption[];
  allowSystemProvider?: boolean;
  /** 生效配置变化时回调；`null` 表示无有效 provider。 */
  onConfigChange?: (config: UserAIProviderConfig | null) => void;
  /**
   * 订阅跨实例同步事件（Web 用 `window` CustomEvent 实现）。
   * 缺省则不订阅；返回的取消函数会在卸载时调用。
   */
  subscribeSync?: (handler: (detail: AiProviderSyncDetail) => void) => (() => void) | void;
  /**
   * 渠道可用性加载器（宿主注入）；缺省则选择器不渲染可用性徽章。
   * 静默失败由宿主负责（hook 内只对结果为空做容错）。
   */
  loadChannelAvailability?: () => Promise<readonly AiChannelAvailabilityEntry[] | null | undefined>;
}

export interface AiProviderSelectionState {
  providerOptions: readonly AIProviderOption[];
  selectedProviderId: string;
  selectedModel: string;
  customModelId: string;
  apiKey: string;
  generationOverrides: UserGenerationOverrides | undefined;
  isEditingApiKey: boolean;
  isHydrated: boolean;
  availabilityMap: ReadonlyMap<string, AiChannelAvailabilityEntry>;
  activeProvider: AIProviderOption | null;
  activeCapabilities: ModelGenerationCapabilities | undefined;
  hasApiKey: boolean;
  maskedApiKey: string;
  shouldShowMaskedApiKey: boolean;
  isCustomModelSelected: boolean;
  setSelectedProviderId: (providerId: string) => void;
  setSelectedModel: (modelId: string) => void;
  setCustomModelId: (modelId: string) => void;
  setApiKey: (apiKey: string) => void;
  setIsEditingApiKey: (editing: boolean) => void;
  /** 用户主动修改高级设置：只写当前 provider+model 的 key，并立即 emit。 */
  updateGenerationOverrides: (next: UserGenerationOverrides | undefined) => void;
}

export const useAiProviderSelection = (
  options: UseAiProviderSelectionOptions,
): AiProviderSelectionState => {
  const {
    storage,
    storageNamespace = DEFAULT_AI_PROVIDER_STORAGE_NAMESPACE,
    providers,
    allowSystemProvider = true,
    onConfigChange,
    subscribeSync,
    loadChannelAvailability,
  } = options;

  const storageKeys = useMemo(() => createAiProviderStorageKeys(storageNamespace), [storageNamespace]);

  const providerOptions = useMemo<readonly AIProviderOption[]>(() => {
    const optionsList = providers ?? AI_PROVIDER_CATALOG;
    if (allowSystemProvider) return optionsList;
    return optionsList.filter((item) => item.id !== 'system');
  }, [allowSystemProvider, providers]);

  const defaultProviderId = useMemo(() => {
    if (allowSystemProvider) return 'system';
    return providerOptions[0]?.id || 'system';
  }, [allowSystemProvider, providerOptions]);

  const [selectedProviderId, setSelectedProviderId] = useState<string>(defaultProviderId);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [customModelId, setCustomModelId] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const [generationOverrides, setGenerationOverrides] = useState<UserGenerationOverrides | undefined>(undefined);
  const [loadedGenerationOverridesKey, setLoadedGenerationOverridesKey] = useState<string | null>(null);
  const [isEditingApiKey, setIsEditingApiKey] = useState<boolean>(false);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);
  const [availabilityMap, setAvailabilityMap] = useState<Map<string, AiChannelAvailabilityEntry>>(new Map());
  const onConfigChangeRef = useRef(onConfigChange);
  const lastEmittedConfigKeyRef = useRef<string>('');

  const activeProvider = providerOptions.find((provider) => provider.id === selectedProviderId) ?? null;
  const hasApiKey = apiKey.trim().length > 0;
  const maskedApiKey = useMemo(() => maskApiKeyForDisplay(apiKey), [apiKey]);
  const shouldShowMaskedApiKey = hasApiKey && !isEditingApiKey;
  const isCustomModelSelected = selectedModel === CUSTOM_AI_MODEL_OPTION_VALUE;

  const activeCapabilities = useMemo(() => {
    if (!activeProvider) return undefined;
    const effectiveModel = resolveEffectiveModelId(activeProvider, selectedModel, customModelId);
    if (!effectiveModel) return undefined;
    return getModelGenerationCapabilities(activeProvider.id, effectiveModel);
  }, [activeProvider, customModelId, selectedModel]);

  useEffect(() => {
    onConfigChangeRef.current = onConfigChange;
  }, [onConfigChange]);

  useEffect(() => {
    setIsEditingApiKey(false);
  }, [activeProvider?.id]);

  // 初始 hydration：读持久化选择并写回默认 provider（缺省时）。
  useEffect(() => {
    try {
      const savedProviderId = storage.getItem(storageKeys.selectedProvider);
      const validProvider = savedProviderId
        ? providerOptions.find((item) => item.id === savedProviderId)
        : null;

      if (!savedProviderId) {
        storage.setItem(storageKeys.selectedProvider, defaultProviderId);
      }

      if (validProvider) {
        const storedApiKey = storage.getItem(getApiKeyStorageKey(storageKeys, validProvider.id)) || '';
        const storedModel =
          storage.getItem(getModelStorageKey(storageKeys, validProvider.id)) ||
          validProvider.models[0]?.value ||
          '';
        const storedCustomModelId =
          storage.getItem(getCustomModelStorageKey(storageKeys, validProvider.id)) || '';
        const modelSelection = resolveModelSelection(validProvider, storedModel, storedCustomModelId);

        setSelectedProviderId(validProvider.id);
        setApiKey(storedApiKey);
        setSelectedModel(modelSelection.selectedModel);
        setCustomModelId(modelSelection.customModelId);
      } else {
        if (savedProviderId) {
          storage.setItem(storageKeys.selectedProvider, defaultProviderId);
        }
        setSelectedProviderId(defaultProviderId);
        setApiKey('');
        setSelectedModel('');
        setCustomModelId('');
      }
    } catch {
      // 存储不可用：保持内存默认，继续 hydration
    }

    setIsHydrated(true);
  }, [defaultProviderId, providerOptions, storage, storageKeys]);

  // 加载渠道可用性数据（静默失败）
  useEffect(() => {
    if (!isHydrated || !loadChannelAvailability) return;
    let cancelled = false;
    void loadChannelAvailability()
      .then((entries) => {
        if (cancelled || !entries) return;
        const map = new Map<string, AiChannelAvailabilityEntry>();
        for (const entry of entries) {
          map.set(`${entry.providerId}:${entry.modelId}`, entry);
        }
        setAvailabilityMap(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isHydrated, loadChannelAvailability]);

  // 外部同步事件：先持久化，再更新内存（与旧组件同一顺序）。
  useEffect(() => {
    if (!subscribeSync) return;

    const handler = (detail: AiProviderSyncDetail) => {
      if (!detail || typeof detail !== 'object') {
        return;
      }

      const nextProviderId = typeof detail.providerId === 'string' ? detail.providerId.trim() : '';
      if (!nextProviderId) {
        return;
      }

      if (!allowSystemProvider && nextProviderId === 'system') {
        return;
      }

      const provider = providerOptions.find((item) => item.id === nextProviderId) ?? null;
      if (!provider) {
        return;
      }

      const modelFromEvent = typeof detail.modelId === 'string' ? detail.modelId.trim() : '';
      const apiKeyFromEvent = typeof detail.apiKey === 'string' ? detail.apiKey : null;
      const generationOverridesFromEvent = detail.generationOverrides as UserGenerationOverrides | undefined;

      try {
        storage.setItem(storageKeys.selectedProvider, nextProviderId);
        if (apiKeyFromEvent != null) {
          storage.setItem(getApiKeyStorageKey(storageKeys, nextProviderId), apiKeyFromEvent);
        }
        if (modelFromEvent) {
          const modelSelection = resolveModelSelection(provider, modelFromEvent, modelFromEvent);
          const effectiveModel =
            modelSelection.selectedModel === CUSTOM_AI_MODEL_OPTION_VALUE
              ? modelSelection.customModelId
              : modelSelection.selectedModel || modelFromEvent;
          if (modelSelection.selectedModel) {
            storage.setItem(getModelStorageKey(storageKeys, nextProviderId), modelSelection.selectedModel);
          }
          if (modelSelection.selectedModel === CUSTOM_AI_MODEL_OPTION_VALUE) {
            storage.setItem(
              getCustomModelStorageKey(storageKeys, nextProviderId),
              modelSelection.customModelId,
            );
          }
          if (effectiveModel && generationOverridesFromEvent) {
            writeGenerationOverrides(
              storage,
              storageKeys,
              nextProviderId,
              effectiveModel,
              generationOverridesFromEvent,
            );
          }
        }
      } catch {
        // 存储在部分受限环境下可能不可用，忽略即可
      }

      setSelectedProviderId(nextProviderId);
      if (apiKeyFromEvent != null) {
        setApiKey(apiKeyFromEvent);
      }
      if (generationOverridesFromEvent) {
        setGenerationOverrides(generationOverridesFromEvent);
      }
      if (modelFromEvent) {
        const modelSelection = resolveModelSelection(provider, modelFromEvent, modelFromEvent);
        setSelectedModel(modelSelection.selectedModel);
        setCustomModelId(modelSelection.customModelId);
      }
    };

    const unsubscribe = subscribeSync(handler);
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [allowSystemProvider, providerOptions, storage, storageKeys, subscribeSync]);

  // provider 切换：持久化选择并载入 provider 级值。
  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (!activeProvider) {
      setApiKey('');
      setSelectedModel('');
      setCustomModelId('');
      setGenerationOverrides(undefined);
      setLoadedGenerationOverridesKey(null);
      return;
    }

    let storedApiKey = '';
    let storedModel = activeProvider.models[0]?.value || '';
    let storedCustomModelId = '';

    try {
      storage.setItem(storageKeys.selectedProvider, selectedProviderId);
      storedApiKey = storage.getItem(getApiKeyStorageKey(storageKeys, activeProvider.id)) || '';
      storedModel = storage.getItem(getModelStorageKey(storageKeys, activeProvider.id)) || storedModel;
      storedCustomModelId = storage.getItem(getCustomModelStorageKey(storageKeys, activeProvider.id)) || '';
    } catch {
      // 存储在部分受限环境下可能不可用，忽略即可
    }

    const modelSelection = resolveModelSelection(activeProvider, storedModel, storedCustomModelId);
    setApiKey(storedApiKey);
    setSelectedModel(modelSelection.selectedModel);
    setCustomModelId(modelSelection.customModelId);
  }, [activeProvider, isHydrated, selectedProviderId, storage, storageKeys]);

  // 按 providerId+modelId 加载生成覆盖（含旧 maxOutputTokens 迁移）。
  useEffect(() => {
    if (!isHydrated || !activeProvider) {
      return;
    }
    const effectiveModel = resolveEffectiveModelId(activeProvider, selectedModel, customModelId);
    if (!activeProvider.id || !effectiveModel) {
      setGenerationOverrides(undefined);
      setLoadedGenerationOverridesKey(null);
      return;
    }
    const currentGenerationOverridesKey = buildGenerationOverridesScopeKey(activeProvider.id, effectiveModel);
    const { overrides } = readGenerationOverrides(storage, storageKeys, activeProvider.id, effectiveModel);
    setGenerationOverrides(overrides);
    setLoadedGenerationOverridesKey(currentGenerationOverridesKey);
  }, [activeProvider, customModelId, isHydrated, selectedModel, storage, storageKeys]);

  // 生效配置 emit：等当前 provider+model 的覆盖加载完成后再发，避免重复发射。
  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (!activeProvider) {
      const configKey = 'null';
      if (configKey === lastEmittedConfigKeyRef.current) {
        return;
      }
      lastEmittedConfigKeyRef.current = configKey;
      onConfigChangeRef.current?.(null);
      return;
    }

    const effectiveModel = resolveEffectiveModelId(activeProvider, selectedModel, customModelId);
    const currentGenerationOverridesKey = buildGenerationOverridesScopeKey(activeProvider.id, effectiveModel);
    if (loadedGenerationOverridesKey !== currentGenerationOverridesKey) {
      return;
    }
    const parsedMaxOutputTokens = normalizeCustomProviderMaxOutputTokens(generationOverrides?.maxOutputTokens);
    const configKey = `${activeProvider.id}::${selectedModel}::${effectiveModel}::${apiKey.trim()}::${parsedMaxOutputTokens ?? ''}::${JSON.stringify(generationOverrides ?? null)}`;
    if (configKey === lastEmittedConfigKeyRef.current) {
      return;
    }
    lastEmittedConfigKeyRef.current = configKey;
    onConfigChangeRef.current?.({
      providerId: activeProvider.id,
      modelId: effectiveModel,
      apiKey: apiKey.trim(),
      ...(typeof parsedMaxOutputTokens === 'number' ? { maxOutputTokens: parsedMaxOutputTokens } : {}),
      ...(generationOverrides ? { generationOverrides } : {}),
    });
  }, [activeProvider, apiKey, customModelId, generationOverrides, isCustomModelSelected, isHydrated, loadedGenerationOverridesKey, selectedModel]);

  // 下面三个 effect 只做持久化，不改变内存选择。
  useEffect(() => {
    if (!isHydrated || !activeProvider) {
      return;
    }
    try {
      storage.setItem(getApiKeyStorageKey(storageKeys, activeProvider.id), apiKey);
    } catch {
      // 存储不可用时忽略
    }
  }, [activeProvider, apiKey, isHydrated, storage, storageKeys]);

  useEffect(() => {
    if (!isHydrated || !activeProvider) {
      return;
    }
    if (!selectedModel) {
      return;
    }
    try {
      storage.setItem(getModelStorageKey(storageKeys, activeProvider.id), selectedModel);
    } catch {
      // 存储不可用时忽略
    }
  }, [activeProvider, isHydrated, selectedModel, storage, storageKeys]);

  useEffect(() => {
    if (!isHydrated || !activeProvider) {
      return;
    }
    if (selectedModel !== CUSTOM_AI_MODEL_OPTION_VALUE) {
      return;
    }
    try {
      storage.setItem(getCustomModelStorageKey(storageKeys, activeProvider.id), customModelId.trim());
    } catch {
      // 存储不可用时忽略
    }
  }, [activeProvider, customModelId, isHydrated, selectedModel, storage, storageKeys]);

  // 用户主动修改高级设置时，仅写入当前 provider+model 的 key，避免模型切换时误写旧值。
  const updateGenerationOverrides = useCallback(
    (next: UserGenerationOverrides | undefined) => {
      if (!activeProvider) {
        setGenerationOverrides(next);
        setLoadedGenerationOverridesKey(null);
        return;
      }
      const effectiveModel = resolveEffectiveModelId(activeProvider, selectedModel, customModelId);
      if (!effectiveModel) {
        setGenerationOverrides(next);
        setLoadedGenerationOverridesKey(null);
        return;
      }
      setGenerationOverrides(next);
      setLoadedGenerationOverridesKey(buildGenerationOverridesScopeKey(activeProvider.id, effectiveModel));
      writeGenerationOverrides(storage, storageKeys, activeProvider.id, effectiveModel, next);
    },
    [activeProvider, customModelId, selectedModel, storage, storageKeys],
  );

  return {
    providerOptions,
    selectedProviderId,
    selectedModel,
    customModelId,
    apiKey,
    generationOverrides,
    isEditingApiKey,
    isHydrated,
    availabilityMap,
    activeProvider,
    activeCapabilities,
    hasApiKey,
    maskedApiKey,
    shouldShowMaskedApiKey,
    isCustomModelSelected,
    setSelectedProviderId,
    setSelectedModel,
    setCustomModelId,
    setApiKey,
    setIsEditingApiKey,
    updateGenerationOverrides,
  };
};
