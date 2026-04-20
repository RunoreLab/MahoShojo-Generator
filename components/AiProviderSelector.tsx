import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AI_PROVIDER_CATALOG, type AIProviderOption } from '@/lib/ai/constants';
import { maskApiKeyForDisplay } from '@/lib/client/mask-api-key';
import Link from 'next/link';

export interface UserAIProviderConfig {
    providerId: string;
    modelId: string;
    apiKey: string;
}

interface AiProviderSelectorProps {
    onConfigChange: (config: UserAIProviderConfig | null) => void;
    storageNamespace?: string;
    allowSystemProvider?: boolean;
    label?: string;
}

const PROVIDER_SELECTOR_SYNC_EVENT = 'mahoshojo:set-ai-provider-config';

interface CustomSelectOption {
    value: string;
    label: string;
    description?: string;
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
        <div className="flex flex-col text-left leading-tight">
            <span className="battle-lite-strong-text text-sm font-semibold">
                {selectedOption?.label ?? placeholder}
            </span>
            <span className="battle-lite-subtle-text text-xs">
                {selectedOption?.description ?? '请选择'}
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
                                className={`flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors ${
                                    option.value === value ? 'battle-lite-select-option-active' : 'battle-lite-select-option'
                                    }`}
                                onClick={() => {
                                    onChange(option.value);
                                    setIsOpen(false);
                                }}
                            >
                                <span className="battle-lite-strong-text text-sm font-semibold">
                                    {option.label}
                                </span>
                                {option.description && (
                                    <span className="battle-lite-subtle-text text-xs">
                                        {option.description}
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
        };
    }, [storageNamespace]);

    const getApiKeyStorageKey = useCallback((providerId: string) => `${storageKeys.apiKeyPrefix}${providerId}`, [storageKeys.apiKeyPrefix]);
    const getModelStorageKey = useCallback((providerId: string) => `${storageKeys.modelPrefix}${providerId}`, [storageKeys.modelPrefix]);

    const defaultProviderId = useMemo(() => {
        if (allowSystemProvider) return 'system';
        return providerOptions[0]?.id || 'system';
    }, [allowSystemProvider, providerOptions]);

    const [selectedProviderId, setSelectedProviderId] = useState<string>(defaultProviderId);
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [apiKey, setApiKey] = useState<string>('');
    const [isEditingApiKey, setIsEditingApiKey] = useState<boolean>(false);
    const [isHydrated, setIsHydrated] = useState<boolean>(false);
    const onConfigChangeRef = useRef(onConfigChange);
    const lastEmittedConfigKeyRef = useRef<string>('');

    const activeProvider = providerOptions.find(provider => provider.id === selectedProviderId) ?? null;
    const hasApiKey = apiKey.trim().length > 0;
    const maskedApiKey = useMemo(() => maskApiKeyForDisplay(apiKey), [apiKey]);
    const shouldShowMaskedApiKey = hasApiKey && !isEditingApiKey;

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

            setSelectedProviderId(validProvider.id);
            setApiKey(storedApiKey);
            setSelectedModel(storedModel);
        } else {
            if (savedProviderId) {
                window.localStorage.setItem(storageKeys.selectedProvider, defaultProviderId);
            }
            setSelectedProviderId(defaultProviderId);
            setApiKey('');
            setSelectedModel('');
        }

        setIsHydrated(true);
    }, [defaultProviderId, getApiKeyStorageKey, getModelStorageKey, providerOptions, storageKeys.selectedProvider]);

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

            try {
                window.localStorage.setItem(storageKeys.selectedProvider, nextProviderId);
                if (apiKeyFromEvent != null) {
                    window.localStorage.setItem(getApiKeyStorageKey(nextProviderId), apiKeyFromEvent);
                }
                if (modelFromEvent) {
                    const isValidModel = provider.models.some(model => model.value === modelFromEvent);
                    const safeModel = isValidModel ? modelFromEvent : (provider.models[0]?.value || '');
                    if (safeModel) {
                        window.localStorage.setItem(getModelStorageKey(nextProviderId), safeModel);
                    }
                }
            } catch {
                // localStorage 在部分隐私模式/受限环境下可能不可用，忽略即可
            }

            setSelectedProviderId(nextProviderId);
            if (apiKeyFromEvent != null) {
                setApiKey(apiKeyFromEvent);
            }
            if (modelFromEvent) {
                const isValidModel = provider.models.some(model => model.value === modelFromEvent);
                setSelectedModel(isValidModel ? modelFromEvent : (provider.models[0]?.value || ''));
            }
        };

        window.addEventListener(PROVIDER_SELECTOR_SYNC_EVENT, handler as EventListener);
        return () => window.removeEventListener(PROVIDER_SELECTOR_SYNC_EVENT, handler as EventListener);
    }, [allowSystemProvider, getApiKeyStorageKey, getModelStorageKey, providerOptions, storageKeys.selectedProvider]);

    useEffect(() => {
        if (!isHydrated || typeof window === 'undefined') {
            return;
        }

        if (!activeProvider) {
            setApiKey('');
            setSelectedModel('');
            return;
        }

        let storedApiKey = '';
        let storedModel = activeProvider.models[0]?.value || '';

        try {
            window.localStorage.setItem(storageKeys.selectedProvider, selectedProviderId);
            storedApiKey = window.localStorage.getItem(getApiKeyStorageKey(activeProvider.id)) || '';
            storedModel = window.localStorage.getItem(getModelStorageKey(activeProvider.id)) || storedModel;
        } catch {
            // localStorage 在部分隐私模式/受限环境下可能不可用，忽略即可
        }

        setApiKey(storedApiKey);
        setSelectedModel(storedModel);
    }, [activeProvider, getApiKeyStorageKey, getModelStorageKey, isHydrated, selectedProviderId, storageKeys.selectedProvider]);

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

        const effectiveModel = selectedModel || activeProvider.models[0]?.value || '';
        const configKey = `${activeProvider.id}::${effectiveModel}::${apiKey.trim()}`;
        if (configKey === lastEmittedConfigKeyRef.current) {
            return;
        }
        lastEmittedConfigKeyRef.current = configKey;
        onConfigChangeRef.current({
            providerId: activeProvider.id,
            modelId: effectiveModel,
            apiKey: apiKey.trim(),
        });
    }, [activeProvider, apiKey, isHydrated, selectedModel]);

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

    const providerSelectOptions = useMemo<CustomSelectOption[]>(() => {
        return providerOptions.map((provider): CustomSelectOption => ({
            value: provider.id,
            label: provider.name,
            description: provider.description,
        }));
    }, [providerOptions]);

    const modelSelectOptions: CustomSelectOption[] = useMemo(() => {
        if (!activeProvider) return [];
        return activeProvider.models.map(model => ({
            value: model.value,
            label: model.label,
            description: model.description,
        }));
    }, [activeProvider]);

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
            </div>
        </div>
    );
};

export default AiProviderSelector;
