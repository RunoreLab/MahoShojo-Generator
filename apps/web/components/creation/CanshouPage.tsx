'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useProviderModeCooldown } from '@/lib/cooldown';
import Link from 'next/link';
import CanshouCard, { CanshouDetails } from '@/components/CanshouCard';
import GeneralCharacterCard from '@/components/GeneralCharacterCard';
import { generateRandomCanshou } from '@/lib/random-character-generator';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import Footer from '@/components/Footer';
import QuestionNavigator from '@/components/QuestionNavigator';
import {
  AnswerReviewList,
  BulkAnswerTools,
  CANSHOU_SAVE_PREFERENCES_THEME,
  CanshouLorePanel,
  DetailsSavePreferencesPanel,
  isMobileFormFactor,
  recommendedSaveModes,
  SaveJsonButton,
} from '@mahoshojo/ui-web/details-controls';
import { DetailsIntroSection } from '@/components/shared/DetailsIntroSection';
import {
  CANSHOU_SELECTION_THEME,
  QuestionnaireSelectionPanel,
} from '@/components/questionnaire/QuestionnaireSelectionPanel';
import { useAppRouterAdapter } from '@/lib/app-router-adapter';
import { CANSHOU_PREFERENCES_STORAGE_KEY } from '@/lib/settings/page-preferences';
import BattleDataModal from '@/components/BattleDataModal';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import AiReasoningPanel from '@/components/ai/AiReasoningPanel';
import { ProviderCooldownNotice } from '@/components/ai/ProviderCooldownNotice';
import { ErrorMessage } from '@/components/ErrorMessage';
import { GenerationModeSwitcher, type GenerationMode } from '@/components/shared/GenerationModeSwitcher';
import { TokenIndicator } from '@/components/shared/TokenIndicator';
import { JsonSizeIndicator } from '@/components/shared/JsonSizeIndicator';
import { ThemeImage } from '@/components/shared/ThemeImage';
import {
  CANSHOU_QUESTIONNAIRE_THEME,
  QuestionnaireQuestionPanel,
} from '@/components/questionnaire/QuestionnaireQuestionPanel';
import { QuestionnaireAnswerExportPanel } from '@/components/questionnaire/QuestionnaireAnswerExportPanel';
import {
  buildQuestionnaireAnswerExportText,
  collectQuestionnaireAnswerExportItems,
} from '@mahoshojo/domain/questionnaire-answer-export';
import { CreatorEntryLink } from '@/components/shared/CreatorEntryLink';
import { StreamStopButton } from '@/components/shared/StreamStopButton';
import { STREAM_ABORT_REASON_USER } from '@/lib/stream/abort';
import { readSafeTextAndReasoningStreamFromResponse } from '@/lib/stream/read-safe-text-and-reasoning-stream';
import { buildGeneralCharacterCardFromMarkdown } from '@/lib/stream/markdown-card';
import { readJsonOrTextFromResponse, resolveApiErrorMessage } from '@/lib/client/apiError';
import { AI_META_REQUEST_HEADER, AI_META_REQUEST_VALUE, readJsonWithAiMeta } from '@/lib/client/read-json-with-ai-meta';
import { formatHttpErrorMessage } from '@/lib/client/httpError';
import { downloadBlob } from '@/lib/client/blobUrl';
import { authStorage } from '@/lib/auth';
import { useGenerationApiIntentLatch } from '@/lib/use-generation-api-intent-latch';
import { buildCustomProviderRequestPayload } from '@/lib/ai/custom-provider';
import { mapDataCardSourceMeta } from '@/lib/data-card-read-mappers';
import {
  buildQuestionnaireAnswerLookup,
  buildQuestionnaireFlow,
  collectStoredQuestionnaireAnswerItems,
  compactQuestionnaireAnswerItems,
  formatQuestionnaireAnswers,
  normalizeQuestionnaireDefinition,
  parseQuestionnaireDataCardPayload,
  normalizeUserAnswers,
  resolveQuestionnaireAnswerTarget,
  resolveQuestionnaireReferences,
  type QuestionnaireAnswerItem,
  type QuestionnaireAnswerMatchTarget,
  type QuestionnairePresetEntry,
  type StoredQuestionnaireAnswerItem,
} from '@/lib/questionnaires';
import { getAnswerLimitInfo, isAnswerOverLimit, QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS } from '@/lib/questionnaire-limits';
import {
  applyQuestionnaireSelection,
  buildQuestionnaireContextItems,
  buildQuestionnaireGenerationRequestFields,
  buildQuestionnaireSelectionLoreText,
  createStoredQuestionnaireSelectionNormalizer,
  ensureQuestionnaireSelectionId,
  isQuestionnaireSelectionNativeAllowed,
  pickDefaultQuestionnairePresetEntry,
  reconcileQuestionnaireSelectionsForSingleMode,
  remapAnswersToQuestionnaireChange,
  removeQuestionnaireSelection,
  setQuestionnaireSelectionLore,
  type QuestionnaireContextItem as DomainQuestionnaireContextItem,
  type QuestionnaireSelection as DomainQuestionnaireSelection,
} from '@mahoshojo/domain/questionnaire-selection';

import type { AIReasoningEnvelope } from '@/types/ai-reasoning';

const normalizeStoredSelection = createStoredQuestionnaireSelectionNormalizer({
  fallbackKind: 'canshou',
  normalize: (value, fallback) => normalizeQuestionnaireDefinition(value, fallback),
});

type QuestionnaireSelection = DomainQuestionnaireSelection;
type QuestionnaireContextItem = DomainQuestionnaireContextItem;

type JsonSaveMode = 'download' | 'text';
type ImageSaveMode = 'download' | 'modal';
type DeviceType = 'mobile' | 'desktop' | 'unknown';

type RateLimitError = Error & {
  retryAfterSeconds?: number;
};

type CanshouResultPayload = CanshouDetails & {
  templateId?: string;
  signature?: string | null;
  userAnswers?: QuestionnaireAnswerItem[] | string[] | Record<string, string>;
};

const resolveCanshouJsonFileName = (data: CanshouResultPayload): string =>
  `残兽档案_${(data.name || 'data').replace(/[^a-z0-9一-龥]/gi, '_')}.json`;

const LOCAL_STORAGE_KEY = 'canshouAnswersDraft'; // 定义本地存储的键
// 偏好存储键的唯一来源在 `lib/settings/page-preferences`。
const CANSHOU_PREFERENCE_KEY = CANSHOU_PREFERENCES_STORAGE_KEY;

export const CanshouPage: React.FC = () => {
  const generationApiIntentLatch = useGenerationApiIntentLatch();
  const router = useAppRouterAdapter();
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedQuestionnaires, setSelectedQuestionnaires] = useState<QuestionnaireSelection[]>([]);
  const [presetEntries, setPresetEntries] = useState<QuestionnairePresetEntry[]>([]);
  const [allowMultipleQuestionnaires, setAllowMultipleQuestionnaires] = useState(false);
  const [showQuestionnaireSettings, setShowQuestionnaireSettings] = useState(false);
  const [questionnaireLoadError, setQuestionnaireLoadError] = useState<string | null>(null);
  const [answersByKey, setAnswersByKey] = useState<Record<string, string>>({});
  const [selectionReady, setSelectionReady] = useState(false);
  const [showPasteImport, setShowPasteImport] = useState(false);
  const [pasteQuestionnaireText, setPasteQuestionnaireText] = useState('');
  const [pasteQuestionnaireError, setPasteQuestionnaireError] = useState<string | null>(null);
  const [draftRestoreReady, setDraftRestoreReady] = useState(false);
  const draftRestoredRef = useRef(false);
  const previousQuestionTargetsRef = useRef<QuestionnaireAnswerMatchTarget[] | null>(null);
  const previousQuestionTargetSignatureRef = useRef<string | null>(null);
  const currentQuestionKeyRef = useRef<string | null>(null);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentAnswer, setCurrentAnswer] = useState('');
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
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [canshouDetails, setCanshouDetails] = useState<CanshouResultPayload | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  const [showIntroduction, setShowIntroduction] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLore, setShowLore] = useState(false);
  const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);
  const isUserCustomKey = userProviderConfig?.providerId !== 'system' && !!userProviderConfig?.apiKey?.trim();
  const providerCooldownMode = isUserCustomKey ? 'custom' : 'system';
  const generatorCooldownMs = isUserCustomKey ? 3000 : 60000;
  const { isCooldown, startCooldown, remainingTime, otherRemainingTime } = useProviderModeCooldown({
    baseKey: 'generateCanshouCooldown',
    currentMode: providerCooldownMode,
    systemDurationMs: 60000,
    customDurationMs: 3000,
  });
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('zh-CN');
  const [showLanguageSection, setShowLanguageSection] = useState(false); // 控制生成语言区域的折叠状态
  const [showBulkFillSection, setShowBulkFillSection] = useState(false); // 控制一键填充区域的折叠状态
  const [showAnswerReview, setShowAnswerReview] = useState(false);
  const [deviceType, setDeviceType] = useState<DeviceType>('unknown');
  const [imageSaveMode, setImageSaveMode] = useState<ImageSaveMode>('download');
  const [jsonSaveMode, setJsonSaveMode] = useState<JsonSaveMode>('download');
  const [generationMode, setGenerationMode] = useState<GenerationMode>('non-stream');
  const [streamingMarkdown, setStreamingMarkdown] = useState<string | null>(null);
  const [streamedGeneralCard, setStreamedGeneralCard] = useState<any | null>(null);
  const [streamingReasoning, setStreamingReasoning] = useState<AIReasoningEnvelope | null>(null);
  const [nonStreamReasoning, setNonStreamReasoning] = useState<AIReasoningEnvelope | null>(null);
  const [streamNotice, setStreamNotice] = useState<string | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const [autoSaveTimestamp, setAutoSaveTimestamp] = useState<number | null>(null);
  const recommendedImageMode: ImageSaveMode = recommendedSaveModes(deviceType === 'mobile').imageSaveMode;
  const recommendedJsonMode: JsonSaveMode = recommendedSaveModes(deviceType === 'mobile').jsonSaveMode;
  const clearTransitionTimers = useCallback(() => {
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    if (transitionEndTimerRef.current) {
      clearTimeout(transitionEndTimerRef.current);
      transitionEndTimerRef.current = null;
    }
  }, []);
  const createSelectionSuffix = useCallback(() => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }, []);
  const ensureSelectionId = useCallback(
    (selection: QuestionnaireSelection, used: Set<string>) =>
      ensureQuestionnaireSelectionId(selection, used, createSelectionSuffix),
    [createSelectionSuffix]
  );

  const questionnaireItems = useMemo<QuestionnaireContextItem[]>(
    () => buildQuestionnaireContextItems(selectedQuestionnaires),
    [selectedQuestionnaires]
  );

  const resolvedQuestionItems = useMemo(
    () => resolveQuestionnaireReferences(questionnaireItems),
    [questionnaireItems]
  );

  const allQuestionTargets = useMemo<QuestionnaireAnswerMatchTarget[]>(
    () => resolvedQuestionItems.map((item, index) => ({
      key: item.key,
      index,
      question: item.question.question,
      questionId: item.question.id,
      questionnaireId: item.questionnaireId,
      questionnaireTitle: item.questionnaireTitle,
    })),
    [resolvedQuestionItems]
  );

  const questionAnswerLookup = useMemo(
    () => buildQuestionnaireAnswerLookup(allQuestionTargets),
    [allQuestionTargets]
  );

  const questionTargetSignature = useMemo(
    () => allQuestionTargets.map((item) => `${item.key}::${item.questionId ?? ''}::${item.question}`).join('\n'),
    [allQuestionTargets]
  );

  const getQuestionnaireFlow = useCallback(
    (answers: Record<string, string>) => buildQuestionnaireFlow(resolvedQuestionItems, answers),
    [resolvedQuestionItems]
  );

  const {
    flow: mergedQuestions,
    indexByKey: mergedQuestionIndexByKey,
  } = useMemo(() => getQuestionnaireFlow(answersByKey), [answersByKey, getQuestionnaireFlow]);

  // 可见流序的目标集：无元数据批量条目按页面展示序号回落（与 DetailsPage 同口径）。
  const mergedQuestionTargets = useMemo<QuestionnaireAnswerMatchTarget[]>(
    () => mergedQuestions.map((item, index) => ({
      key: item.key,
      index,
      question: item.question.question,
      questionId: item.question.id,
      questionnaireId: item.questionnaireId,
      questionnaireTitle: item.questionnaireTitle,
    })),
    [mergedQuestions]
  );

  const answerItems = useMemo<QuestionnaireAnswerItem[]>(() => {
    const items: QuestionnaireAnswerItem[] = [];
    mergedQuestions.forEach((item) => {
      const raw = answersByKey[item.key];
      const answer = typeof raw === 'string' ? raw.trim() : '';
      if (!answer) return;
      items.push({
        question: item.question.question,
        answer,
        questionId: item.question.id,
        questionnaireId: item.questionnaireId,
        questionnaireTitle: item.questionnaireTitle,
      });
    });
    return items;
  }, [mergedQuestions, answersByKey]);

  const buildOverLimitItems = useCallback((answers: Record<string, string>) => {
    return mergedQuestions.flatMap((item) => {
      const raw = answers[item.key];
      const answer = typeof raw === 'string' ? raw.trim() : '';
      if (!answer) return [];
      if (!isAnswerOverLimit(answer, item.question.maxLength ?? null)) return [];
      const limitInfo = getAnswerLimitInfo(item.question.maxLength ?? null);
      if (!limitInfo.limit) return [];
      return [{
        key: item.key,
        question: item.question.question,
        questionnaireTitle: item.questionnaireTitle,
        limit: limitInfo.limit,
        source: limitInfo.source,
        length: answer.length,
      }];
    });
  }, [mergedQuestions]);

  const overLimitItems = useMemo(() => buildOverLimitItems(answersByKey), [answersByKey, buildOverLimitItems]);
  const hasOverLimitAnswer = overLimitItems.length > 0;

  const isQuestionnaireNativeAllowed = useMemo(
    () => isQuestionnaireSelectionNativeAllowed(selectedQuestionnaires),
    [selectedQuestionnaires]
  );

  const questionnaireLoreText = useMemo(
    () => buildQuestionnaireSelectionLoreText(selectedQuestionnaires),
    [selectedQuestionnaires]
  );

  const tokenEstimateText = useMemo(() => {
    const answerText = formatQuestionnaireAnswers(answerItems);
    if (questionnaireLoreText && answerText) return `${questionnaireLoreText}\n\n${answerText}`;
    return questionnaireLoreText || answerText;
  }, [answerItems, questionnaireLoreText]);

  const shouldDisableRemove = selectedQuestionnaires.length <= 1;

  const resolvedResultPayload = useMemo(() => {
    if (!canshouDetails) return null;
    const serverAnswers = normalizeUserAnswers(
      canshouDetails.userAnswers,
      questionnaireItems.map((item) => item.question.question)
    );
    return {
      ...canshouDetails,
      userAnswers: serverAnswers.length > 0 ? serverAnswers : answerItems,
    };
  }, [canshouDetails, answerItems, questionnaireItems]);

  const streamedGeneralCardForDisplay = useMemo(() => {
    if (generationMode !== 'stream') return null;
    const markdown = streamingMarkdown ?? streamedGeneralCard?.content ?? null;
    if (markdown === null) return null;

    const { card } = buildGeneralCharacterCardFromMarkdown({
      markdown,
      defaultName: '残兽',
    });

    return card;
  }, [generationMode, streamingMarkdown, streamedGeneralCard]);

  useEffect(() => {
    fetch('/languages.json')
      .then(res => res.json())
      .then(data => setLanguages(data))
      .catch(err => console.error("Failed to load languages:", err));
  }, [ensureSelectionId]);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const isMobileDevice = isMobileFormFactor();
    const detectedType: DeviceType = isMobileDevice ? 'mobile' : 'desktop';
    setDeviceType(detectedType);
    const defaultImageMode: ImageSaveMode = recommendedSaveModes(isMobileDevice).imageSaveMode;
    const defaultJsonMode: JsonSaveMode = recommendedSaveModes(isMobileDevice).jsonSaveMode;

    try {
      const saved = window.localStorage.getItem(CANSHOU_PREFERENCE_KEY);
      if (!saved) {
        setImageSaveMode(defaultImageMode);
        setJsonSaveMode(defaultJsonMode);
        return;
      }
      const parsed = JSON.parse(saved);
      if (parsed?.generationMode === 'stream' || parsed?.generationMode === 'non-stream') {
        setGenerationMode(parsed.generationMode);
      }
      if (typeof parsed?.selectedLanguage === 'string') {
        setSelectedLanguage(parsed.selectedLanguage);
      }
      if (parsed?.imageSaveMode === 'download' || parsed?.imageSaveMode === 'modal') {
        setImageSaveMode(parsed.imageSaveMode);
      } else {
        setImageSaveMode(defaultImageMode);
      }
      if (parsed?.jsonSaveMode === 'download' || parsed?.jsonSaveMode === 'text') {
        setJsonSaveMode(parsed.jsonSaveMode);
      } else {
        setJsonSaveMode(defaultJsonMode);
      }
      if (typeof parsed?.showLanguageSection === 'boolean') {
        setShowLanguageSection(parsed.showLanguageSection);
      }
      if (typeof parsed?.showBulkFillSection === 'boolean') {
        setShowBulkFillSection(parsed.showBulkFillSection);
      }
      if (typeof parsed?.showAnswerReview === 'boolean') {
        setShowAnswerReview(parsed.showAnswerReview);
      }
      if (typeof parsed?.allowMultipleQuestionnaires === 'boolean') {
        setAllowMultipleQuestionnaires(parsed.allowMultipleQuestionnaires);
      }
      if (typeof parsed?.showQuestionnaireSettings === 'boolean') {
        setShowQuestionnaireSettings(parsed.showQuestionnaireSettings);
      }
      if (Array.isArray(parsed?.questionnaireSelections)) {
        const usedSelectionIds = new Set<string>();
        const restored = (parsed.questionnaireSelections as unknown[])
          .map((raw): QuestionnaireSelection | null =>
            normalizeStoredSelection(raw))
          .filter((item): item is QuestionnaireSelection => Boolean(item))
          .map((item) => ensureSelectionId(item, usedSelectionIds));
        if (restored.length > 0) {
          setSelectedQuestionnaires(restored);
          setSelectionReady(true);
        }
      }
    } catch (error) {
      console.warn('读取残兽生成偏好失败', error);
      setImageSaveMode(defaultImageMode);
      setJsonSaveMode(defaultJsonMode);
    }
  }, [ensureSelectionId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const payload = {
        generationMode,
        selectedLanguage,
        imageSaveMode,
        jsonSaveMode,
        showLanguageSection,
        showBulkFillSection,
        showAnswerReview,
        allowMultipleQuestionnaires,
        showQuestionnaireSettings,
        questionnaireSelections: selectedQuestionnaires,
      };
      window.localStorage.setItem(CANSHOU_PREFERENCE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage 可能不可用，忽略
    }
  }, [
    generationMode,
    selectedLanguage,
    imageSaveMode,
    jsonSaveMode,
    showLanguageSection,
    showBulkFillSection,
    showAnswerReview,
    allowMultipleQuestionnaires,
    showQuestionnaireSettings,
    selectedQuestionnaires,
  ]);

  useEffect(() => {
    return () => {
      clearTransitionTimers();
    };
  }, [clearTransitionTimers]);

  useEffect(() => {
    clearTransitionTimers();
    setIsTransitioning(false);
  }, [selectedQuestionnaires, clearTransitionTimers]);

  useEffect(() => {
    let cancelled = false;
    const loadPresetIndex = async () => {
      setQuestionnaireLoadError(null);
      try {
        const response = await fetch('/questionnaires/presets/index.json');
        if (!response.ok) throw new Error('加载预设问卷索引失败');
        const data = await response.json();
        const list = Array.isArray(data?.presets) ? (data.presets as QuestionnairePresetEntry[]) : [];
        const filtered = list.filter((item) => item.kind === 'canshou');
        if (!cancelled) setPresetEntries(filtered);
      } catch (error) {
        console.error('加载预设问卷失败:', error);
        if (!cancelled) {
          setPresetEntries([]);
          setQuestionnaireLoadError('📋 预设问卷加载失败，请刷新页面重试');
        }
      }
    };
    void loadPresetIndex();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectionReady) return;
    if (selectedQuestionnaires.length > 0) {
      setSelectionReady(true);
      return;
    }
    if (presetEntries.length === 0) return;
    let cancelled = false;
    const loadDefaultPreset = async () => {
      const defaultPreset = pickDefaultQuestionnairePresetEntry(presetEntries);
      if (!defaultPreset) {
        if (!cancelled) setSelectionReady(true);
        return;
      }
      try {
        const response = await fetch(defaultPreset.path);
        if (!response.ok) throw new Error('加载预设问卷失败');
        const data = await response.json();
        const nativeAllowed = typeof (data as any)?.nativeAllowed === 'boolean' ? Boolean((data as any).nativeAllowed) : true;
        const normalized = normalizeQuestionnaireDefinition(data, {
          fallbackId: defaultPreset.id,
          fallbackKind: defaultPreset.kind,
          fallbackTitle: defaultPreset.title,
          nativeAllowed,
        });
        if (!normalized) throw new Error('预设问卷解析失败');
        if (cancelled) return;
        setSelectedQuestionnaires([
          ensureSelectionId({ source: 'preset', questionnaire: normalized }, new Set()),
        ]);
        setSelectionReady(true);
      } catch (error) {
        console.error('加载默认问卷失败:', error);
        if (!cancelled) {
          setQuestionnaireLoadError('📋 默认问卷加载失败，请刷新页面重试');
          setSelectionReady(true);
        }
      }
    };
    void loadDefaultPreset();
    return () => {
      cancelled = true;
    };
  }, [ensureSelectionId, presetEntries, selectedQuestionnaires.length, selectionReady]);

  useEffect(() => {
    if (selectionReady) setLoading(false);
  }, [selectionReady]);

  useEffect(() => {
    const previousTargets = previousQuestionTargetsRef.current;
    const previousSignature = previousQuestionTargetSignatureRef.current;
    previousQuestionTargetsRef.current = allQuestionTargets;
    previousQuestionTargetSignatureRef.current = questionTargetSignature;

    if (!previousTargets || previousSignature === null || previousSignature === questionTargetSignature) {
      return;
    }

    setAnswersByKey((prev) =>
      remapAnswersToQuestionnaireChange({
        previousTargets,
        answersByKey: prev,
        lookup: questionAnswerLookup,
      }),
    );
  }, [allQuestionTargets, questionAnswerLookup, questionTargetSignature]);

  const applySelection = (selection: QuestionnaireSelection) => {
    setSelectedQuestionnaires((prev) =>
      applyQuestionnaireSelection(prev, selection, {
        allowMultiple: allowMultipleQuestionnaires,
        createSuffix: createSelectionSuffix,
      }),
    );
    setPasteQuestionnaireError(null);
    setPasteQuestionnaireText('');
    setShowPasteImport(false);
    setShowIntroduction(false);
    setShowQuestionnaireSettings(false);
  };

  const handleRemoveSelection = (selectionId: string) => {
    clearTransitionTimers();
    setIsTransitioning(false);
    setSelectedQuestionnaires((prev) => removeQuestionnaireSelection(prev, selectionId));
  };

  const handleToggleSelectionLore = (selectionId: string, enabled: boolean) => {
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
      const normalized = normalizeQuestionnaireDefinition(rawData, {
        fallbackKind: 'canshou',
        fallbackId: typeof rawData?.id === 'string' ? rawData.id : `canshou-card-${card?.id ?? ''}`,
        fallbackTitle: typeof rawData?.title === 'string' ? rawData.title : card?.name || '未命名问卷',
        nativeAllowed: typeof rawData?.nativeAllowed === 'boolean' ? rawData.nativeAllowed : false,
      });
      if (!normalized) throw new Error('问卷数据卡解析失败');
      applySelection({
        source: 'database',
        questionnaire: normalized,
        ...cardSourceMeta,
      });
      setQuestionnairePickerError(null);
      setShowQuestionnairePicker(false);
    } catch (error) {
      setQuestionnairePickerError(error instanceof Error ? error.message : '解析问卷失败');
    }
  };

  const handleUploadQuestionnaire = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const normalized = normalizeQuestionnaireDefinition(parsed, {
        fallbackKind: 'canshou',
        fallbackId: typeof parsed?.id === 'string' ? parsed.id : 'canshou-upload',
        fallbackTitle: typeof parsed?.title === 'string' ? parsed.title : file.name.replace(/\.[^.]+$/, ''),
        nativeAllowed: false,
      });
      if (!normalized) throw new Error('问卷文件解析失败');
      applySelection({
        source: 'upload',
        questionnaire: normalized,
      });
      setPasteQuestionnaireError(null);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : '问卷文件解析失败');
    }
  };

  const handlePasteQuestionnaireImport = () => {
    if (!pasteQuestionnaireText.trim()) {
      setPasteQuestionnaireError('请先粘贴问卷 JSON');
      return;
    }
    try {
      const parsed = JSON.parse(pasteQuestionnaireText);
      const normalized = normalizeQuestionnaireDefinition(parsed, {
        fallbackKind: 'canshou',
        fallbackId: typeof parsed?.id === 'string' ? parsed.id : 'canshou-paste',
        fallbackTitle: typeof parsed?.title === 'string' ? parsed.title : '未命名问卷',
        nativeAllowed: false,
      });
      if (!normalized) throw new Error('问卷 JSON 无法识别，请检查格式');
      applySelection({
        source: 'upload',
        questionnaire: normalized,
      });
      setPasteQuestionnaireError(null);
      setError(null);
    } catch (error) {
      setPasteQuestionnaireError(error instanceof Error ? error.message : '问卷 JSON 解析失败');
    }
  };

  const handleAddPreset = async (presetId: string) => {
    const preset = presetEntries.find((item) => item.id === presetId);
    if (!preset) return;
    try {
      const response = await fetch(preset.path);
      if (!response.ok) throw new Error('加载预设问卷失败');
      const data = await response.json();
      const nativeAllowed = typeof (data as any)?.nativeAllowed === 'boolean' ? Boolean((data as any).nativeAllowed) : true;
      const normalized = normalizeQuestionnaireDefinition(data, {
        fallbackId: preset.id,
        fallbackKind: preset.kind,
        fallbackTitle: preset.title,
        nativeAllowed,
      });
      if (!normalized) throw new Error('预设问卷解析失败');
      applySelection({ source: 'preset', questionnaire: normalized });
    } catch (error) {
      setError(error instanceof Error ? error.message : '加载预设问卷失败');
    }
  };

  useEffect(() => {
    if (allowMultipleQuestionnaires) return;
    const nextSelections = reconcileQuestionnaireSelectionsForSingleMode(selectedQuestionnaires);
    if (!nextSelections) return;
    setSelectedQuestionnaires(nextSelections);
    setCurrentQuestionIndex(0);
  }, [allowMultipleQuestionnaires, selectedQuestionnaires]);

  useEffect(() => {
    if (mergedQuestions.length === 0) {
      currentQuestionKeyRef.current = null;
      if (currentQuestionIndex !== 0) {
        setCurrentQuestionIndex(0);
      }
      return;
    }

    const previousKey = currentQuestionKeyRef.current;
    const mappedIndex = previousKey ? mergedQuestionIndexByKey.get(previousKey) : undefined;
    const nextIndex = typeof mappedIndex === 'number' ? mappedIndex : 0;

    if (nextIndex !== currentQuestionIndex) {
      setCurrentQuestionIndex(nextIndex);
    }
    currentQuestionKeyRef.current = mergedQuestions[nextIndex]?.key ?? null;
  }, [mergedQuestions, mergedQuestionIndexByKey, currentQuestionIndex]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!allQuestionTargets.length) return;
    if (draftRestoredRef.current) return;
    draftRestoredRef.current = true;

    try {
      const savedDraft = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!savedDraft) return;
      const parsed = JSON.parse(savedDraft);
      const nextAnswers: Record<string, string> = {};
      const applyStoredEntry = (entry: StoredQuestionnaireAnswerItem, index: number, allowIndexFallback: boolean) => {
        const answer = typeof entry.answer === 'string' ? entry.answer : '';
        if (!answer.trim()) return;
        const target = resolveQuestionnaireAnswerTarget(
          questionAnswerLookup,
          {
            key: entry.key,
            question: entry.question,
            questionId: entry.questionId,
            questionnaireId: entry.questionnaireId,
            questionnaireTitle: entry.questionnaireTitle,
            index,
          },
          { allowIndexFallback }
        );
        if (!target) return;
        nextAnswers[target.key] = answer;
      };

      if (Array.isArray(parsed)) {
        parsed.forEach((value, index) => {
          if (typeof value === 'string' && value.trim()) {
            const target = allQuestionTargets[index];
            if (target) {
              nextAnswers[target.key] = value;
            }
            return;
          }
          if (value && typeof value === 'object') {
            const record = value as Record<string, unknown>;
            applyStoredEntry({
              key: typeof record.key === 'string' ? record.key : undefined,
              question: typeof record.question === 'string' ? record.question : `问题 ${index + 1}`,
              answer: typeof record.answer === 'string'
                ? record.answer
                : (typeof record.value === 'string' ? record.value : ''),
              questionId: typeof record.questionId === 'string' ? record.questionId : undefined,
              questionnaireId: typeof record.questionnaireId === 'string' ? record.questionnaireId : undefined,
              questionnaireTitle: typeof record.questionnaireTitle === 'string' ? record.questionnaireTitle : undefined,
            }, index, true);
          }
        });
      } else if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        const direct = record.answersByKey;
        if (direct && typeof direct === 'object') {
          Object.entries(direct as Record<string, unknown>).forEach(([key, value]) => {
            if (typeof value === 'string' && value.trim() && questionAnswerLookup.byKey.has(key)) {
              nextAnswers[key] = value;
            }
          });
        }

        const answerEntries = Array.isArray(record.answerEntries) ? record.answerEntries : [];
        if (answerEntries.length > 0) {
          answerEntries.forEach((value, index) => {
            if (!value || typeof value !== 'object') return;
            const entryRecord = value as Record<string, unknown>;
            applyStoredEntry({
              key: typeof entryRecord.key === 'string' ? entryRecord.key : undefined,
              question: typeof entryRecord.question === 'string' ? entryRecord.question : `问题 ${index + 1}`,
              answer: typeof entryRecord.answer === 'string'
                ? entryRecord.answer
                : (typeof entryRecord.value === 'string' ? entryRecord.value : ''),
              questionId: typeof entryRecord.questionId === 'string' ? entryRecord.questionId : undefined,
              questionnaireId: typeof entryRecord.questionnaireId === 'string' ? entryRecord.questionnaireId : undefined,
              questionnaireTitle: typeof entryRecord.questionnaireTitle === 'string' ? entryRecord.questionnaireTitle : undefined,
            }, index, false);
          });
        } else if (!direct || typeof direct !== 'object') {
          allQuestionTargets.forEach((item, index) => {
            const candidates = [
              item.questionId,
              `${index}`,
              `${index + 1}`,
              `CS-${index + 1}`,
            ];
            for (const key of candidates) {
              if (!key) continue;
              const value = record[key];
              if (typeof value === 'string' && value.trim()) {
                nextAnswers[item.key] = value;
                break;
              }
            }
          });
        }
      }

      if (Object.keys(nextAnswers).length > 0) {
        setAnswersByKey((prev) => ({ ...prev, ...nextAnswers }));
        const firstKey = mergedQuestions[0]?.key;
        if (firstKey) setCurrentAnswer(nextAnswers[firstKey] || '');
        setAutoSaveTimestamp(Date.now());
      }
    } catch (e) {
      console.error("Failed to load answers from localStorage", e);
    } finally {
      setDraftRestoreReady(true);
    }
  }, [allQuestionTargets, mergedQuestions, questionAnswerLookup]);

  useEffect(() => {
    if (!draftRestoreReady || allQuestionTargets.length === 0) return;
    try {
      const answerEntries = collectStoredQuestionnaireAnswerItems(allQuestionTargets, answersByKey);
      if (answerEntries.length > 0) {
        const dataToSave = JSON.stringify({ version: 3, answersByKey, answerEntries });
        localStorage.setItem(LOCAL_STORAGE_KEY, dataToSave);
        setAutoSaveTimestamp(Date.now());
      } else {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      }
    } catch (e) {
      console.error("Failed to save answers to localStorage", e);
    }
  }, [allQuestionTargets, answersByKey, draftRestoreReady]);

  useEffect(() => {
    const currentKey = mergedQuestions[currentQuestionIndex]?.key;
    if (!currentKey) {
      setCurrentAnswer('');
      return;
    }
    setCurrentAnswer(answersByKey[currentKey] || '');
  }, [currentQuestionIndex, mergedQuestions, answersByKey]);

  const commitAnswerSnapshot = (override?: string) => {
    const item = mergedQuestions[currentQuestionIndex];
    if (!item) return answersByKey;
    const raw = override ?? currentAnswer;
    const normalized = raw.trim();
    const nextAnswers = { ...answersByKey };
    if (normalized.length > 0) {
      nextAnswers[item.key] = raw;
    } else {
      delete nextAnswers[item.key];
    }
    return nextAnswers;
  };

  const handleCurrentAnswerChange = (value: string) => {
    setCurrentAnswer(value);
    setError(null);
    const item = mergedQuestions[currentQuestionIndex];
    if (!item) return;
    setAnswersByKey((prev) => {
      const next = { ...prev };
      if (value.trim()) {
        next[item.key] = value;
      } else {
        delete next[item.key];
      }
      return next;
    });
  };

  const proceedToNextQuestion = (nextAnswers: Record<string, string>) => {
    clearTransitionTimers();
    setIsTransitioning(false);
    const currentKey = mergedQuestions[currentQuestionIndex]?.key;
    const { flow: nextFlow, indexByKey: nextIndexByKey } = getQuestionnaireFlow(nextAnswers);
    const currentFlowIndex = currentKey ? (nextIndexByKey.get(currentKey) ?? -1) : -1;
    const nextIndex = currentFlowIndex + 1;

    if (nextIndex >= 0 && nextIndex < nextFlow.length) {
      setIsTransitioning(true);
      transitionTimerRef.current = setTimeout(() => {
        const nextKey = nextFlow[nextIndex]?.key ?? null;
        currentQuestionKeyRef.current = nextKey;
        setCurrentQuestionIndex(nextIndex);
        setCurrentAnswer(nextKey ? nextAnswers[nextKey] || '' : '');
        transitionEndTimerRef.current = setTimeout(() => {
          setIsTransitioning(false);
        }, 50);
      }, 250);
      return;
    }

    handleSubmit(nextAnswers);
  };

  const handleNext = () => {
    const item = mergedQuestions[currentQuestionIndex];
    if (!item) return;
    const normalizedAnswer = currentAnswer.trim();
    const isRequired = item.question.required === true;

    if (isRequired && normalizedAnswer.length === 0) {
      setError('⚠️ 请输入或选择一个答案');
      return;
    }
    const nextAnswers = commitAnswerSnapshot(currentAnswer);
    setAnswersByKey(nextAnswers);
    setError(null);
    proceedToNextQuestion(nextAnswers);
  };

  const handlePreviousQuestion = () => {
    if (currentQuestionIndex === 0) return;
    clearTransitionTimers();
    setIsTransitioning(false);
    const nextAnswers = commitAnswerSnapshot();
    setAnswersByKey(nextAnswers);
    const previousIndex = currentQuestionIndex - 1;
    const prevKey = mergedQuestions[previousIndex]?.key;
    currentQuestionKeyRef.current = prevKey ?? null;
    setCurrentQuestionIndex(previousIndex);
    setCurrentAnswer(prevKey ? nextAnswers[prevKey] || '' : '');
    setError(null);
  };

  const handleOptionClick = (option: string) => {
    setCurrentAnswer(option);
    setError(null);
    const nextAnswers = commitAnswerSnapshot(option);
    setAnswersByKey(nextAnswers);
    proceedToNextQuestion(nextAnswers);
  };

  const handleSuggestionFill = (value: string) => {
    handleCurrentAnswerChange(value);
  };

  const resignDataCard = useCallback(async (data: any) => {
    const response = await fetch('/api/resign-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null as any);
      if (errorData?.shouldRedirect) {
        router.push('/arrested');
        return null;
      }
      throw new Error(errorData?.message || '签名服务器认证失败');
    }

    return response.json();
  }, [router]);

  const handleNavigateToQuestion = (index: number) => {
    if (index === currentQuestionIndex || index < 0 || index >= mergedQuestions.length) return;
    clearTransitionTimers();
    setIsTransitioning(false);
    const nextAnswers = commitAnswerSnapshot();
    setAnswersByKey(nextAnswers);
    setCurrentQuestionIndex(index);
    const nextKey = mergedQuestions[index]?.key;
    currentQuestionKeyRef.current = nextKey ?? null;
    setCurrentAnswer(nextKey ? nextAnswers[nextKey] || '' : '');
    setError(null);
  };

  const handleSubmit = async (answersSnapshot?: Record<string, string>) => {
    if (isCooldown) {
      setError(`请等待 ${remainingTime} 秒后再生成`);
      return;
    }
    if (userProviderConfig && userProviderConfig.providerId !== 'system' && !userProviderConfig.apiKey?.trim()) {
      setError('⚠️ 已选择自定义 AI 供应商，但尚未填写 API Key。');
      return;
    }
    setSubmitting(true);
    setError(null);
    setCanshouDetails(null);
    setStreamingMarkdown(null);
    setStreamedGeneralCard(null);
    setStreamingReasoning(null);
    setNonStreamReasoning(null);
    setStreamNotice(null);
    let nextCooldownMs = generatorCooldownMs;
    let shouldStartCooldown = false;

    try {
      const snapshot = answersSnapshot ?? answersByKey;
      const finalAnswerItems: QuestionnaireAnswerItem[] = [];
      mergedQuestions.forEach((item) => {
        const raw = snapshot[item.key];
        const answer = typeof raw === 'string' ? raw.trim() : '';
        if (!answer) return;
        finalAnswerItems.push({
          question: item.question.question,
          answer,
          questionId: item.question.id,
          questionnaireId: item.questionnaireId,
          questionnaireTitle: item.questionnaireTitle,
        });
      });

      if (finalAnswerItems.length === 0) {
        setError('⚠️ 请至少填写一题后再生成');
        return;
      }

      const overLimitForSubmit = buildOverLimitItems(snapshot);
      const allowNativeSignatureForSubmit = isQuestionnaireNativeAllowed && overLimitForSubmit.length === 0;

      const customProviderPayload = buildCustomProviderRequestPayload(userProviderConfig);

      const endpoint = generationMode === 'stream' ? '/api/generate-canshou-stream?format=sse' : '/api/generate-canshou';
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
      const response = await generationIntent.dispatch(endpoint, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          answers: finalAnswerItems,
          ...buildQuestionnaireGenerationRequestFields(selectedQuestionnaires),
          allowNativeSignature: allowNativeSignatureForSubmit,
          language: selectedLanguage,
          customProvider: customProviderPayload,
        }),
        ...(streamController ? { signal: streamController.signal } : {}),
      });

      if (!response.ok) {
        const { payload } = await readJsonOrTextFromResponse(response);
        const errorData = payload && typeof payload === 'object' ? (payload as any) : null;
        if (errorData?.shouldRedirect) {
          router.push('/arrested');
          return;
        }
        if (response.status === 429) {
          const retryAfterRaw = errorData?.retryAfterSeconds ?? errorData?.retryAfter ?? response.headers.get('Retry-After') ?? 60;
          const retryAfter = Math.max(1, Number.parseInt(String(retryAfterRaw), 10) || 60);
          const rateLimitError = new Error(`请求过于频繁（HTTP 429）！请等待 ${retryAfter} 秒后再试。`) as RateLimitError;
          rateLimitError.retryAfterSeconds = retryAfter;
          throw rateLimitError;
        }
        const serverMessage = resolveApiErrorMessage({ payload, fallback: '生成失败' });
        throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: '生成失败' }));
      }

      if (generationMode === 'stream') {
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json') || contentType.includes('+json')) {
          const { payload } = await readJsonOrTextFromResponse(response);
          const serverMessage = resolveApiErrorMessage({ payload, fallback: '生成失败' });
          throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: '生成失败' }));
        }

        setStreamingMarkdown('');
        const controller = streamAbortControllerRef.current;
        if (!controller) {
          throw new Error('流式控制器初始化失败');
        }
        const { text: markdown, outputSafetyStatus, wasAborted, abortReason } = await readSafeTextAndReasoningStreamFromResponse(response, {
          abortController: controller,
          label: '残兽档案（流式）',
          onText: (text) => setStreamingMarkdown(text),
          onReasoning: (reasoning) => setStreamingReasoning(reasoning),
          safetyReason: '使用危险符文',
        });

        const { card } = buildGeneralCharacterCardFromMarkdown({
          markdown,
          defaultName: '残兽',
        });
        const cardWithAnswers = {
          ...card,
          userAnswers: compactQuestionnaireAnswerItems(finalAnswerItems),
        };
        if (outputSafetyStatus === 'blocked') {
          setStreamNotice('输出触发调查院规则，已自动截断并追加逮捕令。当前内容可能不完整，但可继续保存。');
        } else if (wasAborted) {
          setStreamNotice(
            abortReason === STREAM_ABORT_REASON_USER
              ? '已手动停止生成。当前内容可能不完整，但可继续保存。'
              : '流式生成已中断。当前内容可能不完整，但可继续保存。'
          );
        }
        if (!allowNativeSignatureForSubmit) {
          setStreamedGeneralCard(cardWithAnswers);
          setError(null);
          shouldStartCooldown = true;
          return;
        }

        let signedCard = cardWithAnswers;
        let hasSignError = false;
        if (!wasAborted && outputSafetyStatus !== 'blocked') {
          try {
            const result = await resignDataCard(cardWithAnswers);
            if (!result) return;
            signedCard = result;
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

      const { data: result, aiMeta } = await readJsonWithAiMeta<CanshouResultPayload>(response);
      setCanshouDetails(result);
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
        setError(err instanceof Error ? `✨ 魔法失效了！${err.message}` : '发生未知错误');
      }
    } finally {
      streamAbortControllerRef.current = null;
      if (shouldStartCooldown) {
        startCooldown(nextCooldownMs);
      }
      setSubmitting(false);
    }
  };

  const handleRegenerate = () => {
    handleSubmit(answersByKey);
  };

  const handleSaveImage = (imageUrl: string) => {
    setSavedImageUrl(imageUrl);
    setShowImageModal(true);
  };

  const imageSaveButtonLabel = imageSaveMode === 'download'
    ? '💾 一键保存长图'
    : '📱 打开长按保存弹窗';

  const downloadStreamedGeneralCard = (data: any) => {
    if (!data) return;
    const jsonPayload = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonPayload], { type: 'application/json' });
    const rawName = (data?.codename || data?.name || '未命名角色').toString();
    const sanitizedName = rawName.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').slice(0, 80) || 'data';
    downloadBlob(blob, `通用残兽角色_${sanitizedName}.json`);
  };

  const copyStreamedGeneralCard = async (data: any) => {
    if (!data) return;
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        throw new Error('clipboard-not-available');
      }
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      alert('✅ 通用角色卡 JSON 已复制到剪贴板');
    } catch (err) {
      console.error('复制 JSON 失败：', err);
      alert('⚠️ 复制失败，请手动长按选择 JSON 内容后复制。');
    }
  };

  const handleClearDraft = () => {
    if (window.confirm('确定要清空所有已保存的问卷答案吗？此操作不可撤销。')) {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      setAnswersByKey({});
      setCurrentAnswer('');
      setAutoSaveTimestamp(null);
      alert('存档已清空！');
    }
  };

  // 批量填充/角色卡导入成功后统一写回：同步当前题输入框并清错误态。
  const handleApplyImportedAnswers = (next: Record<string, string>) => {
    setAnswersByKey(next);
    const currentKey = mergedQuestions[currentQuestionIndex]?.key;
    setCurrentAnswer(currentKey ? next[currentKey] || '' : '');
    setError(null);
  };

  const buildAnswerExportText = useCallback(() => {
    const selectedTitles = selectedQuestionnaires
      .map((selection) => selection.questionnaire.title?.trim())
      .filter((title): title is string => Boolean(title));
    const questionnaireLabel = selectedTitles.length > 0 ? selectedTitles.join(' + ') : '';
    return buildQuestionnaireAnswerExportText({
      title: '残兽问卷答案备份',
      items: collectQuestionnaireAnswerExportItems(
        mergedQuestions.map((item) => ({
          key: item.key,
          question: item.question.question,
          questionnaireTitle: item.questionnaireTitle,
        })),
        answersByKey,
      ),
      total: mergedQuestions.length,
      questionnaireLabel,
    });
  }, [answersByKey, mergedQuestions, selectedQuestionnaires]);

  if (loading) {
    return (
      <div className="magic-background-dark">
        <div className="container"><div className="card text-center">加载中...</div></div>
      </div>
    );
  }

  if (resolvedQuestionItems.length === 0) {
    const hasLore = selectedQuestionnaires.some((selection) => Boolean(selection.questionnaire.loreMarkdown?.trim()));
    return (
      <div className="magic-background-dark">
        <div className="container">
          <div className="card text-center">
            <div className="text-rose-400">
              {hasLore
                ? '当前所选问卷仅包含设定（无题目），请在“问卷设置”中再添加一份有题目的问卷。'
                : '加载问卷失败'}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              关闭“允许同时回答多份问卷”时，也可以叠加纯设定卡；但你仍需要至少一份有题目的问卷用于作答。
            </div>
            {hasLore && (
              <div className="mt-4 flex flex-col items-center justify-center gap-2">
                <button
                  type="button"
                  className="generate-button"
                  onClick={() => {
                    setSelectedQuestionnaires([]);
                    setSelectionReady(false);
                    setLoading(true);
                  }}
                >
                  恢复默认问卷
                </button>
                <Link href="/questionnaire-editor" className="text-xs text-emerald-200 hover:underline">
                  打开问卷编辑器
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  if (mergedQuestions.length === 0) {
    return (
      <div className="magic-background-dark">
        <div className="container"><div className="card text-center">当前没有可作答的题目，请检查问卷条件设置</div></div>
      </div>
    );
  }

  const currentQuestionItem = mergedQuestions[currentQuestionIndex];
  const currentQuestion = currentQuestionItem?.question;
  const currentQuestionnaireTitle = currentQuestionItem?.questionnaireTitle ?? '';
  const primaryQuestionnaire = selectedQuestionnaires[0]?.questionnaire;
  const isLastQuestion = currentQuestionIndex === mergedQuestions.length - 1;
  const progressPercent = Math.round(((currentQuestionIndex + 1) / mergedQuestions.length) * 100);
  const navigatorItems = mergedQuestions.map((item) => ({
    id: item.key,
    label: item.questionnaireTitle ? `${item.question.question} · ${item.questionnaireTitle}` : item.question.question
  }));
  const allowCustomInput = currentQuestion?.allowCustom !== false;
  const currentLimitInfo = getAnswerLimitInfo(currentQuestion?.maxLength ?? null);
  const currentMaxLength = currentLimitInfo.limit;
  const currentAnswerLength = currentAnswer.trim().length;
  const isCurrentOverLimit = Boolean(currentMaxLength && currentAnswerLength > currentMaxLength);
  const currentLimitLabel = currentLimitInfo.source === 'question'
    ? `题目上限 ${currentMaxLength} 字`
    : currentLimitInfo.source === 'global'
      ? `原生统一上限 ${currentMaxLength} 字`
      : '不限';
  const isCurrentRequired = currentQuestion?.required === true;
  const hasOptions = (currentQuestion?.options?.length ?? 0) > 0;
  const showTextInput = allowCustomInput || !hasOptions;
  const fallbackQuickOptions = allowCustomInput ? ['记录未知', '稍后补充'] : [];
  const suggestionPool = showTextInput ? (currentQuestion?.suggestions ?? []).filter(Boolean) : [];
  const nextButtonLabel = isCooldown
    ? `冷却中 (${remainingTime}s)`
    : submitting
      ? '生成中...'
      : isLastQuestion
        ? (isCurrentRequired || currentAnswer.trim() ? '生成档案' : '跳过并生成')
        : (!isCurrentRequired && !currentAnswer.trim() ? '跳过并继续' : '下一题');
  const optionsHintText = allowCustomInput
    ? '推荐选项（点击后将自动进入下一题，可在下方补充）'
    : '推荐选项（点击后将自动进入下一题，本题仅可从选项中选择）';
  const overLimitText = `⚠️ 已超过${currentLimitLabel}，继续提交将导致生成内容丧失原生性。`;

  return (
    <>
      <div className="magic-background-dark">
        <div className="container">
          <div className="card">
            <div className="text-center mb-4">
              <ThemeImage lightSrc="/beast-logo.svg" darkSrc="/beast-logo-white.svg" className="w-full px-8" alt="残兽调查" />
              {primaryQuestionnaire?.description && (
                <p className="text-gray-600 mt-2">{primaryQuestionnaire.description}</p>
              )}
            </div>

            {showIntroduction ? (
              <DetailsIntroSection
                description={null}
                onStart={() => setShowIntroduction(false)}
                startLabel="开始调查"
                onQuickRandom={() => {
                  setSubmitting(true);
                  setError(null);
                  try {
                    const data = generateRandomCanshou();
                    setCanshouDetails(data);
                    setShowIntroduction(false);
                  } catch (err) {
                    console.error('随机生成失败: ', err);
                    setError('随机生成失败，请稍后再试。');
                  } finally {
                    setSubmitting(false);
                  }
                }}
                quickRandomBusy={submitting}
                quickRandomStyle={{ background: 'linear-gradient(to right, #7e22ce, #a855f7)' }}
                encyclopediaItems={[{ slug: 'character-generator', text: '百科：角色生成（/name、/details、/canshou）' }]}
                onNavigateEntry={(href) => router.push(href)}
                encyclopediaLinkClassName="text-blue-200 hover:underline"
                encyclopediaLabelClassName="text-slate-300"
                extraLink={(
                  <CreatorEntryLink
                    className="text-sm text-slate-300"
                    linkClassName="font-semibold text-emerald-300 hover:underline"
                  />
                )}
                backHome={<Link href="/" className="footer-link">返回首页</Link>}
              />
            ) : (!canshouDetails && !streamedGeneralCard) ? (
              <>
                <QuestionNavigator
                  items={navigatorItems}
                  currentIndex={currentQuestionIndex}
                  onNavigate={handleNavigateToQuestion}
                  isAnswered={(index) => {
                    const key = mergedQuestions[index]?.key;
                    return key ? Boolean(answersByKey[key]?.trim()) : false;
                  }}
                  theme="dark"
                />

                <QuestionnaireSelectionPanel
                  theme={CANSHOU_SELECTION_THEME}
                  expanded={showQuestionnaireSettings}
                  onToggleExpanded={() => setShowQuestionnaireSettings(!showQuestionnaireSettings)}
                  allowMultiple={allowMultipleQuestionnaires}
                  onAllowMultipleChange={setAllowMultipleQuestionnaires}
                  selections={selectedQuestionnaires}
                  shouldDisableRemove={shouldDisableRemove}
                  onRemoveSelection={handleRemoveSelection}
                  onToggleLore={handleToggleSelectionLore}
                  onShowDetails={handleOpenQuestionnaireDetails}
                  nativeAllowed={isQuestionnaireNativeAllowed}
                  hasOverLimitAnswer={hasOverLimitAnswer}
                  nativeMaxAnswerChars={QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS}
                  presets={presetEntries}
                  onSelectPreset={(presetId) => void handleAddPreset(presetId)}
                  onUploadFile={(file) => void handleUploadQuestionnaire(file)}
                  onOpenPicker={() => {
                    setQuestionnairePickerError(null);
                    setShowQuestionnairePicker(true);
                  }}
                  editorLink={(
                    <Link href="/questionnaire-editor" className="text-xs text-emerald-300 hover:underline">
                      打开问卷编辑器
                    </Link>
                  )}
                  pasteExpanded={showPasteImport}
                  onTogglePasteExpanded={() => {
                    setPasteQuestionnaireError(null);
                    setShowPasteImport((prev) => !prev);
                  }}
                  pasteText={pasteQuestionnaireText}
                  onPasteTextChange={setPasteQuestionnaireText}
                  onApplyPaste={handlePasteQuestionnaireImport}
                  onClearPaste={() => {
                    setPasteQuestionnaireText('');
                    setPasteQuestionnaireError(null);
                  }}
                  pasteError={pasteQuestionnaireError}
                  error={questionnaireLoadError}
                />

                <QuestionnaireQuestionPanel
                  theme={CANSHOU_QUESTIONNAIRE_THEME}
                  progressLabel={`问题 ${currentQuestionIndex + 1} / ${mergedQuestions.length}`}
                  progressPercent={progressPercent}
                  progressExtra={autoSaveTimestamp ? (
                    <span className="text-xs text-slate-500">已自动保存于 {new Date(autoSaveTimestamp).toLocaleTimeString()}</span>
                  ) : null}
                  questionText={currentQuestion?.question || '未加载题目'}
                  questionnaireTitle={currentQuestionnaireTitle}
                  noticeText="请基于您构想的虚拟档案回答，并确保内容符合公序良俗，请勿使用任何真实信息。"
                  helperText={currentQuestion?.helperText}
                  isRequired={isCurrentRequired}
                  skipText="本题可跳过，不作答将不会记录"
                  quickOptions={fallbackQuickOptions}
                  quickOptionDisabled={submitting || isTransitioning || isCooldown}
                  onQuickOption={handleOptionClick}
                  options={currentQuestion?.options}
                  optionsHintText={optionsHintText}
                  onOptionSelect={handleOptionClick}
                  suggestions={suggestionPool}
                  onSuggestionSelect={handleSuggestionFill}
                  showTextInput={showTextInput}
                  answer={currentAnswer}
                  onAnswerChange={handleCurrentAnswerChange}
                  placeholder={currentQuestion?.placeholder || '请在此输入你的想法...'}
                  answerLength={currentAnswerLength}
                  maxLength={currentMaxLength}
                  limitLabel={currentLimitLabel}
                  showLimitLabel={currentLimitInfo.source !== 'none' && Boolean(currentMaxLength)}
                  isOverLimit={isCurrentOverLimit}
                  overLimitText={overLimitText}
                  isTransitioning={isTransitioning}
                  prevLabel="返回上题"
                  nextButtonContent={nextButtonLabel}
                  onPrev={handlePreviousQuestion}
                  onNext={handleNext}
                  disablePrev={currentQuestionIndex === 0 || submitting || isTransitioning || isCooldown}
                  disableNext={submitting || isTransitioning || isCooldown || (isCurrentRequired && !currentAnswer.trim())}
                  prevButtonClass="generate-button sm:w-1/4"
                  nextButtonClass="generate-button flex-1"
                />

                <TokenIndicator
                  text={tokenEstimateText}
                  warningText="⚠️ 预计问卷回答较长，可能更易超时/失败。可尝试精简答案或减少问卷数量。"
                />

                {generationMode === 'stream' && streamedGeneralCardForDisplay && (
                  <div className="my-6">
                    <GeneralCharacterCard
                      general={streamedGeneralCardForDisplay}
                      isStreaming={submitting}
                      onStopGeneration={() => streamAbortControllerRef.current?.abort(STREAM_ABORT_REASON_USER)}
                    />
                    <AiReasoningPanel reasoning={streamingReasoning} status={streamingReasoning?.status ?? 'idle'} compact />
                  </div>
                )}

                {/* 多语言支持 */}
                <div className="my-4 bg-gray-100 rounded-lg p-3">
                  <button
                    onClick={() => setShowLanguageSection(!showLanguageSection)}
                    className="flex items-center justify-between w-full text-left font-medium text-gray-700 hover:text-blue-600"
                  >
                    <span>
                      <img src="/globe.svg" alt="Language" className="inline-block w-4 h-4 mr-2" />
                      生成语言
                    </span>
                    <span className="ml-2">{showLanguageSection ? '▼' : '▶'}</span>
                  </button>
                  {showLanguageSection && (
                    <div className="mt-3">
                      <select
                        id="language-select"
                        value={selectedLanguage}
                        onChange={(e) => setSelectedLanguage(e.target.value)}
                        className="input-field"
                        disabled={submitting}
                      >
                        {languages.map(lang => (
                          <option key={lang.code} value={lang.code}>{lang.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* 生成方式：非流式 / 流式 */}
                <div className="my-4 bg-gray-100 rounded-lg p-3">
                  <GenerationModeSwitcher
                    label="生成方式"
                    value={generationMode}
                    disabled={submitting}
                    helper={false}
                    onChange={(mode) => setGenerationMode(mode)}
                  />
                  <div className="text-xs text-gray-600 mt-2">
                    {generationMode === 'stream'
                      ? '提示：选择流式生成后，将实时输出 Markdown，并生成【通用角色卡】（templateId=通用角色）。名字会尝试从输出中解析，失败则回退到“残兽”。'
                      : '提示：非流式生成会返回结构化的残兽数据卡（可直接保存/用于升华），但需要等待生成结束一次性返回。'}
                  </div>
                </div>

                {/* 自定义 AI 供应商 */}
                <div className="my-4 bg-gray-50 rounded-lg p-3">
                  <AiProviderSelector onConfigChange={setUserProviderConfig} />
                  <p className="mt-2 text-xs text-gray-500">使用自有 API Key 可缩短冷却至 3 秒，便于批量迭代生成。</p>
                  <ProviderCooldownNotice
                    currentMode={providerCooldownMode}
                    currentIsCooldown={isCooldown}
                    otherRemainingTime={otherRemainingTime}
                  />
                </div>

                {/* 批量回答问卷 + 角色卡导入（与 /details 同一共享区段） */}
                <BulkAnswerTools
                  variant="contrast"
                  targets={allQuestionTargets}
                  indexFallbackTargets={mergedQuestionTargets}
                  answersByKey={answersByKey}
                  onApplyAnswers={handleApplyImportedAnswers}
                  onInfo={(message) => alert(message)}
                  onError={(message) => setError(`⚠️ ${message}`)}
                  onClearDraft={handleClearDraft}
                  open={showBulkFillSection}
                  onOpenChange={setShowBulkFillSection}
                />

                <AnswerReviewList
                  variant="dark"
                  items={mergedQuestionTargets.map((item) => ({
                    key: item.key,
                    index: item.index,
                    question: item.question,
                    questionnaireTitle: item.questionnaireTitle,
                    answer: answersByKey[item.key] ?? '',
                  }))}
                  onEdit={handleNavigateToQuestion}
                  open={showAnswerReview}
                  onOpenChange={setShowAnswerReview}
                />

                {error && <ErrorMessage message={error} />}
                {isQuestionnaireNativeAllowed && hasOverLimitAnswer && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                    ⚠️ 已有 {overLimitItems.length} 条答案超过字数上限，继续提交将导致生成内容丧失原生性。
                  </div>
                )}
                {submitting && generationMode === 'stream' ? (
                  <div className="mt-4 flex justify-center">
                    <StreamStopButton
                      onClick={() => streamAbortControllerRef.current?.abort(STREAM_ABORT_REASON_USER)}
                      label="停止生成"
                    />
                  </div>
                ) : null}

                <QuestionnaireAnswerExportPanel
                  variant="dark"
                  title="生成前备份问卷答案"
                  filenameBase="残兽问卷_答案备份"
                  hasContent={answerItems.length > 0}
                  buildContent={buildAnswerExportText}
                  disabled={submitting || isTransitioning || isCooldown}
                />

                <div className="mt-8 text-center">
                  <Link href="/" className="footer-link">返回首页</Link>
                </div>
              </>
            ) : (
              <>
                {generationMode === 'stream' && streamedGeneralCard ? (
                  <>
                    <GeneralCharacterCard
                      general={streamedGeneralCard}
                      isStreaming={submitting}
                      onStopGeneration={() => streamAbortControllerRef.current?.abort(STREAM_ABORT_REASON_USER)}
                      onSaveImage={handleSaveImage}
                      imageSaveMode={imageSaveMode}
                      saveButtonLabel={imageSaveButtonLabel}
                    />
                    <AiReasoningPanel reasoning={streamingReasoning} status={streamingReasoning?.status ?? 'idle'} compact />
                    {streamNotice ? <div className="mt-3 text-center text-sm text-amber-700">{streamNotice}</div> : null}

                    <div className="card" style={{ marginTop: '1rem' }}>
                      <div className="text-center">
                        <h3 className="text-lg font-medium text-gray-800" style={{ marginBottom: '1rem' }}>后续操作</h3>
                        <div className="flex flex-col sm:flex-row gap-3 justify-center">
                          <button onClick={() => downloadStreamedGeneralCard(streamedGeneralCard)} className="generate-button flex-1">
                            下载通用角色卡
                          </button>
                          <SaveToCloudButton
                            data={streamedGeneralCard}
                            cardType="character"
                            buttonText="保存到云端"
                            className="generate-button flex-1"
                            style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                          />
                          <button
                            onClick={() => void copyStreamedGeneralCard(streamedGeneralCard)}
                            className="generate-button flex-1"
                            style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}
                          >
                            复制到剪贴板
                          </button>
                        </div>
                        <JsonSizeIndicator
                          data={streamedGeneralCard}
                          warningText="⚠️ 接近云端 300KB 上限，保存/替换可能失败，请先精简数据。"
                        />
                        <button
                          onClick={handleRegenerate}
                          disabled={submitting || isCooldown}
                          className="generate-button"
                          style={{ marginTop: '0.5rem', backgroundColor: '#a855f7', backgroundImage: 'linear-gradient(to right, #a855f7, #d946ef)' }}
                        >
                          {isCooldown ? `冷却中 (${remainingTime}s)` : submitting ? '重新生成中...' : '不满意？再来一次'}
                        </button>
                        <div className="mt-2 pt-6 border-t border-gray-200">
                          <p className="text-sm text-gray-600 mb-2">保存好你的档案了吗？</p>
                          <Link href="/battle" className="footer-link text-lg text-purple-600">
                            前往竞技场，让它大闹一场！→
                          </Link>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {nonStreamReasoning && (
                      <AiReasoningPanel
                        reasoning={nonStreamReasoning}
                        status={nonStreamReasoning.status}
                        displayMode="content-only"
                        compact
                      />
                    )}
                    <CanshouCard
                      canshou={canshouDetails!}
                      onSaveImage={handleSaveImage}
                      imageSaveMode={imageSaveMode}
                      saveButtonLabel={imageSaveButtonLabel}
                    />
                    <DetailsSavePreferencesPanel
                      theme={CANSHOU_SAVE_PREFERENCES_THEME}
                      imageSaveMode={imageSaveMode}
                      jsonSaveMode={jsonSaveMode}
                      recommendedImageMode={recommendedImageMode}
                      recommendedJsonMode={recommendedJsonMode}
                      onImageSaveModeChange={setImageSaveMode}
                      onJsonSaveModeChange={setJsonSaveMode}
                      imageHint="如果当前浏览器阻止下载，可切换为弹窗模式再手动保存。"
                      jsonHint="两种方式都可跨终端使用，可随时切换体验。"
                      jsonGroupTitle="JSON 保存方式"
                      jsonRecommendLabels={{ download: '直接下载', text: '复制 JSON' }}
                      footerNote="提示：偏好设置已保存到浏览器，刷新后仍会保留；切换不会触发重新生成。"
                    />
                    <div className="card" style={{ marginTop: '1rem' }}>
                      <div className="text-center">
                        <h3 className="text-lg font-medium text-gray-800" style={{ marginBottom: '1rem' }}>后续操作</h3>
                        <div className="flex flex-col sm:flex-row gap-3 justify-center">
                          {resolvedResultPayload && (
                            <>
                              <SaveJsonButton
                                data={resolvedResultPayload}
                                mode={jsonSaveMode}
                                recommendedMode={recommendedJsonMode}
                                resolveFileName={resolveCanshouJsonFileName}
                                downloadLabel="💾 下载残兽档案"
                              />
                              <SaveToCloudButton
                                data={resolvedResultPayload}
                                buttonText="保存到云端"
                                style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                              />
                            </>
                          )}
                        </div>
                        {resolvedResultPayload && (
                          <JsonSizeIndicator
                            data={resolvedResultPayload}
                            warningText="⚠️ 接近云端 300KB 上限，保存/替换可能失败，请先精简数据。"
                          />
                        )}
                        <button
                          onClick={handleRegenerate}
                          disabled={submitting || isCooldown}
                          className="generate-button"
                          style={{ marginTop: '0.5rem', backgroundColor: '#a855f7', backgroundImage: 'linear-gradient(to right, #a855f7, #d946ef)' }}
                        >
                          {isCooldown ? `冷却中 (${remainingTime}s)` : submitting ? '重新生成中...' : '不满意？再来一次'}
                        </button>
                        <div className="mt-2 pt-6 border-t border-gray-200">
                          <p className="text-sm text-gray-600 mb-2">
                            保存好你的档案了吗？
                          </p>
                          <Link href="/battle" className="footer-link text-lg text-purple-600">
                            前往竞技场，让它大闹一场！→
                          </Link>
                        </div>
                      </div>
                    </div>
                  </>
                )}
                <CanshouLorePanel open={showLore} onOpenChange={setShowLore} />
                <div className="mt-8 text-center">
                  <Link href="/" className="footer-link">返回首页</Link>
                </div>
              </>
            )}
          </div>

          <Footer textWhite={true} />
        </div>
      </div>

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
              <img src={savedImageUrl} alt="残兽档案" className="w-full h-auto rounded-lg" />
            </div>
          </div>
        </div>
      )}
    </>
  );
};
