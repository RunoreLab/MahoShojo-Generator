'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { quickCheck, type FilterResult, type SensitiveMatchDetail } from '@/lib/sensitive-word-filter';
import { randomChooseOneHanaName } from '@/lib/random-choose-hana-name';
import { config } from '@/lib/config';
import { validateDataCard, ValidationResult } from '@/lib/schemas';
import { downloadBlob } from '@/lib/client/blobUrl';
import {
    buildWantuCharacterExportPayload,
    getWantuCharacterExportModeFromPreference,
    parseStoredWantuRoundTripExportPreference,
    resolveWantuCharacterImport,
    serializeWantuRoundTripExportPreference,
    WANTU_ROUND_TRIP_EXPORT_PREFERENCE_KEY,
} from '@/lib/wantu-card/character-manager';
import Footer from '@/components/Footer';
// 【新增】导入卡片组件和颜色配置
import MagicalGirlCard from '@/components/MagicalGirlCard';
import CanshouCard from '@/components/CanshouCard';
import GeneralCharacterCard from '@/components/GeneralCharacterCard';
import { CharacterPortraitAssetPanel } from '@/components/shared/CharacterPortraitAssetPanel';
import { JsonSizeIndicator } from '@/components/shared/JsonSizeIndicator';
import { MainColor } from '@/lib/main-color';
import { useAuth } from '@/lib/useAuth';
import { dataCardApi, authStorage } from '@/lib/auth';
import { loadAuthMigrationStatus, type AuthMigrationStatus } from '@/components/me/authMigrationStatus';
import { getDataCardVisibilityValue } from '@/lib/data-card-status';
import { isQuestionnaireDataCard } from '@/lib/questionnaire-data-card';

// 导入拆分的组件
import AuthModal from '@/components/CharManager/AuthModal';
import SaveCardModal from '@/components/CharManager/SaveCardModal';
import DataCardsModal from '@/components/CharManager/DataCardsModal';
import RecycleBinModal from '@/components/CharManager/RecycleBinModal';
import NarrativeHistoryCardEditorModal from '@/components/CharManager/NarrativeHistoryCardEditorModal';
import QuestionnaireCompatModal, { type QuestionnaireCompatTargetCard } from '@/components/CharManager/QuestionnaireCompatModal';
import { UserWithTitle } from '@/components/UserTitle';
import type { UserBadge } from '@/types/badge';
import type { NarrativeHistoryDataCardV1 } from '@/types/arena';
import {
    CharacterManagerAccountPanel,
    CharacterManagerDraftBar,
    CharacterManagerEditorBody,
    CharacterManagerGuide,
    CharacterManagerImportSection,
    CharacterManagerPageHeader,
    CharacterManagerTemplateSelect,
    DEFAULT_NATIVENESS_REPLACE_HINT,
    NAME_REPLACE_NATIVE_MAX_CHARS,
    cardTopName,
    characterManagerNameFieldAddon,
    extractCardBaseName,
    getDisplayCharCount,
    nameReplacePreservesNativeness,
    replaceAllNamesInData,
    type CharacterManagerCapabilities,
} from '@mahoshojo/ui-web/character-manager';
import {
    inferTemplate,
    createBlankDataCard,
    convertDataCard,
    TEMPLATE_LABELS,
    type DataCardTemplate,
    type InferableTemplate
	} from '@/lib/data-card-converter';
import {
    clearCharacterManagerPageDraft,
    readCharacterManagerPageDraft,
    writeCharacterManagerPageDraft,
} from '@/lib/character-manager-page-draft';
import type { CharacterCardPortraitAsset } from '@/types/visual-asset';
import {
    setDataCardFieldValue,
    type DataCardFieldAddon,
    type DataCardFieldEditorClasses,
    type DataCardFieldPath,
} from '@mahoshojo/ui-web/card-editor';

// Web 角色管理沿用既有全局表单类（`input-field` 等随蓝色主题切换），共源编辑器只接收类名。
const CHARACTER_MANAGER_FIELD_CLASSES: DataCardFieldEditorClasses = {
    input: 'input-field',
    invalidInput: 'input-field border-red-400 focus:border-red-500 focus:ring-red-300 bg-red-50',
    readonlyInput: 'input-field bg-gray-100 cursor-not-allowed',
    label: 'block text-sm font-medium text-gray-700 capitalize',
    fieldset: 'border border-gray-300 p-4 rounded-lg mt-4',
    legend: 'text-sm font-semibold px-2 text-gray-600 capitalize',
    hint: 'text-xs text-gray-500 mt-1',
};


// 定义允许保持原生性的可编辑字段 (顶级键) (SRS 3.7.3)
// 这是一个路径集合，用于更精确地控制哪些字段的修改不影响原生性
const NATIVE_PRESERVING_PATHS = new Set([
    'codename', // 允许修改魔法少女代号
    'name',     // 允许修改残兽名称
    'appearance.colorScheme' // 允许修改配色方案
]);

const LEGACY_MIGRATION_DEFER_COUNT_STORAGE_KEY = 'mahoshojo_auth_migration_defer_count';
const LEGACY_MIGRATION_SOFT_BLOCK_THRESHOLD = 3;

const getArrestedHref = (reason?: string): string => {
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmedReason) return '/arrested';
    return `/arrested?reason=${encodeURIComponent(trimmedReason)}`;
};

/**
 * 辅助函数：判断一个值是否为可以遍历的普通对象（非数组、非null）。
 * @param item - 要检查的值。
 * @returns {boolean} 如果是对象则返回true，否则返回false。
 */
const isObject = (item: any): boolean => {
    return (item && typeof item === 'object' && !Array.isArray(item));
};

type SensitiveIssue = {
    path: string;
    parentPath: string;
    value: string;
    matches: SensitiveMatchDetail[];
};

const parsePathSegments = (path: string): (string | number)[] => {
    if (!path) return [];
    const segments: (string | number)[] = [];
    const parts = path.split('.');
    for (const part of parts) {
        const tokenRegex = /([^\[\]]+)|(\[\d+\])/g;
        let match: RegExpExecArray | null;
        while ((match = tokenRegex.exec(part)) !== null) {
            const token = match[0];
            if (!token) continue;
            if (token.startsWith('[')) {
                const index = Number(token.slice(1, -1));
                segments.push(index);
            } else {
                segments.push(token);
            }
        }
    }
    return segments;
};

const getValueAtPath = (data: any, path: string): any => {
    const segments = parsePathSegments(path);
    if (segments.length === 0) return undefined;
    let current = data;
    for (const segment of segments) {
        if (current === null || current === undefined) return undefined;
        current = current[segment as any];
    }
    return current;
};

const setValueAtPath = (data: any, path: string, newValue: string): boolean => {
    const segments = parsePathSegments(path);
    if (segments.length === 0) return false;
    let current = data;
    for (let i = 0; i < segments.length - 1; i++) {
        const segment = segments[i];
        if (current === null || current === undefined) return false;
        current = current[segment as any];
    }
    const lastSegment = segments[segments.length - 1];
    if (current === null || current === undefined) return false;
    if (typeof current[lastSegment as any] !== 'string') return false;
    current[lastSegment as any] = newValue;
    return true;
};

const maskValueByMatches = (value: string, matches: SensitiveMatchDetail[], mode: 'first' | 'last'): { text: string; changed: boolean } => {
    if (!value || matches.length === 0) {
        return { text: value, changed: false };
    }
    const chars = value.split('');
    const changedIndices = new Set<number>();

    matches.forEach(match => {
        const targetIndex = mode === 'first'
            ? match.startIndex
            : Math.max(match.startIndex, match.endIndex - 1);

        if (targetIndex < 0 || targetIndex >= chars.length) {
            return;
        }

        if (chars[targetIndex] !== '*') {
            chars[targetIndex] = '*';
        }
        changedIndices.add(targetIndex);
    });

    if (changedIndices.size === 0) {
        return { text: value, changed: false };
    }

    return {
        text: chars.join(''),
        changed: true
    };
};

const sortMatchesByPosition = (matches: SensitiveMatchDetail[]): SensitiveMatchDetail[] => {
    return [...matches].sort((a, b) => {
        if (a.startIndex === b.startIndex) {
            return a.endIndex - b.endIndex;
        }
        return a.startIndex - b.startIndex;
    });
};

const collectSensitiveIssues = async (value: any, path = '', parentPath = ''): Promise<SensitiveIssue[]> => {
    const issues: SensitiveIssue[] = [];

    if (typeof value === 'string') {
        if (!value.trim()) {
            return issues;
        }
        const result = await quickCheck(value);
        if (result.matchDetails && result.matchDetails.length > 0) {
            const normalizedMatches = sortMatchesByPosition(result.matchDetails);
            const resolvedParent = parentPath || path;
            issues.push({
                path,
                parentPath: resolvedParent,
                value,
                matches: normalizedMatches
            });
        }
        return issues;
    }

    if (Array.isArray(value)) {
        const effectiveParent = parentPath || path;
        for (let index = 0; index < value.length; index++) {
            const childPath = `${path}[${index}]`;
            const childIssues = await collectSensitiveIssues(value[index], childPath, effectiveParent || path);
            issues.push(...childIssues);
        }
        return issues;
    }

    if (isObject(value)) {
        for (const key of Object.keys(value)) {
            if (key === 'signature') continue;
            if (key.startsWith('_')) continue;
            const childPath = path ? `${path}.${key}` : key;
            const childIssues = await collectSensitiveIssues(value[key], childPath, childPath);
            issues.push(...childIssues);
        }
        return issues;
    }

    return issues;
};

// 【新增】定义渐变色，用于魔法少女卡片背景
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

/** Web 端角色管理页能力快照：全量功能均已交付（DESK-PARITY-001 的投影基准）。 */
const WEB_CHARACTER_MANAGER_CAPABILITIES: CharacterManagerCapabilities = {
    cloudCards: 'manage',
    tachie: true,
    questionnaireEditor: true,
    templateSelect: true,
    nativenessInfo: true,
    sensitiveWords: true,
    scenarioEditors: true,
};

export const CharacterManagerPage: React.FC = () => {
    const router = useRouter();
    const { user, loading: authLoading, isAuthenticated, register, login, logout } = useAuth();
    const [pastedJson, setPastedJson] = useState('');
    const [characterData, setCharacterData] = useState<any | null>(null);
    const [originalData, setOriginalData] = useState<any | null>(null);

    // 账户系统相关状态
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authMessage, setAuthMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null);
    const [authMigrationStatus, setAuthMigrationStatus] = useState<AuthMigrationStatus | null>(null);
    const [authMigrationLoading, setAuthMigrationLoading] = useState(false);
    const [authMigrationError, setAuthMigrationError] = useState<string | null>(null);
    const [showLegacyMigrationReminderModal, setShowLegacyMigrationReminderModal] = useState(false);
    const [legacyMigrationDeferCount, setLegacyMigrationDeferCount] = useState(0);

    // 数据卡管理相关状态
    const [cardsRefresh, setCardsRefresh] = useState(0);
    const [userCapacity, setUserCapacity] = useState(config.DEFAULT_DATA_CARD_CAPACITY);
    const [userUsedSlots, setUserUsedSlots] = useState(0);
  const [showDataCardsModal, setShowDataCardsModal] = useState(false);
  const [recycleBinCards, setRecycleBinCards] = useState<any[]>([]);
  const [showRecycleBinModal, setShowRecycleBinModal] = useState(false);
  const [editingCard, setEditingCard] = useState<any | null>(null);
  const [showSaveCardModal, setShowSaveCardModal] = useState(false);
  const [newCardForm, setNewCardForm] = useState({ name: '', description: '', isPublic: 0 });
  const [saveCardError, setSaveCardError] = useState<string | null>(null);
  const [isSavingCard, setIsSavingCard] = useState(false);
  const [showHistoryCardEditor, setShowHistoryCardEditor] = useState(false);
  const [historyCardDraft, setHistoryCardDraft] = useState<NarrativeHistoryDataCardV1 | null>(null);
  const [historyCardTarget, setHistoryCardTarget] = useState<{
    id: string;
    name: string;
    description: string;
    isPublic: number;
  } | null>(null);
  const [showQuestionnaireCompatModal, setShowQuestionnaireCompatModal] = useState(false);
  const [questionnaireCompatRawJson, setQuestionnaireCompatRawJson] = useState('');
  const [questionnaireCompatTargetCard, setQuestionnaireCompatTargetCard] = useState<QuestionnaireCompatTargetCard | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const cardsPerPage = 12;

    // 徽章管理相关状态
    const [userBadges, setUserBadges] = useState<UserBadge[]>([]);

    // 状态管理
    const [isNative, setIsNative] = useState(false);
    const [hasLostNativeness, setHasLostNativeness] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'info' | 'error' | 'success', text: string } | null>(null);
    const [copiedStatus, setCopiedStatus] = useState(false);
    const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
    const [selectedTemplate, setSelectedTemplate] = useState<InferableTemplate>('unknown');
    const [autoSaveTimestamp, setAutoSaveTimestamp] = useState<number | null>(null);
    const [draftRestoreReady, setDraftRestoreReady] = useState(false);
    // 【新增】图片保存模态框的状态
    const [showImageModal, setShowImageModal] = useState(false);
    const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);

    // 用于控制粘贴区域折叠/展开的状态，默认为折叠
    const [isPasteAreaVisible, setIsPasteAreaVisible] = useState(false);
    const [restoreWantuOriginalOnImport, setRestoreWantuOriginalOnImport] = useState(false);
    const [exportWantuRoundTrip, setExportWantuRoundTrip] = useState(false);

    // 敏感词检测相关状态
    const [sensitiveIssues, setSensitiveIssues] = useState<SensitiveIssue[]>([]);
    const [isSensitiveScanning, setIsSensitiveScanning] = useState(false);
    const [lastScanTime, setLastScanTime] = useState<number | null>(null);
    const [debouncedCharacterData, setDebouncedCharacterData] = useState<any | null>(null);
    const [scanTrigger, setScanTrigger] = useState(0);

    // 即时检测文本框
    const [manualCheckText, setManualCheckText] = useState('');
    const [manualCheckResult, setManualCheckResult] = useState<FilterResult | null>(null);
    const [manualCheckLoading, setManualCheckLoading] = useState(false);

    // 加载用户数据卡和容量
    const loadUserDataCards = useCallback(async () => {
        if (!isAuthenticated) return;
        setCardsRefresh((value) => value + 1);
        await Promise.all([
            dataCardApi.getUserCapacity().then((capacityInfo) => {
                if (capacityInfo !== null) {
                    setUserCapacity(capacityInfo.capacity);
                    setUserUsedSlots(capacityInfo.usedSlots);
                }
            }),
            dataCardApi.getRecycleBin().then(setRecycleBinCards),
        ]);
    }, [isAuthenticated]);

    useEffect(() => {
        if (isAuthenticated) {
            loadUserDataCards();
        } else {
            setRecycleBinCards([]);
            setShowDataCardsModal(false);
            setShowRecycleBinModal(false);
        }
    }, [isAuthenticated, loadUserDataCards]);

    const loadUserBadges = useCallback(async () => {
        if (!isAuthenticated) return;
        try {
            const response = await authStorage.fetch('/api/badges/user');

            if (!response.ok) {
                setUserBadges([]);
                return;
            }

            const data = await response.json();
            setUserBadges(Array.isArray(data.badges) ? data.badges : []);
        } catch (error) {
            console.error('加载徽章失败:', error);
            setUserBadges([]);
        }
    }, [isAuthenticated]);

    useEffect(() => {
        if (isAuthenticated) {
            loadUserBadges();
        } else {
            setUserBadges([]);
        }
    }, [isAuthenticated, loadUserBadges]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const raw = window.localStorage.getItem(LEGACY_MIGRATION_DEFER_COUNT_STORAGE_KEY);
        const parsed = raw ? Number.parseInt(raw, 10) : 0;
        if (Number.isSafeInteger(parsed) && parsed > 0) {
            setLegacyMigrationDeferCount(parsed);
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        setExportWantuRoundTrip(parseStoredWantuRoundTripExportPreference(
            window.localStorage.getItem(WANTU_ROUND_TRIP_EXPORT_PREFERENCE_KEY)
        ));
    }, []);

    const refreshAuthMigrationStatus = useCallback(async () => {
        if (!isAuthenticated) {
            setAuthMigrationStatus(null);
            setAuthMigrationError(null);
            setAuthMigrationLoading(false);
            return;
        }

        setAuthMigrationLoading(true);
        setAuthMigrationError(null);
        try {
            const status = await loadAuthMigrationStatus();
            setAuthMigrationStatus(status);
        } catch (error) {
            setAuthMigrationStatus(null);
            setAuthMigrationError(error instanceof Error ? error.message : '读取迁移状态失败');
        } finally {
            setAuthMigrationLoading(false);
        }
    }, [isAuthenticated]);

    useEffect(() => {
        if (!isAuthenticated) {
            setAuthMigrationStatus(null);
            setAuthMigrationError(null);
            setAuthMigrationLoading(false);
            setShowLegacyMigrationReminderModal(false);
            return;
        }
        void refreshAuthMigrationStatus();
    }, [isAuthenticated, refreshAuthMigrationStatus]);

    const authMigrationHint = useMemo(() => {
        if (!authMigrationStatus) return '';
        if (!authMigrationStatus.hasAuthLink) {
            return '检测到当前账号尚未完成新版账号映射。请前往个人页先设置登录密码，系统会自动完成认领迁移。';
        }
        if (!authMigrationStatus.hasPassword) {
            return '检测到当前账号尚未设置密码。旧密钥登录后续会逐步下线，请尽快完成密码设置。';
        }
        if (authMigrationStatus.authSource === 'legacy-bearer') {
            return '你本次使用的是旧密钥登录。建议尽快切换为密码登录，避免后续旧入口下线带来登录中断。';
        }
        if (!authMigrationStatus.emailVerified) {
            return '账号已设置密码，但邮箱仍未验证。建议在个人页完成验证，便于后续找回与安全提醒。';
        }
        return '账号迁移仍有未完成项，请前往个人页继续处理。';
    }, [authMigrationStatus]);
    const isLegacyMigrationSoftBlocked = legacyMigrationDeferCount >= LEGACY_MIGRATION_SOFT_BLOCK_THRESHOLD;

    const handleDeferLegacyMigrationReminder = useCallback(() => {
        if (legacyMigrationDeferCount >= LEGACY_MIGRATION_SOFT_BLOCK_THRESHOLD) return;
        const nextCount = legacyMigrationDeferCount + 1;
        setLegacyMigrationDeferCount(nextCount);
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(LEGACY_MIGRATION_DEFER_COUNT_STORAGE_KEY, String(nextCount));
        }
        setShowLegacyMigrationReminderModal(false);
    }, [legacyMigrationDeferCount]);

    const handleWantuRoundTripExportPreferenceChange = useCallback((checked: boolean) => {
        setExportWantuRoundTrip(checked);
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(
                WANTU_ROUND_TRIP_EXPORT_PREFERENCE_KEY,
                serializeWantuRoundTripExportPreference(checked)
            );
        }
    }, []);

    // 处理注册
    const handleRegister = async (username: string, email: string, turnstileToken: string, password: string) => {
        setAuthMessage(null);
        const result = await register(username, email, turnstileToken, password);
        if (!result.success) {
            setAuthMessage({ type: 'error', text: result.error || '注册失败' });
            return;
        }

        setShowAuthModal(false);
        setMessage({ type: 'success', text: result.message || '注册成功，已自动登录！' });
        loadUserDataCards();
        loadUserBadges();
        void refreshAuthMigrationStatus();
    };

    // 处理登录
    const handleLogin = async (
        identifier: string,
        credential: string,
        turnstileToken: string,
        mode: 'password' | 'legacy',
    ) => {
        setAuthMessage(null);
        const result = await login(identifier, credential, turnstileToken, mode);
        if (result.success) {
            setShowAuthModal(false);
            setMessage({
                type: 'success',
                text: mode === 'legacy'
                    ? '旧密钥登录成功。请尽快在个人页完成账号迁移并设置密码。'
                    : '密码登录成功！',
            });
            if (mode === 'legacy') {
                setShowLegacyMigrationReminderModal(true);
            }
            loadUserDataCards();
            loadUserBadges();
            void refreshAuthMigrationStatus();
        } else {
            setAuthMessage({ type: 'error', text: result.error || '登录失败' });
        }
        return result;
    };

    const handleLogout = useCallback(() => {
        logout();
        setAuthMigrationStatus(null);
        setAuthMigrationError(null);
        setAuthMigrationLoading(false);
        setShowLegacyMigrationReminderModal(false);
    }, [logout]);

    // 统一构建可上传的数据（处理原生性签名）
    const prepareFinalDataForUpload = useCallback(async (): Promise<any | null> => {
        if (!characterData) return null;
        let finalData = { ...characterData };

        if (isNative && !hasLostNativeness) {
            setMessage({ type: 'info', text: '正在请求服务器进行原生性签名认证...' });
            const response = await fetch('/api/resign-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(finalData),
            });

            if (!response.ok) {
                const errorData = await response.json();
                if (errorData.shouldRedirect) {
                    router.push(getArrestedHref(errorData.reason || '编辑内容不合规'));
                    return null;
                }
                throw new Error(errorData.message || '签名服务器认证失败');
            }
            finalData = await response.json();
            setMessage({ type: 'success', text: '原生性签名认证成功！' });
        } else {
            delete finalData.signature;
        }

        return finalData;
    }, [characterData, hasLostNativeness, isNative, router, setMessage]);

    // 保存当前角色为数据卡
    const handleSaveAsDataCard = async () => {
        if (!isAuthenticated || !characterData) return;

        // 打开保存弹窗，设置默认值
        const isScenario = isScenarioData(characterData);
        const type = isScenario ? 'scenario' : 'character';
        const defaultName = isScenario
            ? (characterData.title || characterData.name || '')
            : (characterData.codename || characterData.name || '');
        const defaultDescription = `${type === 'character' ? '角色' : '情景'}数据卡`;

        setNewCardForm({
            name: defaultName,
            description: defaultDescription,
            isPublic: 0
        });
        setSaveCardError(null);
        setShowSaveCardModal(true);
    };

    // 确认保存数据卡
    const handleConfirmSaveCard = async () => {
        if (!newCardForm.name.trim()) {
            setSaveCardError('请输入数据卡名称');
            return;
        }

        setIsSavingCard(true);
        setSaveCardError(null);

        try {
            const finalData = await prepareFinalDataForUpload();
            if (!finalData) {
                setIsSavingCard(false);
                return;
            }

            // 2. 前端敏感词检查 (使用处理后的 finalData)
            const type = isScenarioData(finalData) ? 'scenario' : 'character';
            const textToCheck = `${newCardForm.name} ${newCardForm.description} ${JSON.stringify(finalData)}`;
            const sensitiveWordResult = await quickCheck(textToCheck);

            if (sensitiveWordResult.hasSensitiveWords) {
                router.push('/arrested');
                return;
            }

            // 3. 调用 API 创建数据卡 (使用处理后的 finalData)
            const result = await dataCardApi.createCard(
                type,
                newCardForm.name,
                newCardForm.description,
                finalData, // 使用经过原生性处理的数据
                newCardForm.isPublic
            );

            if (result.success) {
                setMessage({ type: 'success', text: `数据卡保存成功！${newCardForm.isPublic === 1 ? '（公开）' : '（私有）'}` });
                setShowSaveCardModal(false);
                setNewCardForm({ name: '', description: '', isPublic: 0 });
                setSaveCardError(null);
                loadUserDataCards();
                loadUserBadges();
            } else {
                if (result.error === 'SENSITIVE_WORD_DETECTED' || (result as any).redirect === '/arrested') {
                    router.push('/arrested');
                    return;
                }
                setSaveCardError(result.error || '保存失败');
            }
        } catch (error) {
            // 捕获签名或API调用中可能出现的任何错误
            setSaveCardError(error instanceof Error ? error.message : '保存过程中发生未知错误');
        } finally {
            setIsSavingCard(false);
        }
    };

    const openQuestionnaireCompat = useCallback((rawJson: string, targetCard: QuestionnaireCompatTargetCard | null) => {
        setQuestionnaireCompatRawJson(rawJson);
        setQuestionnaireCompatTargetCard(targetCard);
        setShowQuestionnaireCompatModal(true);
    }, []);

    // 加载数据卡
    const handleLoadDataCard = async (card: any) => {
        try {
            if (card?.type === 'history') {
                const parsed = JSON.parse(card.data);
                setHistoryCardDraft(parsed as NarrativeHistoryDataCardV1);
                setHistoryCardTarget({
                    id: card.id,
                    name: card.name,
                    description: card.description,
                    isPublic: getDataCardVisibilityValue(card),
                });
                setShowHistoryCardEditor(true);
                setShowDataCardsModal(false);
                return;
            }
            if (isQuestionnaireDataCard(card)) {
                const raw = typeof card.data === 'string' ? card.data : JSON.stringify(card.data ?? {}, null, 2);
                openQuestionnaireCompat(raw, {
                    id: card.id,
                    name: card.name,
                    description: card.description,
                    isPublic: getDataCardVisibilityValue(card),
                });
                setMessage({ type: 'info', text: '已进入问卷数据卡兼容模式：建议前往 /questionnaire-editor 进行完整编辑。' });
                setShowDataCardsModal(false);
                return;
            }
            // card.data 是一个 JSON 字符串，我们直接将其传递给统一的加载处理函数
            await processJsonData(card.data);
            setShowDataCardsModal(false);
            // 成功消息现在由 processJsonData 内部处理，这里无需重复设置
        } catch {
            setMessage({ type: 'error', text: '加载数据卡失败' });
        }
    };

    // 删除数据卡
    const handleDeleteDataCard = async (id: string) => {
        if (!window.confirm('确定要删除这个数据卡吗？')) return;

        const result = await dataCardApi.deleteCard(id);
        if (result.success) {
            setMessage({ type: 'success', text: '数据卡已移入回收站' });
            loadUserDataCards();
            loadUserBadges();
        } else {
            setMessage({ type: 'error', text: result.error || '删除失败' });
        }
    };

    // 恢复回收站中的数据卡
    const handleRestoreRecycleCard = async (id: string) => {
        const result = await dataCardApi.restoreCard(id);
        if (result.success) {
            setMessage({ type: 'success', text: '数据卡已恢复' });
            loadUserDataCards();
            loadUserBadges();
        } else {
            setMessage({ type: 'error', text: result.error || '恢复失败' });
        }
    };

    // 永久删除回收站中的数据卡
    const handleDeleteRecycleCard = async (id: string) => {
        if (!window.confirm('确定要彻底删除这个数据卡吗？此操作无法撤销。')) return;

        const result = await dataCardApi.deleteRecycleCard(id);
        if (result.success) {
            setMessage({ type: 'success', text: '数据卡已彻底删除' });
            loadUserDataCards();
            loadUserBadges();
        } else {
            setMessage({ type: 'error', text: result.error || '删除失败' });
        }
    };

    // 更新数据卡信息
    const handleUpdateDataCard = async (id: string, name: string, description: string, isPublic?: number) => {
        // 前端敏感词检查
        const textToCheck = `${name} ${description}`;
        const sensitiveWordResult = await quickCheck(textToCheck);

        if (sensitiveWordResult.hasSensitiveWords) {
            // 直接跳转到 /arrested 页面
            router.push('/arrested');
            return;
        }

        const result = await dataCardApi.updateCard(id, name, description, isPublic);
        if (result.success) {
            setEditingCard(null);
            loadUserDataCards();
            loadUserBadges();
            setMessage({ type: 'success', text: '数据卡信息已更新' });
        } else {
            // 检查是否是敏感词错误，如果是则跳转到 /arrested
            if (result.error === 'SENSITIVE_WORD_DETECTED' || (result as any).redirect === '/arrested') {
                router.push('/arrested');
                return;
            }
            setMessage({ type: 'error', text: result.error || '更新失败' });
        }
    };

    // 用当前编辑的 characterData 替换已有卡片
    const handleReplaceExistingCard = async (card: any) => {
        if (card?.type === 'history') {
            await handleLoadDataCard(card);
            return;
        }
        if (isQuestionnaireDataCard(card)) {
            const raw = typeof card.data === 'string' ? card.data : JSON.stringify(card.data ?? {}, null, 2);
            openQuestionnaireCompat(raw, {
                id: card.id,
                name: card.name,
                description: card.description,
                isPublic: getDataCardVisibilityValue(card),
            });
            setMessage({ type: 'info', text: '问卷数据卡请优先在 /questionnaire-editor 编辑；此处仅提供兼容替换能力。' });
            setShowDataCardsModal(false);
            return;
        }
        if (!characterData) {
            setMessage({ type: 'error', text: '请先在编辑区加载/生成要替换的内容' });
            return;
        }
        if (!window.confirm(`确认用当前编辑内容替换「${card.name}」吗？`)) return;
        try {
            const payloadData = await prepareFinalDataForUpload();
            if (!payloadData) return;
            const result = await dataCardApi.replaceCard(card.id, {
                name: card.name,
                description: card.description,
                isPublic: getDataCardVisibilityValue(card),
                data: payloadData,
            });
            if (result.success) {
                setMessage({ type: 'success', text: result.pendingReview ? '更新已提交审核，审核通过后生效' : '替换成功' });
                loadUserDataCards();
                loadUserBadges();
            } else {
                setMessage({ type: 'error', text: result.error || '替换失败' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: error instanceof Error ? error.message : '替换失败' });
        }
    };

    const handleReplaceHistoryCard = async (payload: NarrativeHistoryDataCardV1) => {
        if (!historyCardTarget) {
            throw new Error('未指定要替换的叙事历史数据卡');
        }

        const textToCheck = `${historyCardTarget.name} ${historyCardTarget.description} ${JSON.stringify(payload)}`;
        const sensitiveWordResult = await quickCheck(textToCheck);
        if (sensitiveWordResult.hasSensitiveWords) {
            router.push('/arrested');
            return;
        }

        const result = await dataCardApi.replaceCard(historyCardTarget.id, {
            name: historyCardTarget.name,
            description: historyCardTarget.description,
            isPublic: historyCardTarget.isPublic,
            data: payload,
        });

        if (!result.success) {
            throw new Error(result.error || '替换失败');
        }

        setMessage({ type: 'success', text: result.pendingReview ? '更新已提交审核，审核通过后生效' : '叙事历史数据卡已替换' });
        loadUserDataCards();
        loadUserBadges();
    };

    // 检测是否为情景文件（结构化情景/通用情景的统一判定）
    const isScenarioData = (data: any): boolean => {
        const template = inferTemplate(data);
        return template === 'scenario' || template === 'general-scenario';
    };

    // 分享数据卡
    const handleShareDataCard = async (card: any) => {
        // 在这里可以添加额外的分享统计或其他操作
        console.log(`分享了数据卡: ${card.name} (${card.id})`);
    };

    // 组件加载时运行，检测设备类型以决定是否默认展开粘贴区域
    useEffect(() => {
        // 使用正则表达式检测用户代理字符串中是否包含常见的移动设备关键词
        const isMobileDevice = /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(navigator.userAgent.toLowerCase());
        // 如果是移动设备，则自动展开粘贴区域，优化移动端用户体验
        if (isMobileDevice) {
            setIsPasteAreaVisible(true);
        }
    }, []); // 空依赖数组 `[]` 确保此效果仅在组件首次挂载时运行一次

    useEffect(() => {
        if (!characterData) {
            setDebouncedCharacterData(null);
            return;
        }
        const handler = setTimeout(() => {
            setDebouncedCharacterData(characterData);
        }, 400);
        return () => clearTimeout(handler);
    }, [characterData]);

    useEffect(() => {
        if (!characterData) {
            setSelectedTemplate('unknown');
        } else {
            setSelectedTemplate(inferTemplate(characterData));
        }
    }, [characterData]);

    const currentTemplate = useMemo<InferableTemplate>(() => characterData ? inferTemplate(characterData) : 'unknown', [characterData]);

    useEffect(() => {
        let cancelled = false;

        if (!debouncedCharacterData) {
            setSensitiveIssues([]);
            setLastScanTime(null);
            setIsSensitiveScanning(false);
            return;
        }

        setIsSensitiveScanning(true);
        collectSensitiveIssues(debouncedCharacterData)
            .then(issues => {
                if (!cancelled) {
                    setSensitiveIssues(issues);
                    setLastScanTime(Date.now());
                }
            })
            .catch(error => {
                if (!cancelled) {
                    console.error('敏感词扫描失败:', error);
                    setSensitiveIssues([]);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsSensitiveScanning(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [debouncedCharacterData, scanTrigger]);

    // [SRS 3.3] 立绘生成器相关状态
    const [isTachieVisible, setIsTachieVisible] = useState(false);
    const [tachiePrompt, setTachiePrompt] = useState('');
    const [characterPortraitAsset, setCharacterPortraitAsset] = useState<CharacterCardPortraitAsset | null>(null);

    useEffect(() => {
        const restored = readCharacterManagerPageDraft();
        if (!restored) {
            setDraftRestoreReady(true);
            return;
        }

        const mode = restored.payload.characterData && restored.payload.originalData ? 'editor' : 'paste';
        setPastedJson(restored.payload.pastedJson);
        setCharacterData(restored.payload.characterData);
        setOriginalData(restored.payload.originalData);
        setIsNative(restored.payload.isNative);
        setHasLostNativeness(false);
        setSelectedTemplate(restored.payload.selectedTemplate);
        setValidationResult(restored.payload.characterData ? validateDataCard(restored.payload.characterData) : null);
        setIsPasteAreaVisible(mode === 'paste' && restored.payload.pastedJson.trim().length > 0);
        setAutoSaveTimestamp(restored.updatedAt);
        setMessage({
            type: 'info',
            text: `已恢复本地草稿（${new Date(restored.updatedAt).toLocaleTimeString()}）`,
        });
        setDraftRestoreReady(true);
    }, []);

    useEffect(() => {
        if (!draftRestoreReady) return;

        const stored = writeCharacterManagerPageDraft({
            pastedJson,
            characterData,
            originalData,
            isNative,
            selectedTemplate,
        });

        setAutoSaveTimestamp(stored?.updatedAt ?? null);
    }, [pastedJson, characterData, originalData, isNative, selectedTemplate, draftRestoreReady]);

    const handleLoadOtherData = useCallback(() => {
        clearCharacterManagerPageDraft();
        setCharacterData(null);
        setOriginalData(null);
        setPastedJson('');
        setCharacterPortraitAsset(null);
        setIsNative(false);
        setHasLostNativeness(false);
        setSelectedTemplate('unknown');
        setValidationResult(null);
        setAutoSaveTimestamp(null);
        setIsPasteAreaVisible(false);
        setRestoreWantuOriginalOnImport(false);
        setMessage(null);
    }, []);

    const handleClearCharacterManagerDraft = useCallback(() => {
        if (typeof window !== 'undefined' && !window.confirm('确定要清空当前页面的本地草稿吗？')) {
            return;
        }
        handleLoadOtherData();
    }, [handleLoadOtherData]);

    // [SRS 3.3.3] 动态生成立绘提示词
    useEffect(() => {
        if (!characterData) {
            setTachiePrompt('');
            return;
        }

        let newPrompt = '';
        if (currentTemplate === 'magical-girl') {
            const appearance = characterData.appearance;
            if (appearance && typeof appearance === 'object' && !Array.isArray(appearance)) {
                const appearanceString = Object.entries(appearance)
                    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
                    .join(', ');
                newPrompt = `${appearanceString}, Xiabanmo, 二次元, 魔法少女`;
            }
        } else if (currentTemplate === 'canshou') {
            const parts = [
                characterData.appearance,
                characterData.materialAndSkin,
                characterData.featuresAndAppendages
            ]
                .map((item: unknown) => (typeof item === 'string' ? item.trim() : ''))
                .filter(Boolean);
            newPrompt = parts.join(', ');
        } else if (currentTemplate === 'general') {
            const name = typeof characterData.name === 'string' ? characterData.name.trim() : '';
            const content = typeof characterData.content === 'string' ? characterData.content.trim() : '';
            const head = content.length > 800 ? content.slice(0, 800) : content;
            const prefix = [name, head].filter(Boolean).join(', ');
            newPrompt = `${prefix ? `${prefix}, ` : ''}Xiabanmo, 二次元, 角色立绘`;
        }

        setTachiePrompt(newPrompt);

    }, [characterData, currentTemplate]);

    /**
     * 现在只负责追踪“原生性”是否因核心数据被修改而丧失。
     * 移除了原有的名称比较和按钮显示逻辑，使其职责更单一、逻辑更清晰。
     */
    useEffect(() => {
        // 这个 Hook 的核心前提是角色必须是原生的，如果不是，则无需执行任何逻辑
        if (!originalData || !characterData || !isNative) return;

        // 一旦原生性丧失，状态就不再改变，以防止不必要的重复计算
        if (hasLostNativeness) return;

        // 定义一个深度比较函数，用于判断两个值是否完全相同
        const deepEqual = (obj1: any, obj2: any): boolean => {
            return JSON.stringify(obj1) === JSON.stringify(obj2);
        };

        let hasBreakingChange = false;

        // 递归检查函数，会忽略被豁免的路径
        const checkForBreakingChanges = (originalNode: any, currentNode: any, path: string) => {
            if (hasBreakingChange) return;
            const originalKeys = originalNode && typeof originalNode === 'object' ? Object.keys(originalNode) : [];
            const currentKeys = currentNode && typeof currentNode === 'object' ? Object.keys(currentNode) : [];
            const mergedKeys = new Set([...originalKeys, ...currentKeys]);

            for (const key of mergedKeys) {
                const currentPath = path ? `${path}.${key}` : key;

                if (currentPath === 'adjudicationEvents') {
                    // 内嵌随机事件完全豁免，增删改均不会破坏原生性
                    continue;
                }

                if (key.startsWith('_')) {
                    continue;
                }

                // 如果当前路径或其父路径在豁免列表中（如 'codename'），或字段本身就是签名/历战记录，则跳过检查
                if (key === 'signature' || key === 'arena_history' || NATIVE_PRESERVING_PATHS.has(currentPath)) {
                    continue;
                }

                const originalValue = originalNode?.[key];
                const currentValue = currentNode?.[key];

                if (!deepEqual(originalValue, currentValue)) {
                    // 历战记录有特殊规则：只允许删除条目，不允许新增或修改
                    if (currentPath === 'arena_history.entries') {
                        const originalEntries = originalValue || [];
                        const currentEntries = currentValue || [];
                        if (currentEntries.length > originalEntries.length) {
                            hasBreakingChange = true;
                        } else {
                            const originalIds = new Set(originalEntries.map((e: any) => e.id));
                            for (const currentEntry of currentEntries) {
                                if (!originalIds.has(currentEntry.id)) {
                                    hasBreakingChange = true;
                                    break;
                                }
                            }
                        }
                    } else {
                        // 对于其他非豁免字段，任何修改都会导致原生性丧失
                        hasBreakingChange = true;
                    }
                    if (hasBreakingChange) {
                        console.log(`原生性丧失：字段 '${currentPath}' 被修改。`);
                        break;
                    }
                }
            }
        };

        checkForBreakingChanges(originalData, characterData, '');

        if (hasBreakingChange) {
            setHasLostNativeness(true);
            setMessage({ type: 'info', text: '注意：您已修改角色的核心数据，该角色将变为“衍生数据”，保存时会移除原生签名。' });
        }

    }, [characterData, originalData, isNative, hasLostNativeness]);


    // 加载和处理JSON数据 (支持角色和情景文件)
    const processJsonData = async (jsonText: string) => {
        setIsLoading(true);
        setMessage(null);
        setHasLostNativeness(false);
        setCharacterPortraitAsset(null);

        try {
            const data = JSON.parse(jsonText);

            if (typeof data !== 'object' || data === null) {
                throw new Error('无效的文件格式。');
            }

            const wantuImport = resolveWantuCharacterImport(data, {
                restoreOriginal: restoreWantuOriginalOnImport,
            });
            if (wantuImport.kind === 'error') {
                throw new Error(wantuImport.error);
            }
            if (wantuImport.kind === 'success') {
                setValidationResult(wantuImport.validationResult);
                setCharacterData(wantuImport.data);
                setOriginalData(JSON.parse(JSON.stringify(wantuImport.data)));
                setIsNative(false);
                setSelectedTemplate(wantuImport.selectedTemplate);
                setMessage({
                    type: wantuImport.warnings.length > 0 ? 'info' : 'success',
                    text: wantuImport.message,
                });
                return;
            }

            // 使用 Zod Schema 验证文件格式
            const validationResult = validateDataCard(data);
            setValidationResult(validationResult);
            // if (!validationResult.success) {
            //     throw new Error(validationResult.error || '无效的文件格式。请确保是有效的角色或情景文件。');
            // }

            if (validationResult.type === 'questionnaire') {
                openQuestionnaireCompat(jsonText, null);
                setMessage({ type: 'info', text: '检测到问卷数据卡：角色管理器仅提供兼容模式。建议前往 /questionnaire-editor 进行完整编辑。' });
                return;
            }

            if ((data as any)?.templateId === 'narrative-history') {
                setHistoryCardDraft(data as NarrativeHistoryDataCardV1);
                setHistoryCardTarget(null);
                setShowHistoryCardEditor(true);
                setMessage({
                    type: validationResult.success ? 'success' : 'info',
                    text: validationResult.success
                        ? `成功加载叙事历史：${(data as any).title || '叙事历史'}（${Array.isArray((data as any).entries) ? (data as any).entries.length : 0} 条）`
                        : `检测到叙事历史数据卡，但格式存在问题：${validationResult.error || '未知错误'}（已进入编辑器，可导出后修复）`
                });
                return;
            }

            const isCharacterFile = validationResult.type === 'character' || validationResult.type === 'canshou' || validationResult.type === 'general';
            const isScenarioFile = validationResult.type === 'scenario';
            const inferredTemplate = inferTemplate(data);

            // 调用API验证原生性
            const verificationResponse = await fetch('/api/verify-origin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const { isValid } = await verificationResponse.json();

            setCharacterData(data);
            setOriginalData(JSON.parse(JSON.stringify(data))); // 深拷贝作为原始备份
            setIsNative(isValid);
            setSelectedTemplate(inferredTemplate);

            if (isCharacterFile) {
                if (inferredTemplate === 'general') {
                    setMessage({ type: 'success', text: `成功加载通用角色: ${data.name || data.codename || '未命名角色'}` });
                } else {
                    setMessage({ type: 'success', text: `成功加载角色: ${data.codename || data.name}` });
                }
            } else if (isScenarioFile) {
                setMessage({ type: 'success', text: `成功加载情景: ${data.title || data.name || '未命名情景'}` });
            }
        } catch (err) {
            const text = err instanceof Error ? err.message : '解析JSON失败。';
            setMessage({ type: 'error', text: `加载失败: ${text}` });
            setCharacterData(null);
            setOriginalData(null);
            setIsNative(false);
            setSelectedTemplate('unknown');
        } finally {
            setIsLoading(false);
        }
    };

    // 粘贴加载处理
    const handlePasteAndLoad = () => {
        if (!pastedJson.trim()) {
            setMessage({ type: 'error', text: '文本框内容为空。' });
            return;
        }
        processJsonData(pastedJson);
    };

    const handleTemplateSelect = useCallback((targetTemplate: DataCardTemplate) => {
        try {
            setCharacterPortraitAsset(null);
            if (!characterData) {
                const blank = createBlankDataCard(targetTemplate);
                setCharacterData(blank);
                setOriginalData(JSON.parse(JSON.stringify(blank)));
                setIsNative(false);
                setHasLostNativeness(false);
                setSelectedTemplate(targetTemplate);
                setValidationResult(validateDataCard(blank));
                setMessage({ type: 'info', text: `已创建${TEMPLATE_LABELS[targetTemplate]}模板的空白内容。` });
            } else {
                const sourceTemplate = inferTemplate(characterData);
                const { data: converted, warnings } = convertDataCard(characterData, targetTemplate, sourceTemplate);
                setCharacterData(converted);
                setOriginalData(JSON.parse(JSON.stringify(converted)));
                setSelectedTemplate(targetTemplate);
                setValidationResult(validateDataCard(converted));
                if (warnings.length) {
                    setMessage({ type: 'info', text: `已转换为${TEMPLATE_LABELS[targetTemplate]}模板。${warnings.join(' ')}` });
                } else {
                    setMessage({ type: 'success', text: `已转换为${TEMPLATE_LABELS[targetTemplate]}模板。` });
                }
            }
        } catch (error) {
            console.error('模板转换失败:', error);
            setMessage({ type: 'error', text: '模板转换失败，请检查数据格式。' });
        }
    }, [characterData, setCharacterData, setOriginalData, setIsNative, setHasLostNativeness, setSelectedTemplate, setValidationResult, setMessage]);

    // 统一的字段更新处理器
    const handleFieldChange = useCallback((path: string | readonly string[], value: any) => {
        // 共源字段编辑器交回逐段键名；ScenarioEditor 等旧调用方仍用点分字符串 DSL，在此展开成段。
        // 路径写入语义（copy-on-write、按下一段是否为数字补数组/对象、templateId 不可改）由共源规则持有。
        const segments = typeof path === 'string' ? path.split('.') : path;
        setCharacterData((prev: any) => (prev ? setDataCardFieldValue(prev, segments, value) : prev));
    }, []);

    // 一键替换所有旧名称的事件处理器
    const handleReplaceAllNames = useCallback(() => {
        if (!characterData || !originalData) return;

        const oldName = cardTopName(originalData);
        const newName = cardTopName(characterData);
        if (!oldName || !newName) return;

        // 从完整名称中提取基础名称（去除称号）
        const oldBaseName = extractCardBaseName(oldName);
        const newBaseName = extractCardBaseName(newName);

        if (oldBaseName === newBaseName) return;

        const newBaseNameCharCount = getDisplayCharCount(newBaseName);
        const shouldPreserveNativeness = nameReplacePreservesNativeness(newBaseName);

        // 始终替换当前编辑数据
        const updatedCharacterData = replaceAllNamesInData(characterData, oldBaseName, newBaseName);

        // 是否同步替换“原始备份数据”决定了该操作是否保持原生性：
        // - 名称不过长：同步替换 originalData，让系统认为除豁免字段外没有意外变化，从而保持原生性。
        // - 名称过长：只同步 top-level 名称字段以收起按钮，但不替换其他字段，强制触发原生性丧失。
        let updatedOriginalData = originalData;
        if (shouldPreserveNativeness) {
            updatedOriginalData = replaceAllNamesInData(originalData, oldBaseName, newBaseName);
        } else {
            updatedOriginalData = JSON.parse(JSON.stringify(originalData));
            if (typeof (updatedOriginalData as any).codename === 'string' && typeof characterData.codename === 'string') {
                (updatedOriginalData as any).codename = characterData.codename;
            }
            if (typeof (updatedOriginalData as any).name === 'string' && typeof characterData.name === 'string') {
                (updatedOriginalData as any).name = characterData.name;
            }
        }

        // 更新状态
        setCharacterData(updatedCharacterData);
        setOriginalData(updatedOriginalData);

        // 隐藏按钮（名称一致后条件不再满足）并显示成功消息
        if (!shouldPreserveNativeness && isNative && !hasLostNativeness) {
            setHasLostNativeness(true);
            setMessage({
                type: 'info',
                text: `已将所有“${oldBaseName}”替换为“${newBaseName}”。注意：新基础名称长度为 ${newBaseNameCharCount} 字，超过 ${NAME_REPLACE_NATIVE_MAX_CHARS} 字上限，本次替换会导致原生性丧失，保存时将移除原生签名。`
            });
        } else {
            setMessage({ type: 'success', text: `已将所有“${oldBaseName}”替换为“${newBaseName}”！` });
        }

    }, [characterData, originalData, hasLostNativeness, isNative]);

    const totalMatches = useMemo(() => {
        return sensitiveIssues.reduce((sum, issue) => sum + issue.matches.length, 0);
    }, [sensitiveIssues]);

    const flattenedMatches = useMemo(() => {
        const items: { key: string; issue: SensitiveIssue; match: SensitiveMatchDetail }[] = [];
        sensitiveIssues.forEach((issue, issueIndex) => {
            issue.matches.forEach((match, matchIndex) => {
                const key = `${issue.path || 'root'}-${match.startIndex}-${match.endIndex}-${match.matchType}-${issueIndex}-${matchIndex}`;
                items.push({ key, issue, match });
            });
        });
        return items;
    }, [sensitiveIssues]);

    const fieldIssueMap = useMemo(() => {
        const map = new Map<string, SensitiveIssue[]>();
        const assign = (key: string | undefined, issue: SensitiveIssue) => {
            if (!key) return;
            const list = map.get(key);
            if (list) {
                list.push(issue);
            } else {
                map.set(key, [issue]);
            }
        };
        sensitiveIssues.forEach(issue => {
            assign(issue.path, issue);
            if (issue.parentPath && issue.parentPath !== issue.path) {
                assign(issue.parentPath, issue);
            }
        });
        return map;
    }, [sensitiveIssues]);

    // 递归字段表单由共源 `DataCardFieldEditor` 渲染（D3.2b-1）；Web 只注入随机代号、名称替换、
    // 敏感词提示与既有全局样式类。字段身份以逐段 `path` 为准；敏感词扫描的 path/parentPath
    // 仍是点分串口径，查表沿用 `displayPath`。
    const renderFieldAddon = (currentPath: DataCardFieldPath, displayPath: string): DataCardFieldAddon => {
        const fieldIssues = fieldIssueMap.get(displayPath) || [];
        const hasIssue = fieldIssues.length > 0;
        const issueCount = fieldIssues.reduce((total, issue) => total + issue.matches.length, 0);
        const issueHint = hasIssue ? (
            <p className="text-xs text-red-500 mt-1">
                检测到 {issueCount} 处敏感词，建议参考下方“敏感词检测”面板进行修正。
                <span className="ml-1">
                    <Link href="/encyclopedia/sensitive-words" className="text-blue-600 hover:underline">为什么会触发？</Link>
                    <span className="mx-1 text-gray-400">·</span>
                    <Link href="/encyclopedia/shield-words" className="text-blue-600 hover:underline">屏蔽词/和谐说明</Link>
                </span>
            </p>
        ) : null;
        const nameAddon = characterManagerNameFieldAddon(currentPath, {
            data: characterData,
            originalData,
            onRandomCodename: handleRandomCodename,
            onReplaceAllNames: handleReplaceAllNames,
            replaceHint: DEFAULT_NATIVENESS_REPLACE_HINT,
        });
        return {
            invalid: hasIssue,
            inline: nameAddon.inline,
            below: (
                <>
                    {nameAddon.below}
                    {issueHint}
                </>
            ),
        };
    };

    const handleRandomCodename = () => {
        const newCodename = randomChooseOneHanaName();
        handleFieldChange('codename', newCodename);
    };

    const handleManualRescan = useCallback(() => {
        if (!characterData) return;
        setScanTrigger(prev => prev + 1);
    }, [characterData]);

    const handleHarmonize = useCallback((mode: 'first' | 'last') => {
        if (!characterData) {
            setMessage({ type: 'info', text: '请先加载角色或情景数据，再执行和谐操作。' });
            return;
        }

        if (sensitiveIssues.length === 0) {
            setMessage({ type: 'info', text: '未检测到敏感词，无需执行和谐。' });
            return;
        }

        let hasChange = false;
        const harmonizedUpdates: { path: string; value: string }[] = [];

        setCharacterData((prev: any) => {
            if (!prev) return prev;
            const cloned = JSON.parse(JSON.stringify(prev));
            let localChange = false;

            sensitiveIssues.forEach(issue => {
                if (!issue.matches.length) return;
                const originalValue = getValueAtPath(cloned, issue.path);
                if (typeof originalValue !== 'string') return;
                const { text, changed } = maskValueByMatches(originalValue, issue.matches, mode);
                if (changed && text !== originalValue) {
                    const updated = setValueAtPath(cloned, issue.path, text);
                    if (updated) {
                        harmonizedUpdates.push({ path: issue.path, value: text });
                        localChange = true;
                    }
                }
            });

            if (localChange) {
                hasChange = true;
                return cloned;
            }

            return prev;
        });

        if (hasChange) {
            if (harmonizedUpdates.length > 0) {
                setOriginalData((prev: any) => {
                    if (!prev) return prev;
                    const clonedOriginal = JSON.parse(JSON.stringify(prev));
                    harmonizedUpdates.forEach(({ path, value }) => {
                        if (path) {
                            setValueAtPath(clonedOriginal, path, value);
                        }
                    });
                    return clonedOriginal;
                });
            }
            setMessage({ type: 'success', text: `已执行${mode === 'first' ? '首字符' : '尾字符'}打码，建议重新扫描确认。` });
            setScanTrigger(prev => prev + 1);
        } else {
            setMessage({ type: 'info', text: '未找到可替换的敏感词片段，请确认检测结果。' });
        }
    }, [characterData, sensitiveIssues]);

    const handleManualCheck = useCallback(async () => {
        if (!manualCheckText.trim()) {
            setManualCheckResult(null);
            return;
        }

        setManualCheckLoading(true);
        try {
            const result = await quickCheck(manualCheckText);
            setManualCheckResult({
                ...result,
                matchDetails: sortMatchesByPosition(result.matchDetails || [])
            });
        } catch (error) {
            console.error('即时文本敏感词检测失败:', error);
            setMessage({ type: 'error', text: '即时文本检测失败，请稍后重试。' });
            setManualCheckResult(null);
        } finally {
            setManualCheckLoading(false);
        }
    }, [manualCheckText]);

    const handleManualReset = useCallback(() => {
        setManualCheckText('');
        setManualCheckResult(null);
    }, []);

    // ===================================
    // 保存与输出 (SRS 3.7.4 & 3.7.5)
    // ===================================
    const handleSaveChanges = async (type: 'download' | 'copy') => {
        if (!characterData) return;
        setMessage(null);
        setCopiedStatus(false); // 重置复制状态

        // 1. 前端先行内容安全检查，提供快速反馈
        if ((await quickCheck(JSON.stringify(characterData))).hasSensitiveWords) {
            setMessage({ type: 'error', text: '检测到不适宜内容，无法保存。请修改后重试。' });
            return;
        }

        // 声明一个变量，用于存储最终要处理的数据
        let finalData;

        try {
            // 2. 核心逻辑分歧：判断是否需要重新签名
            if (isNative && !hasLostNativeness) {
                // **情况一：数据为原生且未被破坏**
                // 此时，我们需要将当前编辑后的数据发送到服务器，获取一个新的有效签名。
                setMessage({ type: 'info', text: '正在请求服务器进行原生性签名认证...' });
                setIsLoading(true);

                const response = await fetch('/api/resign-data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(characterData),
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    if (errorData.shouldRedirect) {
                        router.push(getArrestedHref(errorData.reason || '编辑内容不合规'));
                        // 中断执行，因为页面即将跳转
                        return;
                    }
                    // 如果是其他错误，则抛出异常
                    throw new Error(errorData.message || '签名服务器认证失败');
                }

                // 使用服务器返回的、带有最新有效签名的数据作为最终数据
                finalData = await response.json();
                setMessage({ type: 'success', text: '原生性签名认证成功！' });

            } else {
                // **情况二：数据为衍生数据（非原生或已失去原生性）**
                // 按照原有逻辑，直接移除签名。
                finalData = { ...characterData };
                delete finalData.signature;
            }

            // 3. 执行下载或复制操作
            const isScenario = isScenarioData(finalData);
            const nameCandidates = [
                typeof finalData.codename === 'string' ? finalData.codename : '',
                typeof finalData.name === 'string' ? finalData.name : '',
                typeof finalData.title === 'string' ? finalData.title : '',
            ];
            const resolvedName = nameCandidates.map((item) => item.trim()).find((item) => item) || (isScenario ? '未命名情景' : '未命名角色');
            const filenamePrefix = isScenario ? '情景档案' : '角色档案';
            const jsonData = JSON.stringify(finalData, null, 2);

            if (type === 'download') {
                const blob = new Blob([jsonData], { type: 'application/json' });
                downloadBlob(blob, `${filenamePrefix}_${resolvedName}_已编辑.json`);
                // 延迟更新消息，确保用户能看到签名成功的提示
                setTimeout(() => setMessage({ type: 'success', text: '文件已下载！' }), 1000);
            } else {
                await navigator.clipboard.writeText(jsonData);
                setCopiedStatus(true);
                setTimeout(() => setCopiedStatus(false), 2000);
            }

        } catch (err) {
            const text = err instanceof Error ? err.message : '处理数据时发生未知错误。';
            setMessage({ type: 'error', text: `操作失败: ${text}` });
        } finally {
            setIsLoading(false);
        }
    };

    const handleExportWantuCharacter = async () => {
        if (!characterData) return;
        setMessage(null);

        if (isScenarioData(characterData)) {
            setMessage({ type: 'error', text: '当前内容是情景卡，不能导出为万途角色卡。' });
            return;
        }

        if ((await quickCheck(JSON.stringify(characterData))).hasSensitiveWords) {
            setMessage({ type: 'error', text: '检测到不适宜内容，无法导出万途角色卡。请修改后重试。' });
            return;
        }

        const mode = getWantuCharacterExportModeFromPreference(exportWantuRoundTrip);
        const result = buildWantuCharacterExportPayload(characterData, { mode });
        if (!result.success) {
            setMessage({ type: 'error', text: result.error });
            return;
        }

        const blob = new Blob([result.json], { type: 'application/json' });
        downloadBlob(blob, result.fileName);
        setMessage({ type: 'success', text: result.message });
    };

    /**
     * 【新增】处理图片保存的回调函数。
     * 当在移动设备上点击卡片保存按钮时，此函数会被调用。
     * @param imageUrl - 由卡片组件生成的图片Data URL。
     */
    const handleSaveImageCallback = (imageUrl: string) => {
        setSavedImageUrl(imageUrl);
        setShowImageModal(true);
    };

    return (
        <>
            <div className="magic-background-white">
                <div className="container">
                    <div className="card">
                        <CharacterManagerPageHeader
                            notice={(
                                <div className="flex mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800 text-left">
                                    <div className="mr-2">⚠️ </div>
                                    <div>用户系统仍处于测试阶段，可能存在功能不稳定的情况，敬请谅解。当前处于账号迁移期，请尽快在个人页设置密码完成迁移。</div>
                                </div>
                            )}
                        >
                            <CharacterManagerAccountPanel
                                status={authLoading ? 'loading' : isAuthenticated ? 'authenticated' : 'unauthenticated'}
                                banner={(
                                    <>
                                        {authMigrationLoading ? (
                                            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 text-left">
                                                正在检查账号迁移状态...
                                            </div>
                                        ) : null}
                                        {authMigrationError ? (
                                            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 text-left">
                                                账号迁移状态读取失败：{authMigrationError}
                                            </div>
                                        ) : null}
                                        {authMigrationStatus && (authMigrationStatus.migrationRequired || authMigrationStatus.legacyOnly) ? (
                                            <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-3 text-xs text-yellow-900 text-left">
                                                <div className="font-semibold">账号迁移提醒</div>
                                                <div className="mt-1">{authMigrationHint}</div>
                                                <div className="mt-1 text-yellow-800">
                                                    {!authMigrationStatus.hasAuthLink ? '未映射新版账号；' : '已映射新版账号；'}
                                                    {!authMigrationStatus.hasPassword ? '未设置密码；' : '已设置密码；'}
                                                    {authMigrationStatus.emailVerified ? '邮箱已验证。' : '邮箱未验证。'}
                                                </div>
                                                {legacyMigrationDeferCount > 0 ? (
                                                    <div className="mt-1 text-yellow-800">
                                                        你已选择“稍后处理” {legacyMigrationDeferCount} 次。
                                                    </div>
                                                ) : null}
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    <Link
                                                        href="/me?tab=settings"
                                                        className="rounded bg-white px-2 py-1 text-[11px] text-yellow-900 hover:bg-yellow-100"
                                                    >
                                                        去个人页完成迁移
                                                    </Link>
                                                    <Link
                                                        href="/encyclopedia/auth-migration"
                                                        className="rounded bg-white px-2 py-1 text-[11px] text-yellow-900 hover:bg-yellow-100"
                                                    >
                                                        迁移百科
                                                    </Link>
                                                    {authMigrationStatus.authSource === 'legacy-bearer' ? (
                                                        <button
                                                            onClick={() => setShowLegacyMigrationReminderModal(true)}
                                                            className="rounded bg-white px-2 py-1 text-[11px] text-yellow-900 hover:bg-yellow-100"
                                                        >
                                                            查看迁移说明
                                                        </button>
                                                    ) : null}
                                                </div>
                                            </div>
                                        ) : null}
                                    </>
                                )}
                                actions={(
                                    <div>
                                        <Link
                                            href="/badge-manager"
                                            className="mr-2 px-3 py-1.5 text-xs bg-pink-200 text-gray-700 rounded-lg hover:bg-pink-300 transition-colors"
                                        >
                                            徽章管理
                                        </Link>
                                        <Link
                                            href="/redeem"
                                            className="mr-2 px-3 py-1.5 text-xs bg-pink-200 text-gray-700 rounded-lg hover:bg-pink-300 transition-colors"
                                        >
                                            兑换
                                        </Link>
                                        <button
                                            onClick={handleLogout}
                                            className="px-3 py-1.5 text-xs bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                                        >
                                            退出登录
                                        </button>
                                    </div>
                                )}
                                userDisplay={(
                                    <UserWithTitle
                                        username={user?.username || ''}
                                        prefix={user?.prefix}
                                        usernameClassName="text-sm text-pink-700"
                                        titleClassName="text-xs"
                                        badges={userBadges}
                                        showBadges={true}
                                    />
                                )}
                                myDataCards={isAuthenticated ? {
                                    onOpen: () => setShowDataCardsModal(true),
                                    usedSlots: userUsedSlots,
                                    capacity: userCapacity,
                                } : undefined}
                                signedOut={{
                                    actionLabel: '登录 / 注册',
                                    onAction: () => setShowAuthModal(true),
                                    extra: (
                                        <Link
                                            href="/password-recovery"
                                            className="ml-3 text-sm text-purple-600 hover:text-purple-700 underline"
                                        >
                                            找回密码
                                        </Link>
                                    ),
                                }}
                            />
                        </CharacterManagerPageHeader>

                        <CharacterManagerGuide
                            capabilities={WEB_CHARACTER_MANAGER_CAPABILITIES}
                            linkComponent={Link}
                            saveAndExportText={(
                                <>
                                    完成修改后，可下载新的 <code>.json</code> 文件或将内容复制到剪贴板。
                                </>
                            )}
                        />

                        <CharacterManagerTemplateSelect
                            value={selectedTemplate}
                            hasContent={characterData !== null}
                            onSelect={handleTemplateSelect}
                        />

                        <CharacterManagerDraftBar
                            savedAt={autoSaveTimestamp}
                            onClear={handleClearCharacterManagerDraft}
                        />

                        {!characterData ? (
                            <CharacterManagerImportSection
                                onFile={(file) => {
                                    const reader = new FileReader();
                                    reader.onload = (e) => {
                                        processJsonData(e.target?.result as string);
                                    };
                                    reader.readAsText(file);
                                }}
                                fileExtra={(
                                    <label className="mt-2 flex items-start gap-2 text-xs text-gray-600">
                                        <input
                                            type="checkbox"
                                            checked={restoreWantuOriginalOnImport}
                                            onChange={(event) => setRestoreWantuOriginalOnImport(event.target.checked)}
                                            className="mt-0.5"
                                        />
                                        <span>导入万途往返卡时恢复本仓库原始模板</span>
                                    </label>
                                )}
                                pasteOpen={isPasteAreaVisible}
                                onPasteOpenChange={setIsPasteAreaVisible}
                                pasteValue={pastedJson}
                                onPasteChange={setPastedJson}
                                onPasteLoad={handlePasteAndLoad}
                                pasteBusy={isLoading}
                            />
                        ) : (
                            <CharacterManagerEditorBody
                                data={characterData}
                                onFieldChange={handleFieldChange}
                                title={isScenarioData(characterData)
                                    ? `编辑情景: ${characterData.title || characterData.name || '未命名情景'}`
                                    : `编辑角色: ${originalData.codename || originalData.name}`}
                                badge={isNative && !hasLostNativeness ? (
                                    <span className="px-3 py-1 text-xs font-semibold text-green-800 bg-green-100 rounded-full">原生数据</span>
                                ) : (
                                    <span className="px-3 py-1 text-xs font-semibold text-yellow-800 bg-yellow-100 rounded-full">衍生数据</span>
                                )}
                                classes={CHARACTER_MANAGER_FIELD_CLASSES}
                                renderFieldAddon={renderFieldAddon}
                                bottomActions={(
                                    <div className="mt-8 pt-4 border-t space-y-2">
                                        {isAuthenticated && characterData && (
                                            validationResult?.success ? (
                                                <div className="space-y-2">
                                                    <button
                                                        onClick={handleSaveAsDataCard}
                                                        className="generate-button w-full"
                                                        style={{ backgroundColor: '#10b981', backgroundImage: 'linear-gradient(to right, #10b981, #059669)' }}
                                                    >
                                                        保存到云端
                                                    </button>
                                                    <JsonSizeIndicator
                                                        data={characterData}
                                                        className="mt-0"
                                                        warningText="⚠️ 接近云端 300KB 上限，保存可能失败，请先精简数据。"
                                                    />
                                                </div>
                                            ) : validationResult?.error && (
                                                <div className="w-full p-3 bg-red-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm text-center">
                                                    该文件疑似包含额外字段，暂时不可上传云端 <br /> {validationResult?.error}
                                                </div>
                                            )
                                        )}
                                        <button onClick={() => handleSaveChanges('download')} disabled={message?.type === 'error' || isLoading} className="generate-button w-full">
                                            {isLoading ? '处理中...' : '保存修改并下载'}
                                        </button>
                                        <button onClick={() => handleSaveChanges('copy')} disabled={message?.type === 'error' || isLoading} className="generate-button w-full" style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}>
                                            {isLoading ? '处理中...' : copiedStatus ? '已复制！' : '复制到剪贴板'}
                                        </button>
                                        {!isScenarioData(characterData) && (
                                            <div className="space-y-2">
                                                <button
                                                    type="button"
                                                    onClick={handleExportWantuCharacter}
                                                    disabled={message?.type === 'error' || isLoading}
                                                    className="generate-button mb-0 flex w-full items-center justify-center gap-2"
                                                    style={{ backgroundColor: '#0f766e', backgroundImage: 'linear-gradient(to right, #0f766e, #0d9488)' }}
                                                >
                                                    <Download className="h-4 w-4" aria-hidden="true" />
                                                    <span>导出万途 JSON</span>
                                                </button>
                                                <label
                                                    htmlFor="wantu-round-trip-export"
                                                    className="flex items-start gap-2 rounded-lg border border-teal-100 bg-teal-50 px-3 py-2 text-xs text-teal-900"
                                                >
                                                    <input
                                                        id="wantu-round-trip-export"
                                                        type="checkbox"
                                                        checked={exportWantuRoundTrip}
                                                        onChange={(event) => handleWantuRoundTripExportPreferenceChange(event.target.checked)}
                                                        className="mt-0.5 accent-teal-700"
                                                    />
                                                    <span>
                                                        <span className="font-semibold">导出可往返 JSON：</span>
                                                        额外加 <code>_mahoshojo</code>，保存原始信息
                                                    </span>
                                                </label>
                                            </div>
                                        )}
                                        <button onClick={handleLoadOtherData} className="footer-link mt-4 w-full text-center">
                                            加载其他数据
                                        </button>
                                    </div>
                                )}
                            />
                        )}

                        {message && (
                            <div className={`p-4 rounded-md my-4 text-sm whitespace-pre-wrap ${message.type === 'error' ? 'bg-red-100 text-red-800' :
                                message.type === 'success' ? 'bg-green-100 text-green-800' :
                                    'bg-blue-100 text-blue-800'
                                }`}>
                                {message.text}
                                {message.text.includes('审核') && (
                                    <div className="mt-2 text-xs">
                                        <Link href="/encyclopedia/review" className="text-blue-700 hover:underline">了解公开与审核机制</Link>
                                    </div>
                                )}
                                {(message.text.includes('敏感词') || message.text.includes('逮捕')) && (
                                    <div className="mt-2 text-xs">
                                        <Link href="/encyclopedia/sensitive-words" className="text-blue-700 hover:underline">了解敏感词与逮捕（含恢复建议）</Link>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="card mt-6">
                        <h3 className="text-xl font-bold text-gray-800 text-center mb-2">敏感词检测控制台</h3>
                        <p className="text-sm text-gray-600 text-center">实时标记角色与情景内容中的敏感词，并提供快捷的文本检测与和谐工具。</p>
                        <div className="mt-2 flex flex-wrap justify-center gap-3 text-xs text-gray-600">
                            <Link href="/encyclopedia/sensitive-words" className="text-blue-600 hover:underline">敏感词与逮捕</Link>
                            <Link href="/encyclopedia/shield-words" className="text-blue-600 hover:underline">屏蔽词（和谐替换）</Link>
                            <Link href="/encyclopedia/review" className="text-blue-600 hover:underline">公开与审核</Link>
                        </div>

                        <div className="mt-4">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-semibold text-gray-700">当前档案扫描</span>
                                <span className="text-xs text-gray-500">{lastScanTime ? `最近扫描：${new Date(lastScanTime).toLocaleString()}` : '尚未扫描'}</span>
                            </div>

                            {!characterData ? (
                                <p className="mt-2 text-xs text-gray-500">请先加载角色或情景数据，以查看敏感词标记与和谐建议。</p>
                            ) : isSensitiveScanning ? (
                                <p className="mt-2 text-xs text-gray-500">正在扫描敏感词，请稍候...</p>
                            ) : totalMatches > 0 ? (
                                <>
                                    <p className="mt-2 text-xs text-gray-600">共标记 <span className="font-semibold text-pink-600">{totalMatches}</span> 处敏感词，请按照下方定位信息进行修正。</p>
                                    <ul className="mt-3 space-y-3 max-h-64 overflow-y-auto pr-1">
                                        {flattenedMatches.map(({ key, issue, match }) => (
                                            <li key={key} className="rounded border border-pink-100 bg-pink-50/70 p-2 text-xs text-gray-700">
                                                <div className="flex items-center justify-between text-[11px] text-pink-900 font-mono">
                                                    <span>{issue.path || '(根路径)'}</span>
                                                    <span>{match.matchType === 'variant' ? '变体' : match.matchType === 'regex' ? '正则命中' : '直接命中'}</span>
                                                </div>
                                                <div className="mt-1 leading-relaxed">
                                                    <span>{match.contextBefore}</span>
                                                    <mark className="bg-yellow-200 text-red-700 px-0.5">{match.matchedText}</mark>
                                                    <span>{match.contextAfter}</span>
                                                </div>
                                                <div className="mt-1 text-[10px] text-gray-500">词条：{match.word} ｜ 位置：{match.startIndex} - {match.endIndex - 1}</div>
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            ) : (
                                <p className="mt-2 text-xs text-emerald-600">未检测到敏感词，继续保持！</p>
                            )}

                            <div className="mt-4 flex flex-wrap gap-2">
                                <button
                                    onClick={() => handleHarmonize('first')}
                                    disabled={!characterData || totalMatches === 0}
                                    className="px-4 py-1.5 text-xs font-semibold text-white bg-pink-500 rounded-md hover:bg-pink-600 disabled:opacity-50 disabled:pointer-events-none"
                                >
                                    一键和谐（首字符）
                                </button>
                                <button
                                    onClick={() => handleHarmonize('last')}
                                    disabled={!characterData || totalMatches === 0}
                                    className="px-4 py-1.5 text-xs font-semibold text-white bg-purple-500 rounded-md hover:bg-purple-600 disabled:opacity-50 disabled:pointer-events-none"
                                >
                                    一键和谐（尾字符）
                                </button>
                                <button
                                    onClick={handleManualRescan}
                                    disabled={!characterData || isSensitiveScanning}
                                    className="px-4 py-1.5 text-xs font-semibold text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:pointer-events-none"
                                >
                                    重新扫描
                                </button>
                            </div>
                            <p className="mt-1 text-[11px] text-gray-500">和谐操作仅替换敏感词首尾字符为“*”，不会破坏整体文案结构，也不会影响原生性判定之外的其他字段。</p>
                        </div>

                        <div className="mt-6 border-t pt-4">
                            <h4 className="text-sm font-semibold text-gray-700">即时文本检测</h4>
                            <p className="text-xs text-gray-500 mt-1">将任意提示词、剧情或描述粘贴到下方文本框，实时验证敏感词风险。</p>
                            <textarea
                                value={manualCheckText}
                                onChange={(e) => setManualCheckText(e.target.value)}
                                rows={5}
                                className="input-field resize-y h-32 mt-3"
                                placeholder="在此粘贴待检测文本，支持多段内容。"
                            />
                            <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                    onClick={handleManualCheck}
                                    disabled={manualCheckLoading || !manualCheckText.trim()}
                                    className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-500 rounded-md hover:bg-indigo-600 disabled:opacity-50 disabled:pointer-events-none"
                                >
                                    {manualCheckLoading ? '检测中...' : '立即检测'}
                                </button>
                                <button
                                    onClick={handleManualReset}
                                    disabled={!manualCheckText && !manualCheckResult}
                                    className="px-4 py-1.5 text-xs font-semibold text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:pointer-events-none"
                                >
                                    清空文本
                                </button>
                            </div>

                            {manualCheckResult && (
                                <div className={`mt-3 rounded-md border p-3 text-xs ${manualCheckResult.hasSensitiveWords ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                                    <div className="font-semibold">
                                        {manualCheckResult.hasSensitiveWords
                                            ? `检测到 ${manualCheckResult.matchDetails.length} 处敏感词`
                                            : '未检测到敏感词'}
                                    </div>
                                    {manualCheckResult.hasSensitiveWords && (
                                        <ul className="mt-2 space-y-2 max-h-48 overflow-y-auto pr-1 text-gray-700">
                                            {manualCheckResult.matchDetails.map((match, index) => (
                                                <li key={`manual-${index}-${match.startIndex}-${match.endIndex}`} className="rounded bg-white/90 p-2 shadow-sm">
                                                    <div className="flex items-center justify-between text-[11px] text-gray-500">
                                                        <span>{match.matchType === 'variant' ? '变体' : match.matchType === 'regex' ? '正则命中' : '直接命中'}</span>
                                                        <span>位置 {match.startIndex} - {match.endIndex - 1}</span>
                                                    </div>
                                                    <div className="mt-1 leading-relaxed">
                                                        <span>{match.contextBefore}</span>
                                                        <mark className="bg-yellow-200 text-red-700 px-0.5">{match.matchedText}</mark>
                                                        <span>{match.contextAfter}</span>
                                                    </div>
                                                    <div className="mt-1 text-[10px] text-gray-500">词条：{match.word}</div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 角色卡片预览与生成区域 */}
                    {characterData && !isLoading && (currentTemplate === 'magical-girl' || currentTemplate === 'canshou' || currentTemplate === 'general') && (
                        <div className="card mt-6">
                            <h3 className="text-xl font-bold text-gray-800 text-center mb-4">
                                角色卡片预览与生成
                            </h3>
                            {currentTemplate === 'magical-girl' ? (
                                <MagicalGirlCard
                                    magicalGirl={characterData}
                                    gradientStyle={(() => {
                                        const colorScheme = characterData.appearance?.colorScheme || "粉色";
                                        const mainColorName = Object.values(MainColor).find(color => colorScheme.includes(color)) || MainColor.Pink;
                                        const colors = gradientColors[mainColorName] || gradientColors[MainColor.Pink];
                                        return `linear-gradient(135deg, ${colors.first} 0%, ${colors.second} 100%)`;
                                    })()}
                                    onSaveImage={handleSaveImageCallback}
                                    portraitAsset={characterPortraitAsset}
                                />
                            ) : currentTemplate === 'canshou' ? (
                                <CanshouCard
                                    canshou={characterData}
                                    onSaveImage={handleSaveImageCallback}
                                    portraitAsset={characterPortraitAsset}
                                />
                            ) : (
                                <GeneralCharacterCard
                                    general={characterData}
                                    onSaveImage={handleSaveImageCallback}
                                    portraitAsset={characterPortraitAsset}
                                />
                            )}
                        </div>
                    )}

                    {/* 立绘生成 - 只对角色数据显示 */}
                    {!isScenarioData(characterData) && (
                        <div className="card" style={{ marginTop: '1rem' }}>
                            <button
                                onClick={() => setIsTachieVisible(!isTachieVisible)}
                                className="w-full text-left text-lg font-bold text-gray-800"
                            >
                                {isTachieVisible ? '▼' : '▶'} 立绘生成
                            </button>
                            {isTachieVisible && characterData && (
                                <div className="mt-4 pt-4 border-t">
                                    <CharacterPortraitAssetPanel
                                        prompt={tachiePrompt}
                                        onPortraitAssetChange={setCharacterPortraitAsset}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    <div className="text-center mt-8">
                        <Link href="/" className="footer-link">返回首页</Link>
                    </div>
                    <Footer />
                </div>

                {/* 【新增】用于移动端长按保存的图片模态框 */}
                {showImageModal && savedImageUrl && (
                    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4" onClick={() => setShowImageModal(false)}>
                        <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-auto relative" onClick={(e) => e.stopPropagation()}>
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
                                <p className="text-center text-sm text-gray-600 mb-2">📱 长按图片保存到相册</p>
                                <img src={savedImageUrl} alt="角色卡片" className="w-full h-auto rounded-lg" />
                            </div>
                        </div>
                    </div>
                )}
            </div >

            {showLegacyMigrationReminderModal ? (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4">
                    <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
                        <h3 className="text-lg font-semibold text-gray-900">旧密钥登录迁移提醒</h3>
                        <p className="mt-2 text-sm text-gray-700">
                            你本次使用了旧密钥登录。为避免后续旧入口下线导致无法登录，请尽快在个人页完成“设置登录密码”迁移。
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                            迁移步骤可查看百科：/encyclopedia/auth-migration
                        </p>
                        <p className="mt-2 text-xs text-gray-500">
                            {legacyMigrationDeferCount > 0
                                ? `你已选择“稍后处理” ${legacyMigrationDeferCount} 次。`
                                : '你还未处理过迁移提醒。'}
                        </p>
                        {isLegacyMigrationSoftBlocked ? (
                            <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                                你已多次选择“稍后处理”，本次登录需先完成迁移设置后再继续使用。
                            </p>
                        ) : null}
                        <div className="mt-4 flex justify-end gap-2">
                            {!isLegacyMigrationSoftBlocked ? (
                                <button
                                    type="button"
                                    onClick={handleDeferLegacyMigrationReminder}
                                    className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                    稍后处理
                                </button>
                            ) : null}
                            <Link
                                href="/me?tab=settings"
                                onClick={() => setShowLegacyMigrationReminderModal(false)}
                                className="rounded bg-pink-600 px-3 py-1.5 text-sm text-white hover:bg-pink-700"
                            >
                                去个人页迁移
                            </Link>
                            <Link
                                href="/encyclopedia/auth-migration"
                                onClick={() => setShowLegacyMigrationReminderModal(false)}
                                className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                            >
                                查看迁移百科
                            </Link>
                        </div>
                    </div>
                </div>
            ) : null}

            {/* 认证模态框 */}
            < AuthModal
                isOpen={showAuthModal}
                onClose={() => {
                    setShowAuthModal(false);
                    setAuthMessage(null);
                }}
                onLogin={handleLogin}
                onRegister={handleRegister}
                authMessage={authMessage}
            />

            {/* 数据卡管理模态框 */}
            < DataCardsModal
                isOpen={showDataCardsModal}
                onClose={() => {
                    setShowDataCardsModal(false);
                    setCurrentPage(1);
                }}
                dataCards={[]}
                summaryOwnerId={user?.id}
                refreshKey={cardsRefresh}
                editingCard={editingCard}
                currentPage={currentPage}
                cardsPerPage={cardsPerPage}
                onPageChange={setCurrentPage}
                onEditCard={setEditingCard}
                onUpdateCard={handleUpdateDataCard}
                onDeleteCard={handleDeleteDataCard}
                onLoadCard={handleLoadDataCard}
                onCancelEdit={() => setEditingCard(null)}
            onShareCard={handleShareDataCard}
            onReplaceCard={handleReplaceExistingCard}
            allowHistoryReplace={true}
            userCapacity={userCapacity}
            userUsedSlots={userUsedSlots}
            onOpenRecycleBin={() => {
                setShowDataCardsModal(false);
                setShowRecycleBinModal(true);
            }}
                recycleCount={recycleBinCards.length}
                recycleLimit={config.RECYCLE_BIN_LIMIT}
            />

            < QuestionnaireCompatModal
                isOpen={showQuestionnaireCompatModal}
                onClose={() => {
                    setShowQuestionnaireCompatModal(false);
                    setQuestionnaireCompatRawJson('');
                    setQuestionnaireCompatTargetCard(null);
                }}
                rawJson={questionnaireCompatRawJson}
                targetCard={questionnaireCompatTargetCard}
                onReplaceSuccess={(pendingReview) => {
                    setMessage({ type: 'success', text: pendingReview ? '更新已提交审核，审核通过后生效' : '问卷数据卡已替换' });
                    loadUserDataCards();
                    loadUserBadges();
                }}
            />

            < NarrativeHistoryCardEditorModal
                isOpen={showHistoryCardEditor}
                onClose={() => {
                    setShowHistoryCardEditor(false);
                    setHistoryCardDraft(null);
                    setHistoryCardTarget(null);
                }}
                initialData={historyCardDraft}
                targetCard={historyCardTarget}
                onReplaceTarget={historyCardTarget ? handleReplaceHistoryCard : undefined}
            />

            {/* 回收站模态框 */}
            < RecycleBinModal
                isOpen={showRecycleBinModal}
                onClose={() => setShowRecycleBinModal(false)}
                recycleCards={recycleBinCards}
                onRestore={handleRestoreRecycleCard}
                onDelete={handleDeleteRecycleCard}
                limit={config.RECYCLE_BIN_LIMIT}
            />

            {/* 保存数据卡弹窗 */}
            < SaveCardModal
                isOpen={showSaveCardModal}
                onClose={() => {
                    setShowSaveCardModal(false);
                    setNewCardForm({ name: '', description: '', isPublic: 0 });
                    setSaveCardError(null);
                    setIsSavingCard(false);
                }}
                onSave={handleConfirmSaveCard}
                data={characterData}
                name={newCardForm.name}
                description={newCardForm.description}
                isPublic={newCardForm.isPublic}
                onNameChange={(value) => setNewCardForm({ ...newCardForm, name: value })}
                onDescriptionChange={(value) => setNewCardForm({ ...newCardForm, description: value })}
                onPublicChange={(value) => setNewCardForm({ ...newCardForm, isPublic: value })}
                error={saveCardError}
                isSaving={isSavingCard}
                usedSlots={userUsedSlots}
                userCapacity={userCapacity}
            />

        </>
    );
};
