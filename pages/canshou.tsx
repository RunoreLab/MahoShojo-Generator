// pages/canshou.tsx
import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCooldown } from '../lib/cooldown';
import Link from 'next/link';
import CanshouCard, { CanshouDetails } from '../components/CanshouCard';
import { CANSHOU_LORE } from '../lib/canshou-lore';
import { generateRandomCanshou } from '../lib/random-character-generator';
import SaveToCloudButton from '../components/SaveToCloudButton';
import Footer from '../components/Footer';

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

// 用于保存JSON的按钮组件
const SaveJsonButton: React.FC<{ canshouDetails: CanshouDetails; answers: Record<string, string> }> = ({ canshouDetails, answers }) => {
  const [isMobile, setIsMobile] = useState(false);
  const [showJsonText, setShowJsonText] = useState(false);

  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    const isMobileDevice = /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(userAgent);
    setIsMobile(isMobileDevice);
  }, []);

  const downloadJson = () => {
    // 将用户答案添加到保存的数据中
    const dataToSave = {
      ...canshouDetails,
      userAnswers: answers
    };
    const jsonData = JSON.stringify(dataToSave, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `残兽档案_${canshouDetails.name || 'data'}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSave = () => {
    if (isMobile) {
      setShowJsonText(true);
    } else {
      downloadJson();
    }
  };

  if (showJsonText) {
    return (
      <div className="text-left">
        <div className="mb-4 text-center">
          <div className="p-3 mb-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 text-xs rounded-r-lg">
            <p className="font-bold">手机用户操作提示：</p>
            <p className="mt-1">建议使用电脑进行文件操作。手机用户请复制下方全部内容，并将其手动保存为一个以 <code className="bg-yellow-200 px-1 rounded">.json</code> 结尾的文件。</p>
          </div>
          <p className="text-sm text-gray-600 mb-2">请复制以下数据并保存</p>
          <button
            onClick={() => setShowJsonText(false)}
            className="text-pink-700 text-sm"
          >
            返回
          </button>
        </div>
        <textarea
          value={JSON.stringify({ ...canshouDetails, userAnswers: answers }, null, 2)}
          readOnly
          className="w-full h-64 p-3 border rounded-lg text-xs font-mono bg-gray-50 text-gray-900"
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
        />
        <p className="text-xs text-gray-500 mt-2 text-center">点击文本框可全选内容</p>
      </div>
    );
  }

  return (
    <button
      onClick={handleSave}
      className="generate-button"
    >
      {isMobile ? '查看原始数据' : '下载设定文件'}
    </button>
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
  const [canshouDetails, setCanshouDetails] = useState<CanshouDetails | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  const [showIntroduction, setShowIntroduction] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLore, setShowLore] = useState(false);
  const { isCooldown, startCooldown, remainingTime } = useCooldown('generateCanshouCooldown', 60000);
  const [bulkAnswers, setBulkAnswers] = useState(''); // 用于"一键填充"的textarea
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('zh-CN');
  const [showLanguageSection, setShowLanguageSection] = useState(false); // 控制生成语言区域的折叠状态
  const [showBulkFillSection, setShowBulkFillSection] = useState(false); // 控制一键填充区域的折叠状态

  useEffect(() => {
    fetch('/languages.json')
      .then(res => res.json())
      .then(data => setLanguages(data))
      .catch(err => console.error("Failed to load languages:", err));
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
    setError(null);
    proceedToNext(currentAnswer.trim());
  };

  const handleOptionClick = (option: string) => {
    setCurrentAnswer(option);
    setTimeout(() => proceedToNext(option), 100);
  };

  const handleSubmit = async (finalAnswers: Record<string, string>) => {
    if (isCooldown) {
      setError(`请等待 ${remainingTime} 秒后再生成`);
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/generate-canshou', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: finalAnswers, language: selectedLanguage }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.shouldRedirect) {
          router.push('/arrested');
          return;
        }
        throw new Error(errorData.message || '生成失败，服务器返回错误');
      }

      const result: CanshouDetails = await response.json();
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
    const lines = bulkAnswers.split('\n');
    if (lines.length > questionnaire!.questions.length) {
      setError(`⚠️ 粘贴的答案有 ${lines.length} 行，超过了问卷问题总数 ${questionnaire!.questions.length}！`);
      return;
    }
    const newAnswers = { ...answers };
    lines.forEach((line, index) => {
      if (index < questionnaire!.questions.length) {
        const questionId = questionnaire!.questions[index].id;
        newAnswers[questionId] = line.slice(0, 100); // 限制单行长度
      }
    });
    setAnswers(newAnswers);
    setCurrentAnswer(newAnswers[questionnaire!.questions[currentQuestionIndex].id] || '');
    setError(null);
    alert(`成功填充了 ${lines.length} 个答案！`);
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
            ) : !canshouDetails ? (
              <>
                <div className="mb-6">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600">问题 {currentQuestionIndex + 1} / {questionnaire.questions.length}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="h-2 rounded-full bg-pink-500 transition-all duration-300" style={{ width: `${((currentQuestionIndex + 1) / questionnaire.questions.length) * 100}%` }} />
                  </div>
                </div>

                <div className={`mb-4 min-h-[60px] flex items-center justify-center transition-opacity duration-200 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}>
                  <h3 className="text-xl font-medium text-center text-gray-800">
                    {currentQuestion.question}
                  </h3>
                </div>

                {currentQuestion.options && (
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {currentQuestion.options.map((option, index) => {
                      const value = typeof option === 'string' ? option : option.value;
                      const label = typeof option === 'string' ? option : option.label;
                      const disabled = typeof option !== 'string' && option.disabled;
                      return (
                        <button
                          key={index}
                          onClick={() => !disabled && handleOptionClick(value)}
                          disabled={disabled}
                          className={`p-3 border rounded-lg text-sm text-center transition-colors 
                            ${disabled
                              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                              : 'bg-white text-gray-800 hover:text-pink-500 hover:bg-pink-50 hover:border-pink-300 cursor-pointer'
                            }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {(currentQuestion.type === 'text' || currentQuestion.allowCustom) && (
                  <div className="input-group">
                    <textarea
                      value={currentAnswer}
                      onChange={(e) => setCurrentAnswer(e.target.value)}
                      placeholder={currentQuestion.placeholder || "请在此输入你的想法..."}
                      className="input-field resize-y h-24"
                      maxLength={100}
                    />
                  </div>
                )}

                <button onClick={handleNext} disabled={submitting || isCooldown || !currentAnswer.trim()} className="generate-button">
                  {isCooldown ? `冷却中 (${remainingTime}s)` : submitting ? '生成中...' : isLastQuestion ? '生成档案' : '下一题'}
                </button>
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

                {error && <div className="error-message">{error}</div>}

                <div className="mt-8 text-center">
                  <Link href="/" className="footer-link">返回首页</Link>
                </div>
              </>
            ) : (
              <>
                <CanshouCard canshou={canshouDetails} onSaveImage={handleSaveImage} />
                <div className="card" style={{ marginTop: '1rem' }}>
                  <div className="text-center">
                    <h3 className="text-lg font-medium text-gray-800" style={{ marginBottom: '1rem' }}>后续操作</h3>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                      <SaveJsonButton canshouDetails={canshouDetails} answers={answers} />
                      <SaveToCloudButton
                        data={{ ...canshouDetails, userAnswers: answers }}
                        buttonText="保存到云端"
                        style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                      />
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
          <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-auto relative p-4">
            <button onClick={() => setShowImageModal(false)} className="absolute top-2 right-2 text-3xl text-gray-600 hover:text-gray-900">&times;</button>
            <p className="text-center text-sm text-gray-600 mb-2">长按图片保存到相册</p>
            <img src={savedImageUrl} alt="残兽档案" className="w-full h-auto rounded-lg" />
          </div>
        </div>
      )}
    </>
  );
};

export default CanshouPage;