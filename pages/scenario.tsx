// pages/scenario.tsx

import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { useCooldown } from '../lib/cooldown';
import SaveToCloudButton from '../components/SaveToCloudButton';
import Footer from '../components/Footer';
import AiProviderSelector, { UserAIProviderConfig } from '@/components/AiProviderSelector';
import { ErrorMessage } from '@/components/ErrorMessage';
import { EncyclopediaLinks } from '@/components/encyclopedia/EncyclopediaLinks';

// 定义引导性问题
const scenarioQuestions = [
  { id: 'scene', label: '故事发生的场景是怎样的？', placeholder: '例如：黄昏时分的废弃钟楼顶端，晚风吹拂，可以俯瞰整座城市...' },
  { id: 'roles', label: '场景中有需要出现的角色（NPC）吗？', placeholder: '【强烈建议】此项填写“未指定”，让AI不生成此项内容。如果需要添加场景固定角色，则在此处填写。' },
  { id: 'events', label: '角色们在这里需要做什么核心事件？', placeholder: '例如：进行一场一对一的决斗；合作解开一个古老的谜题；接受一次特别的采访...' },
  { id: 'atmosphere', label: '希望故事的整体氛围是怎样的？', placeholder: '例如：轻松愉快、紧张悬疑、悲伤感人、热血沸腾...' },
  { id: 'development', label: '故事可能会有哪些有趣的发展方向？', placeholder: '例如：决斗中途有第三方介入；谜题的答案指向一个惊人的秘密；采访者突然问了一个尖锐的问题...' },
];

// 定义可供用户选择留空的字段列表
// 这里的 'value' 必须精确对应 Zod Schema 中的路径
const optionalFields = [
  { label: '场景时间', value: 'elements.scene.time' },
  { label: '场景地点', value: 'elements.scene.place' },
  { label: '场景特征', value: 'elements.scene.features' },
  { label: '预设NPC', value: 'elements.roles' },
  { label: '故事氛围', value: 'elements.atmosphere' },
  { label: '发展方向', value: 'elements.development' },
];

const ScenarioPage: React.FC = () => {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>(
    scenarioQuestions.reduce((acc, q) => ({ ...acc, [q.label]: '' }), {})
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultData, setResultData] = useState<any | null>(null);
  const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);

  // 根据是否使用自定义 Key 动态调整冷却时间：官方 60s，自定义 3s
  const isUserCustomKey = userProviderConfig?.providerId !== 'system' && !!userProviderConfig?.apiKey?.trim();
  const scenarioCooldownMs = isUserCustomKey ? 3000 : 60000;
  const scenarioCooldownKey = isUserCustomKey ? 'scenarioCooldown:custom' : 'scenarioCooldown:system';
  const { isCooldown, startCooldown, remainingTime } = useCooldown(scenarioCooldownKey, scenarioCooldownMs);
  // 用于存储希望留空的字段的状态
  const [fieldsToKeepEmpty, setFieldsToKeepEmpty] = useState<string[]>([]);
  // 用于控制高级选项的显示/隐藏
  const [isAdvancedVisible, setIsAdvancedVisible] = useState(false);

  // 多语言支持
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('zh-CN');

  useEffect(() => {
    fetch('/languages.json')
      .then(res => res.json())
      .then(data => setLanguages(data))
      .catch(err => console.error("Failed to load languages:", err));
  }, []);

  const handleAnswerChange = (id: string, value: string) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
  };

  // 处理留空字段复选框的点击事件
  const handleOptionalFieldChange = (fieldValue: string) => {
    setFieldsToKeepEmpty(prev =>
      prev.includes(fieldValue)
        ? prev.filter(f => f !== fieldValue)
        : [...prev, fieldValue]
    );
  };

  const handleGenerate = async () => {
    // [修改] 增加冷却检查
    if (isCooldown) {
      setError(`操作过于频繁，请等待 ${remainingTime} 秒后再试。`);
      return;
    }
    if (userProviderConfig && userProviderConfig.providerId !== 'system' && !userProviderConfig.apiKey) {
      setError('⚠️ 已选择自定义 AI 供应商，但尚未填写 API Key。');
      return;
    }
    setIsGenerating(true);
    setError(null);
    setResultData(null);

    try {
      if ((await quickCheck(JSON.stringify(answers))).hasSensitiveWords) {
        router.push({
          pathname: '/arrested',
          query: { reason: '在情景问卷中使用了危险符文' }
        });
        return;
      }

      const requestBody: Record<string, unknown> = {
        answers,
        language: selectedLanguage,
        fieldsToKeepEmpty,
      };

      if (
        userProviderConfig &&
        (userProviderConfig.apiKey || userProviderConfig.providerId === 'system') &&
        userProviderConfig.modelId !== 'default'
      ) {
        requestBody.customProvider = {
          providerId: userProviderConfig.providerId,
          modelId: userProviderConfig.modelId,
          apiKey: userProviderConfig.apiKey.trim(),
        };
      }

      const response = await fetch('/api/generate-scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // [修改] 在请求体中加入 fieldsToKeepEmpty
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => null as any);
        if (errorJson?.shouldRedirect) {
          router.push({
            pathname: '/arrested',
            query: { reason: errorJson.reason || '使用危险符文' }
          });
          return;
        }
        const serverMessage = errorJson?.message || errorJson?.error;
        throw new Error(serverMessage ? `${serverMessage}（HTTP ${response.status}）` : `生成失败（HTTP ${response.status}）`);
      }

      const result = await response.json();
      setResultData(result);
      startCooldown();

    } catch (err) {
      const message = err instanceof Error ? err.message : '发生未知错误';
      setError(`✨ 剧本创作失败！${message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadJson = (data: any) => {
    const title = data.title || '自定义情景';
    const jsonData = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `情景_${title}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (data: any) => {
    const jsonData = JSON.stringify(data, null, 2);
    navigator.clipboard.writeText(jsonData)
      .then(() => alert('已复制到剪贴板！'))
      .catch(() => alert('复制失败'));
  };

  return (
    <>
      <Head>
        <title>箱庭物语 - MahoShojo Generator</title>
        <meta name="description" content="通过回答问题，快速生成用于竞技场的自定义故事场景。" />
      </Head>
      <div className="magic-background-white">
        <div className="container">
            <div className="card">
              <div className="text-center mb-4">
                <div className="flex justify-center items-center" style={{ marginBottom: '1rem' }}>
                  <img src="/scenario-shadow.webp" width={360} height={40} alt="箱庭物语" />
                </div>
                <p className="subtitle mt-2">情景生成器，创建独一无二的舞台，上演属于你的故事</p>
                <EncyclopediaLinks
                  items={[
                    { slug: 'scenario-generator', text: '百科：箱庭物语（情景生成器）' },
                    { slug: 'scenario-advanced', text: '百科：情景卡进阶（继承与长线）' },
                  ]}
                />
              </div>

              <div className="space-y-6">
                {scenarioQuestions.map(q => (
                  <div key={q.id} className="input-group">
                  <label htmlFor={q.id} className="input-label">{q.label}</label>
                  <textarea
                    id={q.id}
                    value={answers[q.label]}
                    onChange={(e) => handleAnswerChange(q.label, e.target.value)}
                    placeholder={q.placeholder}
                    className="input-field resize-y h-24"
                    rows={3}
                  />
                </div>
              ))}
            </div>

            {/* 高级选项UI */}
            <div className="input-group mt-6">
              <button
                onClick={() => setIsAdvancedVisible(!isAdvancedVisible)}
                className="text-sm font-semibold text-purple-700 hover:underline focus:outline-none"
              >
                {isAdvancedVisible ? '▼ ' : '▶ '}高级选项：强制留空字段
              </button>
              {isAdvancedVisible && (
                <div className="mt-3 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                  <p className="text-xs text-gray-600 mb-3">勾选你希望AI在生成时强制留空的字段，以获得更灵活的情景文件。</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {optionalFields.map(field => (
                      <label key={field.value} className="flex items-center text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={fieldsToKeepEmpty.includes(field.value)}
                          onChange={() => handleOptionalFieldChange(field.value)}
                          className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        />
                        <span className="ml-2 text-gray-700">{field.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="input-group mt-6">
              <AiProviderSelector onConfigChange={setUserProviderConfig} />
              <p className="text-xs text-gray-500 mt-1">
                若需使用自备模型，请先选择供应商与模型并填写对应 API Key。
              </p>
            </div>

            {/* 多语言支持 */}
            <div className="input-group mt-6">
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

            {/* 成功提示信息 */}
            {!isGenerating && resultData && (
              <div className="text-center text-sm text-green-600 my-2 font-semibold">
                🎉 情景生成成功！结果已显示在下方。
              </div>
            )}

            <button onClick={handleGenerate} disabled={isGenerating || isCooldown} className="generate-button mt-4">
              {isCooldown ? `冷却中 (${remainingTime}s)` : isGenerating ? '正在构建舞台...' : '生成情景'}
            </button>
            {error && <ErrorMessage message={error} className="error-message mt-4" />}
          </div>

          {resultData && (
            <div className="card mt-6">
              <h2 className="text-2xl font-bold text-center mb-4">{resultData.title}</h2>
              <div className="bg-gray-100 p-4 rounded-lg font-mono text-xs overflow-x-auto">
                <pre>{JSON.stringify(resultData, null, 2)}</pre>
              </div>
              <div className="flex flex-col md:flex-row justify-center mt-6">
                <button onClick={() => downloadJson(resultData)} className="generate-button flex-1">
                  下载情景文件
                </button>
                <SaveToCloudButton
                  data={resultData}
                  buttonText="保存到云端"
                  className="generate-button flex-1"
                  style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                />
                <button onClick={() => copyToClipboard(resultData)} className="generate-button flex-1" style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}>
                  复制到剪贴板
                </button>
              </div>
            </div>
          )}

          <div className="text-center" style={{ marginTop: '2rem' }}>
            <Link href="/" className="footer-link">返回首页</Link>
          </div>
        </div>
        <Footer />
      </div>
    </>
  );
};

export default ScenarioPage;
