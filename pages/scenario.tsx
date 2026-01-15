// pages/scenario.tsx

import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getSensitiveWordRedirectTarget } from '@/lib/content-safety/client';
import { useCooldown } from '../lib/cooldown';
import SaveToCloudButton from '../components/SaveToCloudButton';
import Footer from '../components/Footer';
import AiProviderSelector, { UserAIProviderConfig } from '@/components/AiProviderSelector';
import { ErrorMessage } from '@/components/ErrorMessage';
import { EncyclopediaLinks } from '@/components/encyclopedia/EncyclopediaLinks';
import { convertDataCard, createBlankDataCard } from '@/lib/data-card-converter';
import { GenerationModeSwitcher, type GenerationMode } from '@/components/shared/GenerationModeSwitcher';
import { readTextStreamFromResponse } from '@/lib/stream/read-text-stream';
import { buildGeneralScenarioCardFromMarkdown } from '@/lib/stream/markdown-card';
import { formatHttpErrorMessage } from '@/lib/client/httpError';

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

const SCENARIO_PREFERENCE_KEY = 'mahoshojo.scenario.preferences.v1';

const ScenarioPage: React.FC = () => {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>(
    scenarioQuestions.reduce((acc, q) => ({ ...acc, [q.label]: '' }), {})
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultData, setResultData] = useState<any | null>(null);
  const [generalScenarioDraft, setGeneralScenarioDraft] = useState<any | null>(null);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('non-stream');
  const [scenarioTitleHint, setScenarioTitleHint] = useState('');
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem(SCENARIO_PREFERENCE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (parsed?.generationMode === 'stream' || parsed?.generationMode === 'non-stream') {
        setGenerationMode(parsed.generationMode);
      }
      if (typeof parsed?.scenarioTitleHint === 'string') {
        setScenarioTitleHint(parsed.scenarioTitleHint);
      }
      if (typeof parsed?.selectedLanguage === 'string') {
        setSelectedLanguage(parsed.selectedLanguage);
      }
      if (typeof parsed?.isAdvancedVisible === 'boolean') {
        setIsAdvancedVisible(parsed.isAdvancedVisible);
      }
      if (Array.isArray(parsed?.fieldsToKeepEmpty)) {
        const allowed = new Set(optionalFields.map(field => field.value));
        const filtered = parsed.fieldsToKeepEmpty.filter((value: unknown) => typeof value === 'string' && allowed.has(value));
        setFieldsToKeepEmpty(filtered);
      }
    } catch (error) {
      console.warn('读取情景生成偏好失败', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const payload = {
        generationMode,
        scenarioTitleHint,
        selectedLanguage,
        isAdvancedVisible,
        fieldsToKeepEmpty,
      };
      window.localStorage.setItem(SCENARIO_PREFERENCE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage 可能不可用，忽略
    }
  }, [generationMode, scenarioTitleHint, selectedLanguage, isAdvancedVisible, fieldsToKeepEmpty]);

  const handleAnswerChange = (id: string, value: string) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
  };

  const verifyOrigin = useCallback(async (data: any): Promise<boolean> => {
    try {
      const response = await fetch('/api/verify-origin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) return false;
      const result = await response.json().catch(() => null as any);
      return Boolean(result?.isValid);
    } catch (err) {
      console.warn('原生性校验失败，将按非原生处理', err);
      return false;
    }
  }, []);

  const resignDataCard = useCallback(async (data: any) => {
    const response = await fetch('/api/resign-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null as any);
      if (errorData?.shouldRedirect) {
        router.push({
          pathname: '/arrested',
          query: { reason: errorData.reason || '编辑内容不合规' }
        });
        return null;
      }
      throw new Error(errorData?.message || '签名服务器认证失败');
    }

    return response.json();
  }, [router]);

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
    if (generationMode === 'stream') {
      const blank = createBlankDataCard('general-scenario');
      setGeneralScenarioDraft({
        ...blank,
        title: scenarioTitleHint.trim() || blank.title || '未命名情景',
        content: '',
      });
    }

    try {
      const redirectTarget = await getSensitiveWordRedirectTarget(JSON.stringify(answers), {
        reason: '在情景问卷中使用了危险符文',
      });
      if (redirectTarget) {
        router.push(redirectTarget);
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

      const endpoint = generationMode === 'stream' ? '/api/generate-scenario-stream' : '/api/generate-scenario';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestBody,
          ...(generationMode === 'stream' ? { titleHint: scenarioTitleHint.trim() } : {}),
        }),
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
        throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: '生成失败' }));
      }

      if (generationMode === 'stream') {
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json') || contentType.includes('+json')) {
          const errorJson = await response.json().catch(() => null as any);
          const serverMessage = errorJson?.message || errorJson?.error;
          throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: '生成失败' }));
        }

        const markdown = await readTextStreamFromResponse(response, {
          label: '情景卡（流式）',
          onText: (text) => {
            setGeneralScenarioDraft((prev: any) => (prev ? { ...prev, content: text } : prev));
          },
        });

        const { card } = buildGeneralScenarioCardFromMarkdown({
          markdown,
          fallbackTitle: scenarioTitleHint.trim(),
          defaultTitle: '情景',
        });

        let signedCard = card;
        try {
          const result = await resignDataCard(card);
          if (!result) return;
          signedCard = result;
        } catch (err) {
          const message = err instanceof Error ? err.message : '签名失败';
          setError(`⚠️ 原生性签名失败，已降级为非原生：${message}`);
        }

        setGeneralScenarioDraft(signedCard);
        startCooldown();
        return;
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
    const title = data?.title || data?.name || '自定义情景';
    const jsonData = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data?.templateId === '通用情景' ? '通用情景' : '情景'}_${title}.json`;
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

  const handleCreateBlankGeneralScenario = () => {
    const blank = createBlankDataCard('general-scenario');
    setGeneralScenarioDraft(blank);
  };

  const handleConvertToGeneralScenario = useCallback(async () => {
    if (!resultData) return;
    try {
      const { data: converted } = convertDataCard(resultData, 'general-scenario', 'scenario');
      let finalConverted = converted;
      const shouldResign = await verifyOrigin(resultData);
      if (shouldResign) {
        try {
          const signed = await resignDataCard(converted);
          if (!signed) return;
          finalConverted = signed;
        } catch (err) {
          const message = err instanceof Error ? err.message : '签名失败';
          setError(`⚠️ 原生性签名失败，已降级为非原生：${message}`);
        }
      }

      setGeneralScenarioDraft(finalConverted);
    } catch (err) {
      const message = err instanceof Error ? err.message : '转换失败';
      setError(`✨ 转换失败！${message}`);
    }
  }, [resultData, resignDataCard, verifyOrigin]);

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
                <div className="input-group">
                  <label htmlFor="scenario-title-hint" className="input-label">情景标题（可选）</label>
                  <input
                    id="scenario-title-hint"
                    value={scenarioTitleHint}
                    onChange={(e) => setScenarioTitleHint(e.target.value)}
                    placeholder="例如：深夜车站、雨夜访谈、黄昏钟楼"
                    className="input-field"
                    disabled={isGenerating}
                  />
                  <p className="text-xs text-gray-500 mt-1">用于流式生成时的标题回退；非流式会由 AI 自动命名。</p>
                </div>

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
            {!isGenerating && generationMode === 'non-stream' && resultData && (
              <div className="text-center text-sm text-green-600 my-2 font-semibold">
                🎉 情景生成成功！结果已显示在下方。
              </div>
            )}

            <div className="input-group mt-6">
              <GenerationModeSwitcher
                label="生成方式"
                value={generationMode}
                disabled={isGenerating}
                helper={false}
                onChange={(mode) => setGenerationMode(mode)}
              />
              <p className="text-xs text-gray-500 mt-2">
                {generationMode === 'stream'
                  ? '提示：选择流式生成后，将实时输出 Markdown，并直接生成【通用情景卡】（templateId=通用情景）。标题会尝试从输出中解析，失败则回退到你填写的标题或“情景”。'
                  : '提示：非流式生成会返回结构化情景 JSON（含 elements 等字段），更适合与竞技场/进阶玩法联动。'}
              </p>
            </div>

            <button onClick={handleGenerate} disabled={isGenerating || isCooldown} className="generate-button mt-4">
              {isCooldown ? `冷却中 (${remainingTime}s)` : isGenerating ? '正在构建舞台...' : '生成情景'}
            </button>
            {error && <ErrorMessage message={error} className="error-message mt-4" />}
          </div>

          {generationMode === 'non-stream' && resultData && (
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

          <div className="card mt-6">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col md:flex-row justify-between gap-2">
                <h2 className="text-xl font-bold">通用情景卡（Markdown）</h2>
                <div className="flex gap-2">
                  <button onClick={handleCreateBlankGeneralScenario} className="generate-button flex-1" style={{ backgroundColor: '#a855f7', backgroundImage: 'linear-gradient(to right, #a855f7, #7c3aed)' }}>
                    创建空白通用情景卡
                  </button>
                  <button
                    onClick={() => void handleConvertToGeneralScenario()}
                    disabled={!resultData}
                    className="generate-button flex-1"
                    style={{ backgroundColor: '#10b981', backgroundImage: 'linear-gradient(to right, #10b981, #059669)' }}
                  >
                    将生成结果转为通用情景卡
                  </button>
                </div>
              </div>

              {generalScenarioDraft && (
                <>
                  <div className="space-y-4">
                    <div className="input-group">
                      <label className="input-label">情景名称</label>
                      <input
                        type="text"
                        value={generalScenarioDraft.title || ''}
                        onChange={(e) => setGeneralScenarioDraft((prev: any) => ({ ...prev, title: e.target.value }))}
                        className="input-field"
                        placeholder="请输入通用情景名称"
                      />
                    </div>

                    <div className="input-group">
                      <label className="input-label">情景内容（Markdown）</label>
                      <textarea
                        value={generalScenarioDraft.content || ''}
                        onChange={(e) => setGeneralScenarioDraft((prev: any) => ({ ...prev, content: e.target.value }))}
                        className="input-field resize-y"
                        rows={12}
                        placeholder="请在此处编写情景设定，建议使用 Markdown 小标题/列表。"
                      />
                    </div>
                  </div>

                  <div className="bg-gray-100 p-4 rounded-lg font-mono text-xs overflow-x-auto">
                    <pre>{JSON.stringify(generalScenarioDraft, null, 2)}</pre>
                  </div>

                  <div className="flex flex-col md:flex-row justify-center mt-2">
                    <button onClick={() => downloadJson(generalScenarioDraft)} className="generate-button flex-1">
                      下载通用情景卡
                    </button>
                    <SaveToCloudButton
                      data={generalScenarioDraft}
                      cardType="scenario"
                      buttonText="保存到云端"
                      className="generate-button flex-1"
                      style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                    />
                    <button onClick={() => copyToClipboard(generalScenarioDraft)} className="generate-button flex-1" style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}>
                      复制到剪贴板
                    </button>
                  </div>
                </>
              )}

              {!generalScenarioDraft && (
                <p className="text-xs text-gray-500">
                  提示：通用情景卡只有 <code>title</code> 和 <code>content</code> 两个主要字段，适合用 Markdown 维护长线场景。
                </p>
              )}
            </div>
          </div>

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
