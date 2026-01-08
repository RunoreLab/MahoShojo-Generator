import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AI_PROVIDER_CATALOG, type AIProviderOption } from '@/lib/ai/constants';
import Link from 'next/link';

export interface UserAIProviderConfig {
    providerId: string;
    modelId: string;
    apiKey: string;
}

interface AiProviderSelectorProps {
    onConfigChange: (config: UserAIProviderConfig | null) => void;
}

const STORAGE_SELECTED_PROVIDER = 'arena.customProvider.selected';
const STORAGE_API_KEY_PREFIX = 'arena.customProvider.apiKey.';
const STORAGE_MODEL_PREFIX = 'arena.customProvider.model.';
const PROVIDER_SELECTOR_SYNC_EVENT = 'mahoshojo:set-ai-provider-config';

const getApiKeyStorageKey = (providerId: string) => `${STORAGE_API_KEY_PREFIX}${providerId}`;
const getModelStorageKey = (providerId: string) => `${STORAGE_MODEL_PREFIX}${providerId}`;

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
            <span className="text-sm font-semibold text-gray-800">
                {selectedOption?.label ?? placeholder}
            </span>
            <span className="text-xs text-gray-500">
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
                <span className="text-gray-400">{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
                <div className="absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-lg border border-pink-200 bg-white shadow-lg">
                    <div role="listbox">
                        {options.map(option => (
                            <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={option.value === value}
                                className={`flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition-colors ${option.value === value ? 'bg-pink-100 text-pink-700' : 'hover:bg-pink-50'
                                    }`}
                                onClick={() => {
                                    onChange(option.value);
                                    setIsOpen(false);
                                }}
                            >
                                <span className="text-sm font-semibold text-gray-800">
                                    {option.label}
                                </span>
                                {option.description && (
                                    <span className="text-xs text-gray-500">
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

const AiProviderSelector: React.FC<AiProviderSelectorProps> = ({ onConfigChange }) => {
    const providerOptions = useMemo<AIProviderOption[]>(() => AI_PROVIDER_CATALOG, []);
    const [selectedProviderId, setSelectedProviderId] = useState<string>('system');
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [apiKey, setApiKey] = useState<string>('');
    const [isHydrated, setIsHydrated] = useState<boolean>(false);

    const activeProvider = providerOptions.find(provider => provider.id === selectedProviderId) ?? null;

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const savedProviderId = window.localStorage.getItem(STORAGE_SELECTED_PROVIDER);
        const validProvider = savedProviderId
            ? providerOptions.find(item => item.id === savedProviderId)
            : null;

        if (!savedProviderId) {
            window.localStorage.setItem(STORAGE_SELECTED_PROVIDER, 'system');
        }

        if (validProvider) {
            const storedApiKey = window.localStorage.getItem(getApiKeyStorageKey(validProvider.id)) || '';
            const storedModel = window.localStorage.getItem(getModelStorageKey(validProvider.id)) || validProvider.models[0]?.value || '';

            setSelectedProviderId(validProvider.id);
            setApiKey(storedApiKey);
            setSelectedModel(storedModel);
        } else {
            if (savedProviderId) {
                window.localStorage.setItem(STORAGE_SELECTED_PROVIDER, 'system');
            }
            setSelectedProviderId('system');
            setApiKey('');
            setSelectedModel('');
        }

        setIsHydrated(true);
    }, [providerOptions]);

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

            const provider = providerOptions.find(item => item.id === nextProviderId) ?? null;
            if (!provider) {
                return;
            }

            const modelFromEvent = typeof detail.modelId === 'string' ? detail.modelId.trim() : '';
            const apiKeyFromEvent = typeof detail.apiKey === 'string' ? detail.apiKey : null;

            try {
                window.localStorage.setItem(STORAGE_SELECTED_PROVIDER, nextProviderId);
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
    }, [providerOptions]);

    useEffect(() => {
        if (!isHydrated || typeof window === 'undefined') {
            return;
        }

        window.localStorage.setItem(STORAGE_SELECTED_PROVIDER, selectedProviderId);

        if (!activeProvider) {
            setApiKey('');
            setSelectedModel('');
            onConfigChange(null);
            return;
        }

        const storedApiKey = window.localStorage.getItem(getApiKeyStorageKey(activeProvider.id)) || '';
        const storedModel = window.localStorage.getItem(getModelStorageKey(activeProvider.id)) || activeProvider.models[0]?.value || '';

        setApiKey(storedApiKey);
        setSelectedModel(storedModel);
    }, [activeProvider, isHydrated, onConfigChange, selectedProviderId]);

    useEffect(() => {
        if (!isHydrated || !activeProvider) {
            return;
        }

        const effectiveModel = selectedModel || activeProvider.models[0]?.value || '';
        onConfigChange({
            providerId: activeProvider.id,
            modelId: effectiveModel,
            apiKey: apiKey.trim(),
        });
    }, [activeProvider, apiKey, isHydrated, onConfigChange, selectedModel]);

    useEffect(() => {
        if (!isHydrated || !activeProvider || typeof window === 'undefined') {
            return;
        }
        window.localStorage.setItem(getApiKeyStorageKey(activeProvider.id), apiKey);
    }, [activeProvider, apiKey, isHydrated]);

    useEffect(() => {
        if (!isHydrated || !activeProvider || typeof window === 'undefined') {
            return;
        }
        if (!selectedModel) {
            return;
        }
        window.localStorage.setItem(getModelStorageKey(activeProvider.id), selectedModel);
    }, [activeProvider, isHydrated, selectedModel]);

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
            <label className="input-label">自定义 AI 能力提供商 (可选)</label>
            <CustomSelect
                options={providerSelectOptions}
                value={selectedProviderId}
                onChange={setSelectedProviderId}
                placeholder="选择供应商"
            />
            <label className="text-xs text-gray-500">更多提供商正在添加中...</label>
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

            <div className="mt-3 space-y-3 rounded-lg border border-pink-200 bg-pink-50 p-3 text-sm text-gray-700">
                <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">选择模型</label>
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
                            <label className="block text-xs font-semibold text-gray-600 mb-1">API Key</label>
                            <input
                                className="input-field"
                                placeholder="请输入该供应商的 API Key"
                                value={apiKey}
                                onChange={(event) => setApiKey(event.target.value)}
                            />
                            <p className="mt-1 text-xs text-gray-500">
                                API Key 仅存储于本地浏览器 localStorage，不会上传到服务器。
                            </p>
                        </div>
                    )
                }
            </div>
        </div>
    );
};

export default AiProviderSelector;
