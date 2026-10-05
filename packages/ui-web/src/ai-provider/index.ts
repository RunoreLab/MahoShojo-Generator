// `ai-provider` 切片：AI Provider 选择与生成参数的共源 UI/逻辑。
//
// 宿主注入契约见 `./contract`；Web 用法参考 `apps/web/components/AiProviderSelector.tsx`
// （薄封装）。Desktop 使用同一份纯逻辑与原子组件组装自己的产品配置面板。

export { maskApiKeyForDisplay } from './mask-api-key';

export {
  AI_PROVIDER_SYNC_EVENT,
  type AiChannelAvailabilityEntry,
  type AiProviderSelectOption,
  type AiProviderStoragePort,
  type AiProviderSyncDetail,
} from './contract';

export {
  buildGenerationOverridesScopeKey,
  createAiProviderStorageKeys,
  getApiKeyStorageKey,
  getCustomModelStorageKey,
  getGenerationOverridesKey,
  getMaxOutputTokensStorageKey,
  getModelStorageKey,
  readGenerationOverrides,
  resolveEffectiveModelId,
  resolveModelSelection,
  summarizeProviderAvailability,
  writeGenerationOverrides,
  type AiProviderStorageKeys,
  type ModelSelectionResolution,
  type ReadGenerationOverridesResult,
} from './selection';

export {
  DEFAULT_AI_PROVIDER_STORAGE_NAMESPACE,
  useAiProviderSelection,
  type AiProviderSelectionState,
  type UseAiProviderSelectionOptions,
} from './use-ai-provider-selection';

export {
  AiProviderCustomSelect,
  type AiProviderCustomSelectProps,
} from './custom-select';

export {
  AdvancedGenerationSettings,
  type AdvancedGenerationSettingsProps,
} from './advanced-generation-settings';

export {
  AiProviderSelectorView,
  type AiProviderSelectorViewProps,
} from './ai-provider-selector-view';

export {
  AiExecutionLocationField,
  resolveAiExecutionLocation,
  type AiExecutionLocation,
  type AiExecutionLocationFieldProps,
  type AiExecutionLocationOptionState,
  type AiExecutionLocationResolution,
  type ResolveAiExecutionLocationInput,
} from './execution-location';

export {
  AI_DIRECT_UNSUPPORTED_REASON_TEXT,
  describeAiDirectUnsupportedReason,
} from './direct-support';
