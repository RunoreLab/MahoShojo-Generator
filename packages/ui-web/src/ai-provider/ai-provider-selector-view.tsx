// 共源 AI Provider 选择器视图。
//
// 这是从 `apps/web/components/AiProviderSelector.tsx` 抽出的宿主无关组件：选择与
// 持久化状态机（`useAiProviderSelection`，Web 唯一 writer）在本文件装配，纯受控
// 展示层在 `./selector-form`（DESK-AIP-009：持久化副作用与视图分离，Desktop 用
// `DesktopAiConfigStore` 驱动同一骨架）；存储、可用性数据源、文档链接与跨实例
// 同步由宿主经 props 注入（SPEC DESK-ONLINE-004/005：shared UI 不得假设
// window/localStorage/Next）。

import { useMemo, type ReactNode } from 'react';

import {
  CUSTOM_AI_MODEL_OPTION,
  canUseCustomModelId,
  isSystemProviderOption,
  type AIProviderOption,
} from '@mahoshojo/ai-core/provider-catalog';
import type { UserAIProviderConfig } from '@mahoshojo/ai-core/generation-settings';

import { AdvancedGenerationSettings } from './advanced-generation-settings';
import type {
  AiChannelAvailabilityEntry,
  AiProviderSelectOption,
  AiProviderStoragePort,
  AiProviderSyncDetail,
} from './contract';
import { AiProviderCustomSelect } from './custom-select';
import { AiProviderSelectorForm } from './selector-form';
import { summarizeProviderAvailability } from './selection';
import {
  DEFAULT_AI_PROVIDER_STORAGE_NAMESPACE,
  useAiProviderSelection,
} from './use-ai-provider-selection';

export interface AiProviderSelectorViewProps {
  /** 生效配置变化回调；`null` 表示当前没有可用 provider 选择。 */
  onConfigChange?: (config: UserAIProviderConfig | null) => void;
  /** 宿主持久化端口（Web: localStorage；Desktop: 注入自己的端口或不使用本视图）。 */
  storage: AiProviderStoragePort;
  storageNamespace?: string;
  allowSystemProvider?: boolean;
  label?: string;
  /** 可用性数据源；缺省则整个组件不渲染可用性徽章（静默跳过）。 */
  loadChannelAvailability?: () => Promise<readonly AiChannelAvailabilityEntry[] | null | undefined>;
  /** 可用性徽章渲染（宿主决定样式；缺省不渲染）。 */
  renderAvailabilityBadge?: (entry: AiChannelAvailabilityEntry) => ReactNode;
  /** 供应商文档入口渲染（Web 是 Next Link；Desktop 可以注入外链样式或返回 null）。 */
  renderDocsLink?: (provider: AIProviderOption) => ReactNode;
  /** 跨实例同步订阅；缺省不订阅。 */
  subscribeSync?: (handler: (detail: AiProviderSyncDetail) => void) => (() => void) | void;
  /** 「API Key 只存本机」的说明文案；宿主按真实存储语义提供，组件不编造承诺。 */
  apiKeyStorageHint?: ReactNode;
}

export const AiProviderSelectorView = ({
  onConfigChange,
  storage,
  storageNamespace = DEFAULT_AI_PROVIDER_STORAGE_NAMESPACE,
  allowSystemProvider = true,
  label = '自定义 AI 能力提供商 (可选)',
  loadChannelAvailability,
  renderAvailabilityBadge,
  renderDocsLink,
  subscribeSync,
  apiKeyStorageHint,
}: AiProviderSelectorViewProps) => {
  const selection = useAiProviderSelection({
    storage,
    storageNamespace,
    allowSystemProvider,
    onConfigChange,
    subscribeSync,
    loadChannelAvailability,
  });

  const {
    providerOptions,
    selectedProviderId,
    selectedModel,
    customModelId,
    apiKey,
    generationOverrides,
    isEditingApiKey: _isEditingApiKey, // eslint-disable-line @typescript-eslint/no-unused-vars -- 保留完整状态面，视图不需要
    availabilityMap,
    activeProvider,
    activeCapabilities,
    maskedApiKey,
    shouldShowMaskedApiKey,
    isCustomModelSelected,
    hasApiKey,
    setSelectedProviderId,
    setSelectedModel,
    setCustomModelId,
    setApiKey,
    setIsEditingApiKey,
    updateGenerationOverrides,
  } = selection;

  const providerSelectOptions = useMemo<AiProviderSelectOption[]>(() => {
    return providerOptions.map((provider): AiProviderSelectOption => {
      const availability = summarizeProviderAvailability(provider, availabilityMap);
      return {
        value: provider.id,
        label: provider.name,
        description: provider.description,
        ...(availability ? { availability } : {}),
      };
    });
  }, [providerOptions, availabilityMap]);

  const modelSelectOptions = useMemo<AiProviderSelectOption[]>(() => {
    if (!activeProvider) return [];
    const options: AiProviderSelectOption[] = activeProvider.models.map((model) => ({
      value: model.value,
      label: model.label,
      description: model.description,
      ...(availabilityMap.get(`${activeProvider.id}:${model.value}`)
        ? { availability: availabilityMap.get(`${activeProvider.id}:${model.value}`) }
        : {}),
    }));
    if (canUseCustomModelId(activeProvider)) {
      options.push({
        value: CUSTOM_AI_MODEL_OPTION.value,
        label: CUSTOM_AI_MODEL_OPTION.label,
        description: CUSTOM_AI_MODEL_OPTION.description,
      });
    }
    return options;
  }, [activeProvider, availabilityMap]);

  return (
    <AiProviderSelectorForm
      label={label}
      providerSelect={
        <AiProviderCustomSelect
          options={providerSelectOptions}
          value={selectedProviderId}
          onChange={setSelectedProviderId}
          placeholder="选择供应商"
          renderAvailabilityBadge={renderAvailabilityBadge}
        />
      }
      providerExtra={
        activeProvider && !isSystemProviderOption(activeProvider)
          ? renderDocsLink?.(activeProvider)
          : null
      }
      modelSelect={
        <AiProviderCustomSelect
          options={modelSelectOptions}
          value={selectedModel}
          onChange={setSelectedModel}
          placeholder="选择模型"
          disabled={modelSelectOptions.length === 0}
          renderAvailabilityBadge={renderAvailabilityBadge}
        />
      }
      customModelId={
        activeProvider && isCustomModelSelected
          ? {
              input: (
                <input
                  className="input-field font-mono"
                  type="text"
                  placeholder="请输入该供应商支持的 modelId"
                  value={customModelId}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setCustomModelId(event.target.value)}
                />
              ),
              hint: '仅切换模型名，端点仍固定为当前预置供应商。',
            }
          : undefined
      }
      apiKey={
        activeProvider && !isSystemProviderOption(activeProvider)
          ? {
              content: (
                <input
                  className="input-field font-mono"
                  type={shouldShowMaskedApiKey ? 'text' : 'password'}
                  placeholder={shouldShowMaskedApiKey ? '' : '请输入该供应商的 API Key'}
                  value={shouldShowMaskedApiKey ? maskedApiKey : apiKey}
                  readOnly={shouldShowMaskedApiKey}
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={() => {
                    if (hasApiKey) {
                      setIsEditingApiKey(true);
                    }
                  }}
                  onChange={(event) => setApiKey(event.target.value)}
                  onBlur={(event) => {
                    if (event.target.value.trim()) {
                      setIsEditingApiKey(false);
                    }
                  }}
                />
              ),
              hint: '已默认隐藏完整 Key，仅显示前 6 位；点击输入框可直接修改。',
              footnote: apiKeyStorageHint,
            }
          : undefined
      }
      advancedSettings={
        <AdvancedGenerationSettings
          value={generationOverrides}
          onChange={updateGenerationOverrides}
          temperatureSupported={
            activeCapabilities ? activeCapabilities.temperature.support !== 'unsupported' : true
          }
          temperatureMax={activeCapabilities?.temperature.max}
          maxOutputTokensMax={activeCapabilities?.maxOutputTokens.max}
          thinkingSupport={activeCapabilities?.thinking.support}
          thinkingEfforts={activeCapabilities?.thinking.efforts}
          canDisableThinking={
            activeCapabilities
              ? activeCapabilities.thinking.support === 'supported' &&
                activeCapabilities.thinking.canDisable !== false
              : true
          }
        />
      }
    />
  );
};
