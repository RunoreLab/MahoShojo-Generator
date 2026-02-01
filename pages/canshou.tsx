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
import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import { parseBulkQuestionnaireAnswers } from '@/lib/questionnaire-bulk-parser';
import { ErrorMessage } from '@/components/ErrorMessage';
import { EncyclopediaLinks } from '@/components/encyclopedia/EncyclopediaLinks';
import { GenerationModeSwitcher, type GenerationMode } from '@/components/shared/GenerationModeSwitcher';
import { TokenIndicator } from '@/components/shared/TokenIndicator';
import { ThemeImage } from '@/components/shared/ThemeImage';
import { readTextStreamFromResponse } from '@/lib/stream/read-text-stream';
import { buildGeneralCharacterCardFromMarkdown } from '@/lib/stream/markdown-card';
import { readJsonOrTextFromResponse, resolveApiErrorMessage } from '@/lib/client/apiError';
import { formatHttpErrorMessage } from '@/lib/client/httpError';
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
import { getAnswerLimitInfo, isAnswerOverLimit, QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS } from '@/lib/questionnaire-limits';

type QuestionnaireSelectionSource = 'preset' | 'upload' | 'database';

type QuestionnaireSelection = {
  source: QuestionnaireSelectionSource;
  questionnaire: QuestionnaireDefinition;
  dataCardId?: string;
  dataCardName?: string;
  dataCardAuthor?: string;
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
  const draftRestoredRef = useRef(false);
  const currentQuestionKeyRef = useRef<string | null>(null);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [showQuestionnairePicker, setShowQuestionnairePicker] = useState(false);
  const [questionnairePickerTab, setQuestionnairePickerTab] = useState<'public' | 'private'>('public');
  const [questionnaireSearch, setQuestionnaireSearch] = useState('');
  const [questionnaireLoading, setQuestionnaireLoading] = useState(false);
  const [questionnairePickerError, setQuestionnairePickerError] = useState<string | null>(null);
  const [publicQuestionnaireCards, setPublicQuestionnaireCards] = useState<any[]>([]);
  const [privateQuestionnaireCards, setPrivateQuestionnaireCards] = useState<any[]>([]);
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
  const recommendedImageMode: ImageSaveMode = deviceType === 'mobile' ? 'modal' : 'download';
  const recommendedJsonMode: JsonSaveMode = deviceType === 'mobile' ? 'text' : 'download';
  const preferenceButtonClass = (active: boolean) => `flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${active ? 'border-rose-500 bg-rose-50 text-rose-700 shadow-sm' : 'border-slate-200 text-slate-600 hover:border-rose-300 hover:text-rose-600'}`;

  const questionnaireItems = useMemo<QuestionnaireContextItem[]>(() => {
    return selectedQuestionnaires.flatMap((selection) =>
      selection.questionnaire.questions.map((question, index) => ({
        key: buildQuestionKey(selection.questionnaire.id, question.id, index),
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
        const restored = parsed.questionnaireSelections
          .map((raw: any) => {
            if (!raw || typeof raw !== 'object') return null;
            const source: QuestionnaireSelectionSource =
              raw.source === 'upload' || raw.source === 'database' || raw.source === 'preset'
                ? raw.source
                : 'preset';
            const normalized = normalizeQuestionnaireDefinition(raw.questionnaire, {
              fallbackKind: 'canshou',
              fallbackId: typeof raw.questionnaire?.id === 'string' ? raw.questionnaire.id : 'canshou-custom',
              fallbackTitle: typeof raw.questionnaire?.title === 'string' ? raw.questionnaire.title : '未命名问卷',
              applyMagicalMeta: false,
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
            } satisfies QuestionnaireSelection;
          })
          .filter(Boolean) as QuestionnaireSelection[];
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
  }, []);

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
        const normalized = normalizeQuestionnaireDefinition(data, {
          fallbackId: defaultPreset.id,
          fallbackKind: defaultPreset.kind,
          fallbackTitle: defaultPreset.title,
          applyMagicalMeta: false,
          nativeAllowed: true,
        });
        if (!normalized) throw new Error('预设问卷解析失败');
        if (cancelled) return;
        setSelectedQuestionnaires([{ source: 'preset', questionnaire: normalized }]);
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
  }, [presetEntries, selectedQuestionnaires.length, selectionReady]);

  useEffect(() => {
    if (selectionReady) setLoading(false);
  }, [selectionReady]);

  const applySelection = (selection: QuestionnaireSelection) => {
    setSelectedQuestionnaires((prev) => {
      if (allowMultipleQuestionnaires) {
        return [...prev, selection];
      }
      return [selection];
    });
    setShowIntroduction(false);
    setShowQuestionnaireSettings(false);
  };

  const handleRemoveSelection = (index: number) => {
    setSelectedQuestionnaires((prev) => prev.filter((_, i) => i !== index));
  };

  const fetchQuestionnaireCardList = useCallback(async (tab: 'public' | 'private', search: string) => {
    const query = search.trim();
    setQuestionnaireLoading(true);
    setQuestionnairePickerError(null);
    try {
      if (tab === 'public') {
        const params = new URLSearchParams({ type: 'questionnaire', limit: '30' });
        if (query) params.set('search', query);
        const res = await fetch(`/api/public-data-cards?${params.toString()}`);
        const json = await res.json();
        if (!res.ok || !json?.success) throw new Error(json?.error || '加载公开问卷失败');
        setPublicQuestionnaireCards(Array.isArray(json.cards) ? json.cards : []);
      } else {
        const { authStorage } = await import('@/lib/auth');
        const authHeader = await authStorage.getAuthHeader();
        if (!authHeader) {
          setPrivateQuestionnaireCards([]);
          setQuestionnairePickerError('请先登录以查看私有问卷');
          return;
        }
        const url = new URL('/api/data-cards', window.location.origin);
        const res = await fetch(url.toString(), {
          headers: { Authorization: authHeader },
        });
        const json = await res.json();
        if (!res.ok || !json?.success) throw new Error(json?.error || '加载私有问卷失败');
        const list = Array.isArray(json.cards) ? json.cards : [];
        const filtered = list.filter((card: any) => card?.type === 'questionnaire');
        const searched = query
          ? filtered.filter((card: any) => {
              const text = `${card?.name || ''} ${card?.description || ''}`.toLowerCase();
              return text.includes(query.toLowerCase());
            })
          : filtered;
        setPrivateQuestionnaireCards(searched);
      }
    } catch (err) {
      setQuestionnairePickerError(err instanceof Error ? err.message : '加载问卷失败');
    } finally {
      setQuestionnaireLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!showQuestionnairePicker) return;
    void fetchQuestionnaireCardList(questionnairePickerTab, questionnaireSearch);
  }, [showQuestionnairePicker, questionnairePickerTab, questionnaireSearch, fetchQuestionnaireCardList]);

  const handleSelectQuestionnaireCard = async (card: any) => {
    try {
      const rawData = typeof card?.data === 'string' ? JSON.parse(card.data) : card?.data;
      const normalized = normalizeQuestionnaireDefinition(rawData, {
        fallbackKind: 'canshou',
        fallbackId: typeof rawData?.id === 'string' ? rawData.id : `canshou-card-${card?.id ?? ''}`,
        fallbackTitle: typeof rawData?.title === 'string' ? rawData.title : card?.name || '未命名问卷',
        applyMagicalMeta: false,
        nativeAllowed: typeof rawData?.nativeAllowed === 'boolean' ? rawData.nativeAllowed : false,
      });
      if (!normalized) throw new Error('问卷数据卡解析失败');
      applySelection({
        source: 'database',
        questionnaire: normalized,
        dataCardId: card?.id,
        dataCardName: card?.name,
        dataCardAuthor: card?.username,
      });
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
        applyMagicalMeta: false,
        nativeAllowed: false,
      });
      if (!normalized) throw new Error('问卷文件解析失败');
      applySelection({
        source: 'upload',
        questionnaire: normalized,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : '问卷文件解析失败');
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
        applyMagicalMeta: false,
        nativeAllowed: true,
      });
      if (!normalized) throw new Error('预设问卷解析失败');
      applySelection({ source: 'preset', questionnaire: normalized });
    } catch (error) {
      setError(error instanceof Error ? error.message : '加载预设问卷失败');
    }
  };

  const getQuestionnaireCardSummary = (card: any) => {
    try {
      const rawData = typeof card?.data === 'string' ? JSON.parse(card.data) : card?.data;
      const title = typeof rawData?.title === 'string' ? rawData.title : card?.name || '未命名问卷';
      const kind = rawData?.kind === 'magical-girl' || rawData?.kind === 'canshou' ? rawData.kind : 'canshou';
      const nativeAllowed = typeof rawData?.nativeAllowed === 'boolean' ? rawData.nativeAllowed : false;
      const description = typeof rawData?.description === 'string' ? rawData.description : card?.description || '';
      return { title, kind, nativeAllowed, description };
    } catch {
      return { title: card?.name || '未命名问卷', kind: 'canshou', nativeAllowed: false, description: card?.description || '' };
    }
  };

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
    const currentKey = mergedQuestions[currentQuestionIndex]?.key;
    const { flow: nextFlow, indexByKey: nextIndexByKey } = getQuestionnaireFlow(nextAnswers);
    const currentFlowIndex = currentKey ? (nextIndexByKey.get(currentKey) ?? -1) : -1;
    const nextIndex = currentFlowIndex + 1;

    if (nextIndex >= 0 && nextIndex < nextFlow.length) {
      setIsTransitioning(true);
      setTimeout(() => {
        const nextKey = nextFlow[nextIndex]?.key ?? null;
        currentQuestionKeyRef.current = nextKey;
        setCurrentQuestionIndex(nextIndex);
        setCurrentAnswer(nextKey ? nextAnswers[nextKey] || '' : '');
        setIsTransitioning(false);
      }, 250);
      return;
    }

    handleSubmit(nextAnswers);
  };

  const handleNext = () => {
    const item = mergedQuestions[currentQuestionIndex];
    if (!item) return;
    const normalizedAnswer = currentAnswer.trim();
    const isRequired = item.question.required !== false;

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

      const endpoint = generationMode === 'stream' ? '/api/generate-canshou-stream' : '/api/generate-canshou';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        if (errorData?.shouldRedirect) {
          router.push('/arrested');
          return;
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
        const markdown = await readTextStreamFromResponse(response, {
          label: '残兽档案（流式）',
          onText: (text) => setStreamingMarkdown(text),
        });

        const { card } = buildGeneralCharacterCardFromMarkdown({
          markdown,
          defaultName: '残兽',
        });
        const cardWithAnswers = {
          ...card,
          userAnswers: finalAnswerItems,
        };
        if (!allowNativeSignatureForSubmit) {
          setStreamedGeneralCard(cardWithAnswers);
          setError(null);
          startCooldown();
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
        startCooldown();
        return;
      }

      const result: CanshouResultPayload = await response.json();
      setCanshouDetails(result);
      startCooldown();
    } catch (err) {
      setError(err instanceof Error ? `✨ 魔法失效了！${err.message}` : '发生未知错误');
    } finally {
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

  if (loading) {
    return (
      <div className="magic-background-dark">
        <div className="container"><div className="card text-center">加载中...</div></div>
      </div>
    );
  }

  if (resolvedQuestionItems.length === 0) {
    return (
      <div className="magic-background-dark">
        <div className="container"><div className="card text-center">加载问卷失败</div></div>
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
    label: item.questionnaireTitle ? `${item.questionnaireTitle} · ${item.question.question}` : item.question.question
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
  const isCurrentRequired = currentQuestion?.required !== false;
  const hasOptions = (currentQuestion?.options?.length ?? 0) > 0;
  const showTextInput = allowCustomInput || !hasOptions;
  const fallbackQuickOptions = allowCustomInput ? ['记录未知', '稍后补充'] : [];
  const nextButtonLabel = isCooldown
    ? `冷却中 (${remainingTime}s)`
    : submitting
      ? '生成中...'
      : isLastQuestion
        ? (isCurrentRequired || currentAnswer.trim() ? '生成档案' : '跳过并生成')
        : (!isCurrentRequired && !currentAnswer.trim() ? '跳过并继续' : '下一题');

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
                          <span className="text-rose-400">提示：当前问卷未获得原生许可，生成结果将不具备原生性。</span>
                        )}
                        {isQuestionnaireNativeAllowed && hasOverLimitAnswer && (
                          <span className="text-amber-300">提示：已有答案超过字数上限（原生统一上限 {QUESTIONNAIRE_NATIVE_MAX_ANSWER_CHARS} 字），生成结果将不具备原生性。</span>
                        )}
                      </div>
                      <div className="space-y-2">
                        {selectedQuestionnaires.map((selection, index) => (
                          <div key={`${selection.questionnaire.id}-${index}`} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2">
                            <div>
                              <div className="font-semibold text-emerald-200">{selection.questionnaire.title}</div>
                              <div className="text-[11px] text-slate-500">
                                来源：{selection.source === 'preset' ? '预设' : selection.source === 'upload' ? '本地上传' : '云端问卷'}
                                {selection.dataCardAuthor ? ` · 作者：${selection.dataCardAuthor}` : ''}
                                {selection.questionnaire.nativeAllowed ? ' · 原生许可' : ' · 非原生'}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={selectedQuestionnaires.length <= 1}
                              onClick={() => handleRemoveSelection(index)}
                              className={`text-xs ${selectedQuestionnaires.length <= 1 ? 'text-slate-700' : 'text-rose-400 hover:underline'}`}
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
                        <label className="text-xs">
                          <span className="mr-2">上传问卷 JSON</span>
                          <input
                            type="file"
                            accept="application/json"
                            onChange={(e) => void handleUploadQuestionnaire(e.target.files?.[0] ?? null)}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowQuestionnairePicker(true)}
                          className="rounded-lg border border-emerald-500/40 bg-slate-900 px-3 py-1 text-xs text-emerald-300 hover:border-emerald-400"
                        >
                          从云端问卷库选择
                        </button>
                        <Link href="/questionnaire-editor" className="text-xs text-emerald-300 hover:underline">
                          打开问卷编辑器
                        </Link>
                      </div>
                      {questionnaireLoadError && (
                        <p className="text-rose-400">{questionnaireLoadError}</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-4 space-y-4">
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm text-slate-200">
                      <span>问题 {currentQuestionIndex + 1} / {mergedQuestions.length}</span>
                      <span>进度 {progressPercent}%</span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-emerald-400 transition-all duration-300 ease-out"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <div className={`mt-4 min-h-[60px] flex items-center justify-center transition-opacity duration-200 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}>
                      <h3 className="text-xl font-semibold text-center text-slate-100">
                        {currentQuestion?.question || '未加载题目'}
                      </h3>
                    </div>
                    {currentQuestionnaireTitle && (
                      <p className="text-center text-xs text-slate-500">问卷来源：{currentQuestionnaireTitle}</p>
                    )}
                    <p className="text-xs text-center text-slate-400 mt-2">
                      请基于您构想的虚拟档案回答，并确保内容符合公序良俗，请勿使用任何真实信息。
                    </p>
                    {currentQuestion?.helperText && (
                      <p className="mt-2 text-sm text-slate-300 text-center">{currentQuestion.helperText}</p>
                    )}
                    {!isCurrentRequired && (
                      <p className="mt-2 text-xs text-emerald-300 text-center">本题可跳过，不作答将不会记录</p>
                    )}
                    {allowCustomInput && fallbackQuickOptions.length > 0 && (
                      <div className="mt-3 flex flex-wrap justify-center gap-3 text-xs">
                        {fallbackQuickOptions.map(option => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => handleOptionClick(option)}
                            disabled={submitting || isCooldown}
                            className="rounded-full border border-slate-600 bg-slate-900 px-4 py-1.5 font-medium text-emerald-300 transition-colors hover:border-emerald-400 hover:text-emerald-200"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {hasOptions && (
                    <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 shadow-sm">
                      <p className="text-xs text-slate-400 mb-3">推荐选项（点击后将自动进入下一题，可在下方补充）</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {currentQuestion?.options?.map((option, index) => {
                          const value = typeof option === 'string' ? option : option.value;
                          const label = typeof option === 'string' ? option : option.label;
                          const disabled = typeof option !== 'string' && option.disabled;
                          return (
                            <button
                              key={`${value}-${index}`}
                              onClick={() => !disabled && handleOptionClick(value)}
                              disabled={disabled}
                              className={`rounded-lg border text-sm px-3 py-2 transition-colors text-left ${disabled
                                ? 'border-slate-700 bg-slate-800 text-slate-500 cursor-not-allowed'
                                : 'border-slate-600 bg-slate-800 text-slate-100 hover:border-emerald-400 hover:text-emerald-200'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {showTextInput && (
                  <div className="input-group mt-4">
                    <textarea
                      value={currentAnswer}
                      onChange={(e) => handleCurrentAnswerChange(e.target.value)}
                      placeholder={currentQuestion?.placeholder || '请在此输入你的想法...'}
                      className="input-field resize-y min-h-[6rem]"
                    />
                    <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                      <span>有效字数：{currentAnswerLength}/{currentMaxLength ?? '不限'}</span>
                      {currentLimitInfo.source !== 'none' && currentMaxLength ? (
                        <span className="text-[11px] text-gray-400">{currentLimitLabel}</span>
                      ) : null}
                    </div>
                    {isCurrentOverLimit && (
                      <div className="mt-1 text-right text-xs text-amber-300">
                        ⚠️ 已超过{currentLimitLabel}，继续提交将导致生成内容丧失原生性。
                      </div>
                    )}
                  </div>
                )}
                {!showTextInput && (
                  <div className="mt-3 text-center text-xs text-slate-500">本题仅可从选项中选择，无需填写文本。</div>
                )}
                <div className="mt-4 flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={handlePreviousQuestion}
                    disabled={currentQuestionIndex === 0 || submitting || isCooldown}
                    className="generate-button sm:w-1/4"
                  >
                    返回上题
                  </button>
                  <button
                    onClick={handleNext}
                    disabled={submitting || isCooldown || (isCurrentRequired && !currentAnswer.trim())}
                    className="generate-button flex-1"
                  >
                    {nextButtonLabel}
                  </button>
                </div>

                <TokenIndicator
                  text={tokenEstimateText}
                  warningText="⚠️ 预计问卷回答较长，可能更易超时/失败。可尝试精简答案或减少问卷数量。"
                />

                {generationMode === 'stream' && streamedGeneralCardForDisplay && (
                  <div className="my-6">
                    <GeneralCharacterCard general={streamedGeneralCardForDisplay} isStreaming={submitting} />
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

      {showQuestionnairePicker && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 px-4 py-6">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 p-4 text-slate-200 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-700 pb-2">
              <h3 className="text-base font-semibold text-emerald-200">选择云端问卷</h3>
              <button
                type="button"
                onClick={() => setShowQuestionnairePicker(false)}
                className="text-lg text-slate-400 hover:text-slate-200"
              >
                ×
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setQuestionnairePickerTab('public')}
                className={`rounded-full px-3 py-1 ${questionnairePickerTab === 'public' ? 'bg-emerald-700/40 text-emerald-200' : 'bg-slate-800 text-slate-400'}`}
              >
                公开问卷
              </button>
              <button
                type="button"
                onClick={() => setQuestionnairePickerTab('private')}
                className={`rounded-full px-3 py-1 ${questionnairePickerTab === 'private' ? 'bg-emerald-700/40 text-emerald-200' : 'bg-slate-800 text-slate-400'}`}
              >
                私有问卷
              </button>
              <input
                value={questionnaireSearch}
                onChange={(e) => setQuestionnaireSearch(e.target.value)}
                placeholder="搜索问卷名称/描述"
                className="input-field flex-1 text-xs"
              />
              <button
                type="button"
                onClick={() => void fetchQuestionnaireCardList(questionnairePickerTab, questionnaireSearch)}
                className="rounded-lg border border-emerald-500/40 px-3 py-1 text-emerald-200"
              >
                刷新
              </button>
            </div>
            {questionnairePickerError && (
              <p className="mt-3 text-xs text-rose-400">{questionnairePickerError}</p>
            )}
            <div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto pr-2 text-xs">
              {questionnaireLoading ? (
                <div className="text-center text-slate-400">加载中...</div>
              ) : (
                (questionnairePickerTab === 'public' ? publicQuestionnaireCards : privateQuestionnaireCards).map((card: any) => {
                  const summary = getQuestionnaireCardSummary(card);
                  return (
                    <button
                      type="button"
                      key={card?.id}
                      onClick={() => void handleSelectQuestionnaireCard(card)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-left hover:border-emerald-400 hover:bg-slate-800"
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-slate-100">{summary.title}</div>
                        <span className="text-[11px] text-slate-400">
                          {summary.kind === 'magical-girl' ? '魔法少女' : '残兽'}
                          {summary.nativeAllowed ? ' · 原生许可' : ' · 非原生'}
                        </span>
                      </div>
                      {summary.description && (
                        <div className="mt-1 text-[11px] text-slate-400">{summary.description}</div>
                      )}
                      <div className="mt-1 text-[11px] text-slate-500">作者：{card?.username || '未知'}</div>
                    </button>
                  );
                })
              )}
              {!questionnaireLoading && (questionnairePickerTab === 'public' ? publicQuestionnaireCards : privateQuestionnaireCards).length === 0 && (
                <div className="text-center text-slate-500">暂无可用问卷</div>
              )}
            </div>
          </div>
        </div>
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
