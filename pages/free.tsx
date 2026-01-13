import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';

import Footer from '@/components/Footer';
import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import { ErrorMessage } from '@/components/ErrorMessage';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import { GenerationModeSwitcher, type GenerationMode } from '@/components/shared/GenerationModeSwitcher';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import MagicalGirlCard from '@/components/MagicalGirlCard';
import CanshouCard from '@/components/CanshouCard';
import GeneralCharacterCard from '@/components/GeneralCharacterCard';

import { useCooldown } from '@/lib/cooldown';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { readTextStreamFromResponse } from '@/lib/stream/read-text-stream';
import { buildGeneralCharacterCardFromMarkdown, buildGeneralScenarioCardFromMarkdown } from '@/lib/stream/markdown-card';
import { buildCustomProviderPayload, isUsingUserProvidedKey } from '@/lib/ai/custom-provider';
import { GENERAL_CHARACTER_TEMPLATE_ID } from '@/lib/schemas/general-character';
import { GENERAL_SCENARIO_TEMPLATE_ID } from '@/lib/schemas/general-scenario';

type FreeSchemaId = 'magical-girl' | 'canshou' | 'scenario' | 'general' | 'general-scenario';

const SCHEMA_OPTIONS: Array<{ id: FreeSchemaId; label: string; description: string; kind: 'character' | 'scenario' }> = [
  { id: 'magical-girl', label: '魔法少女（结构化）', description: '完整字段结构，适合后续升华/竞技场联动；自由生成产物为非原生。', kind: 'character' },
  { id: 'canshou', label: '残兽（结构化）', description: '完整字段结构，适合后续升华/竞技场联动；自由生成产物为非原生。', kind: 'character' },
  { id: 'general', label: '通用角色卡（Markdown）', description: '只有 name/content，适合自由发挥与长线维护。', kind: 'character' },
  { id: 'scenario', label: '情景（结构化）', description: 'elements 结构化字段，适合与竞技场/进阶玩法联动。', kind: 'scenario' },
  { id: 'general-scenario', label: '通用情景卡（Markdown）', description: '只有 title/content，适合自由发挥与长线维护。', kind: 'scenario' },
];

const STREAMABLE_SCHEMA_IDS: FreeSchemaId[] = ['general', 'general-scenario'];

const LOCAL_STORAGE_KEY = 'mahoshojo.free-generator.draft.v1';

const buildFieldGuideForUi = (schemaId: FreeSchemaId): string => {
  switch (schemaId) {
    case 'magical-girl':
      return [
        '魔法少女（结构化）字段速览：',
        '- codename：代号（建议花名/称号）',
        '- appearance：外观（outfit/accessories/colorScheme/overallLook，可选）',
        '- magicConstruct：魔装（name/form/basicAbilities/description，可选）',
        '- wonderlandRule：奇境规则（name/description/tendency/activation，可选）',
        '- blooming：繁开（name/evolvedAbilities/evolvedForm/evolvedOutfit/powerLevel，可选）',
        '- analysis：分析（personalityAnalysis/abilityReasoning/coreTraits/predictionBasis/background，可选）',
        '注意：自由生成不会生成 signature，因此会被视为非原生卡。',
      ].join('\n');
    case 'canshou':
      return [
        '残兽（结构化）字段速览：',
        '- name：名称',
        '- appearance/materialAndSkin/featuresAndAppendages/coreConcept/coreEmotion/evolutionStage/attackMethod/specialAbility/origin/birthEnvironment/researcherNotes（均可选）',
        '注意：自由生成不会生成 signature，因此会被视为非原生卡。',
      ].join('\n');
    case 'scenario':
      return [
        '情景（结构化）字段速览：',
        '- title：标题（必需）',
        '- scenario_type/description（可选）',
        '- elements：必需',
        '  - scene.time/place/features（可选）',
        '  - roles：可选数组，每项包含 name/description（可选）',
        '  - events/atmosphere/development（可选）',
        '注意：自由生成不会生成 signature，因此会被视为非原生卡。',
      ].join('\n');
    case 'general':
      return [
        '通用角色卡字段速览：',
        '- templateId：固定为 通用角色',
        '- name：角色名',
        '- content：正文（建议 Markdown）',
      ].join('\n');
    case 'general-scenario':
      return [
        '通用情景卡字段速览：',
        '- templateId：固定为 通用情景',
        '- title：情景名',
        '- content：正文（建议 Markdown）',
      ].join('\n');
    default:
      return '';
  }
};

export default function FreeGeneratorPage() {
  const router = useRouter();

  const [schemaId, setSchemaId] = useState<FreeSchemaId>('general');
  const [generationMode, setGenerationMode] = useState<GenerationMode>('non-stream');
  const [prompt, setPrompt] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [resultData, setResultData] = useState<any | null>(null);

  const [streamingMarkdown, setStreamingMarkdown] = useState<string | null>(null);
  const [streamedGeneralCard, setStreamedGeneralCard] = useState<any | null>(null);

  const [showFieldGuide, setShowFieldGuide] = useState(false);
  const [showLanguageSection, setShowLanguageSection] = useState(false);
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('zh-CN');

  const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);
  const isUserCustomKey = isUsingUserProvidedKey(userProviderConfig);
  const freeCooldownMs = isUserCustomKey ? 3000 : 60000;
  const freeCooldownKey = isUserCustomKey ? 'freeCooldown:custom' : 'freeCooldown:system';
  const { isCooldown, startCooldown, remainingTime } = useCooldown(freeCooldownKey, freeCooldownMs);

  const schemaOptionsForMode = useMemo(() => {
    if (generationMode === 'stream') {
      return SCHEMA_OPTIONS.filter(item => STREAMABLE_SCHEMA_IDS.includes(item.id));
    }
    return SCHEMA_OPTIONS;
  }, [generationMode]);

  const fieldGuideText = useMemo(() => buildFieldGuideForUi(schemaId), [schemaId]);

  // 多语言
  useEffect(() => {
    fetch('/languages.json')
      .then(res => res.json())
      .then(data => setLanguages(data))
      .catch(err => console.error('Failed to load languages:', err));
  }, []);

  // 流式模式下只允许通用卡：必要时自动切换 schema
  useEffect(() => {
    if (generationMode !== 'stream') return;
    if (STREAMABLE_SCHEMA_IDS.includes(schemaId)) return;
    setSchemaId('general');
  }, [generationMode, schemaId]);

  // 本地存档：对齐问卷生成的“自动保存”
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const payload = {
        schemaId,
        generationMode,
        prompt,
        selectedLanguage,
      };
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage 可能不可用，忽略
    }
  }, [generationMode, prompt, schemaId, selectedLanguage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as any;
      if (parsed?.schemaId) setSchemaId(parsed.schemaId);
      if (parsed?.generationMode) setGenerationMode(parsed.generationMode);
      if (typeof parsed?.prompt === 'string') setPrompt(parsed.prompt);
      if (typeof parsed?.selectedLanguage === 'string') setSelectedLanguage(parsed.selectedLanguage);
    } catch {
      // 忽略损坏的存档
    }
  }, []);

  const handleClearDraft = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
    setPrompt('');
    setError(null);
  };

  const downloadJson = (data: any, suggestedName: string) => {
    const jsonData = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = async (data: any, label: string) => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard-not-available');
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      alert(`✅ 已复制${label} JSON 到剪贴板`);
    } catch {
      alert('⚠️ 复制失败，请手动选择 JSON 内容后复制。');
    }
  };

  const handleGenerate = async () => {
    if (isCooldown) {
      setError(`操作过于频繁，请等待 ${remainingTime} 秒后再试。`);
      return;
    }

    if (userProviderConfig && userProviderConfig.providerId !== 'system' && !userProviderConfig.apiKey?.trim()) {
      setError('⚠️ 已选择自定义 AI 供应商，但尚未填写 API Key。');
      return;
    }

    if (generationMode === 'stream' && !STREAMABLE_SCHEMA_IDS.includes(schemaId)) {
      setError('⚠️ 流式生成仅支持通用角色/通用情景卡，请先切换 Schema。');
      return;
    }

    if (!prompt.trim()) {
      setError('请先输入提示词。');
      return;
    }

    setSubmitting(true);
    setError(null);
    setResultData(null);
    setStreamingMarkdown(null);
    setStreamedGeneralCard(null);

    try {
      const localCheck = await quickCheck(prompt);
      if (localCheck.hasSensitiveWords) {
        router.push({
          pathname: '/arrested',
          query: { reason: '在自由生成中使用了危险符文' },
        });
        return;
      }

      const requestBody: Record<string, unknown> = {
        schema: schemaId,
        prompt,
        language: selectedLanguage,
      };

      const customProviderPayload = buildCustomProviderPayload(userProviderConfig);
      if (customProviderPayload) {
        requestBody.customProvider = {
          providerId: customProviderPayload.providerId,
          modelId: customProviderPayload.modelId,
          apiKey: customProviderPayload.apiKey.trim(),
        };
      }

      const endpoint = generationMode === 'stream' ? '/api/generate-free-stream' : '/api/generate-free';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => null as any);
        if (errorJson?.shouldRedirect) {
          router.push({
            pathname: '/arrested',
            query: { reason: errorJson.reason || '使用危险符文' },
          });
          return;
        }
        const serverMessage = errorJson?.message || errorJson?.error;
        throw new Error(serverMessage ? `${serverMessage}（HTTP ${response.status}）` : `生成失败（HTTP ${response.status}）`);
      }

      if (generationMode === 'stream') {
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json') || contentType.includes('+json')) {
          const errorJson = await response.json().catch(() => null as any);
          const serverMessage = errorJson?.message || errorJson?.error;
          throw new Error(serverMessage ? `${serverMessage}（HTTP ${response.status}）` : `生成失败（HTTP ${response.status}）`);
        }

        const markdown = await readTextStreamFromResponse(response, {
          label: '自由生成（流式）',
          onText: (text) => setStreamingMarkdown(text),
        });

        if (schemaId === 'general') {
          const { card } = buildGeneralCharacterCardFromMarkdown({
            markdown,
            defaultName: '角色',
          });
          setStreamedGeneralCard(card);
        } else {
          const { card } = buildGeneralScenarioCardFromMarkdown({
            markdown,
            defaultTitle: '情景',
          });
          setStreamedGeneralCard(card);
        }

        startCooldown(freeCooldownMs);
        return;
      }

      const json = await response.json();
      setResultData(json);
      startCooldown(freeCooldownMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : '发生未知错误';
      setError(`✨ 生成失败！${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const renderResultActions = (data: any, kind: 'character' | 'scenario') => {
    const labelBase =
      kind === 'scenario'
        ? (data?.title || data?.name || '自定义情景')
        : (data?.codename || data?.name || '自定义角色');
    const safeBase = String(labelBase).replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').slice(0, 80) || 'data';
    const fileName = `${kind === 'scenario' ? '数据卡_情景' : '数据卡_角色'}_${safeBase}.json`;

    return (
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          onClick={() => downloadJson(data, fileName)}
          className="generate-button flex-1"
        >
          下载 JSON
        </button>
        <SaveToCloudButton
          data={data}
          cardType={kind}
          buttonText="保存到云端"
          className="generate-button flex-1"
          style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
        />
        <button
          onClick={() => void copyToClipboard(data, kind === 'scenario' ? '情景卡' : '角色卡')}
          className="generate-button flex-1"
          style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}
        >
          复制到剪贴板
        </button>
      </div>
    );
  };

  const renderResult = () => {
    if (generationMode === 'stream') {
      if (streamingMarkdown === null && !streamedGeneralCard) return null;

      const isGeneralScenario = streamedGeneralCard?.templateId === GENERAL_SCENARIO_TEMPLATE_ID || schemaId === 'general-scenario';
      const title = isGeneralScenario ? '通用情景卡（流式）' : '通用角色卡（流式）';

      return (
        <>
          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 className="text-2xl font-bold text-center mb-4">{title}</h2>
            <div className="rounded-lg bg-gray-50 p-4 border border-gray-200">
              {streamingMarkdown ? (
                <MarkdownBlock content={streamingMarkdown} variant="light" mode="article" />
              ) : submitting ? (
                <div className="text-sm text-gray-500 text-center">正在启动流式生成…</div>
              ) : (
                <div className="text-sm text-gray-500 text-center">生成结果将显示在此处</div>
              )}
            </div>
            <p className="mt-3 text-xs text-gray-500">
              提示：流式模式只输出 Markdown，再由前端转换为通用数据卡；自由生成产物不会包含签名，因此会被视为非原生。
            </p>
          </div>

          {streamedGeneralCard && (
            <>
              {streamedGeneralCard.templateId === GENERAL_CHARACTER_TEMPLATE_ID ? (
                <GeneralCharacterCard general={streamedGeneralCard} />
              ) : (
                <div className="card" style={{ marginTop: '1rem' }}>
                  <h3 className="text-lg font-semibold text-gray-800 mb-3">通用情景卡 JSON</h3>
                  <div className="rounded-lg bg-gray-100 p-4 border border-gray-200 font-mono text-xs overflow-x-auto">
                    <pre>{JSON.stringify(streamedGeneralCard, null, 2)}</pre>
                  </div>
                </div>
              )}

              <div className="card" style={{ marginTop: '1rem' }}>
                <div className="text-center">
                  <h3 className="text-lg font-medium text-gray-800 mb-4">后续操作</h3>
                  {renderResultActions(streamedGeneralCard, streamedGeneralCard.templateId === GENERAL_SCENARIO_TEMPLATE_ID ? 'scenario' : 'character')}
                </div>
              </div>
            </>
          )}
        </>
      );
    }

    if (!resultData) return null;

    const selectedOption = SCHEMA_OPTIONS.find(item => item.id === schemaId) ?? null;
    const kind = selectedOption?.kind ?? 'character';

    if (schemaId === 'magical-girl') {
      return (
        <>
          <MagicalGirlCard
            magicalGirl={resultData}
            gradientStyle="linear-gradient(135deg, #9775fa 0%, #b197fc 100%)"
          />
          <div className="card" style={{ marginTop: '1rem' }}>
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-3">
                提示：自由生成产物不会包含签名，因此会被视为非原生卡。
              </p>
              {renderResultActions(resultData, 'character')}
            </div>
          </div>
        </>
      );
    }

    if (schemaId === 'canshou') {
      return (
        <>
          <CanshouCard canshou={resultData} />
          <div className="card" style={{ marginTop: '1rem' }}>
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-3">
                提示：自由生成产物不会包含签名，因此会被视为非原生卡。
              </p>
              {renderResultActions(resultData, 'character')}
            </div>
          </div>
        </>
      );
    }

    if (schemaId === 'general') {
      return (
        <>
          <GeneralCharacterCard general={resultData} />
          <div className="card" style={{ marginTop: '1rem' }}>
            <div className="text-center">
              {renderResultActions(resultData, 'character')}
            </div>
          </div>
        </>
      );
    }

    if (schemaId === 'general-scenario') {
      return (
        <>
          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 className="text-2xl font-bold text-center mb-4">{resultData.title || '通用情景卡'}</h2>
            <div className="rounded-lg bg-gray-50 p-4 border border-gray-200">
              <MarkdownBlock content={resultData.content || ''} variant="light" mode="article" />
            </div>
          </div>
          <div className="card" style={{ marginTop: '1rem' }}>
            <h3 className="text-lg font-semibold text-gray-800 mb-3">通用情景卡 JSON</h3>
            <div className="rounded-lg bg-gray-100 p-4 border border-gray-200 font-mono text-xs overflow-x-auto">
              <pre>{JSON.stringify(resultData, null, 2)}</pre>
            </div>
            <div className="mt-4 text-center">
              {renderResultActions(resultData, 'scenario')}
            </div>
          </div>
        </>
      );
    }

    // scenario（结构化）
    return (
      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 className="text-2xl font-bold text-center mb-4">{resultData.title || '结构化情景'}</h2>
        <div className="bg-gray-100 p-4 rounded-lg font-mono text-xs overflow-x-auto">
          <pre>{JSON.stringify(resultData, null, 2)}</pre>
        </div>
        <p className="mt-3 text-xs text-gray-500 text-center">
          提示：自由生成产物不会包含签名，因此会被视为非原生卡。
        </p>
        <div className="mt-4 text-center">
          {renderResultActions(resultData, kind)}
        </div>
      </div>
    );
  };

  return (
    <>
      <Head>
        <title>自由生成 - MahoShojo Generator</title>
        <meta name="description" content="自由输入提示词，按指定 Schema 生成任意数据卡（角色/情景）。自由生成产物为非原生。" />
      </Head>
      <div className="magic-background-white">
        <div className="container">
          <div className="card">
            <div className="text-center mb-4">
              <h1 className="text-2xl font-bold text-pink-700">自由生成</h1>
              <p className="subtitle mt-2">
                自由输入任意长度提示词，选择 Schema 后生成数据卡（角色 / 情景）。自由生成产物将被视为非原生卡（不生成签名）。
              </p>
            </div>

            <div className="space-y-4">
              <div className="input-group">
                <label className="input-label">选择 Schema</label>
                <select
                  value={schemaId}
                  onChange={(e) => setSchemaId(e.target.value as FreeSchemaId)}
                  className="input-field"
                  disabled={submitting}
                >
                  {schemaOptionsForMode.map(option => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {SCHEMA_OPTIONS.find(item => item.id === schemaId)?.description}
                </p>
              </div>

              <div className="my-2 bg-gray-100 rounded-lg p-3">
                <button
                  onClick={() => setShowFieldGuide(!showFieldGuide)}
                  className="flex items-center justify-between w-full text-left font-medium text-gray-700 hover:text-blue-600"
                >
                  <span>Schema 字段说明（系统提示词）</span>
                  <span className="ml-2">{showFieldGuide ? '▼' : '▶'}</span>
                </button>
                {showFieldGuide && (
                  <div className="mt-3 rounded-lg bg-white/80 p-3 border border-gray-200 text-xs text-gray-700 whitespace-pre-wrap">
                    {fieldGuideText}
                  </div>
                )}
              </div>

              <div className="input-group">
                <label className="input-label">提示词（任意长度）</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="在这里写你的完整提示词：你想要的风格、设定、限制、字段填充偏好等都由你决定。"
                  className="input-field min-h-[10rem] resize-y"
                  rows={10}
                  disabled={submitting}
                />
                <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                  <span>字符数：{prompt.length}</span>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className="text-blue-600 hover:underline"
                      onClick={() => {
                        navigator.clipboard.writeText(prompt).then(() => alert('已复制提示词到剪贴板')).catch(() => alert('复制失败'));
                      }}
                      disabled={!prompt.trim()}
                    >
                      复制提示词
                    </button>
                    <button
                      type="button"
                      className="text-red-600 hover:underline"
                      onClick={handleClearDraft}
                      disabled={submitting}
                    >
                      清空存档
                    </button>
                  </div>
                </div>
              </div>

              <div className="my-2 bg-gray-100 rounded-lg p-3">
                <GenerationModeSwitcher
                  label="生成方式"
                  value={generationMode}
                  disabled={submitting}
                  helper={false}
                  onChange={(mode) => setGenerationMode(mode)}
                />
                <p className="text-xs text-gray-600 mt-2">
                  {generationMode === 'stream'
                    ? '提示：流式生成只支持通用角色/通用情景卡（Markdown），会实时输出正文。'
                    : '提示：非流式生成会返回结构化 JSON，可生成任意 Schema。'}
                </p>
              </div>

              <div className="my-2 bg-gray-100 rounded-lg p-3">
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

              <div className="my-2 bg-gray-50 rounded-lg p-3">
                <AiProviderSelector onConfigChange={setUserProviderConfig} />
                <p className="mt-2 text-xs text-gray-500">使用自有 API Key 可缩短冷却至 3 秒，便于批量迭代生成。</p>
              </div>

              <button
                onClick={handleGenerate}
                disabled={submitting || isCooldown}
                className="generate-button"
              >
                {isCooldown ? `冷却中 (${remainingTime}s)` : submitting ? '生成中...' : '开始生成'}
              </button>

              {error && <ErrorMessage message={error} className="mt-3" />}

              <div className="mt-6 text-center">
                <Link href="/" className="footer-link">返回首页</Link>
              </div>
            </div>
          </div>

          {renderResult()}

          <Footer className="footer" />
        </div>
      </div>
    </>
  );
}

