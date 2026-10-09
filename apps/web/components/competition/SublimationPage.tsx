'use client';

import React, { useState, ChangeEvent, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useGeneratedResultAutoScroll } from '@mahoshojo/ui-web/details-controls';
import MagicalGirlCard from '@/components/MagicalGirlCard';
import CanshouCard from '@/components/CanshouCard';
import GeneralCharacterCard from '@/components/GeneralCharacterCard';
import { getSensitiveWordRedirectTarget } from '@/lib/content-safety/client';
import { useClientRouteAdapter } from '@/lib/client-route-adapter';
import { downloadBlob } from '@/lib/client/blobUrl';
import { useProviderModeCooldown } from '@/lib/cooldown';
import { config as appConfig } from '@/lib/config';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import Footer from '@/components/Footer';
import BattleDataModal from '@/components/BattleDataModal';
import type { CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import { NarrativeHistoryModal } from '@/components/arena/components/NarrativeHistoryModal';
import { NarrativeHistoryPickerModal } from '@/components/arena/components/NarrativeHistoryPickerModal';
import { useNarrativeHistoryStore } from '@/components/arena/stores/useNarrativeHistoryStore';
import { useAuth } from '@/lib/useAuth';
import AiProviderSelector, { UserAIProviderConfig } from '@/components/AiProviderSelector';
import AiReasoningPanel from '@/components/ai/AiReasoningPanel';
import { ProviderCooldownNotice } from '@/components/ai/ProviderCooldownNotice';
import { ErrorMessage } from '@/components/ErrorMessage';
import { GenerationModeSwitcher, type GenerationMode } from '@/components/shared/GenerationModeSwitcher';
import { TokenIndicator } from '@/components/shared/TokenIndicator';
import { JsonSizeIndicator } from '@/components/shared/JsonSizeIndicator';
import { StreamStopButton } from '@/components/shared/StreamStopButton';
import { SublimationArenaHistoryStrategyFieldset, SublimationPageFrame, SublimationPageHeader, SublimationTargetField, SublimationGuidanceField, SublimationNarrativeField, SublimationPreserveFields, SublimationCurrentStateFieldset, SublimationLoreSelection, TARGET_TEMPLATE_OPTIONS, PRESERVABLE_FIELDS_CONFIG, getDefaultPreserveFields, getPersonalityPreset } from '@mahoshojo/ui-web/sublimation';
import { STREAM_ABORT_REASON_USER } from '@/lib/stream/abort';
import { readSafeTextAndReasoningStreamFromResponse } from '@/lib/stream/read-safe-text-and-reasoning-stream';
import { buildGeneralCharacterCardFromMarkdown } from '@/lib/stream/markdown-card';
import { buildStreamedSublimationResultCard } from '@/lib/sublimation/stream-result';
import { DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY } from '@/lib/sublimation/arena-history';
import {
  SUBLIMATION_STATE_PREF_KEY,
  SUBLIMATION_PREFERENCE_KEY,
  parseSublimationPreferencesDocument,
  writeSublimationPreferences,
  readSublimationStatePreferences,
  writeSublimationStatePreferences,
} from '@/lib/sublimation/preferences';
import { readJsonOrTextFromResponse, resolveApiErrorMessage } from '@/lib/client/apiError';
import { AI_META_REQUEST_HEADER, AI_META_REQUEST_VALUE, readJsonWithAiMeta } from '@/lib/client/read-json-with-ai-meta';
import { formatHttpErrorMessage } from '@/lib/client/httpError';
import { authStorage } from '@/lib/auth';
import { useGenerationApiIntentLatch } from '@/lib/use-generation-api-intent-latch';
import { buildCustomProviderRequestPayload } from '@/lib/ai/custom-provider';
import { formatDateTime } from '@/lib/constants';
import { composeSublimationNarrativeHistoryReference } from '@/lib/narrative-history';
import { mapDataCardSourceMeta } from '@/lib/data-card-read-mappers';
import {
  normalizeQuestionnaireDefinition,
  parseQuestionnaireDataCardPayload,
  type QuestionnairePresetEntry,
} from '@/lib/questionnaires';
import {
  buildQuestionnaireGenerationRequestFields,
  buildQuestionnaireSelectionLoreText,
  collectUsedQuestionnaireSelectionIds,
  createStoredQuestionnaireSelectionNormalizer,
  ensureQuestionnaireSelectionId,
  removeQuestionnaireSelection,
  setQuestionnaireSelectionLore,
  type QuestionnaireSelection,
} from '@mahoshojo/domain/questionnaire-selection';
import type { AIReasoningEnvelope } from '@/types/ai-reasoning';
import {
	    inferTemplate,
	    TEMPLATE_LABELS,
	    type DataCardTemplate,
    type InferableTemplate
} from '@/lib/data-card-converter';
import { GENERAL_CHARACTER_TEMPLATE_ID } from '@/lib/schemas/general-character';

// 颜色处理方案
const MainColor = {
    Red: '红色',
    Orange: '橙色',
    Cyan: '青色',
    Blue: '蓝色',
    Purple: '紫色',
    Pink: '粉色',
    Yellow: '黄色',
    Green: '绿色'
} as const;

const gradientColors: Record<string, { first: string; second: string }> = {
    [MainColor.Red]: { first: '#ff6b6b', second: '#ee5a6f' },
    [MainColor.Orange]: { first: '#ff922b', second: '#ffa94d' },
    [MainColor.Cyan]: { first: '#22b8cf', second: '#66d9e8' },
    [MainColor.Blue]: { first: '#5c7cfa', second: '#748ffc' },
    [MainColor.Purple]: { first: '#9775fa', second: '#b197fc' },
    [MainColor.Pink]: { first: '#ff9a9e', second: '#fecfef' },
    [MainColor.Yellow]: { first: '#f59f00', second: '#fcc419' },
    [MainColor.Green]: { first: '#51cf66', second: '#8ce99a' }
};

type SupportedTargetTemplate = 'magical-girl' | 'canshou' | 'general';

const createQuestionnaireSelectionSuffix = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeStoredSelection = createStoredQuestionnaireSelectionNormalizer({
    fallbackKind: (rawQuestionnaire) =>
        rawQuestionnaire && typeof rawQuestionnaire === 'object' &&
        (rawQuestionnaire as { kind?: unknown }).kind === 'canshou'
            ? 'canshou'
            : 'magical-girl',
    normalize: (value, fallback) => normalizeQuestionnaireDefinition(value, fallback),
});

type RateLimitError = Error & {
    retryAfterSeconds?: number;
};

// 递归提取对象中所有字符串值的函数
const extractTextForCheck = (data: any): string => {
    let textContent = '';
    if (typeof data === 'string') {
        textContent += data + ' ';
    } else if (Array.isArray(data)) {
        data.forEach(item => {
            textContent += extractTextForCheck(item);
        });
    } else if (typeof data === 'object' && data !== null) {
        for (const key in data) {
            if (key !== 'signature' && key !== 'userAnswers') {
                textContent += extractTextForCheck(data[key]);
            }
        }
    }
    return textContent;
};

type NativenessStatus = 'native' | 'derived' | 'checking' | 'unknown';

const NATIVENESS_BADGE_CONFIG: Record<NativenessStatus, { label: string; className: string }> = {
    native: { label: '原生数据', className: 'text-green-800 bg-green-100' },
    derived: { label: '衍生数据', className: 'text-yellow-800 bg-yellow-100' },
    checking: { label: '原生性校验中', className: 'text-gray-600 bg-gray-100' },
    unknown: { label: '原生性未知', className: 'text-gray-600 bg-gray-100' },
};

const NativenessBadge: React.FC<{ status: NativenessStatus }> = ({ status }) => {
    const config = NATIVENESS_BADGE_CONFIG[status];
    return (
        <span className={`px-3 py-1 text-xs font-semibold rounded-full ${config.className}`}>
            {config.label}
        </span>
    );
};

const hasNativeSignature = (data: any) =>
    typeof data?.signature === 'string' && data.signature.trim().length > 0;

// API响应和结果状态的类型
interface SublimationResponse {
    sublimatedData: any;
    unchangedFields: string[];
    targetTemplate?: SupportedTargetTemplate;
}

const getDefaultTargetTemplate = (source: InferableTemplate): SupportedTargetTemplate => {
    if (source === 'magical-girl') return 'magical-girl';
    if (source === 'canshou') return 'canshou';
    if (source === 'general') return 'general';
    return 'general';
};



export const SublimationPage: React.FC = () => {
    const generationApiIntentLatch = useGenerationApiIntentLatch();
    const resultSectionRef = useRef<HTMLDivElement | null>(null);
    const beginResultNavigation = useGeneratedResultAutoScroll(resultSectionRef);
    const router = useClientRouteAdapter();
    const { isAuthenticated } = useAuth();
    const [characterData, setCharacterData] = useState<any>(null);
    const [fileName, setFileName] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resultData, setResultData] = useState<SublimationResponse | null>(null);
    const [generationMode, setGenerationMode] = useState<GenerationMode>('non-stream');
    const [streamingMarkdown, setStreamingMarkdown] = useState<string | null>(null);
    const [streamedGeneralCard, setStreamedGeneralCard] = useState<any | null>(null);
    const [streamingReasoning, setStreamingReasoning] = useState<AIReasoningEnvelope | null>(null);
    const [nonStreamReasoning, setNonStreamReasoning] = useState<AIReasoningEnvelope | null>(null);
    const [streamNotice, setStreamNotice] = useState<string | null>(null);
    const streamAbortControllerRef = useRef<AbortController | null>(null);
    const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
    const [showImageModal, setShowImageModal] = useState(false);
    const [pastedJson, setPastedJson] = useState('');
    const [isPasteAreaVisible, setIsPasteAreaVisible] = useState(false);
    const [userGuidance, setUserGuidance] = useState('');
    const [narrativeHistory, setNarrativeHistory] = useState('');
    const [narrativeHistoryFileName, setNarrativeHistoryFileName] = useState<string | null>(null);
    const [showArenaNarrativePicker, setShowArenaNarrativePicker] = useState(false);
    const [showArenaNarrativeManager, setShowArenaNarrativeManager] = useState(false);
    const [arenaNarrativeSelectedIds, setArenaNarrativeSelectedIds] = useState<string[]>([]);
    const arenaNarrativeEntries = useNarrativeHistoryStore((state) => state.entries);
    const arenaNarrativeCount = useNarrativeHistoryStore((state) => state.entries.length);
    const arenaNarrativeLastUpdatedAt = useNarrativeHistoryStore((state) => state.lastUpdatedAt);

    // 数据库选择相关状态
    const [showBattleDataModal, setShowBattleDataModal] = useState(false);
    const [modalType, setModalType] = useState<'character' | 'scenario'>('character');

    // [新增] 用于管理高级选项的状态
    const [fieldsToPreserve, setFieldsToPreserve] = useState<string[]>([]);
    const [isAdvancedVisible, setIsAdvancedVisible] = useState(false);
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [preferencesError, setPreferencesError] = useState<string | null>(null);
    const [statePreferencesError, setStatePreferencesError] = useState<string | null>(null);
    const [allowReshapeNames, setAllowReshapeNames] = useState(false);
    const [isDowngrade] = useState(false); // 是否使用轻量模型
    const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);
    const [targetTemplate, setTargetTemplate] = useState<SupportedTargetTemplate>('magical-girl');
    const [sourceTemplate, setSourceTemplate] = useState<InferableTemplate>('unknown');
    const [readArenaHistory, setReadArenaHistory] = useState(true);
    const [writeArenaHistory, setWriteArenaHistory] = useState(true);
    const [readCurrentState, setReadCurrentState] = useState(true);
    const [writeCurrentState, setWriteCurrentState] = useState(true);
    const [arenaHistoryRetentionStrategy, setArenaHistoryRetentionStrategy] = useState(
        DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY,
    );
    const [isSourceNative, setIsSourceNative] = useState<boolean | null>(null);
    const [isSourceNativeChecking, setIsSourceNativeChecking] = useState(false);

    const isUserCustomKey = userProviderConfig?.providerId !== 'system' && !!userProviderConfig?.apiKey?.trim();
    const providerCooldownMode = isUserCustomKey ? 'custom' : 'system';
    const sublimationCooldownMs = isUserCustomKey ? 3000 : 60000;
    const { isCooldown, startCooldown, remainingTime, otherRemainingTime } = useProviderModeCooldown({
        baseKey: 'sublimationCooldown',
        currentMode: providerCooldownMode,
        systemDurationMs: 60000,
        customDurationMs: 3000,
    });
    const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
    const [selectedLanguage, setSelectedLanguage] = useState('zh-CN');
    const hasStoredSublimationPrefsRef = useRef(false);

    const [selectedQuestionnaires, setSelectedQuestionnaires] = useState<QuestionnaireSelection[]>([]);
    const [presetEntries, setPresetEntries] = useState<QuestionnairePresetEntry[]>([]);
    const [showQuestionnaireSettings, setShowQuestionnaireSettings] = useState(false);
    const [questionnaireLoadError, setQuestionnaireLoadError] = useState<string | null>(null);
    const [showQuestionnairePicker, setShowQuestionnairePicker] = useState(false);
    const [questionnairePickerError, setQuestionnairePickerError] = useState<string | null>(null);
    const [questionnaireDetailsCard, setQuestionnaireDetailsCard] = useState<{
        id: string;
        name: string;
        description: string;
        type: 'questionnaire';
        data: string;
        isPublic: boolean;
        author?: string;
    } | null>(null);
    const [showQuestionnaireDetailsModal, setShowQuestionnaireDetailsModal] = useState(false);
    const [showPasteQuestionnaireImport, setShowPasteQuestionnaireImport] = useState(false);
    const [pasteQuestionnaireText, setPasteQuestionnaireText] = useState('');
    const [pasteQuestionnaireError, setPasteQuestionnaireError] = useState<string | null>(null);

    const ensureSelectionId = useCallback(
        (selection: QuestionnaireSelection, used: Set<string>) =>
            ensureQuestionnaireSelectionId(selection, used, createQuestionnaireSelectionSuffix),
        [],
    );

    const questionnaireLoreText = useMemo(
        () => buildQuestionnaireSelectionLoreText(selectedQuestionnaires),
        [selectedQuestionnaires],
    );

    const streamedGeneralCardForDisplay = useMemo(() => {
        if (generationMode !== 'stream') return null;
        const markdown = streamingMarkdown ?? streamedGeneralCard?.content ?? null;
        if (markdown === null) return null;

        const fallbackName =
            typeof (characterData as any)?.codename === 'string'
                ? String((characterData as any).codename).trim()
                : typeof (characterData as any)?.name === 'string'
                    ? String((characterData as any).name).trim()
                    : '';

        const defaultName = sourceTemplate === 'magical-girl'
            ? '魔法少女'
            : sourceTemplate === 'canshou'
                ? '残兽'
                : '角色';

        const { card } = buildGeneralCharacterCardFromMarkdown({
            markdown,
            fallbackName,
            defaultName,
        });

        return card;
    }, [generationMode, streamingMarkdown, streamedGeneralCard, characterData, sourceTemplate]);

    useEffect(() => {
        fetch('/languages.json').then(res => res.json()).then(data => setLanguages(data));
        const isMobileDevice = /mobile/i.test(navigator.userAgent);
        if (isMobileDevice) setIsPasteAreaVisible(true);
    }, []);

    useEffect(() => {
        let cancelled = false;
        const loadPresetIndex = async () => {
            setQuestionnaireLoadError(null);
            try {
                const response = await fetch('/questionnaires/presets/index.json');
                if (!response.ok) throw new Error('加载预设问卷索引失败');
                const data = await response.json();
                const list = Array.isArray(data?.presets) ? (data.presets as QuestionnairePresetEntry[]) : [];
                if (!cancelled) setPresetEntries(list);
            } catch (error) {
                console.error('加载预设问卷失败:', error);
                if (!cancelled) {
                    setPresetEntries([]);
                    setQuestionnaireLoadError('📋 预设问卷加载失败，请刷新页面重试');
                }
            }
        };
        void loadPresetIndex();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const saved = window.localStorage.getItem(SUBLIMATION_PREFERENCE_KEY);
            if (!saved) return;
            const parsed = parseSublimationPreferencesDocument(saved);
            hasStoredSublimationPrefsRef.current = true;
            if (parsed?.generationMode === 'stream' || parsed?.generationMode === 'non-stream') {
                setGenerationMode(parsed.generationMode);
            }
            if (typeof parsed?.selectedLanguage === 'string') {
                setSelectedLanguage(parsed.selectedLanguage);
            }
            if (typeof parsed?.userGuidance === 'string') {
                setUserGuidance(parsed.userGuidance);
            }
            if (typeof parsed?.isAdvancedVisible === 'boolean') {
                setIsAdvancedVisible(parsed.isAdvancedVisible);
            }
            if (typeof parsed?.allowReshapeNames === 'boolean') {
                setAllowReshapeNames(parsed.allowReshapeNames);
            }
            if (typeof parsed.targetTemplate === 'string' && TARGET_TEMPLATE_OPTIONS.some((template) => template === parsed.targetTemplate)) {
                setTargetTemplate(parsed.targetTemplate as SupportedTargetTemplate);
            }
            if (Array.isArray(parsed?.fieldsToPreserve)) {
                const filtered = parsed.fieldsToPreserve.filter((value: unknown) => typeof value === 'string');
                setFieldsToPreserve(filtered);
            }
            if (typeof parsed?.showQuestionnaireSettings === 'boolean') {
                setShowQuestionnaireSettings(parsed.showQuestionnaireSettings);
            }
            if (Array.isArray(parsed?.questionnaireSelections)) {
                const usedSelectionIds = new Set<string>();
                const restored = (parsed.questionnaireSelections as unknown[])
                    .map((raw): QuestionnaireSelection | null => normalizeStoredSelection(raw))
                    .filter((item): item is QuestionnaireSelection => Boolean(item))
                    .map((item) => ensureSelectionId(item, usedSelectionIds));
                setSelectedQuestionnaires(restored);
            }
        } catch (error) {
            console.warn('读取升华偏好失败', error);
            setPreferencesError('偏好无法读取，原数据已保留；本页修改可能无法保存。');
        } finally { setPreferencesReady(true); }
    }, [ensureSelectionId]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const restored = readSublimationStatePreferences(window.localStorage, SUBLIMATION_STATE_PREF_KEY);
            setReadArenaHistory(restored.readArenaHistory);
            setWriteArenaHistory(restored.writeArenaHistory);
            setReadCurrentState(restored.readCurrentState);
            setWriteCurrentState(restored.writeCurrentState);
            setArenaHistoryRetentionStrategy(restored.arenaHistoryRetentionStrategy);
        } catch { setStatePreferencesError('历史/状态偏好无法读取，原数据已保留。'); }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined' || !preferencesReady) return;
        try {
            const saved = writeSublimationStatePreferences(window.localStorage, SUBLIMATION_STATE_PREF_KEY, {
                readArenaHistory,
                writeArenaHistory,
                readCurrentState,
                writeCurrentState,
                arenaHistoryRetentionStrategy,
            });
            setStatePreferencesError(saved ? null : '历史/状态偏好写入失败，原数据已保留。');
        } catch { setStatePreferencesError('历史/状态偏好写入失败，原数据已保留。'); }
    }, [preferencesReady, readArenaHistory, writeArenaHistory, readCurrentState, writeCurrentState, arenaHistoryRetentionStrategy]);

    useEffect(() => {
        if (typeof window === 'undefined' || !preferencesReady) return;
        try {
            const payload = {
                generationMode,
                selectedLanguage,
                userGuidance,
                isAdvancedVisible,
                allowReshapeNames,
                targetTemplate,
                fieldsToPreserve,
                showQuestionnaireSettings,
                questionnaireSelections: selectedQuestionnaires,
            };
            if (writeSublimationPreferences(window.localStorage, payload)) { hasStoredSublimationPrefsRef.current = true; setPreferencesError(null); }
            else setPreferencesError('升华偏好写入失败，原数据已保留。');
        } catch { setPreferencesError('升华偏好写入失败，原数据已保留。'); }
    }, [
        preferencesReady,
        generationMode,
        selectedLanguage,
        userGuidance,
        isAdvancedVisible,
        allowReshapeNames,
        targetTemplate,
        fieldsToPreserve,
        showQuestionnaireSettings,
        selectedQuestionnaires,
    ]);

    useEffect(() => {
        setFieldsToPreserve(prev => {
            const allowed = new Set(PRESERVABLE_FIELDS_CONFIG[targetTemplate].map(item => item.id));
            return prev.filter(field => allowed.has(field));
        });
    }, [targetTemplate]);

    const verifyOrigin = useCallback(async (data: any): Promise<boolean> => {
        try {
            const response = await fetch('/api/verify-origin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!response.ok) return false;
            const result = await response.json().catch(() => null as any);
            return Boolean(result?.isValid);
        } catch (error) {
            console.warn('原生性校验失败，将按非原生处理', error);
            return false;
        }
    }, []);

    useEffect(() => {
        if (!characterData) {
            setIsSourceNative(null);
            setIsSourceNativeChecking(false);
            return;
        }

        let isActive = true;
        setIsSourceNative(null);
        setIsSourceNativeChecking(true);
        verifyOrigin(characterData)
            .then((isValid) => {
                if (!isActive) return;
                setIsSourceNative(isValid);
            })
            .finally(() => {
                if (!isActive) return;
                setIsSourceNativeChecking(false);
            });

        return () => {
            isActive = false;
        };
    }, [characterData, verifyOrigin]);

    const resignDataCard = useCallback(async (data: any) => {
        const response = await fetch('/api/resign-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => null as any);
            if (errorData?.shouldRedirect) {
                router.push({
                    pathname: '/arrested',
                    query: { reason: errorData.reason || '编辑内容不合规' }
                });
                return null;
            }
            throw new Error(errorData?.message || '签名服务器认证失败');
        }

        return response.json();
    }, [router]);

    const shouldResignStreamedCard = useCallback(async () => {
        if (!characterData) return false;
        const isNative = await verifyOrigin(characterData);
        if (!isNative) return false;
        const hasNonNativeLore = selectedQuestionnaires.some((selection) =>
            selection.useLore !== false
            && Boolean(selection.questionnaire.loreMarkdown?.trim())
            && (selection.source === 'upload' || selection.questionnaire.nativeAllowed !== true)
        );
        if (hasNonNativeLore) return false;
        const trimmedGuidance = typeof userGuidance === 'string' ? userGuidance.trim() : '';
        const trimmedNarrativeHistory = typeof narrativeHistory === 'string' ? narrativeHistory.trim() : '';
        const hasArenaNarrativeSelection = Array.isArray(arenaNarrativeSelectedIds) && arenaNarrativeSelectedIds.length > 0;
        if (trimmedNarrativeHistory || hasArenaNarrativeSelection) {
            return false;
        }
        if (trimmedGuidance) {
            return appConfig.ALLOW_GUIDED_SUBLIMATION_NATIVE_SIGNING;
        }
        return true;
    }, [characterData, userGuidance, narrativeHistory, arenaNarrativeSelectedIds, verifyOrigin, selectedQuestionnaires]);

    const processJsonData = (jsonText: string) => {
        try {
            const json = JSON.parse(jsonText);
            setCharacterData(json);
            setFileName('粘贴的内容');
            setError(null);
            setResultData(null);

            const inferred = inferTemplate(json);
            setSourceTemplate(inferred);

            const defaultTarget = getDefaultTargetTemplate(inferred);
            const nextTarget = hasStoredSublimationPrefsRef.current ? targetTemplate : defaultTarget;
            setTargetTemplate(nextTarget);
            const isCrossTemplateSelection = inferred !== nextTarget;
            if (isCrossTemplateSelection) {
                setFieldsToPreserve([]);
            } else if (!hasStoredSublimationPrefsRef.current) {
                setFieldsToPreserve(getDefaultPreserveFields(nextTarget));
            }

            return true;
        } catch (err) {
            const message = err instanceof Error ? err.message : '无法解析文件。';
            setError(`❌ 数据加载失败: ${message}`);
            setCharacterData(null);
            setFileName(null);
            return false;
        }
    };

    const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.type !== 'application/json') {
            setError('❌ 文件必须是 .json 格式。');
            return;
        }
        const text = await file.text();
        if (processJsonData(text)) {
            setFileName(file.name);
        }
        event.target.value = '';
    };

    const handlePasteAndLoad = () => {
        if (!pastedJson.trim()) {
            setError('⚠️ 文本框内容为空。');
            return;
        }
        if (processJsonData(pastedJson)) {
            setPastedJson('');
        }
    };

    const handleNarrativeFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const text = await file.text();
        let normalizedText = text;
        if (file.name.toLowerCase().endsWith('.json')) {
            try {
                normalizedText = JSON.stringify(JSON.parse(text), null, 2);
            } catch {
                normalizedText = text;
            }
        }
        setNarrativeHistory(normalizedText);
        setNarrativeHistoryFileName(file.name);
        event.target.value = '';
    };

    const handleClearNarrativeHistory = () => {
        setNarrativeHistory('');
        setNarrativeHistoryFileName(null);
        setArenaNarrativeSelectedIds([]);
    };

    const buildQuestionnaireSelectionKey = useCallback((selection: QuestionnaireSelection): string => {
        if (selection.source === 'database') {
            const id = selection.dataCardId?.trim() ?? selection.questionnaire.id;
            return `database:${id}`;
        }
        if (selection.source === 'preset') {
            return `preset:${selection.questionnaire.id}`;
        }
        return `${selection.source}:${selection.questionnaire.id}`;
    }, []);

    const applyQuestionnaireSelection = useCallback((selection: QuestionnaireSelection) => {
        const hasLore = Boolean(selection.questionnaire.loreMarkdown?.trim());
        const normalizedSelection: QuestionnaireSelection = hasLore ? selection : { ...selection, useLore: false };

        setSelectedQuestionnaires((prev) => {
            const existingKeys = new Set(prev.map(buildQuestionnaireSelectionKey));
            const nextKey = buildQuestionnaireSelectionKey(normalizedSelection);
            if (existingKeys.has(nextKey)) return prev;

            return [...prev, ensureSelectionId(normalizedSelection, collectUsedQuestionnaireSelectionIds(prev))];
        });

        setQuestionnaireLoadError(null);
        setPasteQuestionnaireError(null);
        setPasteQuestionnaireText('');
        setShowPasteQuestionnaireImport(false);
    }, [buildQuestionnaireSelectionKey, ensureSelectionId]);

    const handleRemoveQuestionnaireSelection = (selectionId: string) => {
        setSelectedQuestionnaires((prev) => removeQuestionnaireSelection(prev, selectionId));
    };

    const handleToggleQuestionnaireLore = (selectionId: string, enabled: boolean) => {
        setSelectedQuestionnaires((prev) => setQuestionnaireSelectionLore(prev, selectionId, enabled));
    };

    const handleOpenQuestionnaireDetails = useCallback((selection: QuestionnaireSelection) => {
        const baseId = selection.source === 'database'
            ? (selection.dataCardId ?? selection.questionnaire.id)
            : (selection.questionnaire.id ?? '');
        const cardId = selection.source === 'database'
            ? baseId
            : `questionnaire:${selection.source}:${baseId}`;
        const name = (selection.dataCardName ?? selection.questionnaire.title ?? '未命名问卷').trim() || '未命名问卷';
        const description = selection.questionnaire.description?.trim() || '暂无简介';

        setQuestionnaireDetailsCard({
            id: cardId,
            name,
            description,
            type: 'questionnaire',
            data: JSON.stringify(selection.questionnaire, null, 2),
            isPublic: selection.source === 'database',
            author: selection.dataCardAuthor,
        });
        setShowQuestionnaireDetailsModal(true);
    }, []);

    const handleSelectQuestionnaireCard = (card: any) => {
        try {
            const rawData = parseQuestionnaireDataCardPayload(card);
            const cardSourceMeta = mapDataCardSourceMeta(card);

            const fallbackKind = rawData?.kind === 'canshou' ? 'canshou' : 'magical-girl';
            const normalized = normalizeQuestionnaireDefinition(rawData, {
                fallbackKind,
                fallbackId: typeof rawData?.id === 'string' ? rawData.id : `${fallbackKind}-card-${card?.id ?? ''}`,
                fallbackTitle: typeof rawData?.title === 'string' ? rawData.title : card?.name || '未命名问卷',
                nativeAllowed: typeof rawData?.nativeAllowed === 'boolean' ? rawData.nativeAllowed : false,
            });
            if (!normalized) throw new Error('问卷数据卡解析失败');

            applyQuestionnaireSelection({
                source: 'database',
                questionnaire: normalized,
                ...cardSourceMeta,
            });
            setQuestionnairePickerError(null);
            setShowQuestionnairePicker(false);
        } catch (err) {
            setQuestionnairePickerError(err instanceof Error ? err.message : '解析问卷失败');
        }
    };

    const handleUploadQuestionnaire = async (file: File | null) => {
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const fallbackKind = parsed?.kind === 'canshou' ? 'canshou' : 'magical-girl';
            const normalized = normalizeQuestionnaireDefinition(parsed, {
                fallbackKind,
                fallbackId: typeof parsed?.id === 'string' ? parsed.id : `${fallbackKind}-upload`,
                fallbackTitle: typeof parsed?.title === 'string' ? parsed.title : file.name.replace(/\.[^.]+$/, ''),
                nativeAllowed: false,
            });
            if (!normalized) throw new Error('问卷文件解析失败');
            normalized.nativeAllowed = false;
            applyQuestionnaireSelection({ source: 'upload', questionnaire: normalized });
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : '问卷文件解析失败');
        }
    };

    const handlePasteQuestionnaireImport = () => {
        if (!pasteQuestionnaireText.trim()) {
            setPasteQuestionnaireError('请先粘贴问卷 JSON');
            return;
        }
        try {
            const parsed = JSON.parse(pasteQuestionnaireText);
            const fallbackKind = parsed?.kind === 'canshou' ? 'canshou' : 'magical-girl';
            const normalized = normalizeQuestionnaireDefinition(parsed, {
                fallbackKind,
                fallbackId: typeof parsed?.id === 'string' ? parsed.id : `${fallbackKind}-paste`,
                fallbackTitle: typeof parsed?.title === 'string' ? parsed.title : '未命名问卷',
                nativeAllowed: false,
            });
            if (!normalized) throw new Error('问卷 JSON 无法识别，请检查格式');
            normalized.nativeAllowed = false;
            applyQuestionnaireSelection({ source: 'upload', questionnaire: normalized });
            setPasteQuestionnaireError(null);
            setError(null);
        } catch (err) {
            setPasteQuestionnaireError(err instanceof Error ? err.message : '问卷 JSON 解析失败');
        }
    };

    const handleAddPresetQuestionnaire = async (presetId: string) => {
        const preset = presetEntries.find((item) => item.id === presetId);
        if (!preset) return;
        try {
            const response = await fetch(preset.path);
            if (!response.ok) throw new Error('加载预设问卷失败');
            const data = await response.json();
            const nativeAllowed = typeof (data as any)?.nativeAllowed === 'boolean' ? Boolean((data as any).nativeAllowed) : true;
            const normalized = normalizeQuestionnaireDefinition(data, {
                fallbackKind: preset.kind,
                fallbackId: preset.id,
                fallbackTitle: preset.title,
                nativeAllowed,
            });
            if (!normalized) throw new Error('预设问卷解析失败');
            applyQuestionnaireSelection({ source: 'preset', questionnaire: normalized });
        } catch (err) {
            setQuestionnaireLoadError(err instanceof Error ? err.message : '预设问卷加载失败');
        }
    };

    // 打开角色数据卡选择器
    const handleOpenCharacterDataModal = () => {
        setShowBattleDataModal(true);
    };

    const handleTargetTemplateChange = (value: SupportedTargetTemplate) => {
        if (!TARGET_TEMPLATE_OPTIONS.includes(value)) return;
        setTargetTemplate(value);

        const isCrossTemplateSelection = Boolean(characterData && sourceTemplate !== value);
        if (isCrossTemplateSelection) {
            setFieldsToPreserve([]);
            return;
        }

        setFieldsToPreserve(getDefaultPreserveFields(value));
    };

    const handleSelectDataCard = async (card: any, context: CardLibrarySelectionContext) => {
        try {
            // 正文与卡库来源元数据分开：不能删除源卡以 _ 开头的自定义扩展。
            if (!context.rawSourceData) throw new Error('卡库未提供完整原文，请重新选择或导入 JSON。');
            const cleanedCardData = JSON.parse(JSON.stringify(context.rawSourceData));

            setCharacterData(cleanedCardData);
            setFileName(`${card._cardName || '未命名'}(来自数据库)`); // 使用内部传递的_cardName
            setShowBattleDataModal(false);
            setError(null);

            const inferred = inferTemplate(cleanedCardData);
            setSourceTemplate(inferred);
            const defaultTarget = getDefaultTargetTemplate(inferred);
            const nextTarget = hasStoredSublimationPrefsRef.current ? targetTemplate : defaultTarget;
            setTargetTemplate(nextTarget);
            const isCrossTemplateSelection = inferred !== nextTarget;
            if (isCrossTemplateSelection) {
                setFieldsToPreserve([]);
            } else if (!hasStoredSublimationPrefsRef.current) {
                setFieldsToPreserve(getDefaultPreserveFields(nextTarget));
            }

        } catch (err) {
            setError(`❌ 数据卡加载失败: ${err instanceof Error ? err.message : '未知错误'}`);
        }
    };

    const handleGenerate = async () => {
        if (isCooldown) {
            setError(`操作过于频繁，请等待 ${remainingTime} 秒后再试。`);
            return;
        }
        if (!characterData) {
            setError('⚠️ 请先上传一个角色设定文件。');
            return;
        }
        if (userProviderConfig && userProviderConfig.providerId !== 'system' && !userProviderConfig.apiKey) {
            setError('⚠️ 已选择自定义 AI 供应商，但尚未填写 API Key。');
            return;
        }
        setIsGenerating(true);
        setError(null);
        setResultData(null);
        setStreamingMarkdown(null);
        setStreamedGeneralCard(null);
        setStreamingReasoning(null);
        setNonStreamReasoning(null);
        setStreamNotice(null);
        let nextCooldownMs = sublimationCooldownMs;
        let shouldStartCooldown = false;

	        try {
                const finalNarrativeHistoryText = composeSublimationNarrativeHistoryReference(
                    arenaNarrativeEntries,
                    arenaNarrativeSelectedIds,
                    narrativeHistory
                );

	            const textToCheck = extractTextForCheck(characterData) + " " + userGuidance + " " + finalNarrativeHistoryText + " " + questionnaireLoreText;
	            const redirectTarget = await getSensitiveWordRedirectTarget(textToCheck, {
	                reason: '上传的角色档案或引导内容包含危险符文',
	            });
	            if (redirectTarget) {
	                router.push(redirectTarget);
	                return;
	            }

            const allowedFieldSet = new Set(currentFieldsConfig.map(item => item.id));
            const filteredFieldsToPreserve = fieldsToPreserve.filter(field => allowedFieldSet.has(field));

            const payload: Record<string, any> = {
                ...characterData,
                language: selectedLanguage,
                userGuidance: userGuidance.trim(),
                narrativeHistory: finalNarrativeHistoryText.trim(),
                fieldsToPreserve: filteredFieldsToPreserve,
                allowReshapeNames,
                isDowngrade: isDowngrade,
                targetTemplate: targetTemplate,
                readArenaHistory,
                writeArenaHistory,
                readCurrentState,
                writeCurrentState,
                arenaHistoryRetentionStrategy,
                customProvider: buildCustomProviderRequestPayload(userProviderConfig),
                ...buildQuestionnaireGenerationRequestFields(selectedQuestionnaires),
            };

            if (sourceTemplate !== 'unknown') {
                payload.sourceTemplate = sourceTemplate;
            }

            const endpoint = generationMode === 'stream' ? '/api/generate-sublimation-stream?format=sse' : '/api/generate-sublimation';
            const activityHeaders = await authStorage.getActivityHeaders();
            const requestHeaders: Record<string, string> = {
                'Content-Type': 'application/json',
                ...activityHeaders,
            };
            if (generationMode === 'stream') {
                requestHeaders.Accept = 'text/event-stream';
            } else {
                requestHeaders[AI_META_REQUEST_HEADER] = AI_META_REQUEST_VALUE;
            }
            const streamController = generationMode === 'stream' ? new AbortController() : null;
            if (streamController) {
                streamAbortControllerRef.current?.abort(STREAM_ABORT_REASON_USER);
                streamAbortControllerRef.current = streamController;
            }
            const generationIntent = generationApiIntentLatch.tryAcquire();
            if (!generationIntent) return;
            const revealGeneratedResult = beginResultNavigation(generationIntent, streamController?.signal);
            const response = await generationIntent.dispatch(endpoint, {
                method: 'POST',
                headers: requestHeaders,
                body: JSON.stringify(payload),
                ...(streamController ? { signal: streamController.signal } : {}),
            });

            if (!response.ok) {
                const { payload } = await readJsonOrTextFromResponse(response);
                const errorJson = payload && typeof payload === 'object' ? (payload as any) : null;
                if (errorJson?.shouldRedirect) {
                    router.push({
                        pathname: '/arrested',
                        query: { reason: errorJson.reason || '使用危险符文' }
                    });
                    return;
                }
                if (response.status === 429) {
                    const retryAfterRaw = errorJson?.retryAfterSeconds ?? errorJson?.retryAfter ?? response.headers.get('Retry-After') ?? 60;
                    const retryAfter = Math.max(1, Number.parseInt(String(retryAfterRaw), 10) || 60);
                    const rateLimitError = new Error(`请求过于频繁（HTTP 429）！请等待 ${retryAfter} 秒后再试。`) as RateLimitError;
                    rateLimitError.retryAfterSeconds = retryAfter;
                    throw rateLimitError;
                }
                const serverMessage = resolveApiErrorMessage({ payload, fallback: '升华失败' });
                throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: '升华失败' }));
            }

            if (generationMode === 'stream') {
                const contentType = (response.headers.get('content-type') || '').toLowerCase();
                if (contentType.includes('application/json') || contentType.includes('+json')) {
                    const { payload } = await readJsonOrTextFromResponse(response);
                    const serverMessage = resolveApiErrorMessage({ payload, fallback: '升华失败' });
                    throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: '升华失败' }));
                }

                setStreamingMarkdown('');
                const controller = streamAbortControllerRef.current;
                if (!controller) {
                    throw new Error('流式控制器初始化失败');
                }
                const { text: markdown, outputSafetyStatus, wasAborted, abortReason } = await readSafeTextAndReasoningStreamFromResponse(response, {
                    abortController: controller,
                    label: '升华（流式）',
                    onText: (text) => {
                        setStreamingMarkdown(text);
                        if (text.trim()) revealGeneratedResult();
                    },
                    onReasoning: (reasoning) => setStreamingReasoning(reasoning),
                    safetyReason: '使用危险符文',
                });

                const fallbackName =
                    typeof (characterData as any)?.codename === 'string'
                        ? String((characterData as any).codename).trim()
                        : typeof (characterData as any)?.name === 'string'
                            ? String((characterData as any).name).trim()
                            : '';

                const defaultName = sourceTemplate === 'magical-girl'
                    ? '魔法少女'
                    : sourceTemplate === 'canshou'
                        ? '残兽'
                        : '角色';

                const card = buildStreamedSublimationResultCard({
                    markdown,
                    originalCharacterData: characterData,
                    fallbackName,
                    defaultName,
                    writeArenaHistory,
                    retentionStrategy: arenaHistoryRetentionStrategy,
                    finalUserGuidance: userGuidance.trim() || null,
                    hasNarrativeHistory: Boolean(finalNarrativeHistoryText.trim()),
                    hasQuestionnaireLore: Boolean(questionnaireLoreText.trim()),
                    hasNonNativeQuestionnaireLore: selectedQuestionnaires.some((selection) =>
                        selection.useLore !== false
                        && Boolean(selection.questionnaire.loreMarkdown?.trim())
                        && (selection.source === 'upload' || selection.questionnaire.nativeAllowed !== true)
                    ),
                    questionnaireSelectionCount: selectedQuestionnaires.length,
                    isNative: isSourceNative === true,
                });
                if (outputSafetyStatus === 'blocked') {
                    setStreamNotice('输出触发调查院规则，已自动截断并追加逮捕令。当前内容可能不完整，但可继续保存。');
                } else if (wasAborted) {
                    setStreamNotice(
                        abortReason === STREAM_ABORT_REASON_USER
                            ? '已手动停止生成。当前内容可能不完整，但可继续保存。'
                            : '流式生成已中断。当前内容可能不完整，但可继续保存。'
                    );
                }

                let signedCard = card;
                let hasSignError = false;
                if (!wasAborted && outputSafetyStatus !== 'blocked') {
                    try {
                        const shouldSign = await shouldResignStreamedCard();
                        if (shouldSign) {
                            const result = await resignDataCard(card);
                            if (!result) return;
                            signedCard = result;
                        }
                    } catch (err) {
                        const message = err instanceof Error ? err.message : '签名失败';
                        setError(`⚠️ 原生性签名失败，已降级为非原生：${message}`);
                        hasSignError = true;
                    }
                }

                setStreamedGeneralCard(signedCard);
                if (!hasSignError && !wasAborted && outputSafetyStatus !== 'blocked') {
                    setError(null);
                }
                shouldStartCooldown = true;
                return;
            }

            const { data: result, aiMeta } = await readJsonWithAiMeta<SublimationResponse>(response);
            if (result.targetTemplate && TARGET_TEMPLATE_OPTIONS.includes(result.targetTemplate)) {
                setTargetTemplate(result.targetTemplate);
            }
            setResultData(result);
            if (result.sublimatedData) revealGeneratedResult();
            setNonStreamReasoning(aiMeta?.aiReasoning ?? null);
            shouldStartCooldown = true;

        } catch (err) {
            if (typeof (err as RateLimitError).retryAfterSeconds === 'number') {
                const cooldownSeconds = Math.max(1, Math.ceil((err as RateLimitError).retryAfterSeconds as number));
                nextCooldownMs = cooldownSeconds * 1000;
                shouldStartCooldown = true;
                setError(
                    isUserCustomKey
                        ? `🚫 自定义通道请求太频繁啦！请等待 ${cooldownSeconds} 秒后再试。`
                        : `🚫 请求太频繁了！请等待 ${cooldownSeconds} 秒后再试。`
                );
            } else {
                const message = err instanceof Error ? err.message : '发生未知错误';
                setError(`✨ 升华失败！${message}`);
            }
        } finally {
            streamAbortControllerRef.current = null;
            if (shouldStartCooldown) {
                startCooldown(nextCooldownMs);
            }
            setIsGenerating(false);
        }
    };

    const handleSaveImage = (imageUrl: string) => {
        setSavedImageUrl(imageUrl);
        setShowImageModal(true);
    };

    const downloadJson = (data: any) => {
        const name = data.codename || data.name;
        const jsonData = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        downloadBlob(blob, `角色档案_${name}_升华.json`);
    };

    const handleOptionalFieldChange = (fieldId: string) => {
        setFieldsToPreserve(prev =>
            prev.includes(fieldId)
                ? prev.filter(f => f !== fieldId)
                : [...prev, fieldId]
        );
    };

    const applyPreset = (presetName: 'default' | 'full' | 'personality') => {
        switch (presetName) {
            case 'default':
                setFieldsToPreserve(getDefaultPreserveFields(targetTemplate));
                break;
            case 'full':
                setFieldsToPreserve([]);
                break;
            case 'personality':
                setFieldsToPreserve(getPersonalityPreset(targetTemplate));
                break;
        }
    };

    const renderResultCard = () => {
        if (!resultData?.sublimatedData) return null;
        const data = resultData.sublimatedData;

        if (targetTemplate === 'magical-girl' && data.codename) {
            const colorScheme = data.appearance.colorScheme || "红色、粉色";
            const mainColorName = Object.values(MainColor).find(color => colorScheme.includes(color)) || MainColor.Pink;
            const colors = gradientColors[mainColorName] || gradientColors[MainColor.Pink];
            const gradientStyle = `linear-gradient(135deg, ${colors.first} 0%, ${colors.second} 100%)`;
            return <MagicalGirlCard magicalGirl={data} gradientStyle={gradientStyle} onSaveImage={handleSaveImage} />;
        } else if (targetTemplate === 'canshou' && data.name && data.templateId !== GENERAL_CHARACTER_TEMPLATE_ID) {
            return <CanshouCard canshou={data} onSaveImage={handleSaveImage} />;
        } else if (targetTemplate === 'general') {
            return <GeneralCharacterCard general={data} onSaveImage={handleSaveImage} />;
        }
        return (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                升华结果已生成，可通过“下载新设定”查看完整 JSON。当前模板不支持在页面内预览。
            </div>
        );
    };

    const sourceTemplateLabel = sourceTemplate === 'unknown'
        ? '未识别模板'
        : TEMPLATE_LABELS[sourceTemplate as DataCardTemplate];
    const hasCrossTemplateSelection = Boolean(characterData && sourceTemplate !== targetTemplate);
    const currentFieldsConfig = PRESERVABLE_FIELDS_CONFIG[targetTemplate];
    const trimmedGuidance = userGuidance.trim();
    const hasGuidance = trimmedGuidance.length > 0;
    const trimmedNarrativeHistory = narrativeHistory.trim();
    const hasArenaNarrativeSelection = Array.isArray(arenaNarrativeSelectedIds) && arenaNarrativeSelectedIds.length > 0;
    const hasNarrativeHistory = trimmedNarrativeHistory.length > 0 || hasArenaNarrativeSelection;
    const hasQuestionnaireLore = questionnaireLoreText.trim().length > 0;
    const hasNonNativeQuestionnaireLore =
        hasQuestionnaireLore
        && selectedQuestionnaires.some((selection) =>
            selection.useLore !== false
            && Boolean(selection.questionnaire.loreMarkdown?.trim())
            && (selection.source === 'upload' || selection.questionnaire.nativeAllowed !== true)
        );
    const shouldWarnGuidanceNativeness =
        hasGuidance
        && !hasNarrativeHistory
        && isSourceNative === true
        && !hasNonNativeQuestionnaireLore
        && !appConfig.ALLOW_GUIDED_SUBLIMATION_NATIVE_SIGNING;
    const shouldConfirmGuidanceNativeness =
        hasGuidance
        && !hasNarrativeHistory
        && isSourceNative === true
        && !hasNonNativeQuestionnaireLore
        && appConfig.ALLOW_GUIDED_SUBLIMATION_NATIVE_SIGNING;
    const shouldWarnNarrativeNativeness =
        hasNarrativeHistory
        && isSourceNative === true;
    const shouldWarnLoreNativeness =
        hasNonNativeQuestionnaireLore
        && isSourceNative === true;
    const sourceNativenessStatus: NativenessStatus | null = characterData
        ? (isSourceNativeChecking
            ? 'checking'
            : isSourceNative === null
                ? 'unknown'
                : isSourceNative
                    ? 'native'
                    : 'derived')
        : null;
    const nonStreamResultNativenessStatus: NativenessStatus | null = resultData?.sublimatedData
        ? (hasNativeSignature(resultData.sublimatedData) ? 'native' : 'derived')
        : null;
    const streamResultNativenessStatus: NativenessStatus | null = streamedGeneralCardForDisplay
        ? (streamedGeneralCard
            ? (hasNativeSignature(streamedGeneralCard) ? 'native' : 'derived')
            : isGenerating
                ? 'checking'
                : 'unknown')
        : null;

    return (
        <>
            <SublimationPageFrame afterContainer={<>
                {showImageModal && savedImageUrl && (
                    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-auto relative">
                            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur flex justify-end p-2">
                                <button
                                    onClick={() => setShowImageModal(false)}
                                    aria-label="关闭"
                                    className="text-3xl leading-none text-gray-600 hover:text-gray-900"
                                >
                                    ×
                                </button>
                            </div>
                            <div className="px-4 pb-4">
                                <p className="text-center text-sm text-gray-600 mb-2">长按图片保存到相册</p>
                                <img src={savedImageUrl} alt="角色卡片" className="w-full h-auto rounded-lg" />
                            </div>
                        </div>
                    </div>
                )}
                <Footer />

                {/* 数据库数据选择模态框 */}
	                <BattleDataModal
	                    isOpen={showBattleDataModal}
	                    onClose={() => setShowBattleDataModal(false)}
	                    onSelectCard={handleSelectDataCard}
	                    selectedType={modalType}
	                />

                    <BattleDataModal
                        isOpen={showQuestionnairePicker}
                        onClose={() => {
                            setShowQuestionnairePicker(false);
                            setQuestionnairePickerError(null);
                        }}
                        selectedType="questionnaire"
                        initialTab="public"
                        titleOverride="选择云端问卷"
                        onSelectCard={handleSelectQuestionnaireCard}
                        externalError={questionnairePickerError}
                    />

                    {questionnaireDetailsCard && (
                        <DataCardDetailsModal
                            isOpen={showQuestionnaireDetailsModal}
                            onClose={() => {
                                setShowQuestionnaireDetailsModal(false);
                                setQuestionnaireDetailsCard(null);
                            }}
                            card={{
                                id: questionnaireDetailsCard.id,
                                name: questionnaireDetailsCard.name,
                                description: questionnaireDetailsCard.description,
                                type: 'questionnaire',
                                data: questionnaireDetailsCard.data,
                                isPublic: questionnaireDetailsCard.isPublic,
                                author: questionnaireDetailsCard.author,
                            }}
                        />
                    )}

                    <NarrativeHistoryPickerModal
                        isOpen={showArenaNarrativePicker}
                        onClose={() => setShowArenaNarrativePicker(false)}
                        initialSelectedIds={arenaNarrativeSelectedIds}
                        onConfirm={(entries) => {
                            setArenaNarrativeSelectedIds(entries.map((entry) => entry.id));
                            setShowArenaNarrativePicker(false);
                        }}
                    />
                    <NarrativeHistoryModal
                        isOpen={showArenaNarrativeManager}
                        onClose={() => setShowArenaNarrativeManager(false)}
                    />
            </>}>
                    <div className="card">
                        <SublimationPageHeader onNavigate={(href) => router.push(href)} />

                        {/* 文件上传与粘贴区域 */}
                        <div className="input-group">
                            <label htmlFor="character-upload" className="input-label">上传设定文件</label>
                            <input id="character-upload" type="file" accept=".json" onChange={handleFileChange} className="input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100" />
                            {fileName && (
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                    <span className="text-gray-500">已加载角色: {fileName}</span>
                                    {sourceNativenessStatus && <NativenessBadge status={sourceNativenessStatus} />}
                                </div>
                            )}
                        </div>
                        <div className="mb-6">
                            <button onClick={() => setIsPasteAreaVisible(!isPasteAreaVisible)} className="text-purple-700 hover:underline cursor-pointer mb-2 font-semibold">
                                {isPasteAreaVisible ? '▼ 折叠文本粘贴区域' : '▶ 展开文本粘贴区域 (手机端推荐)'}
                            </button>
                            {isPasteAreaVisible && (
                                <div className="input-group mt-2">
                                    <textarea value={pastedJson} onChange={(e) => setPastedJson(e.target.value)} placeholder="在此处粘贴一个设定文件(.json)内容" className="input-field resize-y h-32" />
                                    <button onClick={handlePasteAndLoad} disabled={isGenerating} className="generate-button mt-2 mb-0" style={{ backgroundColor: '#8b5cf6', backgroundImage: 'linear-gradient(to right, #8b5cf6, #a78bfa)' }}>从文本加载设定</button>
                                </div>
                            )}
                        </div>

                        {/* 数据库选择区域 */}
                        <div className="mb-6">
                            <h3 className="input-label">从数据库选择角色</h3>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleOpenCharacterDataModal}
                                    disabled={isGenerating}
                                    className="flex-1 px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                    从在线角色数据库中选择
                                </button>
                                <select
                                    value={modalType}
                                    onChange={(e) => setModalType(e.target.value as 'character' | 'scenario')}
                                    className="flex-1 input-field"
                                    disabled={isGenerating}
                                >
                                    <option value="character">角色/残兽/通用</option>
                                    <option value="scenario">情景 (Scenario)</option>
                                </select>
                            </div>
                            {!isAuthenticated && (
                                <p className="text-xs text-gray-500 mt-1">
                                    <Link
                                        href="/character-manager"
                                        className="text-purple-600 hover:text-purple-800 underline"
                                    >
                                        登录
                                    </Link>
                                    后可访问私有数据卡与收藏夹。
                                </p>
                            )}
                            {isAuthenticated && (
                                <p className="text-xs text-gray-500 mt-1">
                                    支持任意设定素材；默认会引用档案中的历战记录，可在下方“资料读写策略”中关闭读取或写入。
                                </p>
                            )}
                        </div>

                        <SublimationTargetField targetTemplate={targetTemplate} sourceTemplateLabel={sourceTemplateLabel} hasCrossTemplateSelection={hasCrossTemplateSelection} disabled={isGenerating || !characterData} onChange={handleTargetTemplateChange} />

                        <SublimationLoreSelection
                            expanded={showQuestionnaireSettings}
                            onExpandedChange={setShowQuestionnaireSettings}
                            disabled={isGenerating}
                            selections={selectedQuestionnaires}
                            presets={presetEntries}
                            onSelectPreset={handleAddPresetQuestionnaire}
                            onUpload={handleUploadQuestionnaire}
                            onOpenPicker={() => {
                                setQuestionnairePickerError(null);
                                setShowQuestionnairePicker(true);
                            }}
                            onToggleLore={handleToggleQuestionnaireLore}
                            onRemove={handleRemoveQuestionnaireSelection}
                            onDetails={handleOpenQuestionnaireDetails}
                            pasteExpanded={showPasteQuestionnaireImport}
                            onPasteExpandedChange={(expanded) => {
                                setPasteQuestionnaireError(null);
                                setShowPasteQuestionnaireImport(expanded);
                            }}
                            pasteText={pasteQuestionnaireText}
                            onPasteTextChange={setPasteQuestionnaireText}
                            onPasteImport={handlePasteQuestionnaireImport}
                            onPasteClear={() => {
                                setPasteQuestionnaireText('');
                                setPasteQuestionnaireError(null);
                            }}
                            loadError={questionnaireLoadError}
                            pasteError={pasteQuestionnaireError}
                            tokenIndicator={questionnaireLoreText.trim() ? (
                                <TokenIndicator
                                    text={questionnaireLoreText}
                                    warningText="⚠️ 注入设定较长时，升华更易超时/失败。可尝试精简 lore 或减少勾选内容。"
                                />
                            ) : null}
                            warnNonNative={shouldWarnLoreNativeness}
                            editorNavigation={{ onNavigate: (href) => router.push(href) }}
                        />

                        <SublimationGuidanceField value={userGuidance} onChange={setUserGuidance} disabled={isGenerating}>
                            {shouldConfirmGuidanceNativeness && (
                                <p className="text-xs text-green-700 mt-1">✅ 管理员已允许引导升华保留原生签名。</p>
                            )}
                            {shouldWarnGuidanceNativeness && (
                                <p className="text-xs text-yellow-700 mt-1">
                                    ⚠️ 当前素材为原生，提供引导将使升华结果变为“衍生数据”（非原生），并移除原生签名。
                                </p>
                            )}
                        </SublimationGuidanceField>

                        <SublimationNarrativeField value={narrativeHistory} onChange={(value) => { setNarrativeHistory(value); if (narrativeHistoryFileName) setNarrativeHistoryFileName(null); }} disabled={isGenerating}>
	                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
	                                <input
	                                    id="narrative-history-upload"
                                    type="file"
                                    accept=".txt,.md,.json"
                                    onChange={handleNarrativeFileChange}
                                    className="text-xs"
                                    disabled={isGenerating}
                                />
	                                {narrativeHistoryFileName && (
	                                    <span className="text-gray-500">已加载叙事历史文件: {narrativeHistoryFileName}</span>
	                                )}
	                                {(narrativeHistory || narrativeHistoryFileName || hasArenaNarrativeSelection) && (
	                                    <button
	                                        type="button"
	                                        onClick={handleClearNarrativeHistory}
	                                        className="text-purple-700 hover:underline"
	                                        disabled={isGenerating}
                                    >
	                                        清空叙事历史
	                                    </button>
	                                )}
	                            </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                    <button
                                        type="button"
                                        onClick={() => setShowArenaNarrativePicker(true)}
                                        className="px-3 py-2 text-xs font-semibold rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                        disabled={isGenerating}
                                    >
                                        从竞技场叙事历史选择
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowArenaNarrativeManager(true)}
                                        className="px-3 py-2 text-xs font-semibold rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                        disabled={isGenerating}
                                    >
                                        查看/编辑竞技场叙事历史
                                    </button>
                                    <span className="text-gray-500">
                                        竞技场缓存：{arenaNarrativeCount} 条{arenaNarrativeLastUpdatedAt ? `｜最近更新：${formatDateTime(arenaNarrativeLastUpdatedAt)}` : ''}
                                    </span>
                                    {hasArenaNarrativeSelection && (
                                        <span className="text-gray-500">已选：{arenaNarrativeSelectedIds.length} 条</span>
                                    )}
                                </div>
                                <p className="text-[11px] text-gray-500 mt-1">
                                    最终会合并“竞技场勾选条目 + 文本框/上传内容”作为升华参考；不勾选则不会引用竞技场叙事历史。
                                </p>
	                            {shouldWarnNarrativeNativeness && (
	                                <p className="text-xs text-yellow-700 mt-1">
	                                    ⚠️ 已提供叙事历史，本次升华结果将标记为“衍生数据”（非原生），并移除原生签名。
	                                </p>
                            )}
                            {!shouldWarnNarrativeNativeness && hasNarrativeHistory && (
                                <p className="text-xs text-gray-600 mt-1">
                                    已加入叙事历史，本次升华结果将标记为“衍生数据”（非原生），AI 将据此补充升华背景。
                                </p>
                            )}
                        </SublimationNarrativeField>

                        {/* 历战记录 / 当前状态策略 */}
                        <div className="input-group">
                            <label className="input-label">资料读写策略</label>
                            <div className="grid gap-4 md:grid-cols-2">
                                <SublimationArenaHistoryStrategyFieldset
                                    readArenaHistory={readArenaHistory}
                                    writeArenaHistory={writeArenaHistory}
                                    retentionStrategy={arenaHistoryRetentionStrategy}
                                    disabled={isGenerating}
                                    onReadArenaHistoryChange={setReadArenaHistory}
                                    onWriteArenaHistoryChange={setWriteArenaHistory}
                                    onRetentionStrategyChange={setArenaHistoryRetentionStrategy}
                                />
                                <SublimationCurrentStateFieldset readCurrentState={readCurrentState} writeCurrentState={writeCurrentState} disabled={isGenerating} streamMode={generationMode === 'stream'} onReadChange={setReadCurrentState} onWriteChange={setWriteCurrentState} />
                            </div>
                        </div>

                        <SublimationPreserveFields expanded={isAdvancedVisible} hasSource={!!characterData} disabled={isGenerating} onToggle={() => setIsAdvancedVisible(!isAdvancedVisible)} targetTemplate={targetTemplate} fieldsToPreserve={fieldsToPreserve} allowReshapeNames={allowReshapeNames} onAllowReshapeNamesChange={setAllowReshapeNames} onFieldChange={handleOptionalFieldChange} onPreset={applyPreset} />

                        {/* 多语言支持 */}
                        <div className="input-group">
                            <label htmlFor="language-select" className="input-label">
                                <img src="/globe.svg" alt="Language" className="inline-block w-4 h-4 mr-2" />
                                生成语言
                            </label>
                            <select
                                id="language-select"
                                value={selectedLanguage}
                                onChange={(e) => setSelectedLanguage(e.target.value)}
                                className="input-field"
                                disabled={isGenerating}
                            >
                                {languages.map(lang => (
                                    <option key={lang.code} value={lang.code}>{lang.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="input-group">
                            <GenerationModeSwitcher
                                label="生成方式"
                                value={generationMode}
                                disabled={isGenerating}
                                helper={false}
                                onChange={(mode) => setGenerationMode(mode)}
                            />
                            <p className="text-xs text-gray-500 mt-2">
                                {generationMode === 'stream'
                                    ? '提示：选择流式生成后，将实时输出 Markdown，并生成【通用角色卡】（templateId=通用角色）。代号/名字会尝试从输出中解析，失败则回退到原卡名称或“角色”。'
                                    : '提示：非流式生成会返回结构化数据卡（按目标模板输出），更适合继续升华/编辑。'}
                            </p>
                        </div>

                        {/* 自定义 AI 模型选择 */}
                        <AiProviderSelector onConfigChange={setUserProviderConfig} />
                        <ProviderCooldownNotice
                            currentMode={providerCooldownMode}
                            currentIsCooldown={isCooldown}
                            otherRemainingTime={otherRemainingTime}
                        />

                        {/* 成功提示信息 */}
                        {!isGenerating && generationMode === 'non-stream' && resultData && (
                            <div className="text-center text-sm text-green-600 my-2 font-semibold">
                                🎉 升华成功！结果已显示在下方，请下滑查看。
                            </div>
                        )}
                        {!isGenerating && generationMode === 'stream' && streamedGeneralCard && !streamNotice && (
                            <div className="text-center text-sm text-green-600 my-2 font-semibold">
                                🎉 升华成功！已生成通用角色卡（流式），请下滑查看。
                            </div>
                        )}

                        {/* 更新按钮状态和文本 */}
                        <button onClick={handleGenerate} disabled={isGenerating || !characterData || isCooldown} className="generate-button mt-4">
                            {isCooldown ? `冷却中 (${remainingTime}s)` : isGenerating ? '升华中...' : '开始升华'}
                        </button>
                        {isGenerating && generationMode === 'stream' ? (
                            <div className="mt-3 flex justify-center">
                                <StreamStopButton
                                    onClick={() => streamAbortControllerRef.current?.abort(STREAM_ABORT_REASON_USER)}
                                    label="停止生成"
                                />
                            </div>
                        ) : null}
                        {streamNotice ? <div className="mt-3 text-center text-sm text-amber-700">{streamNotice}</div> : null}
                        {preferencesError || statePreferencesError ? <p role="alert" className="text-sm text-red-600">{[preferencesError, statePreferencesError].filter(Boolean).join(' ')}</p> : null}
                        {error && <ErrorMessage message={error} className="error-message mt-4" />}
                    </div>

                    {isGenerating && <div className="text-center mt-6">少女蜕变中，请稍后...</div>}

                    {generationMode === 'stream' && (streamingMarkdown !== null || streamedGeneralCard) && (
                        <>
                            {streamedGeneralCardForDisplay && (
                                <div ref={resultSectionRef} className="card mt-6">
                                    {streamResultNativenessStatus && (
                                        <div className="flex items-center justify-between mb-3">
                                            <h3 className="text-sm font-semibold text-gray-700">升华结果原生性</h3>
                                            <NativenessBadge status={streamResultNativenessStatus} />
                                        </div>
                                    )}
                                    <GeneralCharacterCard
                                        general={streamedGeneralCardForDisplay}
                                        onSaveImage={handleSaveImage}
                                        isStreaming={isGenerating}
                                        onStopGeneration={() => streamAbortControllerRef.current?.abort(STREAM_ABORT_REASON_USER)}
                                    />
                                    <AiReasoningPanel reasoning={streamingReasoning} status={streamingReasoning?.status ?? 'idle'} compact />
                                    <p className="mt-3 text-xs text-gray-500 text-center">
                                        提示：流式模式生成的是通用角色卡（Markdown），不保证与目标模板字段一一对应。
                                    </p>
                                    <p className="mt-1 text-xs text-gray-500 text-center">
                                        下载/保存的 JSON 已按所选历战策略写回；页面预览不展示这部分历史元数据。
                                    </p>
                                </div>
                            )}

                            {streamedGeneralCard && (
                                <div className="card mt-6 text-center">
                                    <h3 className="text-lg font-bold text-gray-800 mb-3">操作</h3>
                                    <div className="flex flex-col md:flex-row justify-center">
                                        <button onClick={() => downloadJson(streamedGeneralCard)} className="generate-button flex-1">
                                            下载通用角色卡
                                        </button>
                                        <SaveToCloudButton
                                            data={streamedGeneralCard}
                                            cardType="character"
                                            buttonText="保存到云端"
                                            className="generate-button flex-1"
                                            style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                                        />
                                        <Link href="/battle" className="generate-button flex-1" style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)', textDecoration: 'none' }}>
                                            前往竞技场
                                        </Link>
                                    </div>
                                    <JsonSizeIndicator
                                        data={streamedGeneralCard}
                                        warningText="⚠️ 接近云端 300KB 上限，保存/替换可能失败，请先精简数据。"
                                    />
                                </div>
                            )}
                        </>
                    )}

                    {generationMode === 'non-stream' && resultData && (
                        <>
                            {nonStreamReasoning && (
                                <AiReasoningPanel
                                    reasoning={nonStreamReasoning}
                                    status={nonStreamReasoning.status}
                                    displayMode="content-only"
                                    compact
                                />
                            )}
                            {resultData.unchangedFields && resultData.unchangedFields.length > 0 && (
                                <div className="card mt-6 bg-blue-50 border border-blue-200">
                                    <h4 className="font-bold text-blue-800 mb-2">升华报告</h4>
                                    <p className="text-sm text-blue-700">AI 已根据角色经历更新设定，但以下字段保留原始设定：</p>
                                    <ul className="list-disc list-inside text-xs text-blue-600 mt-2 pl-2">
                                        {resultData.unchangedFields.map(field => <li key={field}>{field}</li>)}
                                    </ul>
                                </div>
                            )}
                            {nonStreamResultNativenessStatus && (
                                <div className="card mt-6 flex items-center justify-between">
                                    <h3 className="text-sm font-semibold text-gray-700">升华结果原生性</h3>
                                    <NativenessBadge status={nonStreamResultNativenessStatus} />
                                </div>
                            )}
                            <div ref={resultSectionRef}>{renderResultCard()}</div>
                            <div className="card mt-6 text-center">
                                <h3 className="text-lg font-bold text-gray-800 mb-3">操作</h3>
                                <div className="flex flex-col md:flex-row justify-center">
                                    <button onClick={() => downloadJson(resultData.sublimatedData)} className="generate-button flex-1">
                                        下载新设定
                                    </button>
                                    <SaveToCloudButton
                                        data={resultData.sublimatedData}
                                        buttonText="保存到云端"
                                        className="generate-button flex-1"
                                        style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                                    />
                                    <Link href="/battle" className="generate-button flex-1" style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)', textDecoration: 'none' }}>
                                        前往竞技场
                                    </Link>
                                </div>
                                <JsonSizeIndicator
                                    data={resultData.sublimatedData}
                                    warningText="⚠️ 接近云端 300KB 上限，保存/替换可能失败，请先精简数据。"
                                />
                            </div>
                        </>
                    )}

                    <div className="text-center" style={{ marginTop: '2rem' }}>
                        <Link href="/" className="footer-link">返回首页</Link>
                    </div>
            </SublimationPageFrame>

	        </>
	    );
	};
