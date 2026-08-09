import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AI_PROVIDER_CATALOG,
    CUSTOM_AI_MODEL_OPTION,
    CUSTOM_AI_MODEL_OPTION_VALUE,
    canUseCustomModelId,
    type AIProviderOption,
} from '@/lib/ai/constants';
import {
    normalizeCustomProviderMaxOutputTokens,
} from '@/lib/ai/custom-provider';
import { maskApiKeyForDisplay } from '@/lib/client/mask-api-key';
import { ChannelAvailabilityBadge } from '@/components/ChannelAvailabilityBadge';
import type { UserGenerationOverrides } from '@/lib/ai/generation-settings/types';
import AdvancedGenerationSettings from '@/components/AdvancedGenerationSettings';
import { getModelGenerationCapabilities } from '@/lib/ai/generation-settings/model-capabilities';
import Link from 'next/link';

export interface UserAIProviderConfig {
    providerId: string;
    modelId: string;
    apiKey: string;
    maxOutputTokens?: number;
    generationOverrides?: UserGenerationOverrides;
}

interface AiProviderSelectorProps {
    onConfigChange: (config: UserAIProviderConfig | null) => void;
    storageNamespace?: string;
    allowSystemProvider?: boolean;
    label?: string;
}

const PROVIDER_SELECTOR_SYNC_EVENT = 'mahoshojo:set-ai-provider-config';

type AvailabilityStatus = 'healthy' | 'degraded' | 'poor' | 'unknown';

type AvailabilityEntry = {
    providerId: string;
    modelId: string;
    primary: {
        window: '1h' | '24h' | 'none';
        successRate: number | null;
        status: 'healthy' | 'degraded' | 'poor' | 'unknown';
    };
    reference?: {
        window: '24h';
        successRate: number;
        status: 'healthy' | 'degraded' | 'poor';
    };
};

interface CustomSelectOption {
    value: string;
    label: string;
    description?: string;
    availability?: AvailabilityEntry;
}

interface CustomSelectProps {
    options: CustomSelectOption[];
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    disabled?: boolean;
}

const CustomSelect: React.FC<CustomSelectProps> = ({ options, value, onChange, placeholder, disabled = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find(option => option.value === value) ?? null;

    const handleDocumentClick = useCallback((event: MouseEvent) => {
        if (!containerRef.current) return;
        if (!containerRef.current.contains(event.target as Node)) {
            setIsOpen(false);
        }
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        document.addEventListener('mousedown', handleDocumentClick);
        return () => document.removeEventListener('mousedown', handleDocumentClick);
    }, [handleDocumentClick, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        };
        document.addEventListener('keydown', handleKeydown);
        return () => document.removeEventListener('keydown', handleKeydown);
    }, [isOpen]);

    const renderSelected = () => (
        <div className="flex flex-1 flex-col text-left leading-tight">
            <span className="battle-lite-strong-text text-sm font-semibold">
                {selectedOption?.label ?? placeholder}
            </span>
            <span className="battle-lite-subtle-text flex items-center gap-1 text-xs">
                <span>{selectedOption?.description ?? '请选择'}</span>
                {selectedOption?.availability && (
                    <ChannelAvailabilityBadge availability={selectedOption.availability} compact />
                )}
            </span>
        </div>
    );

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                className={`input-field flex w-full items-center justify-between gap-2 text-left ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                onClick={() => !disabled && setIsOpen(prev => !prev)}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                disabled={disabled}
            >
                {renderSelected()}
                <span className="battle-lite-subtle-text">{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
                <div className="battle-lite-select-menu absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-lg">
                    <div role="listbox">
                        {options.map((option, index) => (
                            <button
                                key={`${option.value}-${index}`}
                                type="button"
                                role="option"
                                aria-selected={option.value === value}
                                className={`flex w-full items-start gap-2 px-4 py-3 text-left transition-colors ${
                                    option.value === value ? 'battle-lite-select-option-active' : 'battle-lite-select-option'
                                    }`}
                                onClick={() => {
                                    onChange(option.value);
                                    setIsOpen(false);
                                }}
                            >
                                <div className="flex flex-1 flex-col items-start gap-1">
                                    <span className="battle-lite-strong-text text-sm font-semibold">
                                        {option.label}
                                    </span>
                                    {option.description && (
                                        <span className="battle-lite-subtle-text text-xs">
                                            {option.description}
                                        </span>
                                    )}
                                </div>
                                {option.availability && (
                                    <span className="mt-0.5 shrink-0">
                                        <ChannelAvailabilityBadge availability={option.availability} compact />
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const AiProviderSelector: React.FC<AiProviderSelectorProps> = ({
    onConfigChange,
    storageNamespace = 'arena.customProvider',
    allowSystemProvider = true,
    label = '自定义 AI 能力提供商 (可选)',
}) => {

    const providerOptions = useMemo<AIProviderOption[]>(() => {
        const options = AI_PROVIDER_CATALOG;
        if (allowSystemProvider) return options;
        return options.filter((item) => item.id !== 'system');
    }, [allowSystemProvider]);

    const storageKeys = useMemo(() => {
        return {
            selectedProvider: `${storageNamespace}.selected`,
            apiKeyPrefix: `${storageNamespace}.apiKey.`,
            modelPrefix: `${storageNamespace}.model.`,
            customModelPrefix: `${storageNamespace}.customModel.`,
            maxOutputTokensPrefix: `${storageNamespace}.maxOutputTokens.`,
            generationOverridesPrefix: `${storageNamespace}.generationOverrides.`,
        };
    }, [storageNamespace]);

    const getApiKeyStorageKey = useCallback((providerId: string) => `${storageKeys.apiKeyPrefix}${providerId}`, [storageKeys.apiKeyPrefix]);
    const getModelStorageKey = useCallback((providerId: string) => `${storageKeys.modelPrefix}${providerId}`, [storageKeys.modelPrefix]);
    const getCustomModelStorageKey = useCallback((providerId: string) => `${storageKeys.customModelPrefix}${providerId}`, [storageKeys.customModelPrefix]);
    const getMaxOutputTokensStorageKey = useCallback((providerId: string) => `${storageKeys.maxOutputTokensPrefix}${providerId}`, [storageKeys.maxOutputTokensPrefix]);
    const getGenerationOverridesKey = useCallback((providerId: string, modelId: string) => `${storageKeys.generationOverridesPrefix}${providerId}.${modelId}`, [storageKeys.generationOverridesPrefix]);

    /** 读取某 provider+model 的生成覆盖：优先新 key，兼容读取旧 provider 级 maxOutputTokens 并回写。 */
    const readGenerationOverrides = useCallback((providerId: string, modelId: string): { overrides: UserGenerationOverrides | undefined; migrated: boolean } => {
        if (typeof window === 'undefined') {
            return { overrides: undefined, migrated: false };
        }
        try {
            const newKey = getGenerationOverridesKey(providerId, modelId);
            const stored = window.localStorage.getItem(newKey);
            if (stored) {
                try {
                    return { overrides: JSON.parse(stored) as UserGenerationOverrides, migrated: false };
                } catch {
                    // 损坏数据，忽略并回退到旧 key
                }
            }
            const legacy = window.localStorage.getItem(getMaxOutputTokensStorageKey(providerId));
            if (legacy) {
                const parsed = normalizeCustomProviderMaxOutputTokens(Number(legacy));
                if (typeof parsed === 'number') {
                    const overrides: UserGenerationOverrides = { maxOutputTokens: parsed };
                    window.localStorage.setItem(newKey, JSON.stringify(overrides));
                    // 迁移成功后立即删除旧 key，避免“恢复默认”后旧值复活、或传播到其他模型。
                    window.localStorage.removeItem(getMaxOutputTokensStorageKey(providerId));
                    return { overrides, migrated: true };
                }
            }
            return { overrides: undefined, migrated: false };
        } catch {
            return { overrides: undefined, migrated: false };
        }
    }, [getGenerationOverridesKey, getMaxOutputTokensStorageKey]);

    /** 保存某 provider+model 的生成覆盖。 */
    const writeGenerationOverrides = useCallback((providerId: string, modelId: string, overrides: UserGenerationOverrides | undefined) => {
        if (typeof window === 'undefined') return;
        try {
            const newKey = getGenerationOverridesKey(providerId, modelId);
            if (overrides && (typeof overrides.maxOutputTokens === 'number' || typeof overrides.temperature === 'number' || overrides.thinking)) {
                window.localStorage.setItem(newKey, JSON.stringify(overrides));
            } else {
                window.localStorage.removeItem(newKey);
            }
        } catch {
            // localStorage 不可用时忽略
        }
    }, [getGenerationOverridesKey]);

    const defaultProviderId = useMemo(() => {
        if (allowSystemProvider) return 'system';
        return providerOptions[0]?.id || 'system';
    }, [allowSystemProvider, providerOptions]);

    const [selectedProviderId, setSelectedProviderId] = useState<string>(defaultProviderId);
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [customModelId, setCustomModelId] = useState<string>('');
    const [apiKey, setApiKey] = useState<string>('');
    const [generationOverrides, setGenerationOverrides] = useState<UserGenerationOverrides | undefined>(undefined);
    const [isEditingApiKey, setIsEditingApiKey] = useState<boolean>(false);
    const [isHydrated, setIsHydrated] = useState<boolean>(false);
    const [availabilityMap, setAvailabilityMap] = useState<Map<string, AvailabilityEntry>>(new Map());
    const onConfigChangeRef = useRef(onConfigChange);
    const lastEmittedConfigKeyRef = useRef<string>('');

    const activeProvider = providerOptions.find(provider => provider.id === selectedProviderId) ?? null;
    const hasApiKey = apiKey.trim().length > 0;
    const maskedApiKey = useMemo(() => maskApiKeyForDisplay(apiKey), [apiKey]);
    const shouldShowMaskedApiKey = hasApiKey && !isEditingApiKey;
    const isCustomModelSelected = selectedModel === CUSTOM_AI_MODEL_OPTION_VALUE;

    // 当前 provider+model 的生成能力（驱动高级设置 UI）。
    const activeCapabilities = useMemo(() => {
        if (!activeProvider) return undefined;
        const effectiveModel = isCustomModelSelected
            ? customModelId.trim()
            : (selectedModel || activeProvider.models[0]?.value || '');
        if (!effectiveModel) return undefined;
        return getModelGenerationCapabilities(activeProvider.id, effectiveModel);
    }, [activeProvider, customModelId, isCustomModelSelected, selectedModel]);

    const resolveModelSelection = useCallback((
        provider: AIProviderOption,
        storedModel: string,
        storedCustomModelId: string,
    ) => {
        const defaultModel = provider.models[0]?.value || '';
        const normalizedModel = storedModel.trim();
        const normalizedCustomModelId = storedCustomModelId.trim();

        if (normalizedModel === CUSTOM_AI_MODEL_OPTION_VALUE && canUseCustomModelId(provider)) {
            return {
                selectedModel: CUSTOM_AI_MODEL_OPTION_VALUE,
                customModelId: normalizedCustomModelId,
            };
        }

        if (provider.models.some(model => model.value === normalizedModel)) {
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
    }, []);

    useEffect(() => {
        onConfigChangeRef.current = onConfigChange;
    }, [onConfigChange]);

    useEffect(() => {
        setIsEditingApiKey(false);
    }, [activeProvider?.id]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const savedProviderId = window.localStorage.getItem(storageKeys.selectedProvider);
        const validProvider = savedProviderId
            ? providerOptions.find(item => item.id === savedProviderId)
            : null;

        if (!savedProviderId) {
            window.localStorage.setItem(storageKeys.selectedProvider, defaultProviderId);
        }

        if (validProvider) {
            const storedApiKey = window.localStorage.getItem(getApiKeyStorageKey(validProvider.id)) || '';
            const storedModel = window.localStorage.getItem(getModelStorageKey(validProvider.id)) || validProvider.models[0]?.value || '';
            const storedCustomModelId = window.localStorage.getItem(getCustomModelStorageKey(validProvider.id)) || '';
            const modelSelection = resolveModelSelection(validProvider, storedModel, storedCustomModelId);

            setSelectedProviderId(validProvider.id);
            setApiKey(storedApiKey);
            setSelectedModel(modelSelection.selectedModel);
            setCustomModelId(modelSelection.customModelId);
        } else {
            if (savedProviderId) {
                window.localStorage.setItem(storageKeys.selectedProvider, defaultProviderId);
            }
            setSelectedProviderId(defaultProviderId);
            setApiKey('');
            setSelectedModel('');
            setCustomModelId('');
        }

        setIsHydrated(true);
    }, [defaultProviderId, getApiKeyStorageKey, getCustomModelStorageKey, getModelStorageKey, providerOptions, resolveModelSelection, storageKeys.selectedProvider]);

    // 加载渠道可用性数据（静默失败）
    useEffect(() => {
        if (!isHydrated || typeof window === 'undefined') return;
        let cancelled = false;
        fetch('/api/ai/channel-availability')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled || !data?.entries) return;
                const map = new Map<string, AvailabilityEntry>();
                for (const entry of data.entries) {
                    map.set(`${entry.providerId}:${entry.modelId}`, entry);
                }
                setAvailabilityMap(map);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [isHydrated]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handler = (event: Event) => {
            const detail = (event as CustomEvent<Partial<UserAIProviderConfig> | undefined>)?.detail;
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

            const provider = providerOptions.find(item => item.id === nextProviderId) ?? null;
            if (!provider) {
                return;
            }

            const modelFromEvent = typeof detail.modelId === 'string' ? detail.modelId.trim() : '';
            const apiKeyFromEvent = typeof detail.apiKey === 'string' ? detail.apiKey : null;
            const generationOverridesFromEvent = detail.generationOverrides;

            try {
                window.localStorage.setItem(storageKeys.selectedProvider, nextProviderId);
                if (apiKeyFromEvent != null) {
                    window.localStorage.setItem(getApiKeyStorageKey(nextProviderId), apiKeyFromEvent);
                }
                if (modelFromEvent) {
                    const modelSelection = resolveModelSelection(provider, modelFromEvent, modelFromEvent);
                    const effectiveModel = modelSelection.selectedModel === CUSTOM_AI_MODEL_OPTION_VALUE
                        ? modelSelection.customModelId
                        : (modelSelection.selectedModel || modelFromEvent);
                    if (modelSelection.selectedModel) {
                        window.localStorage.setItem(getModelStorageKey(nextProviderId), modelSelection.selectedModel);
                    }
                    if (modelSelection.selectedModel === CUSTOM_AI_MODEL_OPTION_VALUE) {
                        window.localStorage.setItem(getCustomModelStorageKey(nextProviderId), modelSelection.customModelId);
                    }
                    if (effectiveModel && generationOverridesFromEvent) {
                        writeGenerationOverrides(nextProviderId, effectiveModel, generationOverridesFromEvent);
                    }
                }
            } catch {
                // localStorage 在部分隐私模式/受限环境下可能不可用，忽略即可
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

        window.addEventListener(PROVIDER_SELECTOR_SYNC_EVENT, handler as EventListener);
        return () => window.removeEventListener(PROVIDER_SELECTOR_SYNC_EVENT, handler as EventListener);
    }, [allowSystemProvider, getApiKeyStorageKey, getCustomModelStorageKey, getModelStorageKey, providerOptions, resolveModelSelection, storageKeys.selectedProvider, writeGenerationOverrides]);

    useEffect(() => {
        if (!isHydrated || typeof window === 'undefined') {
            return;
        }

        if (!activeProvider) {
            setApiKey('');
            setSelectedModel('');
            setCustomModelId('');
            setGenerationOverrides(undefined);
            return;
        }

        let storedApiKey = '';
        let storedModel = activeProvider.models[0]?.value || '';
        let storedCustomModelId = '';

        try {
            window.localStorage.setItem(storageKeys.selectedProvider, selectedProviderId);
            storedApiKey = window.localStorage.getItem(getApiKeyStorageKey(activeProvider.id)) || '';
            storedModel = window.localStorage.getItem(getModelStorageKey(activeProvider.id)) || storedModel;
            storedCustomModelId = window.localStorage.getItem(getCustomModelStorageKey(activeProvider.id)) || '';
        } catch {
            // localStorage 在部分隐私模式/受限环境下可能不可用，忽略即可
        }

        const modelSelection = resolveModelSelection(activeProvider, storedModel, storedCustomModelId);
        setApiKey(storedApiKey);
        setSelectedModel(modelSelection.selectedModel);
        setCustomModelId(modelSelection.customModelId);
    }, [activeProvider, getApiKeyStorageKey, getCustomModelStorageKey, getModelStorageKey, isHydrated, resolveModelSelection, selectedProviderId, storageKeys.selectedProvider]);

    // 按 providerId+modelId 加载生成覆盖（含旧 maxOutputTokens 迁移）。
    useEffect(() => {
        if (!isHydrated || !activeProvider) {
            return;
        }
        const effectiveModel = isCustomModelSelected
            ? customModelId.trim()
            : (selectedModel || activeProvider.models[0]?.value || '');
        if (!activeProvider.id || !effectiveModel) {
            return;
        }
        const { overrides } = readGenerationOverrides(activeProvider.id, effectiveModel);
        setGenerationOverrides(overrides);
    }, [activeProvider, customModelId, isCustomModelSelected, isHydrated, readGenerationOverrides, selectedModel]);

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
            onConfigChangeRef.current(null);
            return;
        }

        const effectiveModel = isCustomModelSelected
            ? customModelId.trim()
            : (selectedModel || activeProvider.models[0]?.value || '');
        const parsedMaxOutputTokens = normalizeCustomProviderMaxOutputTokens(generationOverrides?.maxOutputTokens);
        const configKey = `${activeProvider.id}::${selectedModel}::${effectiveModel}::${apiKey.trim()}::${parsedMaxOutputTokens ?? ''}::${JSON.stringify(generationOverrides ?? null)}`;
        if (configKey === lastEmittedConfigKeyRef.current) {
            return;
        }
        lastEmittedConfigKeyRef.current = configKey;
        onConfigChangeRef.current({
            providerId: activeProvider.id,
            modelId: effectiveModel,
            apiKey: apiKey.trim(),
            ...(typeof parsedMaxOutputTokens === 'number' ? { maxOutputTokens: parsedMaxOutputTokens } : {}),
            ...(generationOverrides ? { generationOverrides } : {}),
        });
    }, [activeProvider, apiKey, customModelId, generationOverrides, isCustomModelSelected, isHydrated, selectedModel]);

    useEffect(() => {
        if (!isHydrated || !activeProvider || typeof window === 'undefined') {
            return;
        }
        window.localStorage.setItem(getApiKeyStorageKey(activeProvider.id), apiKey);
    }, [activeProvider, apiKey, getApiKeyStorageKey, isHydrated]);

    useEffect(() => {
        if (!isHydrated || !activeProvider || typeof window === 'undefined') {
            return;
        }
        if (!selectedModel) {
            return;
        }
        window.localStorage.setItem(getModelStorageKey(activeProvider.id), selectedModel);
    }, [activeProvider, getModelStorageKey, isHydrated, selectedModel]);

    useEffect(() => {
        if (!isHydrated || !activeProvider || typeof window === 'undefined') {
            return;
        }
        if (selectedModel !== CUSTOM_AI_MODEL_OPTION_VALUE) {
            return;
        }
        window.localStorage.setItem(getCustomModelStorageKey(activeProvider.id), customModelId.trim());
    }, [activeProvider, customModelId, getCustomModelStorageKey, isHydrated, selectedModel]);

    // 用户主动修改高级设置时，仅写入当前 provider+model 的 key，避免模型切换时误写旧值。
    const handleGenerationOverridesChange = useCallback((next: UserGenerationOverrides | undefined) => {
        setGenerationOverrides(next);
        if (!activeProvider || typeof window === 'undefined') {
            return;
        }
        const effectiveModel = isCustomModelSelected
            ? customModelId.trim()
            : (selectedModel || activeProvider.models[0]?.value || '');
        if (!effectiveModel) {
            return;
        }
        writeGenerationOverrides(activeProvider.id, effectiveModel, next);
    }, [activeProvider, customModelId, isCustomModelSelected, selectedModel, writeGenerationOverrides]);

    const providerSelectOptions = useMemo<CustomSelectOption[]>(() => {
        return providerOptions.map((provider): CustomSelectOption => {
            const entries = provider.models
                .map(model => availabilityMap.get(`${provider.id}:${model.value}`))
                .filter((entry): entry is AvailabilityEntry => entry !== undefined);

            if (entries.length === 0) {
                return {
                    value: provider.id,
                    label: provider.name,
                    description: provider.description,
                };
            }

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
                    value: provider.id,
                    label: provider.name,
                    description: provider.description,
                    availability: { providerId: provider.id, modelId: '', primary: { window: 'none', successRate: null, status: 'unknown' } },
                };
            }

            const avgRate = rateSum / rateCount;
            const status: AvailabilityStatus = avgRate >= 0.90 ? 'healthy' : avgRate >= 0.70 ? 'degraded' : 'poor';
            return {
                value: provider.id,
                label: provider.name,
                description: provider.description,
                availability: { providerId: provider.id, modelId: '', primary: { window: '1h', successRate: avgRate, status } },
            };
        });
    }, [providerOptions, availabilityMap]);

    const modelSelectOptions: CustomSelectOption[] = useMemo(() => {
        if (!activeProvider) return [];
        const options = activeProvider.models.map(model => ({
            value: model.value,
            label: model.label,
            description: model.description,
            availability: availabilityMap.get(`${activeProvider.id}:${model.value}`),
        }));
        if (canUseCustomModelId(activeProvider)) {
            options.push({
                value: CUSTOM_AI_MODEL_OPTION.value,
                label: CUSTOM_AI_MODEL_OPTION.label,
                description: CUSTOM_AI_MODEL_OPTION.description,
                availability: undefined,
            });
        }
        return options;
    }, [activeProvider, availabilityMap]);

    return (
        <div className="input-group">
            <label className="input-label">{label}</label>
            <CustomSelect
                options={providerSelectOptions}
                value={selectedProviderId}
                onChange={setSelectedProviderId}
                placeholder="选择供应商"
            />
            <label className="battle-lite-subtle-text text-xs">更多提供商正在添加中...</label>
            {
                activeProvider && (activeProvider.id !== 'system') && (
                    <div className="mt-4">
                        <Link
                            href={activeProvider.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex w-full items-center justify-center rounded-lg bg-pink-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:bg-pink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-500"
                        >
                            前往获取 API Key
                        </Link>
                    </div>
                )
            }

            <div className="battle-lite-accent-box mt-3 space-y-3 rounded-lg p-3 text-sm">
                <div>
                    <label className="battle-lite-muted-text mb-1 block text-xs font-semibold">选择模型</label>
                    <CustomSelect
                        options={modelSelectOptions}
                        value={selectedModel}
                        onChange={setSelectedModel}
                        placeholder="选择模型"
                        disabled={modelSelectOptions.length === 0}
                    />
                </div>

                {
                    activeProvider && isCustomModelSelected && (
                        <div>
                            <label className="battle-lite-muted-text mb-1 block text-xs font-semibold">自定义 modelId</label>
                            <input
                                className="input-field font-mono"
                                type="text"
                                placeholder="请输入该供应商支持的 modelId"
                                value={customModelId}
                                autoComplete="off"
                                spellCheck={false}
                                onChange={(event) => setCustomModelId(event.target.value)}
                            />
                            <p className="battle-lite-subtle-text mt-1 text-xs">
                                仅切换模型名，端点仍固定为当前预置供应商。
                            </p>
                        </div>
                    )
                }

                {
                    activeProvider && activeProvider.id !== 'system' && (
                        <div>
                            <label className="battle-lite-muted-text mb-1 block text-xs font-semibold">API Key</label>
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
                            <p className="battle-lite-subtle-text mt-1 text-xs">
                                已默认隐藏完整 Key，仅显示前 6 位；点击输入框可直接修改。
                            </p>
                            <p className="battle-lite-subtle-text mt-1 text-xs">
                                API Key 仅存储于本地浏览器；请求时会随 HTTPS 发送到边缘函数用于转发调用，不会写入数据库或日志。
                            </p>
                        </div>
                    )
                }

                <AdvancedGenerationSettings
                    value={generationOverrides}
                    onChange={handleGenerationOverridesChange}
                    temperatureSupported={activeCapabilities ? activeCapabilities.temperature.support !== 'unsupported' : true}
                    temperatureMax={activeCapabilities?.temperature.max}
                    maxOutputTokensMax={activeCapabilities?.maxOutputTokens.max}
                    thinkingSupport={activeCapabilities?.thinking.support}
                    thinkingEfforts={activeCapabilities?.thinking.efforts}
                    canDisableThinking={activeCapabilities ? activeCapabilities.thinking.support === 'supported' : true}
                />

                <p className="battle-lite-subtle-text mt-1 text-xs">
                    高级设置按「供应商 + 模型」分别保存；留空表示跟随模型 / 供应商默认。
                </p>
            </div>
        </div>
    );
};

export default AiProviderSelector;
