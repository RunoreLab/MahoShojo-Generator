// pages/details.tsx

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import MagicalGirlCard from '../components/MagicalGirlCard';
import GeneralCharacterCard from '../components/GeneralCharacterCard';
import { useCooldown } from '../lib/cooldown';
import { quickCheck } from '@/lib/sensitive-word-filter';
import Link from 'next/link';
import TachieGenerator from '../components/TachieGenerator';
import { generateRandomMagicalGirl } from '../lib/random-character-generator';
import SaveToCloudButton from '../components/SaveToCloudButton';
import Footer from '../components/Footer';
import QuestionNavigator from '../components/QuestionNavigator';
import BattleDataModal from '@/components/BattleDataModal';
import {
  buildQuestionKey,
  buildQuestionnaireFlow,
  formatQuestionnaireAnswers,
  normalizeQuestionnaireDefinition,
  normalizeUserAnswers,
  resolveQuestionnaireReferences,
  type QuestionnaireAnswerItem,
  type QuestionnaireDefinition,
  type QuestionnairePresetEntry,
  type QuestionnaireQuestion,
} from '@/lib/questionnaires';
import { persistArrestedBackup, type ArrestedBackupDraftItem, type ArrestedBackupTriggerSource } from '@/lib/arrested-backup';
import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import { parseBulkQuestionnaireAnswers } from '@/lib/questionnaire-bulk-parser';
import { ErrorMessage } from '@/components/ErrorMessage';
import { EncyclopediaLinks } from '@/components/encyclopedia/EncyclopediaLinks';
import { GenerationModeSwitcher, type GenerationMode } from '@/components/shared/GenerationModeSwitcher';
import { TokenIndicator } from '@/components/shared/TokenIndicator';
import { readTextStreamFromResponse } from '@/lib/stream/read-text-stream';
import { buildGeneralCharacterCardFromMarkdown } from '@/lib/stream/markdown-card';
import { readJsonOrTextFromResponse, resolveApiErrorMessage } from '@/lib/client/apiError';
import { formatHttpErrorMessage } from '@/lib/client/httpError';
import { getAnswerLimitInfo, isAnswerOverLimit, QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS } from '@/lib/questionnaire-limits';
import {
  DETAILS_QUESTIONNAIRE_THEME,
  QuestionnaireQuestionPanel,
} from '@/components/questionnaire/QuestionnaireQuestionPanel';

type QuestionnaireSelectionSource = 'preset' | 'upload' | 'database';

type QuestionnaireSelection = {
  source: QuestionnaireSelectionSource;
  questionnaire: QuestionnaireDefinition;
  dataCardId?: string;
  dataCardName?: string;
  dataCardAuthor?: string;
  selectionId?: string;
};

type QuestionnaireContextItem = {
  key: string;
  questionnaireId: string;
  questionnaireTitle: string;
  indexInQuestionnaire: number;
  question: QuestionnaireQuestion;
};

type JsonSaveMode = 'download' | 'text';
type ImageSaveMode = 'download' | 'modal';
type DeviceType = 'mobile' | 'desktop' | 'unknown';

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
interface SaveJsonButtonProps {
  data: MagicalGirlDetails;
  mode: JsonSaveMode;
  recommendedMode: JsonSaveMode;
}

const SaveJsonButton: React.FC<SaveJsonButtonProps> = ({ data, mode, recommendedMode }) => {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const jsonPayload = useMemo(() => JSON.stringify(data, null, 2), [data]);

  const downloadJson = () => {
    const blob = new Blob([jsonPayload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const sanitizedCodename = data.codename?.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_') || 'data';
    link.download = `魔法少女_${sanitizedCodename}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setCopyStatus('idle');
  };

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard) {
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
    ? '✅ JSON 已复制到剪贴板'
    : copyStatus === 'error'
      ? '⚠️ 复制失败，请手动长按选择'
      : recommendedMode === 'text'
        ? '建议复制后在本地粘贴到新文件中'
        : '若无法下载，可改用复制模式';

  if (mode === 'download') {
    return (
      <div className="flex-1 min-w-[260px] text-left">
        <p className="text-xs text-gray-500 mb-2 text-center">
          {recommendedMode === 'download'
            ? '推荐：直接下载 JSON 文件，适合桌面端或支持下载的浏览器'
            : '实验功能：部分移动端浏览器也支持直接下载，如失败请切换到复制模式'}
        </p>
        <button onClick={downloadJson} className="generate-button w-full">
          {recommendedMode === 'download' ? '💾 下载设定文件' : '🧪 尝试直接下载 JSON'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-[260px] text-left">
      <div className="mb-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
        <p className="font-semibold mb-1">复制模式</p>
        <p>复制下方全部内容，并将其粘贴到文本文件中保存为 <code className="bg-yellow-100 px-1 rounded">.json</code>。</p>
        <p className="mt-1">也可粘贴到竞技场的文本输入框继续使用。</p>
      </div>
      <div className="flex items-center justify-between mb-2 gap-2">
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

const LOCAL_STORAGE_KEY = 'magicalGirlAnswersDraft'; // 定义本地存储的键
const DETAILS_PREFERENCE_KEY = 'mahoshojo.details.preferences.v1';

const DetailsPage: React.FC = () => {
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
  const generatorCooldownMs = isUserCustomKey ? 3000 : 60000;
  const generatorCooldownKey = isUserCustomKey ? 'generateDetailsCooldown:custom' : 'generateDetailsCooldown:system';
  const { isCooldown, startCooldown, remainingTime } = useCooldown(generatorCooldownKey, generatorCooldownMs);
  const [bulkAnswers, setBulkAnswers] = useState(''); // 用于"一键填充"的textarea
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

  // 多语言支持
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('zh-CN');
  const recommendedImageMode: ImageSaveMode = deviceType === 'mobile' ? 'modal' : 'download';
  const recommendedJsonMode: JsonSaveMode = deviceType === 'mobile' ? 'text' : 'download';
  const preferenceButtonClass = (active: boolean) => `flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${active ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm' : 'border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600'}`;
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
      selection.questionnaire.questions.map((question, index) => ({
        key: buildQuestionKey(selection.selectionId ?? selection.questionnaire.id, question.id, index),
        questionnaireId: selection.questionnaire.id,
        questionnaireTitle: selection.questionnaire.title,
        indexInQuestionnaire: index,
        question,
      }))
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
    return selectedQuestionnaires.every((selection) => selection.questionnaire.nativeAllowed === true);
  }, [selectedQuestionnaires]);

  const tokenEstimateText = useMemo(() => formatQuestionnaireAnswers(answerItems), [answerItems]);

  const shouldDisableRemove = selectedQuestionnaires.length <= 1;
  const shouldApplyMagicalMeta = (questionnaireId?: string) => questionnaireId === 'magical-girl-default';

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

  useEffect(() => {
    fetch('/languages.json')
      .then(res => res.json())
      .then(data => setLanguages(data))
      .catch(err => console.error("Failed to load languages:", err));
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const userAgent = navigator.userAgent.toLowerCase();
    const isMobileDevice = /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(userAgent);
    const detectedType: DeviceType = isMobileDevice ? 'mobile' : 'desktop';
    setDeviceType(detectedType);
    const defaultImageMode: ImageSaveMode = isMobileDevice ? 'modal' : 'download';
    const defaultJsonMode: JsonSaveMode = isMobileDevice ? 'text' : 'download';

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
        const restored = parsed.questionnaireSelections
          .map((raw: any) => {
            if (!raw || typeof raw !== 'object') return null;
            const source: QuestionnaireSelectionSource =
              raw.source === 'upload' || raw.source === 'database' || raw.source === 'preset'
                ? raw.source
                : 'preset';
            const presetQuestionnaireId = typeof raw.questionnaire?.id === 'string' ? raw.questionnaire.id : undefined;
            const normalized = normalizeQuestionnaireDefinition(raw.questionnaire, {
              fallbackKind: 'magical-girl',
              fallbackId: typeof raw.questionnaire?.id === 'string' ? raw.questionnaire.id : 'magical-girl-custom',
              fallbackTitle: typeof raw.questionnaire?.title === 'string' ? raw.questionnaire.title : '未命名问卷',
              applyMagicalMeta: source === 'preset' && shouldApplyMagicalMeta(presetQuestionnaireId),
              nativeAllowed: source === 'preset' ? true : false,
            });
            if (!normalized) return null;
            if (source === 'preset') normalized.nativeAllowed = true;
            if (source === 'upload') normalized.nativeAllowed = false;
            if (source === 'database' && normalized.nativeAllowed == null) normalized.nativeAllowed = false;
            return {
              source,
              questionnaire: normalized,
              dataCardId: typeof raw.dataCardId === 'string' ? raw.dataCardId : undefined,
              dataCardName: typeof raw.dataCardName === 'string' ? raw.dataCardName : undefined,
              dataCardAuthor: typeof raw.dataCardAuthor === 'string' ? raw.dataCardAuthor : undefined,
              selectionId: typeof raw.selectionId === 'string' ? raw.selectionId : undefined,
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
    if (!allowMultipleQuestionnaires && selectedQuestionnaires.length > 1) {
      setSelectedQuestionnaires([selectedQuestionnaires[0]]);
      setCurrentQuestionIndex(0);
    }
  }, [allowMultipleQuestionnaires, selectedQuestionnaires]);

  useEffect(() => {
    if (mergedQuestions.length === 0) {
      currentQuestionKeyRef.current = null;
      return;
    }
    const previousKey = currentQuestionKeyRef.current;
    if (!previousKey) {
      if (currentQuestionIndex !== 0) setCurrentQuestionIndex(0);
      return;
    }
    const nextIndex = mergedQuestionIndexByKey.get(previousKey);
    if (typeof nextIndex === 'number' && nextIndex !== currentQuestionIndex) {
      setCurrentQuestionIndex(nextIndex);
      return;
    }
    if (nextIndex === undefined && currentQuestionIndex !== 0) {
      setCurrentQuestionIndex(0);
    }
  }, [mergedQuestions, mergedQuestionIndexByKey, currentQuestionIndex]);

  useEffect(() => {
    currentQuestionKeyRef.current = mergedQuestions[currentQuestionIndex]?.key ?? null;
  }, [mergedQuestions, currentQuestionIndex]);

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
      const defaultPreset = presetEntries.find((item) => item.isDefault) ?? presetEntries[0];
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
          applyMagicalMeta: shouldApplyMagicalMeta(defaultPreset.id),
          nativeAllowed: true,
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
      return [normalizedSelection];
    });
    setPasteQuestionnaireError(null);
    setPasteQuestionnaireText('');
    setShowPasteImport(false);
    setShowIntroduction(false);
    setShowQuestionnaireSettings(false);
  };

  const handleRemoveSelection = (index: number) => {
    clearTransitionTimers();
    setIsTransitioning(false);
    setSelectedQuestionnaires((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSelectQuestionnaireCard = (card: any) => {
    try {
      const rawPayload = card?.data ?? card?.dataJson ?? card?.data_json ?? card?.dataJSON ?? null;
      let rawData: any = null;
      if (rawPayload !== null && rawPayload !== undefined) {
        rawData = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
      } else if (card && typeof card === 'object') {
        if (Array.isArray(card.questions)) {
          rawData = card;
        } else if (card.questionnaire && Array.isArray(card.questionnaire.questions)) {
          rawData = card.questionnaire;
        }
      }
      if (!rawData) throw new Error('问卷数据卡内容为空或格式不受支持');
      const normalized = normalizeQuestionnaireDefinition(rawData, {
        fallbackKind: 'magical-girl',
        fallbackId: typeof rawData?.id === 'string' ? rawData.id : `magical-girl-card-${card?.id ?? ''}`,
        fallbackTitle: typeof rawData?.title === 'string' ? rawData.title : card?.name || '未命名问卷',
        applyMagicalMeta: false,
        nativeAllowed: typeof rawData?.nativeAllowed === 'boolean' ? rawData.nativeAllowed : false,
      });
      if (!normalized) throw new Error('问卷数据卡解析失败');
      applySelection({
        source: 'database',
        questionnaire: normalized,
        dataCardId: card?._cardId ?? card?.id,
        dataCardName: card?._cardName ?? card?.name,
        dataCardAuthor: card?._author ?? card?.username ?? card?.author,
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
        fallbackKind: 'magical-girl',
        fallbackId: typeof parsed?.id === 'string' ? parsed.id : 'magical-girl-upload',
        fallbackTitle: typeof parsed?.title === 'string' ? parsed.title : file.name.replace(/\.[^.]+$/, ''),
        applyMagicalMeta: false,
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
        fallbackKind: 'magical-girl',
        fallbackId: typeof parsed?.id === 'string' ? parsed.id : 'magical-girl-paste',
        fallbackTitle: typeof parsed?.title === 'string' ? parsed.title : '未命名问卷',
        applyMagicalMeta: false,
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
      const normalized = normalizeQuestionnaireDefinition(data, {
        fallbackId: preset.id,
        fallbackKind: preset.kind,
        fallbackTitle: preset.title,
        applyMagicalMeta: shouldApplyMagicalMeta(preset.id),
        nativeAllowed: true,
      });
      if (!normalized) throw new Error('预设问卷解析失败');
      applySelection({ source: 'preset', questionnaire: normalized });
    } catch (error) {
      setError(error instanceof Error ? error.message : '加载预设问卷失败');
    }
  };

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
              `MG-${index + 1}`,
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

  const handleNext = () => {
    const item = mergedQuestions[currentQuestionIndex];
    if (!item) return;
    const normalizedAnswer = currentAnswer.trim();
    const isRequired = item.question.required !== false;

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

    const nextAnswers = { ...answersByKey };
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
      nextAnswers[item.key] = entry.value;
      appliedCount += 1;
    });
    setAnswersByKey(nextAnswers);
    const currentKey = mergedQuestions[currentQuestionIndex]?.key;
    setCurrentAnswer(currentKey ? nextAnswers[currentKey] || '' : '');
    setError(null);
    const formatLabel = parsed.format === 'qa'
      ? 'Q/A'
      : parsed.format === 'json'
        ? 'JSON'
        : parsed.format === 'paragraphs'
          ? '段落'
          : '逐行';
    alert(`成功填充了 ${appliedCount} 个答案（识别格式：${formatLabel}${ignoredCount > 0 ? `，忽略了 ${ignoredCount} 条无效或超出范围的内容` : ''}）！`);
    setBulkAnswers('');
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

    setSubmitting(true);
    setError(null);
    setMagicalGirlDetails(null);
    setStreamingMarkdown(null);
    setStreamedGeneralCard(null);

    const safetyText = finalAnswerItems.map((item) => item.answer).join('');
    console.log('检查敏感词:', safetyText);
    if (await checkSensitiveWords(safetyText)) return;

    try {
      console.log('提交答案:', finalAnswerItems);
      const customProviderPayload = (
        userProviderConfig
        && (userProviderConfig.apiKey || userProviderConfig.providerId === 'system')
        && userProviderConfig.modelId !== 'default'
      ) ? {
        providerId: userProviderConfig.providerId,
        modelId: userProviderConfig.modelId,
        apiKey: userProviderConfig.apiKey,
      } : undefined;

      const endpoint = generationMode === 'stream'
        ? '/api/generate-magical-girl-details-stream'
        : '/api/generate-magical-girl-details';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          answers: finalAnswerItems,
          questionnaires: selectedQuestionnaires.map((selection) => ({
            id: selection.questionnaire.id,
            title: selection.questionnaire.title,
            kind: selection.questionnaire.kind,
            questions: selection.questionnaire.questions.map((question) => ({
              id: question.id,
              question: question.question,
              required: question.required !== false,
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

        // 处理不同的 HTTP 状态码
        if (errorData?.shouldRedirect) {
          // 如果API返回需要重定向的标志，则执行跳转
          router.push('/arrested');
          // 返回以停止进一步执行
          return;
        }
        else if (response.status === 429) {
          const retryAfter = errorData?.retryAfter || 60;
          throw new Error(`请求过于频繁（HTTP 429）！请等待 ${retryAfter} 秒后再试。`);
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
        const markdown = await readTextStreamFromResponse(response, {
          label: '魔法少女角色卡（流式）',
          onText: (text) => setStreamingMarkdown(text),
        });

        if (await checkSensitiveWords(markdown, {
          source: 'output',
          origin: 'details-stream',
          reason: '使用危险符文',
          backupItems: buildAnswerBackupItems(),
        })) return;

        const fallbackName = finalAnswerItems[0]?.answer ?? '';
        const { card } = buildGeneralCharacterCardFromMarkdown({
          markdown,
          fallbackName,
          defaultName: '魔法少女',
        });
        const cardWithAnswers = {
          ...card,
          userAnswers: finalAnswerItems,
        };
        if (!allowNativeSignatureForSubmit) {
          setStreamedGeneralCard(cardWithAnswers);
          setError(null);
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
        return;
      }

      const result: MagicalGirlDetails = await response.json();
      console.log('生成结果:', result);
      // 加入后置生成敏感词检测
      if (await checkSensitiveWords(JSON.stringify(result), {
        source: 'output',
        origin: 'details',
        reason: '使用危险符文',
        backupItems: buildAnswerBackupItems(),
      })) return;

      setMagicalGirlDetails(result);
      setError(null); // 成功时清除错误
    } catch (error) {
      console.error('提交失败:', error);

      // 处理不同类型的错误
      if (error instanceof Error) {
        const errorMessage = error.message;

        // 检查是否是 rate limit 错误
        if (errorMessage.includes('请求过于频繁')) {
          const cooldownSeconds = Math.ceil(generatorCooldownMs / 1000);
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
      setSubmitting(false);
      // 依据当前通道实时覆盖冷却时间，确保自定义 AI 时降为 3 秒
      startCooldown(generatorCooldownMs);
    }
  };

  // “一键复制”功能的函数
  const handleCopyContent = () => {
    const contentToCopy = mergedQuestions
      .map((item, index) => {
        const title = item.questionnaireTitle ? `（${item.questionnaireTitle}）` : '';
        return `Q${index + 1}${title}: ${item.question.question}\nA: ${answersByKey[item.key] || ''}`;
      })
      .join('\n\n');

    // 使用剪贴板API进行复制
    navigator.clipboard.writeText(contentToCopy).then(() => {
      alert('已填写内容已复制到剪贴板！');
    }).catch(err => {
      console.error('复制失败: ', err);
      alert('复制失败，请稍后再试。');
    });
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
    link.download = `通用魔法少女角色_${sanitizedName}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
    return (
      <div className="magic-background">
        <div className="container">
          <div className="card">
            <div className="error-message">加载问卷失败</div>
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

  const isLastQuestion = currentQuestionIndex === mergedQuestions.length - 1;
  const currentQuestionItem = mergedQuestions[currentQuestionIndex];
  const currentQuestion = currentQuestionItem?.question;
  const currentQuestionnaireTitle = currentQuestionItem?.questionnaireTitle ?? '';
  const currentLimitInfo = getAnswerLimitInfo(currentQuestion?.maxLength ?? null);
  const currentMaxLength = currentLimitInfo.limit;
  const currentAnswerLength = currentAnswer.trim().length;
  const isCurrentOverLimit = Boolean(currentMaxLength && currentAnswerLength > currentMaxLength);
  const currentLimitLabel = currentLimitInfo.source === 'question'
    ? `题目上限 ${currentMaxLength} 字`
    : currentLimitInfo.source === 'global'
      ? `原生统一上限 ${currentMaxLength} 字`
      : '不限';
  const quickSuggestions = currentQuestion?.suggestions ?? [];
  const hasOptions = (currentQuestion?.options?.length ?? 0) > 0;
  const allowCustomInput = currentQuestion?.allowCustom !== false;
  const isCurrentRequired = currentQuestion?.required !== false;
  const showTextInput = allowCustomInput || !hasOptions;
  const navigatorItems = mergedQuestions.map((item) => ({
    id: item.key,
    label: item.questionnaireTitle ? `${item.question.question} · ${item.questionnaireTitle}` : item.question.question
  }));
  const progressPercent = Math.round(((currentQuestionIndex + 1) / mergedQuestions.length) * 100);
  const fallbackQuickOptions = allowCustomInput ? ['还没想好', '不想回答'] : [];
  const suggestionPool = showTextInput ? quickSuggestions.filter(Boolean) : [];
  const nextButtonLabel = isCooldown
    ? `请等待 ${remainingTime} 秒`
    : submitting
      ? '提交中...'
      : isLastQuestion
        ? (isCurrentRequired || currentAnswer.trim() ? '提交' : '跳过并提交')
        : (!isCurrentRequired && !currentAnswer.trim() ? '跳过并继续' : '下一题');
  const optionsHintText = allowCustomInput
    ? '推荐选项（点击后自动跳转下一题，也可继续补充文本）'
    : '推荐选项（点击后自动跳转下一题，本题仅可从选项中选择）';
  const overLimitText = `⚠️ 已超过${currentLimitLabel}，继续提交将导致生成内容丧失原生性。`;
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
      <Head>
        <title>魔法少女调查问卷 ~ 奇妙妖精大调查</title>
        <meta name="description" content="回答问卷，生成您的专属魔法少女" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="magic-background">
        <div className="container">
          <div className="card">
            {/* Logo */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '1rem' }}>
              <img src="/questionnaire-logo.svg" width={250} height={160} alt="Questionnaire Logo" />
            </div>

            {showIntroduction ? (
              // 介绍部分
              <div className="text-center">
                <div className="mb-6 leading-relaxed text-gray-800"
                  style={{ lineHeight: '1.5', marginTop: '3rem', marginBottom: '4rem' }}
                >
                  你在魔法少女道路上的潜力和表现将会如何？<br />
                  <p className="mt-4 text-sm text-gray-500 italic">本测试设定来源于小说《下班，然后变成魔法少女》</p>
                </div>
                {/* 注意事项 */}
                <div className="mb-6 p-3 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 text-sm text-left rounded-r-lg">
                  <p className="font-bold">⚠️ 注意事项</p>
                  <p className="mt-1">请勿在问卷中输入任何真实的隐私信息，或任何不适宜、攻击性、不符合公序良俗的内容。所有回答将被用于生成虚拟角色，并且将会被储存在角色信息中。</p>
                </div>
                <EncyclopediaLinks
                  items={[
                    { slug: 'character-generator', text: '百科：角色生成入口说明' },
                    { slug: 'archive', text: '百科：档案馆（角色管理）' },
                  ]}
                />
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button
                    onClick={handleStartQuestionnaire}
                    className="generate-button text-lg flex-1"
                  >
                    开始回答问卷
                  </button>
                  <button
                    onClick={() => {
                      setIsGenerating(true);
                      setError(null);
                      try {
                        // 直接同步调用，移除 await
                        const data = generateRandomMagicalGirl();
                        setMagicalGirlDetails(data);
                        setShowIntroduction(false);
                      } catch (err) {
                        console.error('随机生成失败: ', err);
                        setError('随机生成失败，请稍后再试。');
                      } finally {
                        setIsGenerating(false);
                      }
                    }}
                    disabled={isGenerating}
                    className="generate-button text-lg flex-1"
                    style={{ background: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                  >
                    {isGenerating ? '生成中...' : '快速随机生成'}
                  </button>
                </div>

                {/* 返回首页链接 */}
                <div className="text-center" style={{ marginTop: '2rem' }}>
                  <button
                    onClick={() => router.push('/')}
                    className="footer-link"
                  >
                    返回首页
                  </button>
                </div>
              </div>
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

                <div className="my-4 rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 text-sm">
                  <button
                    type="button"
                    onClick={() => setShowQuestionnaireSettings(!showQuestionnaireSettings)}
                    className="flex w-full items-center justify-between font-semibold text-indigo-700"
                  >
                    <span>问卷设置</span>
                    <span>{showQuestionnaireSettings ? '▲' : '▼'}</span>
                  </button>
                  {showQuestionnaireSettings && (
                    <div className="mt-3 space-y-3 text-xs text-slate-600">
                      <p>你可以选择预设、上传或从云端问卷库挑选。若启用多问卷，将按顺序依次出题。</p>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={allowMultipleQuestionnaires}
                            onChange={(e) => setAllowMultipleQuestionnaires(e.target.checked)}
                          />
                          允许同时回答多份问卷
                        </label>
                        {!isQuestionnaireNativeAllowed && (
                          <span className="text-rose-500">提示：当前问卷未获得原生许可，生成结果将不具备原生性。</span>
                        )}
                        {isQuestionnaireNativeAllowed && hasOverLimitAnswer && (
                          <span className="text-amber-600">提示：已有答案超过字数上限（原生统一上限 {QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS} 字），生成结果将不具备原生性。</span>
                        )}
                      </div>
                      <div className="space-y-2">
                        {selectedQuestionnaires.map((selection, index) => (
                          <div key={`${selection.questionnaire.id}-${index}`} className="flex items-center justify-between rounded-lg border border-indigo-100 bg-white px-3 py-2">
                            <div>
                              <div className="font-semibold text-indigo-700">{selection.questionnaire.title}</div>
                              <div className="text-[11px] text-gray-500">
                                来源：{selection.source === 'preset' ? '预设' : selection.source === 'upload' ? '本地上传' : '云端问卷'}
                                {selection.dataCardAuthor ? ` · 作者：${selection.dataCardAuthor}` : ''}
                                {selection.questionnaire.nativeAllowed ? ' · 原生许可' : ' · 非原生'}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={shouldDisableRemove}
                              onClick={() => handleRemoveSelection(index)}
                              className={`text-xs ${shouldDisableRemove ? 'text-gray-300' : 'text-rose-500 hover:underline'}`}
                            >
                              移除
                            </button>
                          </div>
                        ))}
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
                        <label className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100 cursor-pointer">
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
                          className="rounded-lg border border-indigo-200 bg-white px-3 py-1 text-xs text-indigo-600 hover:border-indigo-400"
                        >
                          从云端问卷库选择
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPasteQuestionnaireError(null);
                            setShowPasteImport((prev) => !prev);
                          }}
                          className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100"
                        >
                          {showPasteImport ? '收起粘贴导入' : '粘贴导入 JSON'}
                        </button>
                        <Link href="/questionnaire-editor" className="text-xs text-indigo-600 hover:underline">
                          打开问卷编辑器
                        </Link>
                      </div>
                      {showPasteImport && (
                        <div className="rounded-lg border border-indigo-100 bg-white p-3 text-xs text-slate-600">
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
                              className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100"
                            >
                              解析并载入
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPasteQuestionnaireText('');
                                setPasteQuestionnaireError(null);
                              }}
                              className="text-xs text-slate-500 hover:text-slate-700"
                            >
                              清空
                            </button>
                          </div>
                          {pasteQuestionnaireError && (
                            <p className="mt-2 text-rose-500">{pasteQuestionnaireError}</p>
                          )}
                        </div>
                      )}
                      {questionnaireLoadError && (
                        <p className="text-rose-500">{questionnaireLoadError}</p>
                      )}
                    </div>
                  )}
                </div>

                <QuestionnaireQuestionPanel
                  theme={DETAILS_QUESTIONNAIRE_THEME}
                  progressLabel={`问题 ${currentQuestionIndex + 1} / ${mergedQuestions.length}`}
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
                  placeholder={currentQuestion?.placeholder ?? '请输入您的答案（建议控制在适中长度）'}
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
                  prevLabel="返回上题"
                  nextButtonContent={nextButtonContent}
                  onPrev={handlePreviousQuestion}
                  onNext={handleNext}
                  disablePrev={currentQuestionIndex === 0 || submitting || isTransitioning || isCooldown}
                  disableNext={submitting || isTransitioning || isCooldown || (isCurrentRequired && currentAnswer.trim().length === 0)}
                  prevButtonClass="generate-button w-1/4"
                  nextButtonClass="generate-button"
                />

                <TokenIndicator
                  text={tokenEstimateText}
                  warningText="⚠️ 预计问卷回答较长，可能更易超时/失败。可尝试精简答案或减少问卷数量。"
                />

                {/* 多语言支持 */}
                <div className="my-4 bg-gray-100 rounded-lg p-3">
                  <button
                    onClick={() => setShowLanguageSection(!showLanguageSection)}
                    className="flex items-center justify-between w-full text-left font-medium text-gray-700 hover:text-blue-600"
                  >
                    <span>生成语言</span>
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
                      ? '提示：选择流式生成后，将实时输出 Markdown，并生成【通用角色卡】（templateId=通用角色）。代号/名字会尝试从输出中解析，失败则回退到你填写的名字或“魔法少女”。'
                      : '提示：非流式生成会返回结构化的魔法少女数据卡（适合保存为模板/用于升华等），但需要等待生成结束一次性返回。'}
                  </div>
                </div>

                {/* 自定义 AI 供应商 */}
                <div className="my-4 bg-gray-50 rounded-lg p-3">
                  <AiProviderSelector onConfigChange={setUserProviderConfig} />
                  <p className="mt-2 text-xs text-gray-500">使用自有 API Key 可缩短冷却至 3 秒，便于批量迭代生成。</p>
                </div>

                {/* 批量回答问卷 */}
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

                <div className="my-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <button
                    onClick={() => setShowAnswerReview(!showAnswerReview)}
                    className="flex w-full items-center justify-between text-left text-sm font-semibold text-blue-700"
                  >
                    <span>答案概览</span>
                    <span>{showAnswerReview ? '▲' : '▼'}</span>
                  </button>
                  {showAnswerReview && (
                    <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1 text-sm">
                      {mergedQuestions.map((item, index) => (
                        <div key={`answer-review-${item.key}`} className="rounded-lg bg-white/90 p-3 shadow-sm">
                          <div className="text-xs font-semibold text-pink-600">Q{index + 1}</div>
                          <div className="mt-1 text-xs text-gray-500">
                            {item.questionnaireTitle ? `(${item.questionnaireTitle}) ` : ''}{item.question.question}
                          </div>
                          <div className="mt-2 text-gray-800 whitespace-pre-wrap">
                            {answersByKey[item.key] && answersByKey[item.key].trim().length > 0
                              ? answersByKey[item.key]
                              : <span className="text-gray-400">尚未填写</span>}
                          </div>
                          <div className="mt-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleNavigateToQuestion(index)}
                              className="text-xs text-pink-500 hover:underline"
                            >
                              编辑此题
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 错误信息显示 */}
                {error && (
                  <ErrorMessage message={error} />
                )}
                {isQuestionnaireNativeAllowed && hasOverLimitAnswer && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                    ⚠️ 已有 {overLimitItems.length} 条答案超过字数上限，继续提交将导致生成内容丧失原生性。
                  </div>
                )}

                {/* 复制已填写内容 */}
                <div className="text-center">
                  <button className="border-2 border-grey-900 rounded-md px-4 py-2 cursor-pointer" onClick={handleCopyContent} style={{ marginRight: '10px' }}>
                    复制已填写内容
                  </button>
                  <p className="mt-2 text-xs text-gray-500">
                    为避免生成失败丢失信息的可能，建议在提交生成前复制保存已填写信息。
                  </p>
                </div>

                {/* 返回首页链接 */}
                <div className="text-center" style={{ marginTop: '1rem' }}>
                  <button
                    onClick={() => router.push('/')}
                    className="footer-link"
                  >
                    返回首页
                  </button>
                </div>
              </>
            )}
          </div>

          {/* 流式：通用角色卡（Markdown） */}
          {generationMode === 'stream' && (streamingMarkdown !== null || streamedGeneralCard) && (
            <>
              {streamedGeneralCardForDisplay && (
                <GeneralCharacterCard
                  general={streamedGeneralCardForDisplay}
                  isStreaming={submitting}
                  onSaveImage={handleSaveImage}
                  imageSaveMode={imageSaveMode}
                  saveButtonLabel={imageSaveButtonLabel}
                />
              )}

              {streamedGeneralCard && (
                <>
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

          {/* 非流式：魔法少女详细信息结果 */}
          {generationMode === 'non-stream' && magicalGirlDetails && (
            <>
              <MagicalGirlCard
                magicalGirl={magicalGirlDetails}
                gradientStyle="linear-gradient(135deg, #9775fa 0%, #b197fc 100%)"
                onSaveImage={handleSaveImage}
                imageSaveMode={imageSaveMode}
                saveButtonLabel={imageSaveButtonLabel}
              />
              <div className="card" style={{ marginTop: '1rem' }}>
                <div className="space-y-5 text-left">
                  <div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-blue-900">设定长图保存方式</span>
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
                          <span className="ml-2 inline-flex items-center rounded-full bg-indigo-100 px-2 text-[10px] font-semibold text-indigo-600">推荐</span>
                        )}
                      </button>
                      <button
                        type="button"
                        className={preferenceButtonClass(imageSaveMode === 'modal')}
                        onClick={() => setImageSaveMode('modal')}
                      >
                        长按保存弹窗
                        {recommendedImageMode === 'modal' && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-indigo-100 px-2 text-[10px] font-semibold text-indigo-600">推荐</span>
                        )}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">若当前浏览器不支持下载，可切换为长按模式，系统会弹出预览供保存。</p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-blue-900">设定文件保存方式</span>
                      <span className="text-xs text-gray-500">推荐：{recommendedJsonMode === 'download' ? '直接下载 JSON' : '复制原始数据'}</span>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 mt-2">
                      <button
                        type="button"
                        className={preferenceButtonClass(jsonSaveMode === 'download')}
                        onClick={() => setJsonSaveMode('download')}
                      >
                        直接下载 JSON
                        {recommendedJsonMode === 'download' && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-indigo-100 px-2 text-[10px] font-semibold text-indigo-600">推荐</span>
                        )}
                      </button>
                      <button
                        type="button"
                        className={preferenceButtonClass(jsonSaveMode === 'text')}
                        onClick={() => setJsonSaveMode('text')}
                      >
                        复制原始数据
                        {recommendedJsonMode === 'text' && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-indigo-100 px-2 text-[10px] font-semibold text-indigo-600">推荐</span>
                        )}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">两种方式可随时切换，移动端也可尝试直接下载，桌面端亦能复制备用。</p>
                  </div>

                  <p className="text-xs text-gray-400 text-center">提示：偏好设置已保存到浏览器，刷新后仍会保留；切换不会丢失生成结果。</p>
                </div>
              </div>
              {/* 关键解释抽屉 点击展开 点击关闭 */}
              <div className="card" style={{ marginTop: '1rem' }}>
                <div className="text-center">
                  <button
                    onClick={() => setShowDetails(!showDetails)}
                    className="text-lg font-medium text-blue-900 hover:text-blue-700 transition-colors duration-200"
                    style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    {showDetails ? '点击收起设定说明' : '点击展开设定说明'} {showDetails ? '▼' : '▶'}
                  </button>
                  {showDetails && (
                    <div className="text-left" style={{ marginTop: '1rem' }}>
                      <div className="mb-4">
                        <h4 className="font-medium text-blue-800 mb-2">1. 魔力构装（简称魔装）</h4>
                        <p className="text-sm text-gray-700 leading-relaxed">
                          魔法少女的本相魔力所孕育的能力具现，是魔法少女能力体系的基础。一般呈现为魔法少女在现实生活中接触过，在冥冥之中与其命运关联或映射的物体，并且与魔法少女特色能力相关。例如，泡泡机形态的魔装可以使魔法少女制造魔法泡泡，而这些泡泡可以拥有产生幻象、缓冲防护、束缚困敌等能力。这部分的内容需包含魔装的名字（通常为2字词），魔装的形态，魔装的基本能力。
                        </p>
                      </div>
                      <div className="mb-4">
                        <h4 className="font-medium text-blue-800 mb-2">2. 奇境规则</h4>
                        <p className="text-sm text-gray-700 leading-relaxed">
                          魔法少女的本相灵魂所孕育的能力，是魔装能力的一体两面。奇境是魔装能力在规则层面上的升华，体现为与魔装相关的规则领域，而规则的倾向则会根据魔法少女的倾向而有不同的发展。例如，泡泡机形态的魔装升华而来的奇境规则可以是倾向于守护的&ldquo;戳破泡泡的东西将会立即无效化&rdquo;，也可以是倾向于进攻的&ldquo;沾到身上的泡泡被戳破会立即遭受伤害&rdquo;。
                        </p>
                      </div>
                      <div className="mb-4">
                        <h4 className="font-medium text-blue-800 mb-2">3. 繁开</h4>
                        <p className="text-sm text-gray-700 leading-relaxed">
                          是魔法少女魔装能力的二段进化与解放，无论是作为魔法少女的魔力衣装还是魔装的武器外形都会发生改变。需包含繁开状态魔装名（需要包含原魔装名的每个字），繁开后的进化能力，繁开后的魔装形态，繁开后的魔法少女衣装样式（在通常变身外观上的升级与改变）。
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 保存原始数据按钮 */}
              <div className="card" style={{ marginTop: '1rem' }}>
                <div className="text-center">
                  <h3 className="text-lg font-medium text-blue-900" style={{ marginBottom: '1rem' }}>保存人物设定</h3>
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
                  {/* 新增：前往竞技场的入口 */}
                  <div className="mt-2 pt-6 border-t border-gray-200">
                    <p className="text-sm text-gray-600 mb-2">
                      保存好你的设定文件了吗？
                    </p>
                    <Link href="/battle" className="footer-link text-lg text-blue-600">
                      前往竞技场，开始战斗！→
                    </Link>
                  </div>
                </div>
              </div>

              {/* 立绘生成器 */}
              <div className="card" style={{ marginTop: '1rem' }}>
                <div className="text-center">
                  <h3 className="text-lg font-medium text-blue-900" style={{ marginBottom: '1rem' }}>生成立绘</h3>
                  <TachieGenerator
                    prompt={`${JSON.stringify(magicalGirlDetails.appearance)} , Xiabanmo, 二次元, 魔法少女`}
                  />
                </div>
              </div>
            </>
          )}

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
          visibleTabs={['public', 'my']}
          titleOverride="选择云端问卷"
          onSelectCard={handleSelectQuestionnaireCard}
          externalError={questionnairePickerError}
        />

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

export default DetailsPage;
