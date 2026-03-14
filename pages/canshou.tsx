// pages/canshou.tsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCooldown } from '../lib/cooldown';
import Link from 'next/link';
import CanshouCard, { CanshouDetails } from '../components/CanshouCard';
import GeneralCharacterCard from '../components/GeneralCharacterCard';
import { CANSHOU_LORE } from '../lib/canshou-lore';
import { generateRandomCanshou } from '../lib/random-character-generator';
import SaveToCloudButton from '../components/SaveToCloudButton';
import Footer from '../components/Footer';
import QuestionNavigator from '../components/QuestionNavigator';
import BattleDataModal from '@/components/BattleDataModal';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import AiReasoningPanel from '@/components/ai/AiReasoningPanel';
import { parseBulkQuestionnaireAnswers } from '@/lib/questionnaire-bulk-parser';
import { ErrorMessage } from '@/components/ErrorMessage';
import { EncyclopediaLinks } from '@/components/encyclopedia/EncyclopediaLinks';
import { GenerationModeSwitcher, type GenerationMode } from '@/components/shared/GenerationModeSwitcher';
import { TokenIndicator } from '@/components/shared/TokenIndicator';
import { JsonSizeIndicator } from '@/components/shared/JsonSizeIndicator';
import { ThemeImage } from '@/components/shared/ThemeImage';
import {
  CANSHOU_QUESTIONNAIRE_THEME,
  QuestionnaireQuestionPanel,
} from '@/components/questionnaire/QuestionnaireQuestionPanel';
import { QuestionnaireAnswerExportPanel } from '@/components/questionnaire/QuestionnaireAnswerExportPanel';
import { readTextAndReasoningStreamFromResponse } from '@/lib/stream/read-text-and-reasoning-stream';
import { buildGeneralCharacterCardFromMarkdown } from '@/lib/stream/markdown-card';
import { readJsonOrTextFromResponse, resolveApiErrorMessage } from '@/lib/client/apiError';
import { AI_META_REQUEST_HEADER, AI_META_REQUEST_VALUE, readJsonWithAiMeta } from '@/lib/client/read-json-with-ai-meta';
import { formatHttpErrorMessage } from '@/lib/client/httpError';
import { authStorage } from '@/lib/auth';
import { mapDataCardSourceMeta } from '@/lib/data-card-read-mappers';
import {
  buildQuestionKey,
  buildQuestionnaireFlow,
  compactQuestionnaireAnswerItems,
  formatQuestionnaireAnswers,
  normalizeQuestionnaireDefinition,
  parseQuestionnaireDataCardPayload,
  normalizeUserAnswers,
  resolveQuestionnaireReferences,
  type QuestionnaireAnswerItem,
  type QuestionnaireDefinition,
  type QuestionnairePresetEntry,
  type QuestionnaireQuestion,
} from '@/lib/questionnaires';
import { getAnswerLimitInfo, isAnswerOverLimit, QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS } from '@/lib/questionnaire-limits';
import type { AIReasoningEnvelope } from '@/types/ai-reasoning';

type QuestionnaireSelectionSource = 'preset' | 'upload' | 'database';

type QuestionnaireSelection = {
  source: QuestionnaireSelectionSource;
  questionnaire: QuestionnaireDefinition;
  dataCardId?: string;
  dataCardName?: string;
  dataCardAuthor?: string;
  selectionId?: string;
  useLore?: boolean;
};

type QuestionnaireContextItem = {
  key: string;
  questionnaireId: string;
  questionnaireScopeId: string;
  questionnaireTitle: string;
  indexInQuestionnaire: number;
  question: QuestionnaireQuestion;
};

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

interface SaveJsonButtonProps {
  data: CanshouResultPayload;
  mode: JsonSaveMode;
  recommendedMode: JsonSaveMode;
}

// 用于保存JSON的按钮组件
const SaveJsonButton: React.FC<SaveJsonButtonProps> = ({ data, mode, recommendedMode }) => {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const jsonPayload = useMemo(() => JSON.stringify(data, null, 2), [data]);

  const downloadJson = () => {
    const blob = new Blob([jsonPayload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const sanitizedName = (data.name || 'data').replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
    link.href = url;
    link.download = `残兽档案_${sanitizedName}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setCopyStatus('idle');
  };

  const handleCopy = async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        throw new Error('clipboard-not-available');
      }
      await navigator.clipboard.writeText(jsonPayload);
      setCopyStatus('success');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (err) {
      console.error('复制 JSON 失败：', err);
      setCopyStatus('error');
      setTimeout(() => setCopyStatus('idle'), 2500);
    }
  };

  const statusMessage = copyStatus === 'success'
    ? '✅ JSON 已复制，记得粘贴到文件中保存'
    : copyStatus === 'error'
      ? '⚠️ 复制遇到问题，请手动长按选择'
      : recommendedMode === 'text'
        ? '推荐复制后在本地编辑器中保存为 .json 文件'
        : '若下载失败，可切换到复制模式';

  if (mode === 'download') {
    return (
      <div className="flex-1 min-w-[260px] text-left">
        <p className="text-xs text-gray-500 mb-2 text-center">
          {recommendedMode === 'download'
            ? '推荐：直接下载 JSON 文件，方便在桌面端继续编辑'
            : '实验功能：部分移动端浏览器支持直接下载，若失败请使用复制模式'}
        </p>
        <button onClick={downloadJson} className="generate-button w-full">
          {recommendedMode === 'download' ? '💾 下载残兽档案' : '🧪 尝试直接下载 JSON'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-[260px] text-left">
      <div className="mb-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
        <p className="font-semibold mb-1">复制模式</p>
        <p>复制完整内容后，粘贴到文本编辑器中，以 <code className="bg-yellow-100 px-1 rounded">.json</code> 结尾保存。</p>
      </div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500">{statusMessage}</span>
        <button
          onClick={handleCopy}
          className="rounded-md border border-indigo-200 bg-white px-3 py-1 text-xs font-medium text-indigo-600 hover:border-indigo-400 hover:text-indigo-700"
          type="button"
        >
          复制 JSON
        </button>
      </div>
      <textarea
        value={jsonPayload}
        readOnly
        className="w-full h-64 p-3 border rounded-lg text-xs font-mono bg-gray-50 text-gray-900"
        onClick={(e) => (e.target as HTMLTextAreaElement).select()}
      />
      <p className="text-xs text-gray-400 mt-2 text-center">点击文本框可全选内容</p>
    </div>
  );
};

const LOCAL_STORAGE_KEY = 'canshouAnswersDraft'; // 定义本地存储的键
const CANSHOU_PREFERENCE_KEY = 'mahoshojo.canshou.preferences.v1';

const CanshouPage: React.FC = () => {
  const router = useRouter();
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
  const draftRestoredRef = useRef(false);
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
  const generatorCooldownMs = isUserCustomKey ? 3000 : 60000;
  const generatorCooldownKey = isUserCustomKey ? 'generateCanshouCooldown:custom' : 'generateCanshouCooldown:system';
  const { isCooldown, startCooldown, remainingTime } = useCooldown(generatorCooldownKey, generatorCooldownMs);
  const [bulkAnswers, setBulkAnswers] = useState(''); // 用于"一键填充"的textarea
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
  const [autoSaveTimestamp, setAutoSaveTimestamp] = useState<number | null>(null);
  const recommendedImageMode: ImageSaveMode = deviceType === 'mobile' ? 'modal' : 'download';
  const recommendedJsonMode: JsonSaveMode = deviceType === 'mobile' ? 'text' : 'download';
  const preferenceButtonClass = (active: boolean) => `flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${active ? 'border-rose-500 bg-rose-50 text-rose-700 shadow-sm' : 'border-slate-200 text-slate-600 hover:border-rose-300 hover:text-rose-600'}`;
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
    (selection: QuestionnaireSelection, used: Set<string>) => {
      const base = selection.questionnaire.id || 'questionnaire';
      let nextId = typeof selection.selectionId === 'string' ? selection.selectionId.trim() : '';
      if (!nextId) {
        nextId = used.has(base) ? `${base}::${createSelectionSuffix()}` : base;
      } else if (used.has(nextId)) {
        nextId = `${base}::${createSelectionSuffix()}`;
      }
      used.add(nextId);
      return { ...selection, selectionId: nextId };
    },
    [createSelectionSuffix]
  );

  const questionnaireItems = useMemo<QuestionnaireContextItem[]>(() => {
    return selectedQuestionnaires.flatMap((selection) =>
      selection.questionnaire.questions.map((question, index) => {
        const questionnaireScopeId = selection.selectionId ?? selection.questionnaire.id;
        return {
          key: buildQuestionKey(questionnaireScopeId, question.id, index),
          questionnaireId: selection.questionnaire.id,
          questionnaireScopeId,
          questionnaireTitle: selection.questionnaire.title,
          indexInQuestionnaire: index,
          question,
        };
      })
    );
  }, [selectedQuestionnaires]);

  const resolvedQuestionItems = useMemo(
    () => resolveQuestionnaireReferences(questionnaireItems),
    [questionnaireItems]
  );

  const getQuestionnaireFlow = useCallback(
    (answers: Record<string, string>) => buildQuestionnaireFlow(resolvedQuestionItems, answers),
    [resolvedQuestionItems]
  );

  const {
    flow: mergedQuestions,
    indexByKey: mergedQuestionIndexByKey,
  } = useMemo(() => getQuestionnaireFlow(answersByKey), [answersByKey, getQuestionnaireFlow]);

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

  const isQuestionnaireNativeAllowed = useMemo(() => {
    if (selectedQuestionnaires.length === 0) return false;
    return selectedQuestionnaires.every((selection) => {
      const hasQuestions = selection.questionnaire.questions.length > 0;
      const hasLore = Boolean(selection.questionnaire.loreMarkdown?.trim());
      const usesLore = hasLore && selection.useLore !== false;
      if (!hasQuestions && !usesLore) return true;
      return selection.questionnaire.nativeAllowed === true;
    });
  }, [selectedQuestionnaires]);

  const questionnaireLoreText = useMemo(() => {
    const blocks = selectedQuestionnaires
      .filter((selection) => selection.useLore !== false)
      .map((selection) => ({
        title: selection.questionnaire.title,
        lore: selection.questionnaire.loreMarkdown?.trim() ?? '',
      }))
      .filter((item) => Boolean(item.lore))
      .map((item) => `【设定来源：${item.title}】\n${item.lore}`);
    return blocks.length > 0 ? blocks.join('\n\n') : '';
  }, [selectedQuestionnaires]);

  const tokenEstimateText = useMemo(() => {
    const answerText = formatQuestionnaireAnswers(answerItems);
    if (questionnaireLoreText && answerText) return `${questionnaireLoreText}\n\n${answerText}`;
    return questionnaireLoreText || answerText;
  }, [answerItems, questionnaireLoreText]);

  const shouldDisableRemove = selectedQuestionnaires.length <= 1;

  const answerableSelections = useMemo(
    () => selectedQuestionnaires.filter((selection) => selection.questionnaire.questions.length > 0),
    [selectedQuestionnaires]
  );

  const loreSelections = useMemo(
    () => selectedQuestionnaires.filter((selection) => Boolean(selection.questionnaire.loreMarkdown?.trim())),
    [selectedQuestionnaires]
  );

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
    const userAgent = navigator.userAgent.toLowerCase();
    const isMobileDevice = /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(userAgent);
    const detectedType: DeviceType = isMobileDevice ? 'mobile' : 'desktop';
    setDeviceType(detectedType);
    const defaultImageMode: ImageSaveMode = isMobileDevice ? 'modal' : 'download';
    const defaultJsonMode: JsonSaveMode = isMobileDevice ? 'text' : 'download';

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
          .map((raw): QuestionnaireSelection | null => {
            if (!raw || typeof raw !== 'object') return null;
            const rawRecord = raw as Record<string, unknown>;
            const source: QuestionnaireSelectionSource =
              rawRecord.source === 'upload' || rawRecord.source === 'database' || rawRecord.source === 'preset'
                ? rawRecord.source
                : 'preset';
            const rawQuestionnaire = rawRecord.questionnaire as { id?: unknown; title?: unknown; nativeAllowed?: unknown } | null;
            const fallbackNativeAllowed = source === 'preset'
              ? (typeof rawQuestionnaire?.nativeAllowed === 'boolean' ? rawQuestionnaire.nativeAllowed : true)
              : source === 'upload'
                ? false
                : (typeof rawQuestionnaire?.nativeAllowed === 'boolean' ? rawQuestionnaire.nativeAllowed : false);
            const normalized = normalizeQuestionnaireDefinition(rawRecord.questionnaire, {
              fallbackKind: 'canshou',
              fallbackId: typeof rawQuestionnaire?.id === 'string' ? rawQuestionnaire.id : 'canshou-custom',
              fallbackTitle: typeof rawQuestionnaire?.title === 'string' ? rawQuestionnaire.title : '未命名问卷',
              nativeAllowed: fallbackNativeAllowed,
            });
            if (!normalized) return null;
            if (source === 'database' && normalized.nativeAllowed == null) normalized.nativeAllowed = false;
            return {
              source,
              questionnaire: normalized,
              dataCardId: typeof rawRecord.dataCardId === 'string' ? rawRecord.dataCardId : undefined,
              dataCardName: typeof rawRecord.dataCardName === 'string' ? rawRecord.dataCardName : undefined,
              dataCardAuthor: typeof rawRecord.dataCardAuthor === 'string' ? rawRecord.dataCardAuthor : undefined,
              selectionId: typeof rawRecord.selectionId === 'string' ? rawRecord.selectionId : undefined,
              useLore: typeof rawRecord.useLore === 'boolean' ? rawRecord.useLore : undefined,
            } satisfies QuestionnaireSelection;
          })
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
      const defaultPreset = presetEntries.find((item) => item.isDefault) ?? presetEntries[0];
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

  const applySelection = (selection: QuestionnaireSelection) => {
    const hasQuestions = selection.questionnaire.questions.length > 0;
    const hasLore = Boolean(selection.questionnaire.loreMarkdown?.trim());
    const isLoreOnly = !hasQuestions && hasLore;

    setSelectedQuestionnaires((prev) => {
      const usedSelectionIds = new Set<string>();
      prev.forEach((item) => {
        const existingId = item.selectionId || item.questionnaire.id;
        if (existingId) usedSelectionIds.add(existingId);
      });

      const normalizedSelection = ensureSelectionId(selection, usedSelectionIds);

      if (allowMultipleQuestionnaires) {
        return [...prev, normalizedSelection];
      }

      if (hasQuestions) {
        const preservedLoreOnly = prev.filter((item) => item.questionnaire.questions.length === 0);
        return [normalizedSelection, ...preservedLoreOnly];
      }

      if (isLoreOnly && prev.length > 0) {
        return [...prev, normalizedSelection];
      }

      return [normalizedSelection];
    });
    setPasteQuestionnaireError(null);
    setPasteQuestionnaireText('');
    setShowPasteImport(false);
    setShowIntroduction(false);
    setShowQuestionnaireSettings(false);
  };

  const handleRemoveSelection = (selectionId: string) => {
    clearTransitionTimers();
    setIsTransitioning(false);
    setSelectedQuestionnaires((prev) => prev.filter((item) => (item.selectionId ?? item.questionnaire.id) !== selectionId));
  };

  const handleToggleSelectionLore = (selectionId: string, enabled: boolean) => {
    setSelectedQuestionnaires((prev) => prev.map((item) => {
      const id = item.selectionId ?? item.questionnaire.id;
      if (id !== selectionId) return item;
      return { ...item, useLore: enabled };
    }));
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
    if (selectedQuestionnaires.length <= 1) return;

    const firstAnswerableIndex = selectedQuestionnaires.findIndex((selection) => selection.questionnaire.questions.length > 0);
    if (firstAnswerableIndex < 0) return;

    const hasExtraAnswerable = selectedQuestionnaires.some(
      (selection, index) => index !== firstAnswerableIndex && selection.questionnaire.questions.length > 0
    );
    if (!hasExtraAnswerable) return;

    const nextSelections = selectedQuestionnaires.filter(
      (selection, index) => selection.questionnaire.questions.length === 0 || index === firstAnswerableIndex
    );

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
    if (!mergedQuestions.length) return;
    if (draftRestoredRef.current) return;
    draftRestoredRef.current = true;

    try {
      const savedDraft = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!savedDraft) return;
      const parsed = JSON.parse(savedDraft);
      const nextAnswers: Record<string, string> = {};

      if (Array.isArray(parsed)) {
        parsed.forEach((value, index) => {
          const item = mergedQuestions[index];
          if (!item) return;
          if (typeof value === 'string' && value.trim()) {
            nextAnswers[item.key] = value;
          }
        });
      } else if (parsed && typeof parsed === 'object') {
        const direct = (parsed as any).answersByKey;
        if (direct && typeof direct === 'object') {
          Object.entries(direct as Record<string, unknown>).forEach(([key, value]) => {
            if (typeof value === 'string' && value.trim()) {
              nextAnswers[key] = value;
            }
          });
        } else {
          mergedQuestions.forEach((item, index) => {
            const candidates = [
              item.question.id,
              `${index}`,
              `${index + 1}`,
              `CS-${index + 1}`,
            ];
            for (const key of candidates) {
              const value = (parsed as any)[key];
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
    }
  }, [mergedQuestions]);

  useEffect(() => {
    try {
      const hasAnswers = Object.values(answersByKey).some((value) => typeof value === 'string' && value.trim() !== '');
      if (hasAnswers) {
        const dataToSave = JSON.stringify({ version: 2, answersByKey });
        localStorage.setItem(LOCAL_STORAGE_KEY, dataToSave);
        setAutoSaveTimestamp(Date.now());
      }
    } catch (e) {
      console.error("Failed to save answers to localStorage", e);
    }
  }, [answersByKey]);

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

      const customProviderPayload = (
        userProviderConfig
        && (userProviderConfig.apiKey || userProviderConfig.providerId === 'system')
        && userProviderConfig.modelId !== 'default'
      ) ? {
        providerId: userProviderConfig.providerId,
        modelId: userProviderConfig.modelId,
        apiKey: userProviderConfig.apiKey,
      } : undefined;

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
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          answers: finalAnswerItems,
          questionnaireSelections: selectedQuestionnaires.map((selection) => ({
            source: selection.source,
            kind: selection.questionnaire.kind,
            presetId: selection.source === 'preset' ? selection.questionnaire.id : undefined,
            dataCardId: selection.source === 'database' ? selection.dataCardId : undefined,
            useLore: selection.useLore === false ? false : undefined,
          })),
          questionnaires: selectedQuestionnaires.map((selection) => ({
            id: selection.questionnaire.id,
            title: selection.questionnaire.title,
            kind: selection.questionnaire.kind,
            useLore: selection.useLore === false ? false : undefined,
            loreMarkdown: selection.questionnaire.loreMarkdown ?? undefined,
            questions: selection.questionnaire.questions.map((question) => ({
              id: question.id,
              question: question.question,
              required: question.required === true,
              maxLength: question.maxLength ?? null,
            })),
          })),
          allowNativeSignature: allowNativeSignatureForSubmit,
          language: selectedLanguage,
          customProvider: customProviderPayload,
        }),
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
        const { text: markdown } = await readTextAndReasoningStreamFromResponse(response, {
          label: '残兽档案（流式）',
          onText: (text) => setStreamingMarkdown(text),
          onReasoning: (reasoning) => setStreamingReasoning(reasoning),
        });

        const { card } = buildGeneralCharacterCardFromMarkdown({
          markdown,
          defaultName: '残兽',
        });
        const cardWithAnswers = {
          ...card,
          userAnswers: compactQuestionnaireAnswerItems(finalAnswerItems),
        };
        if (!allowNativeSignatureForSubmit) {
          setStreamedGeneralCard(cardWithAnswers);
          setError(null);
          shouldStartCooldown = true;
          return;
        }

        let signedCard = cardWithAnswers;
        let hasSignError = false;
        try {
          const result = await resignDataCard(cardWithAnswers);
          if (!result) return;
          signedCard = result;
        } catch (err) {
          const message = err instanceof Error ? err.message : '签名失败';
          setError(`⚠️ 原生性签名失败，已降级为非原生：${message}`);
          hasSignError = true;
        }

        setStreamedGeneralCard(signedCard);
        if (!hasSignError) {
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
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const rawName = (data?.codename || data?.name || '未命名角色').toString();
    const sanitizedName = rawName.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').slice(0, 80) || 'data';
    link.href = url;
    link.download = `通用残兽角色_${sanitizedName}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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

  const handleBulkFill = () => {
    if (mergedQuestions.length === 0) {
      setError('⚠️ 当前没有可填充的题目，请先选择问卷。');
      return;
    }
    const parsed = parseBulkQuestionnaireAnswers(bulkAnswers, {
      expectedCount: mergedQuestions.length,
      orderedQuestionIds: mergedQuestions.map((item) => item.question.id),
      orderedQuestionKeys: mergedQuestions.map((item) => item.key),
    });

    if (parsed.entries.length === 0) {
      setError('⚠️ 未识别到可填充的答案。支持逐行答案、Q/A 格式、编号列表，以及 JSON（数组/含 userAnswers/问卷回答）。');
      return;
    }

    const newAnswers = { ...answersByKey };
    let appliedCount = 0;
    let ignoredCount = 0;
    parsed.entries.forEach(entry => {
      if (entry.index < 0 || entry.index >= mergedQuestions.length) {
        ignoredCount += 1;
        return;
      }
      const item = mergedQuestions[entry.index];
      if (!item) {
        ignoredCount += 1;
        return;
      }
      const trimmed = entry.value.trim();
      if (!trimmed) {
        ignoredCount += 1;
        return;
      }
      newAnswers[item.key] = entry.value;
      appliedCount += 1;
    });
    setAnswersByKey(newAnswers);
    const currentKey = mergedQuestions[currentQuestionIndex]?.key;
    setCurrentAnswer(currentKey ? newAnswers[currentKey] || '' : '');
    setError(null);
    const formatLabel = parsed.format === 'qa'
      ? 'Q/A'
      : parsed.format === 'json'
        ? 'JSON'
        : parsed.format === 'paragraphs'
          ? '段落'
          : '逐行';
    alert(`成功填充了 ${appliedCount} 个答案（识别格式：${formatLabel}${ignoredCount > 0 ? `，忽略了 ${ignoredCount} 条超出范围的内容` : ''}）！`);
    setBulkAnswers('');
  };

  const buildAnswerExportText = useCallback(() => {
    const now = new Date();
    const answered = mergedQuestions.flatMap((item, index) => {
      const raw = answersByKey[item.key];
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (!trimmed) return [];
      return [{
        index,
        questionnaireTitle: item.questionnaireTitle,
        question: item.question.question,
        answer: raw,
      }];
    });

    const selectedTitles = selectedQuestionnaires
      .map((selection) => selection.questionnaire.title?.trim())
      .filter((title): title is string => Boolean(title));
    const questionnaireLabel = selectedTitles.length > 0 ? selectedTitles.join(' + ') : '';

    const lines: string[] = [];
    lines.push('【残兽问卷答案备份】');
    lines.push(`导出时间：${now.toLocaleString()}`);
    lines.push(`已填写：${answered.length} / ${mergedQuestions.length}`);
    if (questionnaireLabel) lines.push(`问卷：${questionnaireLabel}`);
    lines.push('');

    answered.forEach((entry) => {
      const title = entry.questionnaireTitle ? `（${entry.questionnaireTitle}）` : '';
      lines.push(`Q${entry.index + 1}${title}: ${entry.question}`);
      lines.push(`A: ${entry.answer}`);
      lines.push('');
    });

    return lines.join('\n').trimEnd();
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
      <Head>
        <title>残兽生成器 - 间界残兽前进基地</title>
      </Head>
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
              <div className="text-center">
                {/* 注意事项 */}
                <div className="mb-6 p-3 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 text-sm text-left rounded-r-lg">
                  <p className="font-bold">⚠️ 注意事项</p>
                  <p className="mt-1">请勿在问卷中输入任何真实的隐私信息，或任何不适宜、攻击性、不符合公序良俗的内容。所有回答将被用于生成虚拟角色，并且将会被储存在角色信息中。</p>
                </div>
                <EncyclopediaLinks
                  items={[{ slug: 'character-generator', text: '百科：角色生成（/name、/details、/canshou）' }]}
                  linkClassName="text-blue-200 hover:underline"
                  labelClassName="text-slate-300"
                />
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button onClick={() => setShowIntroduction(false)} className="generate-button text-lg flex-1">开始调查</button>
                  <button
                    onClick={() => { // 移除 async
                      setSubmitting(true);
                      setError(null);
                      try {
                        // 直接同步调用，移除 await
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
                    disabled={submitting}
                    className="generate-button text-lg flex-1"
                    style={{ background: 'linear-gradient(to right, #7e22ce, #a855f7)' }}
                  >
                    {submitting ? '生成中...' : '快速随机生成'}
                  </button>
                </div>
                <div className="mt-8">
                  <Link href="/" className="footer-link">返回首页</Link>
                </div>
              </div>
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

                <div className="my-4 rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-200">
                  <button
                    type="button"
                    onClick={() => setShowQuestionnaireSettings(!showQuestionnaireSettings)}
                    className="flex w-full items-center justify-between font-semibold text-emerald-300"
                  >
                    <span>问卷设置</span>
                    <span>{showQuestionnaireSettings ? '▲' : '▼'}</span>
                  </button>
	                  {showQuestionnaireSettings && (
	                    <div className="mt-3 space-y-3 text-xs text-slate-400">
	                      <p>你可以选择预设、上传或从云端问卷库挑选。多问卷只影响题目顺序；设定（Lore）可单独启用/禁用。</p>
	                      <div className="flex flex-wrap items-center gap-3">
	                        <label className="flex items-center gap-2">
	                          <input
	                            type="checkbox"
	                            checked={allowMultipleQuestionnaires}
	                            onChange={(e) => setAllowMultipleQuestionnaires(e.target.checked)}
	                          />
	                          允许同时回答多份问卷
	                        </label>
	                        {!allowMultipleQuestionnaires && (
	                          <span className="text-[11px] text-slate-500">关闭时：仅允许 1 份可作答问卷，但仍可叠加纯设定卡。</span>
	                        )}
	                        {!isQuestionnaireNativeAllowed && (
	                          <span className="text-rose-400">提示：当前问卷未获得原生许可，生成结果将不具备原生性。</span>
	                        )}
	                        {isQuestionnaireNativeAllowed && hasOverLimitAnswer && (
	                          <span className="text-amber-300">提示：已有答案超过字数上限（原生统一上限 {QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS} 字），生成结果将不具备原生性。</span>
	                        )}
	                      </div>
	                      <div className="space-y-2">
	                        <div className="text-[11px] font-semibold text-slate-500">可作答问卷（题目）</div>
	                        {answerableSelections.length === 0 ? (
	                          <div className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-[11px] text-slate-500">
	                            暂无可作答问卷
	                          </div>
	                        ) : (
	                          answerableSelections.map((selection) => {
	                            const selectionId = selection.selectionId ?? selection.questionnaire.id;
	                            const hasLore = Boolean(selection.questionnaire.loreMarkdown?.trim());
	                            const loreStatus = hasLore ? (selection.useLore !== false ? ' · 设定：启用' : ' · 设定：关闭') : '';
	                            return (
	                              <div key={selectionId} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2">
	                                <div>
	                                  <div className="font-semibold text-emerald-200">{selection.questionnaire.title}</div>
	                                  <div className="text-[11px] text-slate-500">
	                                    来源：{selection.source === 'preset' ? '预设' : selection.source === 'upload' ? '本地上传' : '云端问卷'}
	                                    {selection.dataCardAuthor ? ` · 作者：${selection.dataCardAuthor}` : ''}
	                                    {selection.questionnaire.nativeAllowed ? ' · 原生许可' : ' · 非原生'}
	                                    {loreStatus}
	                                  </div>
	                                </div>
	                                <div className="flex items-center gap-3">
	                                  <button
	                                    type="button"
	                                    onClick={() => handleOpenQuestionnaireDetails(selection)}
	                                    className="text-xs text-emerald-300 hover:underline"
	                                  >
	                                    详情
	                                  </button>
	                                  <button
	                                    type="button"
	                                    disabled={shouldDisableRemove}
	                                    onClick={() => handleRemoveSelection(selectionId)}
	                                    className={`text-xs ${shouldDisableRemove ? 'text-slate-700' : 'text-rose-400 hover:underline'}`}
	                                  >
	                                    移除
	                                  </button>
	                                </div>
	                              </div>
	                            );
	                          })
	                        )}
	                      </div>
	                      <div className="space-y-2">
	                        <div className="text-[11px] font-semibold text-slate-500">设定（Lore）注入</div>
	                        {loreSelections.length === 0 ? (
	                          <div className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-[11px] text-slate-500">
	                            暂无设定来源
	                          </div>
	                        ) : (
	                          loreSelections.map((selection) => {
	                            const selectionId = selection.selectionId ?? selection.questionnaire.id;
	                            const isLoreOnly = selection.questionnaire.questions.length === 0;
	                            return (
	                              <div key={selectionId} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2">
	                                <div>
	                                  <div className="font-semibold text-emerald-200">{selection.questionnaire.title}</div>
	                                  <div className="text-[11px] text-slate-500">
	                                    来源：{selection.source === 'preset' ? '预设' : selection.source === 'upload' ? '本地上传' : '云端问卷'}
	                                    {selection.dataCardAuthor ? ` · 作者：${selection.dataCardAuthor}` : ''}
	                                    {selection.questionnaire.nativeAllowed ? ' · 原生许可' : ' · 非原生'}
	                                    {isLoreOnly ? ' · 仅设定' : ' · 来自问卷'}
	                                  </div>
	                                </div>
	                                <div className="flex items-center gap-3">
	                                  <label className="flex items-center gap-2 text-[11px] text-emerald-200">
	                                    <input
	                                      type="checkbox"
	                                      checked={selection.useLore !== false}
	                                      onChange={(e) => handleToggleSelectionLore(selectionId, e.target.checked)}
	                                    />
	                                    使用设定
	                                  </label>
	                                  <button
	                                    type="button"
	                                    onClick={() => handleOpenQuestionnaireDetails(selection)}
	                                    className="text-xs text-emerald-300 hover:underline"
	                                  >
	                                    详情
	                                  </button>
	                                  {isLoreOnly && (
	                                    <button
	                                      type="button"
	                                      disabled={shouldDisableRemove}
	                                      onClick={() => handleRemoveSelection(selectionId)}
	                                      className={`text-xs ${shouldDisableRemove ? 'text-slate-700' : 'text-rose-400 hover:underline'}`}
	                                    >
	                                      移除
	                                    </button>
	                                  )}
	                                </div>
	                              </div>
	                            );
	                          })
	                        )}
	                      </div>
	                      <div className="flex flex-wrap items-center gap-2">
	                        <select
	                          className="input-field text-xs"
	                          onChange={(e) => {
                            if (e.target.value) {
                              void handleAddPreset(e.target.value);
                              e.currentTarget.value = '';
                            }
                          }}
                          defaultValue=""
                        >
                          <option value="" disabled>选择预设问卷</option>
                          {presetEntries.map((preset) => (
                            <option key={preset.id} value={preset.id}>{preset.title}</option>
                          ))}
                        </select>
                        <label className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200 hover:border-emerald-300 hover:bg-emerald-500/20 cursor-pointer">
                          上传问卷 JSON
                          <input
                            type="file"
                            accept="application/json"
                            onChange={(e) => void handleUploadQuestionnaire(e.target.files?.[0] ?? null)}
                            className="hidden"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setQuestionnairePickerError(null);
                            setShowQuestionnairePicker(true);
                          }}
                          className="rounded-lg border border-emerald-500/40 bg-slate-900 px-3 py-1 text-xs text-emerald-300 hover:border-emerald-400"
                        >
                          从云端问卷库选择
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPasteQuestionnaireError(null);
                            setShowPasteImport((prev) => !prev);
                          }}
                          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200 hover:border-emerald-300 hover:bg-emerald-500/20"
                        >
                          {showPasteImport ? '收起粘贴导入' : '粘贴导入 JSON'}
                        </button>
                        <Link href="/questionnaire-editor" className="text-xs text-emerald-300 hover:underline">
                          打开问卷编辑器
                        </Link>
                      </div>
                      {showPasteImport && (
                        <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-3 text-xs text-slate-300">
                          <label className="text-xs text-slate-500">粘贴问卷 JSON</label>
                          <textarea
                            value={pasteQuestionnaireText}
                            onChange={(e) => setPasteQuestionnaireText(e.target.value)}
                            placeholder="在此粘贴问卷 JSON"
                            className="input-field mt-2 h-28"
                            rows={6}
                          />
                          <div className="mt-2 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={handlePasteQuestionnaireImport}
                              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200 hover:border-emerald-300 hover:bg-emerald-500/20"
                            >
                              解析并载入
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPasteQuestionnaireText('');
                                setPasteQuestionnaireError(null);
                              }}
                              className="text-xs text-slate-500 hover:text-slate-200"
                            >
                              清空
                            </button>
                          </div>
                          {pasteQuestionnaireError && (
                            <p className="mt-2 text-rose-400">{pasteQuestionnaireError}</p>
                          )}
                        </div>
                      )}
                      {questionnaireLoadError && (
                        <p className="text-rose-400">{questionnaireLoadError}</p>
                      )}
                    </div>
                  )}
                </div>

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
                    <GeneralCharacterCard general={streamedGeneralCardForDisplay} isStreaming={submitting} />
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
                </div>

                <div className="my-4 bg-gray-100 rounded-lg p-3">
                  <button
                    onClick={() => setShowBulkFillSection(!showBulkFillSection)}
                    className="flex items-center justify-between w-full text-left font-medium text-gray-700 hover:text-blue-600"
                  >
                    <span>一键填充答案</span>
                    <span className="ml-2">{showBulkFillSection ? '▼' : '▶'}</span>
                  </button>
                  {showBulkFillSection && (
                    <div className="mt-3">
                      <textarea
                        id="bulk-answers"
                        value={bulkAnswers}
                        onChange={(e) => setBulkAnswers(e.target.value)}
                        placeholder="在此处粘贴所有答案：支持每行一个、Q/A 复制内容、编号列表、JSON。"
                        className="input-field h-20"
                        rows={4}
                      />
                      <div className="flex justify-between items-center mt-2">
                        <button onClick={handleBulkFill} className="text-sm text-blue-600 hover:underline">填充</button>
                        <button onClick={handleClearDraft} className="text-sm text-red-600 hover:underline">清空存档</button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="my-4 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <button
                    onClick={() => setShowAnswerReview(!showAnswerReview)}
                    className="flex w-full items-center justify-between text-left text-sm font-semibold text-emerald-300"
                  >
                    <span>答案概览</span>
                    <span>{showAnswerReview ? '▲' : '▼'}</span>
                  </button>
                  {showAnswerReview && (
                    <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1 text-sm">
                      {mergedQuestions.map((item, index) => (
                        <div key={`canshou-review-${item.key}`} className="rounded-lg border border-slate-700 bg-slate-900/80 p-3">
                          <div className="text-xs font-semibold text-emerald-300">Q{index + 1}</div>
                          <div className="mt-1 text-xs text-slate-300">
                            {item.questionnaireTitle ? `(${item.questionnaireTitle}) ` : ''}{item.question.question}
                          </div>
                          <div className="mt-2 text-slate-100 whitespace-pre-wrap">
                            {answersByKey[item.key] && answersByKey[item.key].trim().length > 0
                              ? answersByKey[item.key]
                              : <span className="text-slate-500">尚未填写</span>}
                          </div>
                          <div className="mt-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleNavigateToQuestion(index)}
                              className="text-xs text-emerald-300 hover:underline"
                            >
                              编辑此题
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {error && <ErrorMessage message={error} />}
                {isQuestionnaireNativeAllowed && hasOverLimitAnswer && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                    ⚠️ 已有 {overLimitItems.length} 条答案超过字数上限，继续提交将导致生成内容丧失原生性。
                  </div>
                )}

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
                      onSaveImage={handleSaveImage}
                      imageSaveMode={imageSaveMode}
                      saveButtonLabel={imageSaveButtonLabel}
                    />
                    <AiReasoningPanel reasoning={streamingReasoning} status={streamingReasoning?.status ?? 'idle'} compact />

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
                    <div className="card" style={{ marginTop: '1rem' }}>
                      <div className="space-y-5 text-left">
                        <div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-gray-800">设定长图保存方式</span>
                            <span className="text-xs text-gray-500">推荐：{recommendedImageMode === 'download' ? '一键下载' : '长按保存弹窗'}</span>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2 mt-2">
                            <button
                              type="button"
                              className={preferenceButtonClass(imageSaveMode === 'download')}
                              onClick={() => setImageSaveMode('download')}
                            >
                              一键下载长图
                              {recommendedImageMode === 'download' && (
                                <span className="ml-2 inline-flex items-center rounded-full bg-rose-100 px-2 text-[10px] font-semibold text-rose-600">推荐</span>
                              )}
                            </button>
                            <button
                              type="button"
                              className={preferenceButtonClass(imageSaveMode === 'modal')}
                              onClick={() => setImageSaveMode('modal')}
                            >
                              长按保存弹窗
                              {recommendedImageMode === 'modal' && (
                                <span className="ml-2 inline-flex items-center rounded-full bg-rose-100 px-2 text-[10px] font-semibold text-rose-600">推荐</span>
                              )}
                            </button>
                          </div>
                          <p className="mt-2 text-xs text-gray-500">如果当前浏览器阻止下载，可切换为弹窗模式再手动保存。</p>
                        </div>

                        <div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-gray-800">JSON 保存方式</span>
                            <span className="text-xs text-gray-500">推荐：{recommendedJsonMode === 'download' ? '直接下载' : '复制 JSON'}</span>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2 mt-2">
                            <button
                              type="button"
                              className={preferenceButtonClass(jsonSaveMode === 'download')}
                              onClick={() => setJsonSaveMode('download')}
                            >
                              直接下载 JSON
                              {recommendedJsonMode === 'download' && (
                                <span className="ml-2 inline-flex items-center rounded-full bg-rose-100 px-2 text-[10px] font-semibold text-rose-600">推荐</span>
                              )}
                            </button>
                            <button
                              type="button"
                              className={preferenceButtonClass(jsonSaveMode === 'text')}
                              onClick={() => setJsonSaveMode('text')}
                            >
                              复制原始数据
                              {recommendedJsonMode === 'text' && (
                                <span className="ml-2 inline-flex items-center rounded-full bg-rose-100 px-2 text-[10px] font-semibold text-rose-600">推荐</span>
                              )}
                            </button>
                          </div>
                          <p className="mt-2 text-xs text-gray-500">两种方式都可跨终端使用，可随时切换体验。</p>
                        </div>

                        <p className="text-xs text-gray-400 text-center">提示：偏好设置已保存到浏览器，刷新后仍会保留；切换不会触发重新生成。</p>
                      </div>
                    </div>
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
                <div className="card">
                  <button onClick={() => setShowLore(!showLore)} className="text-lg font-medium text-gray-800 w-full text-left">
                    {showLore ? '▼ ' : '▶ '}残兽设定说明
                  </button>
                  {showLore && (
                    <div className="mt-4 text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-100 p-4 rounded-lg">
                      {CANSHOU_LORE}
                    </div>
                  )}
                </div>
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

export default CanshouPage;
