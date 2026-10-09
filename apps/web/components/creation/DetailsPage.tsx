'use client';

import { BackHomeLink } from '@mahoshojo/ui-web/shell';
import { getQuestionnaireQuestionPresentation } from '@mahoshojo/ui-web/questionnaire';
import { QuestionnaireResultActions } from '@mahoshojo/ui-web/details-controls';

import { generationActionClassNames, generationSubmitClassName } from '@mahoshojo/ui-web/generation-actions';
import { useUnsavedPageGuard } from '@mahoshojo/ui-web/client';
import { assertSupportedQuestionnaireAnswerDraft, questionnaireAnswerDraftFingerprint } from '@/lib/questionnaire-draft-shape';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import MagicalGirlCard from '@/components/MagicalGirlCard';
import GeneralCharacterCard from '@/components/GeneralCharacterCard';
import { useProviderModeCooldown } from '@/lib/cooldown';
import { quickCheck } from '@/lib/sensitive-word-filter';
import Link from 'next/link';
import { generateRandomMagicalGirl } from '@/lib/random-character-generator';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import Footer from '@/components/Footer';
import QuestionNavigator from '@/components/QuestionNavigator';
import { AnswerReviewList, BulkAnswerTools, isMobileFormFactor, QuestionnaireLanguageSection, QuestionnairePageCard, recommendedSaveModes, SaveJsonButton } from '@mahoshojo/ui-web/details-controls';
import {
  buildQuestionnaireAnswerExportText,
  collectQuestionnaireAnswerExportItems,
} from '@mahoshojo/domain/questionnaire-answer-export';
import { useAppRouterAdapter } from '@/lib/app-router-adapter';
import { DETAILS_PREFERENCES_STORAGE_KEY } from '@/lib/settings/page-preferences';
import BattleDataModal from '@/components/BattleDataModal';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import {
  buildQuestionnaireAnswerLookup,
  buildQuestionnaireFlow,
  collectQuestionnaireFlowAnswerItems,
  collectStoredQuestionnaireAnswerItems,
  compactQuestionnaireAnswerItems,
  formatQuestionnaireAnswers,
  MAX_QUESTIONNAIRE_IMPORT_BYTES,
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
import {
  applyQuestionnaireSelection,
  buildQuestionnaireContextItems,
  buildQuestionnaireGenerationRequestBody,
  buildQuestionnaireSelectionLoreText,
  createStoredQuestionnaireSelectionNormalizer,
  ensureQuestionnaireSelectionId,
  isQuestionnaireGenerationNativeSignatureAllowed,
  isQuestionnaireSelectionNativeAllowed,
  pickDefaultQuestionnairePresetEntry,
  reconcileQuestionnaireSelectionsForSingleMode,
  remapAnswersToQuestionnaireChange,
  removeQuestionnaireSelection,
  resolveQuestionnaireSelectionNativeAllowedFallback,
  setQuestionnaireSelectionLore,
  type QuestionnaireContextItem,
  type QuestionnaireSelection,
} from '@mahoshojo/domain/questionnaire-selection';
import { persistArrestedBackup, type ArrestedBackupDraftItem, type ArrestedBackupTriggerSource } from '@/lib/arrested-backup';
import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import AiReasoningPanel from '@/components/ai/AiReasoningPanel';
import { ErrorMessage } from '@/components/ErrorMessage';
import { GenerationModeSwitcher, type GenerationMode } from '@/components/shared/GenerationModeSwitcher';
import { ProviderCooldownNotice } from '@/components/ai/ProviderCooldownNotice';
import { TokenIndicator } from '@/components/shared/TokenIndicator';
import { JsonSizeIndicator } from '@/components/shared/JsonSizeIndicator';
import { StreamStopButton } from '@/components/shared/StreamStopButton';
import { buildGeneralCharacterCardFromMarkdown } from '@/lib/stream/markdown-card';
import { readSafeTextAndReasoningStreamFromResponse } from '@/lib/stream/read-safe-text-and-reasoning-stream';
import { readJsonOrTextFromResponse, resolveApiErrorMessage } from '@/lib/client/apiError';
import { AI_META_REQUEST_HEADER, AI_META_REQUEST_VALUE, readJsonWithAiMeta } from '@/lib/client/read-json-with-ai-meta';
import { formatHttpErrorMessage } from '@/lib/client/httpError';
import { downloadBlob } from '@/lib/client/blobUrl';
import { getAnswerLimitInfo, isAnswerOverLimit, QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS } from '@/lib/questionnaire-limits';
import { exceedsUtf8ByteLimit } from '@/lib/data-card-size';
import { authStorage } from '@/lib/auth';
import { useGenerationApiIntentLatch } from '@/lib/use-generation-api-intent-latch';
import { useGeneratedResultAutoScroll } from '@mahoshojo/ui-web/details-controls';
import { buildCustomProviderRequestPayload } from '@/lib/ai/custom-provider';
import { mapDataCardSourceMeta } from '@/lib/data-card-read-mappers';
import {
  DETAILS_QUESTIONNAIRE_THEME,
  QuestionnaireQuestionPanel,
} from '@/components/questionnaire/QuestionnaireQuestionPanel';
import { QuestionnaireSelectionPanel } from '@/components/questionnaire/QuestionnaireSelectionPanel';
import { QuestionnaireAnswerExportPanel } from '@/components/questionnaire/QuestionnaireAnswerExportPanel';
import { CharacterPortraitAssetPanel } from '@/components/shared/CharacterPortraitAssetPanel';
import { CreatorEntryLink } from '@/components/shared/CreatorEntryLink';
import { DetailsIntroSection } from '@/components/shared/DetailsIntroSection';
import { DetailsSavePreferencesPanel } from '@/components/shared/DetailsSavePreferencesPanel';
import { DetailsFieldGuidePanel } from '@/components/shared/DetailsFieldGuidePanel';
import { STREAM_ABORT_REASON_USER } from '@/lib/stream/abort';
import type { AIReasoningEnvelope } from '@/types/ai-reasoning';
import type { CharacterCardPortraitAsset } from '@/types/visual-asset';

const normalizeStoredSelection = createStoredQuestionnaireSelectionNormalizer({
  fallbackKind: 'magical-girl',
  normalize: (value, fallback) => normalizeQuestionnaireDefinition(value, fallback),
});

type JsonSaveMode = 'download' | 'text';
type ImageSaveMode = 'download' | 'modal';
type DeviceType = 'mobile' | 'desktop' | 'unknown';

type RateLimitError = Error & {
  retryAfterSeconds?: number;
};

interface MagicalGirlDetails {
  codename: string;
  appearance: {
    outfit: string;
    accessories: string;
    colorScheme: string;
    overallLook: string;
  };
  magicConstruct: {
    name: string;
    form: string;
    basicAbilities: string[];
    description: string;
  };
  wonderlandRule: {
    name: string;
    description: string;
    tendency: string;
    activation: string;
  };
  blooming: {
    name: string;
    evolvedAbilities: string[];
    evolvedForm: string;
    evolvedOutfit: string;
    powerLevel: string;
  };
  analysis: {
    personalityAnalysis: string;
    abilityReasoning: string;
    coreTraits: string[];
    predictionBasis: string;
    background: {
      belief: string;
      bonds: string;
    };
  };
  templateId?: string;
  signature?: string;
  userAnswers?: QuestionnaireAnswerItem[] | string[] | Record<string, string>;
}
const resolveDetailsJsonFileName = (data: MagicalGirlDetails): string =>
  `魔法少女_${data.codename?.replace(/[^a-z0-9一-龥]/gi, '_') || 'data'}.json`;

const LOCAL_STORAGE_KEY = 'magicalGirlAnswersDraft'; // 定义本地存储的键
// 偏好存储键的唯一来源在 `lib/settings/page-preferences`——设置页与本页
// 读写同一个键，两处声明同一字面量会漂移。
const DETAILS_PREFERENCE_KEY = DETAILS_PREFERENCES_STORAGE_KEY;

export const DetailsPage: React.FC = () => {
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
  const draftStorageBlocked = useRef(false);
  const unsavedAnswers = useRef(false);
  const savedAnswersBaseline = useRef(questionnaireAnswerDraftFingerprint({}));
  const unpersistedResult = useRef(false);
  const [draftError, setDraftError] = useState<string | null>(null);
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
  const [magicalGirlDetails, setMagicalGirlDetails] = useState<MagicalGirlDetails | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  const [showIntroduction, setShowIntroduction] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);
  const isUserCustomKey = userProviderConfig?.providerId !== 'system' && !!userProviderConfig?.apiKey?.trim();
  const providerCooldownMode = isUserCustomKey ? 'custom' : 'system';
  const generatorCooldownMs = isUserCustomKey ? 3000 : 60000;
  const { isCooldown, startCooldown, remainingTime, otherRemainingTime } = useProviderModeCooldown({
    baseKey: 'generateDetailsCooldown',
    currentMode: providerCooldownMode,
    systemDurationMs: 60000,
    customDurationMs: 3000,
  });
  const [showLanguageSection, setShowLanguageSection] = useState(false); // 控制生成语言区域的折叠状态
  const [showBulkFillSection, setShowBulkFillSection] = useState(false); // 控制一键填充区域的折叠状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [autoSaveTimestamp, setAutoSaveTimestamp] = useState<number | null>(null);
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
  const resultSectionRef = useRef<HTMLDivElement | null>(null);
  const [characterPortraitAsset, setCharacterPortraitAsset] = useState<CharacterCardPortraitAsset | null>(null);

  // 多语言支持
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('zh-CN');
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

  // 可见流序的目标集：无元数据批量条目按页面展示序号回落（与原 handleBulkFill 同口径）。
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
    if (!magicalGirlDetails) return null;
    const serverAnswers = normalizeUserAnswers(
      magicalGirlDetails.userAnswers,
      questionnaireItems.map((item) => item.question.question)
    );
    return {
      ...magicalGirlDetails,
      userAnswers: serverAnswers.length > 0 ? serverAnswers : answerItems,
    };
  }, [magicalGirlDetails, answerItems, questionnaireItems]);

  const streamedGeneralCardForDisplay = useMemo(() => {
    if (generationMode !== 'stream') return null;
    const markdown = streamingMarkdown ?? streamedGeneralCard?.content ?? null;
    if (markdown === null) return null;

    const fallbackName = answerItems[0]?.answer ?? '';
    const { card } = buildGeneralCharacterCardFromMarkdown({
      markdown,
      fallbackName,
      defaultName: '魔法少女',
    });
    return card;
  }, [generationMode, streamingMarkdown, streamedGeneralCard, answerItems]);

  const streamPortraitPrompt = useMemo(() => {
    if (generationMode !== 'stream') return '';
    const name = typeof streamedGeneralCardForDisplay?.name === 'string' ? streamedGeneralCardForDisplay.name.trim() : '';
    const contentRaw = (streamingMarkdown ?? streamedGeneralCard?.content ?? '').trim();
    const contentHead = contentRaw.length > 800 ? contentRaw.slice(0, 800) : contentRaw;
    const prefix = [name, contentHead].filter(Boolean).join(', ');
    return `${prefix ? `${prefix}, ` : ''}Xiabanmo, 二次元, 角色立绘`;
  }, [generationMode, streamedGeneralCardForDisplay, streamingMarkdown, streamedGeneralCard]);

  useEffect(() => {
    fetch('/languages.json')
      .then(res => res.json())
      .then(data => setLanguages(data))
      .catch(err => console.error("Failed to load languages:", err));
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const isMobileDevice = isMobileFormFactor();
    const detectedType: DeviceType = isMobileDevice ? 'mobile' : 'desktop';
    setDeviceType(detectedType);
    const defaultImageMode: ImageSaveMode = recommendedSaveModes(isMobileDevice).imageSaveMode;
    const defaultJsonMode: JsonSaveMode = recommendedSaveModes(isMobileDevice).jsonSaveMode;

    try {
      const saved = window.localStorage.getItem(DETAILS_PREFERENCE_KEY);
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
      if (typeof parsed?.showDetails === 'boolean') {
        setShowDetails(parsed.showDetails);
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
      console.warn('读取魔法少女设定偏好失败', error);
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
        showDetails,
        allowMultipleQuestionnaires,
        showQuestionnaireSettings,
        questionnaireSelections: selectedQuestionnaires,
      };
      window.localStorage.setItem(DETAILS_PREFERENCE_KEY, JSON.stringify(payload));
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
    showDetails,
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
    let cancelled = false;
    const loadPresetIndex = async () => {
      setQuestionnaireLoadError(null);
      try {
        const response = await fetch('/questionnaires/presets/index.json');
        if (!response.ok) throw new Error('加载预设问卷索引失败');
        const data = await response.json();
        const list = Array.isArray(data?.presets) ? (data.presets as QuestionnairePresetEntry[]) : [];
        const filtered = list.filter((item) => item.kind === 'magical-girl');
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
        const normalized = normalizeQuestionnaireDefinition(data, {
          fallbackId: defaultPreset.id,
          fallbackKind: defaultPreset.kind,
          fallbackTitle: defaultPreset.title,
          nativeAllowed: resolveQuestionnaireSelectionNativeAllowedFallback('preset', data),
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

  // 生成完成（含快速随机）：仅当结果整体仍在视口下方时自动滚动定位一次；
  // 已可见/已滚过/正边看边生成的位置不打断（语义见 useResultAutoScroll）。
  const beginResultNavigation = useGeneratedResultAutoScroll(resultSectionRef);

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
        fallbackKind: 'magical-girl',
        fallbackId: typeof rawData?.id === 'string' ? rawData.id : `magical-girl-card-${card?.id ?? ''}`,
        fallbackTitle: typeof rawData?.title === 'string' ? rawData.title : card?.name || '未命名问卷',
        nativeAllowed: resolveQuestionnaireSelectionNativeAllowedFallback('database', rawData),
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
    // `File.size` 不读内容即可拿到字节数：parse 前预算先行拦截超大输入（bounded-input）。
    if (file.size > MAX_QUESTIONNAIRE_IMPORT_BYTES) {
      setError(`问卷文件超过大小上限（${MAX_QUESTIONNAIRE_IMPORT_BYTES / 1024 / 1024} MiB）。`);
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const normalized = normalizeQuestionnaireDefinition(parsed, {
        fallbackKind: 'magical-girl',
        fallbackId: typeof parsed?.id === 'string' ? parsed.id : 'magical-girl-upload',
        fallbackTitle: typeof parsed?.title === 'string' ? parsed.title : file.name.replace(/\.[^.]+$/, ''),
        nativeAllowed: resolveQuestionnaireSelectionNativeAllowedFallback('upload', parsed),
      });
      if (!normalized) throw new Error('问卷文件解析失败');
      // 上传件没有服务器身份可验证，nativeAllowed 恒 false（即使文件声明 true）。
      normalized.nativeAllowed = false;
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
    // 粘贴路径没有 File.size 可用：逐码点计 UTF-8 字节、超限即停的同一预算。
    if (exceedsUtf8ByteLimit(pasteQuestionnaireText, MAX_QUESTIONNAIRE_IMPORT_BYTES)) {
      setPasteQuestionnaireError(`问卷 JSON 超过大小上限（${MAX_QUESTIONNAIRE_IMPORT_BYTES / 1024 / 1024} MiB）。`);
      return;
    }
    try {
      const parsed = JSON.parse(pasteQuestionnaireText);
      const normalized = normalizeQuestionnaireDefinition(parsed, {
        fallbackKind: 'magical-girl',
        fallbackId: typeof parsed?.id === 'string' ? parsed.id : 'magical-girl-paste',
        fallbackTitle: typeof parsed?.title === 'string' ? parsed.title : '未命名问卷',
        nativeAllowed: resolveQuestionnaireSelectionNativeAllowedFallback('upload', parsed),
      });
      if (!normalized) throw new Error('问卷 JSON 无法识别，请检查格式');
      // 上传件没有服务器身份可验证，nativeAllowed 恒 false（即使文件声明 true）。
      normalized.nativeAllowed = false;
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
      const normalized = normalizeQuestionnaireDefinition(data, {
        fallbackId: preset.id,
        fallbackKind: preset.kind,
        fallbackTitle: preset.title,
        nativeAllowed: resolveQuestionnaireSelectionNativeAllowedFallback('preset', data),
      });
      if (!normalized) throw new Error('预设问卷解析失败');
      applySelection({ source: 'preset', questionnaire: normalized });
    } catch (error) {
      setError(error instanceof Error ? error.message : '加载预设问卷失败');
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!allQuestionTargets.length) return;
    if (draftRestoredRef.current) return;
    draftRestoredRef.current = true;

    try {
      const savedDraft = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (savedDraft === null) return;
      const parsed = JSON.parse(savedDraft);
      assertSupportedQuestionnaireAnswerDraft(parsed, allQuestionTargets);
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
              `MG-${index + 1}`,
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

      savedAnswersBaseline.current = questionnaireAnswerDraftFingerprint(nextAnswers);
      if (Object.keys(nextAnswers).length > 0) {
        setAnswersByKey((prev) => ({ ...prev, ...nextAnswers }));
        const firstKey = mergedQuestions[0]?.key;
        if (firstKey) setCurrentAnswer(nextAnswers[firstKey] || '');
        setAutoSaveTimestamp(Date.now());
      }
    } catch (e) {
      console.error("Failed to load answers from localStorage", e);
      draftStorageBlocked.current = true;
      setDraftError('旧问卷存档无法读取，原数据已保留。可以继续填写和生成；本次内容暂不自动保存，请及时导出备份。');
    } finally {
      setDraftRestoreReady(true);
    }
  }, [allQuestionTargets, mergedQuestions, questionAnswerLookup]);

  useEffect(() => {
    if (!draftRestoreReady || allQuestionTargets.length === 0) return;
    if (draftStorageBlocked.current) {
      unsavedAnswers.current = questionnaireAnswerDraftFingerprint(answersByKey) !== savedAnswersBaseline.current;
      return;
    }
    try {
      const answerEntries = collectStoredQuestionnaireAnswerItems(allQuestionTargets, answersByKey);
      if (answerEntries.length > 0) {
        const dataToSave = JSON.stringify({ version: 3, answersByKey, answerEntries });
        localStorage.setItem(LOCAL_STORAGE_KEY, dataToSave);
        setAutoSaveTimestamp(Date.now());
      } else {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      }
      savedAnswersBaseline.current = questionnaireAnswerDraftFingerprint(answersByKey);
      unsavedAnswers.current = false;
      setDraftError(null);
    } catch (e) {
      console.error("Failed to save answers to localStorage", e);
      unsavedAnswers.current = questionnaireAnswerDraftFingerprint(answersByKey) !== savedAnswersBaseline.current;
      setAutoSaveTimestamp(null);
      setDraftError('问卷存档写入失败，当前内容仅保留在本页，请及时导出备份。');
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

  const handleNext = () => {
    const item = mergedQuestions[currentQuestionIndex];
    if (!item) return;
    const normalizedAnswer = currentAnswer.trim();
    const isRequired = item.question.required === true;

    if (isRequired && normalizedAnswer.length === 0) {
      setError('⚠️ 请输入答案后再继续');
      return;
    }

    const nextAnswers = commitAnswerSnapshot(currentAnswer);
    setAnswersByKey(nextAnswers);
    setError(null);
    proceedToNextQuestion(nextAnswers);
  };

  // “返回上题”功能的函数
  const handlePreviousQuestion = () => {
    if (currentQuestionIndex === 0) return;
    clearTransitionTimers();
    setIsTransitioning(false);
    const nextAnswers = commitAnswerSnapshot();
    setAnswersByKey(nextAnswers);

    const prevIndex = currentQuestionIndex - 1;
    const prevKey = mergedQuestions[prevIndex]?.key;
    currentQuestionKeyRef.current = prevKey ?? null;
    setCurrentQuestionIndex(prevIndex);
    setCurrentAnswer(prevKey ? nextAnswers[prevKey] || '' : '');
    setError(null);
  };

  const handleQuickOption = (option: string) => {
    setCurrentAnswer(option);
    setError(null);
    const nextAnswers = commitAnswerSnapshot(option);
    setAnswersByKey(nextAnswers);
    proceedToNextQuestion(nextAnswers);
  };

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

  const handleSuggestionFill = (value: string) => {
    handleCurrentAnswerChange(value);
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

  const redirectToArrested = useCallback((reason?: string, withBackup?: boolean) => {
    const query: Record<string, string> = {};
    if (reason) query.reason = reason;
    if (withBackup) query.backup = '1';
    if (Object.keys(query).length > 0) {
      router.push({ pathname: '/arrested', query });
    } else {
      router.push('/arrested');
    }
  }, [router]);

  const resignDataCard = useCallback(async (data: any) => {
    const response = await fetch('/api/resign-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null as any);
      if (errorData?.shouldRedirect) {
        redirectToArrested(errorData.reason || '编辑内容不合规');
        return null;
      }
      throw new Error(errorData?.message || '签名服务器认证失败');
    }

    return response.json();
  }, [redirectToArrested]);

  const buildAnswerBackupItems = (): ArrestedBackupDraftItem[] => {
    if (!answerItems.length) return [];
    return [
      {
        id: 'questionnaire-answers',
        label: '魔法少女问卷答案',
        filename: 'magical-girl-answers.json',
        content: {
          answers: answerItems,
          questionnaires: selectedQuestionnaires.map((selection) => selection.questionnaire),
          language: selectedLanguage,
          questionCount: mergedQuestions.length,
        },
        description: '提交前填写的所有答案',
      }
    ];
  };

  type SensitiveCheckOptions = {
    source?: ArrestedBackupTriggerSource;
    reason?: string;
    origin?: string;
    backupItems?: ArrestedBackupDraftItem[];
  };

  const checkSensitiveWords = async (content: string, options?: SensitiveCheckOptions) => {
    const checkResult = await quickCheck(content);
    if (checkResult.hasSensitiveWords) {
      if (options?.source === 'output') {
        const backupItems = options.backupItems ?? [];
        if (backupItems.length > 0) {
          persistArrestedBackup({
            triggerSource: 'output',
            origin: options.origin || 'details',
            reason: options.reason,
            items: backupItems,
          });
        }
        redirectToArrested(options?.reason, backupItems.length > 0);
      } else {
        redirectToArrested(options?.reason);
      }
      return true;
    }
    return false;
  }

  const checkSensitiveWordsForAnswers = async (items: QuestionnaireAnswerItem[]): Promise<boolean> => {
    for (const item of items) {
      const answer = item.answer?.trim();
      if (!answer) continue;
      if (await checkSensitiveWords(answer)) {
        return true;
      }
    }
    return false;
  };

  const hasDraftResult = magicalGirlDetails !== null || streamedGeneralCard !== null || Boolean(streamingMarkdown);
  useEffect(() => {
    if (!hasDraftResult) unpersistedResult.current = false;
    else if (draftStorageBlocked.current || draftError !== null) unpersistedResult.current = true;
  }, [hasDraftResult, draftError]);
  useUnsavedPageGuard(() => unsavedAnswers.current || unpersistedResult.current || ((draftStorageBlocked.current || draftError !== null)
    && (hasDraftResult)));

  const handleClearDraft = () => {
    if (!window.confirm(draftStorageBlocked.current ? '确定清空本页填写的问卷答案吗？原有存档会保留，生成结果不会清除。' : '确定要清空所有已保存的问卷答案吗？此操作不可撤销。')) return;
    if (!draftStorageBlocked.current) {
      try { localStorage.removeItem(LOCAL_STORAGE_KEY); }
      catch {
        setDraftError('清空存档失败，当前答案和原存档均已保留。');
        return;
      }
      savedAnswersBaseline.current = questionnaireAnswerDraftFingerprint({});
      unsavedAnswers.current = false;
      setDraftError(null);
    }
    setAnswersByKey({});
    setCurrentAnswer('');
    setAutoSaveTimestamp(null);
    if (!draftStorageBlocked.current) alert('存档已清空！');
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
      title: '魔法少女问卷答案备份',
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

  const handleSubmit = async (answersSnapshot?: Record<string, string>) => {
    if (isCooldown) {
      setError(`请等待 ${remainingTime} 秒后再生成`);
      return;
    }
    if (userProviderConfig && userProviderConfig.providerId !== 'system' && !userProviderConfig.apiKey?.trim()) {
      setError('⚠️ 已选择自定义 AI 供应商，但尚未填写 API Key。');
      return;
    }

    const snapshot = answersSnapshot ?? answersByKey;
    // 与 Desktop `buildDetailsAnswers` 共用同一投影（D5.1a-r1 对拍口径）；
    // 封闭题选项外取值（批量导入等旁路可写入）由共源投影拒绝，两宿主同样拦在生成前。
    let finalAnswerItems: QuestionnaireAnswerItem[];
    try {
      finalAnswerItems = collectQuestionnaireFlowAnswerItems(mergedQuestions, snapshot);
    } catch (cause) {
      setError(`⚠️ ${cause instanceof Error ? cause.message : '问卷回答无效，请检查后重试'}`);
      return;
    }

    if (finalAnswerItems.length === 0) {
      setError('⚠️ 请至少填写一题后再生成');
      return;
    }

    const overLimitForSubmit = buildOverLimitItems(snapshot);
    const allowNativeSignatureForSubmit = isQuestionnaireGenerationNativeSignatureAllowed(
      selectedQuestionnaires,
      overLimitForSubmit.length > 0,
    );

    setSubmitting(true);
    setError(null);
    setMagicalGirlDetails(null);
    setStreamingMarkdown(null);
    setStreamedGeneralCard(null);
    setStreamingReasoning(null);
    setNonStreamReasoning(null);
    setStreamNotice(null);
    setCharacterPortraitAsset(null);
    let nextCooldownMs = generatorCooldownMs;

    if (await checkSensitiveWordsForAnswers(finalAnswerItems)) return;

    try {
      console.log('提交答案:', finalAnswerItems);
      const customProviderPayload = buildCustomProviderRequestPayload(userProviderConfig);

      const endpoint = generationMode === 'stream'
        ? '/api/generate-magical-girl-details-stream?format=sse'
        : '/api/generate-magical-girl-details';

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
        body: JSON.stringify({
          // 业务请求体与 Desktop hosted 通路共用同一组装器（D5.1a-r1 对拍基准）；
          // `customProvider` 是 Web 宿主特有字段，无自定义供应商时为 undefined 被序列化省略。
          ...buildQuestionnaireGenerationRequestBody({
            answers: finalAnswerItems,
            selections: selectedQuestionnaires,
            allowNativeSignature: allowNativeSignatureForSubmit,
            language: selectedLanguage,
          }),
          customProvider: customProviderPayload,
        }),
        ...(streamController ? { signal: streamController.signal } : {}),
      });

      if (!response.ok) {
        const { payload } = await readJsonOrTextFromResponse(response);
        const errorData = payload && typeof payload === 'object' ? (payload as any) : null;

        // 处理不同的 HTTP 状态码
        if (errorData?.shouldRedirect) {
          // 如果API返回需要重定向的标志，则执行跳转
          router.push('/arrested');
          // 返回以停止进一步执行
          return;
        }
        else if (response.status === 429) {
          const retryAfterRaw = errorData?.retryAfterSeconds ?? errorData?.retryAfter ?? response.headers.get('Retry-After') ?? 60;
          const retryAfter = Math.max(1, Number.parseInt(String(retryAfterRaw), 10) || 60);
          const rateLimitError = new Error(`请求过于频繁（HTTP 429）！请等待 ${retryAfter} 秒后再试。`) as RateLimitError;
          rateLimitError.retryAfterSeconds = retryAfter;
          throw rateLimitError;
        } else if (response.status === 524) {
          throw new Error('Cloudflare 超时（HTTP 524），请稍后重试。');
        } else {
          const fallback = response.status >= 500 ? '服务器内部错误' : '生成失败';
          const serverMessage = resolveApiErrorMessage({ payload, fallback });
          throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback }));
        }
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
          label: '魔法少女角色卡（流式）',
          onText: (text) => {
            setStreamingMarkdown(text);
            if (text.trim()) revealGeneratedResult();
          },
          onReasoning: (reasoning) => setStreamingReasoning(reasoning),
          safetyReason: '使用危险符文',
        });

        const fallbackName = finalAnswerItems[0]?.answer ?? '';
        const { card } = buildGeneralCharacterCardFromMarkdown({
          markdown,
          fallbackName,
          defaultName: '魔法少女',
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
        return;
      }

      const { data: result, aiMeta } = await readJsonWithAiMeta<MagicalGirlDetails>(response);
      console.log('生成结果:', result);
      // 加入后置生成敏感词检测
      if (await checkSensitiveWords(JSON.stringify(result), {
        source: 'output',
        origin: 'details',
        reason: '使用危险符文',
        backupItems: buildAnswerBackupItems(),
      })) return;

      setMagicalGirlDetails(result);
      revealGeneratedResult();
      setNonStreamReasoning(aiMeta?.aiReasoning ?? null);
      setError(null); // 成功时清除错误
    } catch (error) {
      console.error('提交失败:', error);

      // 处理不同类型的错误
      if (error instanceof Error) {
        const errorMessage = error.message;

        // 检查是否是 rate limit 错误
        if (errorMessage.includes('请求过于频繁')) {
          const cooldownSeconds =
            typeof (error as RateLimitError).retryAfterSeconds === 'number'
              ? Math.max(1, Math.ceil((error as RateLimitError).retryAfterSeconds as number))
              : Math.ceil(generatorCooldownMs / 1000);
          nextCooldownMs = cooldownSeconds * 1000;
          setError(
            isUserCustomKey
              ? `🚫 自定义通道请求太频繁啦！每 ${cooldownSeconds} 秒生成一次就好～`
              : `🚫 请求太频繁了！每 ${Math.max(cooldownSeconds, 60) / 60} 分钟只能生成一次哦~请稍后再试吧！`
          );
        } else if (errorMessage.includes('网络') || error instanceof TypeError) {
          setError('🌐 网络连接有问题！请检查网络后重试~');
        } else {
          setError(`✨ 魔法失效了！${errorMessage}`);
        }
      } else {
        setError('✨ 魔法失效了！生成详情时发生未知错误，请重试');
      }
    } finally {
      streamAbortControllerRef.current = null;
      setSubmitting(false);
      // 依据当前通道实时覆盖冷却时间，确保自定义 AI 时降为 3 秒
      startCooldown(nextCooldownMs);
    }
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
    downloadBlob(blob, `通用魔法少女角色_${sanitizedName}.json`);
  };

  const copyStreamedGeneralCard = async (data: any) => {
    if (!data) return;
    try {
      if (!navigator.clipboard) throw new Error('clipboard-not-available');
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      alert('✅ 通用角色卡 JSON 已复制到剪贴板');
    } catch (err) {
      console.error('复制 JSON 失败：', err);
      alert('⚠️ 复制失败，请手动长按选择 JSON 内容后复制。');
    }
  };

  const handleStartQuestionnaire = () => {
    setShowIntroduction(false);
  };


  if (loading) {
    return (
      <div className="magic-background">
        <div className="container">
          <div className="card">
            <div className="text-center text-lg">加载中...</div>
          </div>
        </div>
      </div>
    );
  }

  if (resolvedQuestionItems.length === 0) {
    const hasLore = selectedQuestionnaires.some((selection) => Boolean(selection.questionnaire.loreMarkdown?.trim()));
    return (
      <div className="magic-background">
        <div className="container">
          <div className="card">
            <div className="error-message">
              {hasLore
                ? '当前所选问卷仅包含设定（无题目），请在“问卷设置”中再添加一份有题目的问卷。'
                : '加载问卷失败'}
            </div>
            <div className="mt-2 text-center text-xs text-gray-500">
              关闭“允许同时回答多份问卷”时，也可以叠加纯设定卡；但你仍需要至少一份有题目的问卷用于作答。
            </div>
            {hasLore && (
              <div className="mt-4 flex flex-col items-center justify-center gap-2">
                <button
                  type="button"
                  className={generationSubmitClassName}
                  onClick={() => {
                    setSelectedQuestionnaires([]);
                    setSelectionReady(false);
                    setLoading(true);
                  }}
                >
                  恢复默认问卷
                </button>
                <Link href="/questionnaire-editor" className="text-xs text-indigo-600 hover:underline">
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
      <div className="magic-background">
        <div className="container">
          <div className="card">
            <div className="error-message">当前没有可作答的题目，请检查问卷条件设置</div>
          </div>
        </div>
      </div>
    );
  }

  const currentQuestionItem = mergedQuestions[currentQuestionIndex];
  const currentQuestion = currentQuestionItem?.question;
  const currentQuestionnaireTitle = currentQuestionItem?.questionnaireTitle ?? '';
  const currentLimitInfo = getAnswerLimitInfo(currentQuestion?.maxLength ?? null);
  const currentMaxLength = currentLimitInfo.limit;
  const currentAnswerLength = currentAnswer.trim().length;
  const isCurrentOverLimit = Boolean(currentMaxLength && currentAnswerLength > currentMaxLength);

  const hasOptions = (currentQuestion?.options?.length ?? 0) > 0;
  const allowCustomInput = currentQuestion?.allowCustom !== false;
  const isCurrentRequired = currentQuestion?.required === true;
  const showTextInput = allowCustomInput || !hasOptions;
  const navigatorItems = mergedQuestions.map((item) => ({
    id: item.key,
    label: item.questionnaireTitle ? `${item.question.question} · ${item.questionnaireTitle}` : item.question.question
  }));
  const progressPercent = Math.round(((currentQuestionIndex + 1) / mergedQuestions.length) * 100);
  const questionPresentation = getQuestionnaireQuestionPresentation({
    variant: 'details', question: currentQuestion, answer: currentAnswer,
    index: currentQuestionIndex, total: mergedQuestions.length,
    busy: submitting, cooldownSeconds: isCooldown ? remainingTime : 0,
  });
  const { quickOptions: fallbackQuickOptions, nextButtonLabel, optionsHintText, overLimitText, limitLabel: currentLimitLabel, suggestions: suggestionPool } = questionPresentation;
  const nextButtonContent = submitting ? (
    <span className="flex items-center justify-center">
      <svg className="animate-spin h-4 w-4 text-white" style={{ marginLeft: '-0.25rem', marginRight: '0.5rem' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      提交中...
    </span>
  ) : nextButtonLabel;

  return (
    <>
      <div className="magic-background">
        <div className="container">
          <QuestionnairePageCard variant="details">
            {draftError && <p role="alert" className="my-3 text-sm text-amber-700">{draftError}</p>}
            {showIntroduction ? (
              // 介绍部分
              <DetailsIntroSection
                onStart={handleStartQuestionnaire}
                onQuickRandom={() => {
                  setIsGenerating(true);
                  setError(null);
                  try {
                    // 直接同步调用，移除 await
                    const data = generateRandomMagicalGirl();
                    setMagicalGirlDetails(data);
                    beginResultNavigation(data)();
                    setCharacterPortraitAsset(null);
                    setShowIntroduction(false);
                  } catch (err) {
                    console.error('随机生成失败: ', err);
                    setError('随机生成失败，请稍后再试。');
                  } finally {
                    setIsGenerating(false);
                  }
                }}
                quickRandomBusy={isGenerating}
                onNavigateEntry={(href) => router.push(href)}
                extraLink={<CreatorEntryLink />}
                backHome={(
                  <BackHomeLink renderLink={(props) => <Link {...props} />} />
                )}
              />
            ) : (
              // 问卷部分
              <>
                <QuestionNavigator
                  items={navigatorItems}
                  currentIndex={currentQuestionIndex}
                  onNavigate={handleNavigateToQuestion}
                  isAnswered={(index) => {
                    const key = mergedQuestions[index]?.key;
                    return key ? Boolean(answersByKey[key]?.trim()) : false;
                  }}
                  theme="pink"
                />

                <QuestionnaireSelectionPanel
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
                    <Link href="/questionnaire-editor" className="text-xs text-indigo-600 hover:underline">
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
                  theme={DETAILS_QUESTIONNAIRE_THEME}
                  progressLabel={questionPresentation.progressLabel}
                  progressPercent={progressPercent}
                  progressExtra={autoSaveTimestamp ? (
                    <span className="text-xs text-gray-400">已自动保存于 {new Date(autoSaveTimestamp).toLocaleTimeString()}</span>
                  ) : null}
                  questionText={currentQuestion?.question || '未加载题目'}
                  questionnaireTitle={currentQuestionnaireTitle}
                  noticeText="请基于您构想的虚拟角色身份回答，并确保内容符合公序良俗，请勿使用任何真实信息。"
                  helperText={currentQuestion?.helperText}
                  isRequired={isCurrentRequired}
                  skipText="本题可跳过，不作答将不会记录"
                  quickOptions={fallbackQuickOptions}
                  quickOptionDisabled={submitting || isTransitioning || isCooldown}
                  onQuickOption={handleQuickOption}
                  options={currentQuestion?.options}
                  optionsHintText={optionsHintText}
                  onOptionSelect={handleQuickOption}
                  suggestions={suggestionPool}
                  onSuggestionSelect={handleSuggestionFill}
                  showTextInput={showTextInput}
                  answer={currentAnswer}
                  onAnswerChange={handleCurrentAnswerChange}
                  placeholder={questionPresentation.placeholder}
                  answerLength={currentAnswerLength}
                  maxLength={currentMaxLength}
                  limitLabel={currentLimitLabel}
                  showLimitLabel={currentLimitInfo.source !== 'none' && Boolean(currentMaxLength)}
                  isOverLimit={isCurrentOverLimit}
                  overLimitText={overLimitText}
                  isTransitioning={isTransitioning}
                  transitionClassName="transition-all duration-300 ease-out"
                  transitionStyle={{
                    opacity: isTransitioning ? 0 : 1,
                    transform: isTransitioning ? 'translateX(-16px)' : 'translateX(0)',
                  }}
                  prevLabel={questionPresentation.prevLabel}
                  nextButtonContent={nextButtonContent}
                  onPrev={handlePreviousQuestion}
                  onNext={handleNext}
                  disablePrev={currentQuestionIndex === 0 || submitting || isTransitioning || isCooldown}
                  disableNext={submitting || isTransitioning || isCooldown || (isCurrentRequired && currentAnswer.trim().length === 0)}
                />

                <TokenIndicator
                  text={tokenEstimateText}
                  warningText="⚠️ 预计问卷回答较长，可能更易超时/失败。可尝试精简答案或减少问卷数量。"
                />

                <QuestionnaireLanguageSection
                  variant="details"
                  expanded={showLanguageSection}
                  onToggle={() => setShowLanguageSection(!showLanguageSection)}
                  languages={languages}
                  value={selectedLanguage}
                  onChange={setSelectedLanguage}
                  disabled={submitting}
                />

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
                      ? '提示：选择流式生成后，将实时输出 Markdown，并生成【通用角色卡】（templateId=通用角色）。代号/名字会尝试从输出中解析，失败则回退到你填写的名字或“魔法少女”。'
                      : '提示：非流式生成会返回结构化的魔法少女数据卡（适合保存为模板/用于升华等），但需要等待生成结束一次性返回。'}
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

                {/* 批量回答问卷 + 角色卡导入（与 Desktop 同一共享区段） */}
                <BulkAnswerTools
                  variant="light"
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
                  variant="light"
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

                {/* 错误信息显示 */}
                {error && (
                  <ErrorMessage message={error} />
                )}
                {streamNotice ? <div className="mt-3 text-center text-sm text-amber-700">{streamNotice}</div> : null}
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
                  variant="light"
                  title="生成前备份问卷答案"
                  filenameBase="魔法少女问卷_答案备份"
                  hasContent={answerItems.length > 0}
                  buildContent={buildAnswerExportText}
                  disabled={submitting || isTransitioning || isCooldown}
                />

                {/* 返回首页链接 */}
                <div className="text-center" style={{ marginTop: '1rem' }}>
                  <BackHomeLink renderLink={(props) => <Link {...props} />} />
                </div>
              </>
            )}
          </QuestionnairePageCard>

          <div ref={resultSectionRef}>

          {/* 流式：通用角色卡（Markdown） */}
          {generationMode === 'stream' && (streamingMarkdown !== null || streamedGeneralCard) && (
            <>
              {streamedGeneralCardForDisplay && (
                <>
                  <GeneralCharacterCard
                    general={streamedGeneralCardForDisplay}
                    isStreaming={submitting}
                    onStopGeneration={() => streamAbortControllerRef.current?.abort(STREAM_ABORT_REASON_USER)}
                    onSaveImage={handleSaveImage}
                    imageSaveMode={imageSaveMode}
                    saveButtonLabel={imageSaveButtonLabel}
                    portraitAsset={characterPortraitAsset}
                  />
                  <AiReasoningPanel reasoning={streamingReasoning} status={streamingReasoning?.status ?? 'idle'} compact />
                  <div className="card" style={{ marginTop: '1rem' }}>
                    <div className="text-center">
                      <h3 className="text-lg font-medium text-gray-800" style={{ marginBottom: '1rem' }}>生成立绘</h3>
                      <CharacterPortraitAssetPanel
                        prompt={streamPortraitPrompt}
                        onPortraitAssetChange={setCharacterPortraitAsset}
                      />
                    </div>
                  </div>
                </>
              )}

              {streamedGeneralCard && (
                <>
                  <div className="card" style={{ marginTop: '1rem' }}>
                    <div className="text-center">
                      <h3 className="text-lg font-medium text-gray-800" style={{ marginBottom: '1rem' }}>后续操作</h3>
                      <div className="flex flex-col gap-3">
                        <button onClick={() => downloadStreamedGeneralCard(streamedGeneralCard)} className={generationActionClassNames.secondary}>
                          下载通用角色卡
                        </button>
                        {/* SaveToCloudButton 内部为「保存 + 替换」双按钮，独占一列避免与相邻按钮挤压 */}
                        <div className="flex flex-col gap-3">
                          <SaveToCloudButton
                            data={streamedGeneralCard}
                            cardType="character"
                            buttonText="保存到云端"
                            className={`${generationActionClassNames.primary} w-full`}
                            style={{ marginLeft: 0 }}
                          />
                        </div>
                        <button
                          onClick={() => void copyStreamedGeneralCard(streamedGeneralCard)}
                          className={generationActionClassNames.secondary}
                        >
                          复制到剪贴板
                        </button>
                      </div>
                      <JsonSizeIndicator
                        data={streamedGeneralCard}
                        warningText="⚠️ 接近云端 300KB 上限，保存/替换可能失败，请先精简数据。"
                      />
                      <div className="mt-2 pt-6 border-t border-gray-200">
                        <p className="text-sm text-gray-600 mb-2">保存好你的档案了吗？</p>
                        <Link href="/battle" className="footer-link text-lg text-purple-600">
                          前往竞技场，让她大闹一场！→
                        </Link>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* 非流式/快速随机：魔法少女详细信息结果（不设模式门禁，快速随机在任何模式下都渲染） */}
          {magicalGirlDetails && (
            <>
              <MagicalGirlCard
                magicalGirl={magicalGirlDetails}
                gradientStyle="linear-gradient(135deg, #9775fa 0%, #b197fc 100%)"
                onSaveImage={handleSaveImage}
                imageSaveMode={imageSaveMode}
                saveButtonLabel={imageSaveButtonLabel}
                portraitAsset={characterPortraitAsset}
              />
              {nonStreamReasoning && (
                <AiReasoningPanel
                  reasoning={nonStreamReasoning}
                  status={nonStreamReasoning.status}
                  displayMode="content-only"
                  compact
                />
              )}
              <DetailsSavePreferencesPanel
                imageSaveMode={imageSaveMode}
                onImageSaveModeChange={setImageSaveMode}
                recommendedImageMode={recommendedImageMode}
                jsonSaveMode={jsonSaveMode}
                onJsonSaveModeChange={setJsonSaveMode}
                recommendedJsonMode={recommendedJsonMode}
              />
              {/* 关键解释抽屉 点击展开 点击关闭 */}
              <DetailsFieldGuidePanel
                expanded={showDetails}
                onToggle={() => setShowDetails(!showDetails)}
              />

              <QuestionnaireResultActions
                variant="details"
                renderLink={(props) => <Link {...props} />}
                sizeIndicator={resolvedResultPayload && <JsonSizeIndicator
                  data={resolvedResultPayload}
                  warningText="⚠️ 接近云端 300KB 上限，保存/替换可能失败，请先精简数据。"
                />}
              >
                {resolvedResultPayload && <>
                  <SaveJsonButton
                    data={resolvedResultPayload}
                    mode={jsonSaveMode}
                    recommendedMode={recommendedJsonMode}
                    resolveFileName={resolveDetailsJsonFileName}
                  />
                  <div className="flex flex-col gap-3">
                    <SaveToCloudButton
                      data={resolvedResultPayload}
                      buttonText="保存到云端"
                      className={`${generationActionClassNames.primary} w-full`}
                      style={{ marginLeft: 0 }}
                    />
                  </div>
                </>}
              </QuestionnaireResultActions>

              {/* 立绘生成器 */}
              <div className="card" style={{ marginTop: '1rem' }}>
                <div className="text-center">
                  <h3 className="text-lg font-medium text-gray-800" style={{ marginBottom: '1rem' }}>生成立绘</h3>
                  <CharacterPortraitAssetPanel
                    prompt={`${JSON.stringify(magicalGirlDetails.appearance)} , Xiabanmo, 二次元, 魔法少女`}
                    onPortraitAssetChange={setCharacterPortraitAsset}
                  />
                </div>
              </div>
            </>
          )}
          </div>

          <Footer textWhite={true} />
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

        {/* Image Modal */}
        {showImageModal && savedImageUrl && (
          <div className="fixed inset-0 bg-black flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', paddingLeft: '2rem', paddingRight: '2rem', zIndex: 1000 }}
          >
            <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-auto relative">
              <div className="sticky top-0 z-10 bg-white/95 backdrop-blur flex justify-end p-2">
                <button
                  onClick={() => setShowImageModal(false)}
                  aria-label="关闭"
                  className="text-gray-500 hover:text-gray-700 text-3xl leading-none"
                >
                  ×
                </button>
              </div>
              <div className="px-4 pb-4">
                <p className="text-center text-sm text-gray-600" style={{ marginTop: '0.5rem' }}>
                  💫 长按图片保存到相册
                </p>
                <div className="items-center flex flex-col" style={{ padding: '0.5rem' }}>
                  <img
                    src={savedImageUrl}
                    alt="魔法少女详细档案"
                    className="w-1/2 h-auto rounded-lg mx-auto"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  );
};
