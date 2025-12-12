// pages/details.tsx

import React, { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import MagicalGirlCard from '../components/MagicalGirlCard';
import { useCooldown } from '../lib/cooldown';
import { quickCheck } from '@/lib/sensitive-word-filter';
import Link from 'next/link';
import TachieGenerator from '../components/TachieGenerator';
import { generateRandomMagicalGirl } from '../lib/random-character-generator';
import SaveToCloudButton from '../components/SaveToCloudButton';
import Footer from '../components/Footer';
import QuestionNavigator from '../components/QuestionNavigator';
import { buildMagicalQuestionMeta, type MagicalQuestionMeta } from '@/lib/questionnaires';
import { persistArrestedBackup, type ArrestedBackupDraftItem, type ArrestedBackupTriggerSource } from '@/lib/arrested-backup';
import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';

interface Questionnaire {
  questions: string[];
}

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
  userAnswers?: string[];
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

const DetailsPage: React.FC = () => {
  const router = useRouter();
  const [questions, setQuestions] = useState<string[]>([]);
  const [questionMeta, setQuestionMeta] = useState<MagicalQuestionMeta[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [currentAnswer, setCurrentAnswer] = useState('');
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

  // 多语言支持
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('zh-CN');
  const recommendedImageMode: ImageSaveMode = deviceType === 'mobile' ? 'modal' : 'download';
  const recommendedJsonMode: JsonSaveMode = deviceType === 'mobile' ? 'text' : 'download';
  const preferenceButtonClass = (active: boolean) => `flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${active ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm' : 'border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600'}`;

  const resolvedResultPayload = useMemo(() => {
    if (!magicalGirlDetails) return null;
    const serverAnswers = Array.isArray(magicalGirlDetails.userAnswers) && magicalGirlDetails.userAnswers.length > 0
      ? magicalGirlDetails.userAnswers
      : null;
    return {
      ...magicalGirlDetails,
      userAnswers: serverAnswers ?? answers,
    };
  }, [magicalGirlDetails, answers]);

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

  useEffect(() => {
    // 加载问卷数据
    fetch('/questionnaire.json')
      .then(response => {
        if (!response.ok) {
          throw new Error('加载问卷文件失败');
        }
        return response.json();
      })
      .then((data: Questionnaire) => {
        setQuestions(data.questions);
        const metadata = buildMagicalQuestionMeta(data.questions.length);
        setQuestionMeta(metadata);
        const emptyAnswers = new Array(data.questions.length).fill('');

        // 尝试从 localStorage 读取存档
        try {
          const savedDraft = localStorage.getItem(LOCAL_STORAGE_KEY);
          if (savedDraft) {
            const parsedAnswers = JSON.parse(savedDraft);
            if (Array.isArray(parsedAnswers) && parsedAnswers.length === data.questions.length) {
              setAnswers(parsedAnswers);
              setCurrentAnswer(parsedAnswers[0] || ''); // 直接设置第一个问题的答案
              setAutoSaveTimestamp(Date.now());
              return; // 读取成功，提前返回
            } else if (parsedAnswers && typeof parsedAnswers === 'object') {
              // 兼容新版结构
              const restored = data.questions.map((_, index) => parsedAnswers[`MG-${index + 1}`] || parsedAnswers[index] || '');
              setAnswers(restored);
              setCurrentAnswer(restored[0] || '');
              setAutoSaveTimestamp(Date.now());
              return;
            }
          }
        } catch (e) {
          console.error("Failed to load answers from localStorage", e);
        }

        // 如果没有有效存档，则设置空答案
        setAnswers(emptyAnswers);
        setCurrentAnswer('');
      })
      .catch(error => {
        console.error('加载问卷失败:', error);
        setError('📋 加载问卷失败，请刷新页面重试');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []); // 这个 Hook 只在组件首次挂载时运行一次

  // 答案变化时，自动保存到 localStorage (这个 useEffect 保持不变)
  useEffect(() => {
    try {
      if (answers.some(answer => answer.trim() !== '')) {
        const dataToSave = JSON.stringify(answers);
        localStorage.setItem(LOCAL_STORAGE_KEY, dataToSave);
        setAutoSaveTimestamp(Date.now());
      }
    } catch (e) {
      console.error("Failed to save answers to localStorage", e);
    }
  }, [answers]);

  useEffect(() => {
    setCurrentAnswer(answers[currentQuestionIndex] || '');
  }, [currentQuestionIndex, answers]);

  const handleNext = () => {
    const meta = questionMeta[currentQuestionIndex];
    const normalizedAnswer = currentAnswer.trim();

    if (normalizedAnswer.length === 0) {
      setError('⚠️ 请输入答案后再继续');
      return;
    }

    const maxLength = Math.max(meta?.maxLength ?? 200, 150);
    if (normalizedAnswer.length > maxLength) {
      setError(`⚠️ 答案不能超过${maxLength}字`);
      return;
    }

    setError(null); // 清除错误信息

    proceedToNextQuestion(normalizedAnswer);
  };

  // “返回上题”功能的函数
  const handlePreviousQuestion = () => {
    if (currentQuestionIndex === 0) return;

    const updatedAnswers = [...answers];
    updatedAnswers[currentQuestionIndex] = currentAnswer.trim();
    setAnswers(updatedAnswers);

    const prevIndex = currentQuestionIndex - 1;
    setCurrentQuestionIndex(prevIndex);
    setCurrentAnswer(updatedAnswers[prevIndex] || '');
    setError(null);
  };

  const handleQuickOption = (option: string) => {
    setCurrentAnswer(option);
    setError(null);
    proceedToNextQuestion(option);
  };

  const handleNavigateToQuestion = (index: number) => {
    if (index === currentQuestionIndex || index < 0 || index >= questions.length) return;

    const updatedAnswers = [...answers];
    updatedAnswers[currentQuestionIndex] = currentAnswer.trim();
    setAnswers(updatedAnswers);
    setCurrentQuestionIndex(index);
    setCurrentAnswer(updatedAnswers[index] || '');
    setError(null);
  };

  const handleSuggestionFill = (value: string) => {
    setCurrentAnswer(value);
    setError(null);
  };

  const proceedToNextQuestion = (answer: string) => {
    // 保存当前答案
    const newAnswers = [...answers];
    newAnswers[currentQuestionIndex] = answer;
    setAnswers(newAnswers);

    if (currentQuestionIndex < questions.length - 1) {
      // 开始渐变动画
      setIsTransitioning(true);

      // 延迟切换题目，让淡出动画完成
      setTimeout(() => {
        setCurrentQuestionIndex(currentQuestionIndex + 1);
        setCurrentAnswer(newAnswers[currentQuestionIndex + 1] || '');

        // 短暂延迟后开始淡入动画
        setTimeout(() => {
          setIsTransitioning(false);
        }, 50);
      }, 250);
    } else {
      // 提交
      handleSubmit(newAnswers);
    }
  };

  const redirectToArrested = (reason?: string, withBackup?: boolean) => {
    const query: Record<string, string> = {};
    if (reason) query.reason = reason;
    if (withBackup) query.backup = '1';
    if (Object.keys(query).length > 0) {
      router.push({ pathname: '/arrested', query });
    } else {
      router.push('/arrested');
    }
  };

  const buildAnswerBackupItems = (): ArrestedBackupDraftItem[] => {
    if (!answers.length) return [];
    return [
      {
        id: 'questionnaire-answers',
        label: '魔法少女问卷答案',
        filename: 'magical-girl-answers.json',
        content: {
          answers,
          language: selectedLanguage,
          questionCount: questions.length,
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
      const emptyAnswers = new Array(questions.length).fill('');
      setAnswers(emptyAnswers);
      setCurrentAnswer('');
      setAutoSaveTimestamp(null);
      alert('存档已清空！');
    }
  };

  const handleBulkFill = () => {
    const lines = bulkAnswers.split('\n');
    if (lines.length > questions.length) {
      setError(`⚠️ 粘贴的答案有 ${lines.length} 行，超过了问卷问题总数 ${questions.length}！`);
      return;
    }
    const newAnswers = [...answers];
    lines.forEach((line, index) => {
      if (index < questions.length) {
        const maxLength = Math.max(questionMeta[index]?.maxLength ?? 200, 150);
        newAnswers[index] = line.slice(0, maxLength);
      }
    });
    setAnswers(newAnswers);
    setCurrentAnswer(newAnswers[currentQuestionIndex] || '');
    setError(null);
    alert(`成功填充了 ${lines.length} 个答案！`);
    setBulkAnswers('');
  };

  const handleSubmit = async (finalAnswers: string[]) => {
    if (isCooldown) {
      setError(`请等待 ${remainingTime} 秒后再生成`);
      return;
    }
    if (userProviderConfig && userProviderConfig.providerId !== 'system' && !userProviderConfig.apiKey?.trim()) {
      setError('⚠️ 已选择自定义 AI 供应商，但尚未填写 API Key。');
      return;
    }
    setSubmitting(true);
    setError(null); // 清除之前的错误
    // 检查
    console.log('检查敏感词:', finalAnswers.join(''));
    if (await checkSensitiveWords(finalAnswers.join(''))) return;

    try {
      console.log('提交答案:', finalAnswers);
      const customProviderPayload = (
        userProviderConfig
        && (userProviderConfig.apiKey || userProviderConfig.providerId === 'system')
        && userProviderConfig.modelId !== 'default'
      ) ? {
        providerId: userProviderConfig.providerId,
        modelId: userProviderConfig.modelId,
        apiKey: userProviderConfig.apiKey,
      } : undefined;

      const response = await fetch('/api/generate-magical-girl-details', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          answers: finalAnswers,
          language: selectedLanguage,
          customProvider: customProviderPayload,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: '无法解析的服务器错误' }));

        // 处理不同的 HTTP 状态码
        if (errorData.shouldRedirect) {
          // 如果API返回需要重定向的标志，则执行跳转
          router.push('/arrested');
          // 返回以停止进一步执行
          return;
        }
        else if (response.status === 429) {
          const retryAfter = errorData.retryAfter || 60;
          throw new Error(`请求过于频繁！请等待 ${retryAfter} 秒后再试。`);
        } else if (response.status >= 500) {
          throw new Error('服务器内部错误，当前可能正忙，请稍后重试');
        } else {
          throw new Error(errorData.message || errorData.error || '生成失败');
        }
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
          setError('🚫 请求太频繁了！每2分钟只能生成一次哦~请稍后再试吧！');
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
      startCooldown();
    }
  };

  // “一键复制”功能的函数
  const handleCopyContent = () => {
    const contentToCopy = questions
      .map((question, index) => `Q${index + 1}: ${question}\nA: ${answers[index] || ''}`)
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

  if (questions.length === 0) {
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

  const isLastQuestion = currentQuestionIndex === questions.length - 1;
  const currentQuestion = questions[currentQuestionIndex];
  const currentMeta = questionMeta[currentQuestionIndex];
  const currentMaxLength = Math.max(currentMeta?.maxLength ?? 200, 150);
  const quickSuggestions = currentMeta?.suggestions ?? [];
  const hasOptions = (currentMeta?.options?.length ?? 0) > 0;
  const navigatorItems = questions.map((question, index) => ({
    id: questionMeta[index]?.id ?? `MG-${index + 1}`,
    label: question
  }));
  const progressPercent = Math.round(((currentQuestionIndex + 1) / questions.length) * 100);
  const fallbackQuickOptions = ['还没想好', '不想回答'];
  const suggestionPool = quickSuggestions.filter(Boolean);

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
                  <p style={{ fontSize: '0.8rem', marginTop: '1rem', color: '#999', fontStyle: 'italic' }}>本测试设定来源于小说《下班，然后变成魔法少女》</p>
                </div>
                {/* 注意事项 */}
                <div className="mb-6 p-3 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 text-sm text-left rounded-r-lg">
                  <p className="font-bold">⚠️ 注意事项</p>
                  <p className="mt-1">请勿在问卷中输入任何真实的隐私信息，或任何不适宜、攻击性、不符合公序良俗的内容。所有回答将被用于生成虚拟角色，并且将会被储存在角色信息中。</p>
                </div>
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
                  isAnswered={(index) => (answers[index] || '').trim().length > 0}
                  theme="pink"
                />

                <div className="mt-4 space-y-4">
                  <div className="rounded-2xl border border-pink-100 bg-white/90 p-4 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm text-gray-600">
                      <span>问题 {currentQuestionIndex + 1} / {questions.length}</span>
                      <span>进度 {progressPercent}%</span>
                      {autoSaveTimestamp && (
                        <span className="text-xs text-gray-400">已自动保存于 {new Date(autoSaveTimestamp).toLocaleTimeString()}</span>
                      )}
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-pink-100">
                      <div
                        className="h-full rounded-full bg-pink-400 transition-all duration-300 ease-out"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <h2
                      className="mt-4 text-xl font-semibold leading-relaxed text-center text-pink-700 transition-all duration-300 ease-out"
                      style={{
                        opacity: isTransitioning ? 0 : 1,
                        transform: isTransitioning ? 'translateX(-16px)' : 'translateX(0)'
                      }}
                    >
                      {currentQuestion}
                    </h2>
                    <p className="text-xs text-center text-gray-500 mt-2">
                      请基于您构想的虚拟角色身份回答，并确保内容符合公序良俗，请勿使用任何真实信息。
                    </p>
                    {currentMeta?.helperText && (
                      <p className="mt-2 text-sm text-gray-600 text-center">{currentMeta.helperText}</p>
                    )}
                    <div className="mt-3 flex flex-wrap justify-center gap-3 text-xs">
                      {fallbackQuickOptions.map(option => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => handleQuickOption(option)}
                          disabled={submitting || isTransitioning || isCooldown}
                          className="rounded-full border border-pink-200 bg-white px-4 py-1.5 font-medium text-pink-600 transition-colors hover:border-pink-400 hover:bg-pink-50"
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>

                  {hasOptions && (
                    <div className="rounded-2xl border border-pink-100 bg-white p-4 shadow-sm">
                      <p className="text-xs text-gray-500 mb-2">推荐选项（点击后自动跳转下一题，也可继续补充文本）</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {currentMeta?.options?.map(option => (
                          <button
                            type="button"
                            key={option.value}
                            onClick={() => handleQuickOption(option.value)}
                            className="rounded-lg border border-pink-200 bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:border-pink-400 hover:bg-pink-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-300"
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {suggestionPool.length > 0 && (
                    <div className="rounded-2xl border border-pink-100 bg-white/80 p-3 shadow-sm">
                      <p className="text-xs text-gray-500 mb-2">灵感提示（点击将内容填入文本框，可再编辑）</p>
                      <div className="flex flex-wrap gap-2">
                        {suggestionPool.map(suggestion => (
                          <button
                            type="button"
                            key={suggestion}
                            onClick={() => handleSuggestionFill(suggestion)}
                            className="rounded-full border border-pink-200 bg-white px-3 py-1.5 text-xs text-pink-600 transition-colors hover:border-pink-400 hover:bg-pink-50"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 输入框 */}
                <div className="input-group mt-4">
                  <textarea
                    value={currentAnswer}
                    onChange={(e) => setCurrentAnswer(e.target.value)}
                    placeholder={currentMeta?.placeholder ?? '请输入您的答案（建议控制在适中长度）'}
                    className="input-field min-h-[6rem] resize-y"
                    maxLength={currentMaxLength}
                  />
                  <div className="mt-1 text-right text-xs text-gray-500">
                    {currentAnswer.length}/{currentMaxLength}
                  </div>
                </div>
                {/* 下一题按钮 */}
                <div className="mt-4 flex flex-col sm:flex-row gap-2">
                  <button className="generate-button w-1/4" onClick={handlePreviousQuestion} disabled={currentQuestionIndex === 0 || submitting || isTransitioning || isCooldown}>
                    返回上题
                  </button>
                  <button
                    onClick={handleNext}
                    disabled={submitting || currentAnswer.trim().length === 0 || isTransitioning || isCooldown}
                    className="generate-button"
                  >
                    {isCooldown
                      ? `请等待 ${remainingTime} 秒`
                      : submitting
                        ? (
                          <span className="flex items-center justify-center">
                            <svg className="animate-spin h-4 w-4 text-white" style={{ marginLeft: '-0.25rem', marginRight: '0.5rem' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            提交中...
                          </span>
                        )
                        : isLastQuestion
                          ? '提交'
                          : '下一题'}
                  </button>
                </div>

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
                        placeholder="在此处粘贴所有答案，每行一个。"
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
                      {questions.map((question, index) => (
                        <div key={`answer-review-${index}`} className="rounded-lg bg-white/90 p-3 shadow-sm">
                          <div className="text-xs font-semibold text-pink-600">Q{index + 1}</div>
                          <div className="mt-1 text-xs text-gray-500">{question}</div>
                          <div className="mt-2 text-gray-800 whitespace-pre-wrap">
                            {answers[index] && answers[index].trim().length > 0 ? answers[index] : <span className="text-gray-400">尚未填写</span>}
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
                  <div className="error-message">
                    {error}
                  </div>
                )}

                {/* 复制已填写内容 */}
                <div style={{ textAlign: 'center' }}>
                  <button className="border-2 border-grey-900 rounded-md px-4 py-2 cursor-pointer" onClick={handleCopyContent} style={{ marginRight: '10px' }}>
                    复制已填写内容
                  </button>
                  <p style={{ fontSize: '12px', color: '#888', marginTop: '10px' }}>
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

          {/* 显示魔法少女详细信息结果 */}
          {magicalGirlDetails && (
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

                  <p className="text-xs text-gray-400 text-center">提示：偏好设置仅影响本次会话，切换不会丢失生成结果。</p>
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
                  <div style={{ marginTop: '0.5rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' }}>
                    <p className="text-sm text-gray-600 mb-2">
                      保存好你的设定文件了吗？
                    </p>
                    <Link href="/battle" className="footer-link" style={{ color: '#193cb8', fontSize: '1.125rem' }}>
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

        {/* Image Modal */}
        {showImageModal && savedImageUrl && (
          <div className="fixed inset-0 bg-black flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', paddingLeft: '2rem', paddingRight: '2rem', zIndex: 1000 }}
          >
            <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-auto relative">
              <div className="flex justify-between items-center m-0 absolute top-0 right-0">
                <div></div>
                <button
                  onClick={() => setShowImageModal(false)}
                  className="text-gray-500 hover:text-gray-700 text-3xl leading-none"
                  style={{ marginRight: '0.5rem' }}
                >
                  ×
                </button>
              </div>
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
        )}

      </div>
    </>
  );
};

export default DetailsPage;
