// pages/canshou.tsx
import React, { useState, useEffect, useMemo } from 'react';
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
import { readTextStreamFromResponse } from '@/lib/stream/read-text-stream';
import { buildGeneralCharacterCardFromMarkdown } from '@/lib/stream/markdown-card';
import { MarkdownBlock } from '@/components/MarkdownBlock';

// 定义问卷和问题的类型
interface Question {
  id: string;
  question: string;
  options?: (string | { value: string; label: string; disabled?: boolean })[];
  type?: 'text';
  placeholder?: string;
  allowCustom?: boolean;
}

interface CanshouQuestionnaire {
  title: string;
  description: string;
  questions: Question[];
}

type JsonSaveMode = 'download' | 'text';
type ImageSaveMode = 'download' | 'modal';
type DeviceType = 'mobile' | 'desktop' | 'unknown';

type CanshouResultPayload = CanshouDetails & {
  templateId?: string;
  signature?: string | null;
  userAnswers?: Record<string, string>;
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

const CanshouPage: React.FC = () => {
  const router = useRouter();
  const [questionnaire, setQuestionnaire] = useState<CanshouQuestionnaire | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentAnswer, setCurrentAnswer] = useState('');
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

  const resolvedResultPayload = useMemo(() => {
    if (!canshouDetails) return null;
    const serverAnswers = canshouDetails.userAnswers && Object.keys(canshouDetails.userAnswers).length > 0
      ? canshouDetails.userAnswers
      : null;
    return {
      ...canshouDetails,
      userAnswers: serverAnswers ?? answers,
    };
  }, [canshouDetails, answers]);

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
    setImageSaveMode(isMobileDevice ? 'modal' : 'download');
    setJsonSaveMode(isMobileDevice ? 'text' : 'download');
  }, []);

  // 加载问卷文件
  useEffect(() => {
    const fetchData = async () => {
      try {
        const questionnaireRes = await fetch('/canshou_questionnaire.json');

        if (!questionnaireRes.ok) throw new Error('加载问卷文件失败');
        const questionnaireData: CanshouQuestionnaire = await questionnaireRes.json();
        setQuestionnaire(questionnaireData);

        // 初始化答案对象
        const initialAnswers = questionnaireData.questions.reduce((acc, q) => ({ ...acc, [q.id]: '' }), {});

        // 从localStorage加载存档
        const savedDraft = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (savedDraft) {
          const parsedAnswers = JSON.parse(savedDraft);
          // 合并存档和初始答案，以防问卷更新
          const mergedAnswers = { ...initialAnswers, ...parsedAnswers };
          setAnswers(mergedAnswers);
          // 关键修正：确保在currentQuestionIndex变化时，也能正确加载当前问题的答案
          if (questionnaireData.questions[currentQuestionIndex]) {
            setCurrentAnswer(mergedAnswers[questionnaireData.questions[currentQuestionIndex].id] || '');
          }
        } else {
          setAnswers(initialAnswers);
        }

      } catch (error) {
        console.error('加载页面数据失败:', error);
        setError('📋 加载问卷失败，请刷新页面重试');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [currentQuestionIndex]); // 依赖为空，只在初次加载时执行

  // 答案变化时，自动保存到 localStorage
  useEffect(() => {
    try {
      if (Object.values(answers).some(answer => answer.trim() !== '')) {
        const dataToSave = JSON.stringify(answers);
        localStorage.setItem(LOCAL_STORAGE_KEY, dataToSave);
      }
    } catch (e) {
      console.error("Failed to save answers to localStorage", e);
    }
  }, [answers]);

  useEffect(() => {
    if (!questionnaire) return;
    const question = questionnaire.questions[currentQuestionIndex];
    if (!question) return;
    setCurrentAnswer(answers[question.id] || '');
  }, [currentQuestionIndex, questionnaire, answers]);


  const proceedToNext = (answer: string) => {
    const currentQuestion = questionnaire!.questions[currentQuestionIndex];
    const newAnswers = { ...answers, [currentQuestion.id]: answer };
    setAnswers(newAnswers);

    if (currentQuestionIndex < questionnaire!.questions.length - 1) {
      setIsTransitioning(true);
      setTimeout(() => {
        const nextIndex = currentQuestionIndex + 1;
        setCurrentQuestionIndex(nextIndex);
        setCurrentAnswer(newAnswers[questionnaire!.questions[nextIndex].id] || '');
        setIsTransitioning(false);
      }, 250);
    } else {
      handleSubmit(newAnswers);
    }
  };

  const handleNext = () => {
    if (currentAnswer.trim().length === 0) {
      setError('⚠️ 请输入或选择一个答案');
      return;
    }
    if (allowCustomInput && currentMaxLength && currentAnswer.trim().length > currentMaxLength) {
      setError(`⚠️ 答案不能超过${currentMaxLength}字`);
      return;
    }
    setError(null);
    proceedToNext(currentAnswer.trim());
  };

  const handlePreviousQuestion = () => {
    if (!questionnaire || currentQuestionIndex === 0) return;

    const currentQuestion = questionnaire.questions[currentQuestionIndex];
    const trimmed = currentAnswer.trim();
    const updatedAnswers = { ...answers, [currentQuestion.id]: trimmed };
    setAnswers(updatedAnswers);

    const previousIndex = currentQuestionIndex - 1;
    const previousQuestion = questionnaire.questions[previousIndex];
    setCurrentQuestionIndex(previousIndex);
    setCurrentAnswer(updatedAnswers[previousQuestion.id] || '');
    setError(null);
  };

  const handleOptionClick = (option: string) => {
    setCurrentAnswer(option);
    setTimeout(() => proceedToNext(option), 100);
  };

  const handleNavigateToQuestion = (index: number) => {
    if (!questionnaire) return;
    if (index === currentQuestionIndex || index < 0 || index >= questionnaire.questions.length) return;

    const currentQuestion = questionnaire.questions[currentQuestionIndex];
    const updatedAnswers = { ...answers, [currentQuestion.id]: currentAnswer.trim() };
    setAnswers(updatedAnswers);

    const targetQuestion = questionnaire.questions[index];
    setCurrentQuestionIndex(index);
    setCurrentAnswer(updatedAnswers[targetQuestion.id] || '');
    setError(null);
  };

  const handleSubmit = async (finalAnswers: Record<string, string>) => {
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
          answers: finalAnswers,
          language: selectedLanguage,
          customProvider: customProviderPayload,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null as any);
        if (errorData?.shouldRedirect) {
          router.push('/arrested');
          return;
        }
        const serverMessage = errorData?.message || errorData?.error;
        throw new Error(serverMessage ? `${serverMessage}（HTTP ${response.status}）` : `生成失败（HTTP ${response.status}）`);
      }

      if (generationMode === 'stream') {
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json') || contentType.includes('+json')) {
          const errorData = await response.json().catch(() => null as any);
          const serverMessage = errorData?.message || errorData?.error;
          throw new Error(serverMessage ? `${serverMessage}（HTTP ${response.status}）` : `生成失败（HTTP ${response.status}）`);
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

        setStreamedGeneralCard(card);
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
    handleSubmit(answers);
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
      const emptyAnswers = questionnaire!.questions.reduce((acc, q) => ({ ...acc, [q.id]: '' }), {});
      setAnswers(emptyAnswers);
      setCurrentAnswer('');
      alert('存档已清空！');
    }
  };

  const handleBulkFill = () => {
    const parsed = parseBulkQuestionnaireAnswers(bulkAnswers, {
      expectedCount: questionnaire!.questions.length,
      orderedQuestionIds: questionnaire!.questions.map(question => question.id),
    });

    if (parsed.entries.length === 0) {
      setError('⚠️ 未识别到可填充的答案。支持逐行答案、Q/A 格式、编号列表，以及 JSON（数组/含 userAnswers/按问题 id）。');
      return;
    }

    const newAnswers = { ...answers };
    let appliedCount = 0;
    let ignoredCount = 0;
    parsed.entries.forEach(entry => {
      if (entry.index < 0 || entry.index >= questionnaire!.questions.length) {
        ignoredCount += 1;
        return;
      }
      const questionDef = questionnaire!.questions[entry.index];
      const questionId = questionDef.id;
      const limit = (questionDef.type === 'text' || questionDef.allowCustom) ? 240 : 180;
      newAnswers[questionId] = entry.value.slice(0, limit);
      appliedCount += 1;
    });
    setAnswers(newAnswers);
    setCurrentAnswer(newAnswers[questionnaire!.questions[currentQuestionIndex].id] || '');
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

  if (loading || !questionnaire) {
    return (
      <div className="magic-background-dark">
        <div className="container"><div className="card text-center">加载中...</div></div>
      </div>
    );
  }

  const currentQuestion = questionnaire.questions[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === questionnaire.questions.length - 1;
  const progressPercent = Math.round(((currentQuestionIndex + 1) / questionnaire.questions.length) * 100);
  const navigatorItems = questionnaire.questions.map((question, index) => ({
    id: question.id || `CS-${index + 1}`,
    label: question.question
  }));
  const allowCustomInput = currentQuestion.type === 'text' || currentQuestion.allowCustom;
  const currentMaxLength = allowCustomInput ? 240 : undefined;
  const fallbackQuickOptions = allowCustomInput ? ['记录未知', '稍后补充'] : [];

  return (
    <>
      <Head>
        <title>残兽生成器 - 间界残兽前进基地</title>
      </Head>
      <div className="magic-background-dark">
        <div className="container">
          <div className="card">
            <div className="text-center mb-4">
              <img src="/beast-logo.svg" className="w-full px-8" alt="残兽调查" />
              <p className="text-gray-600 mt-2">{questionnaire.description}</p>
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
                    const q = questionnaire.questions[index];
                    return q ? (answers[q.id]?.trim()?.length ?? 0) > 0 : false;
                  }}
                  theme="dark"
                />

                <div className="mt-4 space-y-4">
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm text-slate-200">
                      <span>问题 {currentQuestionIndex + 1} / {questionnaire.questions.length}</span>
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
                        {currentQuestion.question}
                      </h3>
                    </div>
                    <p className="text-xs text-center text-slate-400 mt-2">
                      请基于您构想的虚拟档案回答，并确保内容符合公序良俗，请勿使用任何真实信息。
                    </p>
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

                  {currentQuestion.options && (
                    <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 shadow-sm">
                      <p className="text-xs text-slate-400 mb-3">推荐选项（点击后将自动进入下一题，可在下方补充）</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {currentQuestion.options.map((option, index) => {
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

                {allowCustomInput && (
                  <div className="input-group mt-4">
                    <textarea
                      value={currentAnswer}
                      onChange={(e) => setCurrentAnswer(e.target.value)}
                      placeholder={currentQuestion.placeholder || '请在此输入你的想法...'}
                      className="input-field resize-y min-h-[6rem]"
                      maxLength={currentMaxLength || undefined}
                    />
                    {currentMaxLength ? (
                      <div className="mt-1 text-right text-xs text-gray-500">
                        {currentAnswer.length}/{currentMaxLength}
                      </div>
                    ) : null}
                  </div>
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
                    disabled={submitting || isCooldown || !currentAnswer.trim()}
                    className="generate-button flex-1"
                  >
                    {isCooldown ? `冷却中 (${remainingTime}s)` : submitting ? '生成中...' : isLastQuestion ? '生成档案' : '下一题'}
                  </button>
                </div>

                {generationMode === 'stream' && streamingMarkdown !== null && (
                  <div className="my-4 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                    <div className="text-xs text-slate-300 mb-2">流式输出预览（通用角色卡 Markdown）</div>
                    <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-3">
                      {streamingMarkdown ? (
                        <MarkdownBlock content={streamingMarkdown} variant="dark" mode="article" />
                      ) : submitting ? (
                        <div className="text-xs text-slate-400 text-center">正在启动流式生成…</div>
                      ) : (
                        <div className="text-xs text-slate-400 text-center">选择流式并生成后会在此实时输出</div>
                      )}
                    </div>
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
                      {questionnaire.questions.map((question, index) => (
                        <div key={`canshou-review-${question.id}`} className="rounded-lg border border-slate-700 bg-slate-900/80 p-3">
                          <div className="text-xs font-semibold text-emerald-300">Q{index + 1}</div>
                          <div className="mt-1 text-xs text-slate-300">{question.question}</div>
                          <div className="mt-2 text-slate-100 whitespace-pre-wrap">
                            {answers[question.id] && answers[question.id].trim().length > 0 ? answers[question.id] : <span className="text-slate-500">尚未填写</span>}
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

                <div className="mt-8 text-center">
                  <Link href="/" className="footer-link">返回首页</Link>
                </div>
              </>
            ) : (
              <>
                {generationMode === 'stream' && streamedGeneralCard ? (
                  <>
                    <div className="card" style={{ marginTop: '1rem' }}>
                      <h2 className="text-2xl font-bold text-center mb-4">通用角色卡（Markdown）</h2>
                      <div className="rounded-lg bg-gray-50 p-4 border border-gray-200">
                        <MarkdownBlock content={streamedGeneralCard.content} variant="light" mode="article" />
                      </div>
                      <p className="mt-3 text-xs text-gray-500">
                        提示：流式模式生成的是通用角色卡（Markdown），不包含结构化残兽字段；如需升华/结构化字段建议切回非流式。
                      </p>
                    </div>

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
                        <div style={{ marginTop: '0.5rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' }}>
                          <p className="text-sm text-gray-600 mb-2">保存好你的档案了吗？</p>
                          <Link href="/battle" className="footer-link" style={{ color: '#c026d3', fontSize: '1.125rem' }}>
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

                        <p className="text-xs text-gray-400 text-center">提示：偏好设置仅在当前页面有效，切换不会触发重新生成。</p>
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
                        <div style={{ marginTop: '0.5rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' }}>
                          <p className="text-sm text-gray-600 mb-2">
                            保存好你的档案了吗？
                          </p>
                          <Link href="/battle" className="footer-link" style={{ color: '#c026d3', fontSize: '1.125rem' }}>
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
