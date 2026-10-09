'use client';

import { useGeneratedResultAutoScroll } from '@mahoshojo/ui-web/details-controls';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAppRouterAdapter } from '@/lib/app-router-adapter';

import Footer from '@/components/Footer';
import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import { ErrorMessage } from '@/components/ErrorMessage';
import AiReasoningPanel from '@/components/ai/AiReasoningPanel';
import { ProviderCooldownNotice } from '@/components/ai/ProviderCooldownNotice';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import { GenerationModeSwitcher, type GenerationMode } from '@/components/shared/GenerationModeSwitcher';
import { CharacterPortraitAssetPanel } from '@/components/shared/CharacterPortraitAssetPanel';
import { TokenIndicator } from '@/components/shared/TokenIndicator';
import { JsonSizeIndicator } from '@/components/shared/JsonSizeIndicator';
import { StreamStopButton } from '@/components/shared/StreamStopButton';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import MagicalGirlCard from '@/components/MagicalGirlCard';
import CanshouCard from '@/components/CanshouCard';
import GeneralCharacterCard from '@/components/GeneralCharacterCard';

import { useProviderModeCooldown } from '@/lib/cooldown';
import { getSensitiveWordRedirectTarget } from '@/lib/content-safety/client';
import { buildGeneralCharacterCardFromMarkdown, buildGeneralScenarioCardFromMarkdown } from '@/lib/stream/markdown-card';
import { readSafeTextAndReasoningStreamFromResponse } from '@/lib/stream/read-safe-text-and-reasoning-stream';
import { USER_PROVIDED_KEY_COOLDOWN_MS, OFFICIAL_KEY_MAX_AI_COOLDOWN_MS } from '@/lib/ai/cooldowns';
import { buildCustomProviderRequestPayload, isUsingUserProvidedKey } from '@/lib/ai/custom-provider';
import { formatReferenceAttachmentsForPrompt } from '@/lib/ai/attachments';
import { GENERAL_SCENARIO_TEMPLATE_ID } from '@/lib/schemas/general-scenario';
import { readJsonOrTextFromResponse, resolveApiErrorMessage } from '@/lib/client/apiError';
import { AI_META_REQUEST_HEADER, AI_META_REQUEST_VALUE, readJsonWithAiMeta } from '@/lib/client/read-json-with-ai-meta';
import { formatHttpErrorMessage } from '@/lib/client/httpError';
import { downloadBlob } from '@/lib/client/blobUrl';
import { authStorage } from '@/lib/auth';
import { useGenerationApiIntentLatch } from '@/lib/use-generation-api-intent-latch';
import { STREAM_ABORT_REASON_USER } from '@/lib/stream/abort';
import type { AIReasoningEnvelope } from '@/types/ai-reasoning';
import type { CharacterCardPortraitAsset } from '@/types/visual-asset';
// Schema 目录 / 字段速览 / 提示词占位与 Desktop 共源（ui-web/free）；
// 流式白名单以 ai-core 为准，不再本地另存一份。
import {
  FreePageLayout,
  FreeResultActions,
  FreeResultPanel,
  FreeJsonResult,
  FreeAttachmentPanel,
  FreeSchemaFields,
  FreePromptField,
  FreeLanguageField,
  FREE_SCHEMA_OPTIONS,
  freeSchemaOptionsForMode,
  toPromptAttachments,
  useFreeAttachments,
} from '@mahoshojo/ui-web/free';
import { isFreeStreamSchemaId, type FreeSchemaId } from '@mahoshojo/ai-core/free-generation';

const LOCAL_STORAGE_KEY = 'mahoshojo.free-generator.draft.v1';

const SENSITIVE_CHECK_MAX_CHARS = 50_000;

type RateLimitError = Error & {
  retryAfterSeconds?: number;
};

const isPlainObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ensureString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const ensureStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string' && value.trim()) {
    return [value];
  }
  return [];
};

const normalizeMagicalGirlForCard = (input: unknown): any => {
  const record = isPlainObject(input) ? input : {};

  const appearance = isPlainObject(record.appearance) ? record.appearance : {};
  const magicConstruct = isPlainObject(record.magicConstruct) ? record.magicConstruct : {};
  const wonderlandRule = isPlainObject(record.wonderlandRule) ? record.wonderlandRule : {};
  const blooming = isPlainObject(record.blooming) ? record.blooming : {};
  const analysis = isPlainObject(record.analysis) ? record.analysis : {};

  const backgroundRaw = isPlainObject(analysis.background) ? analysis.background : null;
  const hasBackground = Boolean(backgroundRaw && (typeof backgroundRaw.belief === 'string' || typeof backgroundRaw.bonds === 'string'));

  return {
    ...record,
    codename: ensureString(record.codename, ensureString(record.name, '未命名魔法少女')),
    appearance: {
      outfit: ensureString(appearance.outfit),
      accessories: ensureString(appearance.accessories),
      colorScheme: ensureString(appearance.colorScheme),
      overallLook: ensureString(appearance.overallLook),
    },
    magicConstruct: {
      name: ensureString(magicConstruct.name),
      form: ensureString(magicConstruct.form),
      basicAbilities: ensureStringArray(magicConstruct.basicAbilities),
      description: ensureString(magicConstruct.description),
    },
    wonderlandRule: {
      name: ensureString(wonderlandRule.name),
      description: ensureString(wonderlandRule.description),
      tendency: ensureString(wonderlandRule.tendency),
      activation: ensureString(wonderlandRule.activation),
    },
    blooming: {
      name: ensureString(blooming.name),
      evolvedAbilities: ensureStringArray(blooming.evolvedAbilities),
      evolvedForm: ensureString(blooming.evolvedForm),
      evolvedOutfit: ensureString(blooming.evolvedOutfit),
      powerLevel: ensureString(blooming.powerLevel),
    },
    analysis: {
      personalityAnalysis: ensureString(analysis.personalityAnalysis),
      abilityReasoning: ensureString(analysis.abilityReasoning),
      coreTraits: ensureStringArray(analysis.coreTraits),
      predictionBasis: ensureString(analysis.predictionBasis),
      ...(hasBackground
        ? {
          background: {
            belief: ensureString(backgroundRaw?.belief),
            bonds: ensureString(backgroundRaw?.bonds),
          },
        }
        : {}),
    },
  };
};

const normalizeCanshouForCard = (input: unknown): any => {
  const record = isPlainObject(input) ? input : {};
  return {
    ...record,
    name: ensureString(record.name, ensureString(record.codename, '未命名残兽')),
    appearance: ensureString(record.appearance),
    materialAndSkin: ensureString(record.materialAndSkin),
    featuresAndAppendages: ensureString(record.featuresAndAppendages),
    coreConcept: ensureString(record.coreConcept),
    coreEmotion: ensureString(record.coreEmotion),
    evolutionStage: ensureString(record.evolutionStage),
    attackMethod: ensureString(record.attackMethod),
    specialAbility: ensureString(record.specialAbility),
    origin: ensureString(record.origin),
    birthEnvironment: ensureString(record.birthEnvironment),
    researcherNotes: ensureString(record.researcherNotes),
  };
};

const buildGeneralPortraitPrompt = (name: string, content: string): string => {
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedContent = typeof content === 'string' ? content.trim() : '';
  const head = normalizedContent.length > 800 ? normalizedContent.slice(0, 800) : normalizedContent;
  const prefix = [normalizedName, head].filter(Boolean).join(', ');
  return `${prefix ? `${prefix}, ` : ''}Xiabanmo, 二次元, 角色立绘`;
};

const buildCanshouPortraitPrompt = (input: Record<string, unknown>): string => {
  const parts = [input.appearance, input.materialAndSkin, input.featuresAndAppendages]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  return parts.join(', ');
};

export function FreePage() {
  const generationApiIntentLatch = useGenerationApiIntentLatch();
  const resultSectionRef = useRef<HTMLDivElement | null>(null);
  const beginResultNavigation = useGeneratedResultAutoScroll(resultSectionRef);
  const router = useAppRouterAdapter();
  // 附件会话共源（ui-web/free）：读取代际失效、合并前预算复核、maxCount
  // 上限与 Desktop 同一实现；附件不写入草稿。
  const attachmentState = useFreeAttachments();
  const { items: attachments, isReading: isReadingAttachments, error: attachmentError, clear: clearAttachments } = attachmentState;

  const [schemaId, setSchemaId] = useState<FreeSchemaId>('general');
  const [generationMode, setGenerationMode] = useState<GenerationMode>('non-stream');
  const [prompt, setPrompt] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [resultData, setResultData] = useState<any | null>(null);
  const [nonStreamReasoning, setNonStreamReasoning] = useState<AIReasoningEnvelope | null>(null);

  const [streamingMarkdown, setStreamingMarkdown] = useState<string | null>(null);
  const [streamedGeneralCard, setStreamedGeneralCard] = useState<any | null>(null);
  const [streamingReasoning, setStreamingReasoning] = useState<AIReasoningEnvelope | null>(null);
  const [streamNotice, setStreamNotice] = useState<string | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const [characterPortraitAsset, setCharacterPortraitAsset] = useState<CharacterCardPortraitAsset | null>(null);

  const [showFieldGuide, setShowFieldGuide] = useState(false);
  const [showLanguageSection, setShowLanguageSection] = useState(false);
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('zh-CN');

  const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);
  const isUserCustomKey = isUsingUserProvidedKey(userProviderConfig);
  const providerCooldownMode = isUserCustomKey ? 'custom' : 'system';
  const freeCooldownMs = isUserCustomKey ? USER_PROVIDED_KEY_COOLDOWN_MS : OFFICIAL_KEY_MAX_AI_COOLDOWN_MS;
  const { isCooldown, startCooldown, remainingTime, otherRemainingTime } = useProviderModeCooldown({
    baseKey: 'freeCooldown',
    currentMode: providerCooldownMode,
    systemDurationMs: OFFICIAL_KEY_MAX_AI_COOLDOWN_MS,
    customDurationMs: USER_PROVIDED_KEY_COOLDOWN_MS,
  });

  const schemaOptionsForMode = useMemo(() => freeSchemaOptionsForMode(generationMode), [generationMode]);


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
    if (isFreeStreamSchemaId(schemaId)) return;
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
        showFieldGuide,
        showLanguageSection,
      };
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage 可能不可用，忽略
    }
  }, [generationMode, prompt, schemaId, selectedLanguage, showFieldGuide, showLanguageSection]);

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
      if (typeof parsed?.showFieldGuide === 'boolean') setShowFieldGuide(parsed.showFieldGuide);
      if (typeof parsed?.showLanguageSection === 'boolean') setShowLanguageSection(parsed.showLanguageSection);
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
    clearAttachments();
  };

  const tokenEstimateText = useMemo(() => {
    const blocks: string[] = [];
    if (prompt.trim()) blocks.push(prompt);
    const attachmentsText = formatReferenceAttachmentsForPrompt(attachments);
    if (attachmentsText.trim()) blocks.push(attachmentsText);
    return blocks.join('\n\n');
  }, [attachments, prompt]);

  const downloadJson = (data: any, suggestedName: string) => {
    const jsonData = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    downloadBlob(blob, suggestedName);
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

    if (isReadingAttachments) {
      setError('附件读取中，请稍候再试。');
      return;
    }

    if (userProviderConfig && userProviderConfig.providerId !== 'system' && !userProviderConfig.apiKey?.trim()) {
      setError('⚠️ 已选择自定义 AI 供应商，但尚未填写 API Key。');
      return;
    }

    if (generationMode === 'stream' && !isFreeStreamSchemaId(schemaId)) {
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
    setNonStreamReasoning(null);
    setStreamingMarkdown(null);
    setStreamedGeneralCard(null);
    setStreamingReasoning(null);
    setStreamNotice(null);
    setCharacterPortraitAsset(null);
    let nextCooldownMs = freeCooldownMs;
    let shouldStartCooldown = false;

    try {
      const combinedForSafety = [prompt, ...attachments.map((item) => item.content)].filter((t) => t.trim()).join('\n\n');
      const safetyText = combinedForSafety.length > SENSITIVE_CHECK_MAX_CHARS ? combinedForSafety.slice(0, SENSITIVE_CHECK_MAX_CHARS) : combinedForSafety;
      const redirectTarget = await getSensitiveWordRedirectTarget(safetyText, {
        reason: '在自由生成中使用了危险符文',
      });
      if (redirectTarget) {
        router.push(redirectTarget);
        return;
      }

      const requestBody: Record<string, unknown> = {
        schema: schemaId,
        prompt,
        language: selectedLanguage,
      };

      if (attachments.length > 0) {
        requestBody.attachments = toPromptAttachments(attachments);
      }

      const customProviderPayload = buildCustomProviderRequestPayload(userProviderConfig);
      if (customProviderPayload) {
        requestBody.customProvider = customProviderPayload;
      }

      const endpoint = generationMode === 'stream' ? '/api/generate-free-stream?format=sse' : '/api/generate-free';
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
        body: JSON.stringify(requestBody),
        ...(streamController ? { signal: streamController.signal } : {}),
      });

      if (!response.ok) {
        const { payload } = await readJsonOrTextFromResponse(response);
        const errorJson = payload && typeof payload === 'object' ? (payload as any) : null;
        if (errorJson?.shouldRedirect) {
          router.push({
            pathname: '/arrested',
            query: { reason: errorJson.reason || '使用危险符文' },
          });
          return;
        }
        if (response.status === 429) {
          const retryAfterRaw = errorJson?.retryAfterSeconds ?? errorJson?.retryAfter ?? response.headers.get('Retry-After') ?? 60;
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
        const controller = streamAbortControllerRef.current;
        if (!controller) {
          throw new Error('流式控制器初始化失败');
        }
        const { text: markdown, outputSafetyStatus, wasAborted, abortReason } = await readSafeTextAndReasoningStreamFromResponse(response, {
          abortController: controller,
          label: '自由生成（流式）',
          onText: (text) => {
            setStreamingMarkdown(text);
            if (text.trim()) revealGeneratedResult();
          },
          onReasoning: (reasoning) => setStreamingReasoning(reasoning),
          safetyReason: '使用危险符文',
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

        if (outputSafetyStatus === 'blocked') {
          setStreamNotice('输出触发调查院规则，已自动截断并追加逮捕令。当前内容可能不完整，但可继续保存。');
        } else if (wasAborted) {
          setStreamNotice(
            abortReason === STREAM_ABORT_REASON_USER
              ? '已手动停止生成。当前内容可能不完整，但可继续保存。'
              : '流式生成已中断。当前内容可能不完整，但可继续保存。'
          );
        }

        shouldStartCooldown = true;
        return;
      }

      const { data, aiMeta } = await readJsonWithAiMeta<any>(response);
      setResultData(data);
      revealGeneratedResult();
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
        const message = err instanceof Error ? err.message : '发生未知错误';
        setError(`✨ 生成失败！${message}`);
      }
    } finally {
      streamAbortControllerRef.current = null;
      if (shouldStartCooldown) {
        startCooldown(nextCooldownMs);
      }
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
      <FreeResultActions sizeIndicator={(
        <JsonSizeIndicator data={data} warningText="⚠️ 接近云端 300KB 上限，保存/替换可能失败，请先精简数据。" />
      )}>
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
      </FreeResultActions>
    );
  };

  const renderResult = () => {
    if (generationMode === 'stream') {
      if (streamingMarkdown === null && !streamedGeneralCard) return null;

      const isGeneralScenario = streamedGeneralCard?.templateId === GENERAL_SCENARIO_TEMPLATE_ID || schemaId === 'general-scenario';
      const title = isGeneralScenario ? '通用情景卡（流式）' : '通用角色卡（流式）';

      return (
        <>
          {isGeneralScenario ? (
            <div className="card !max-w-none">
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
              <AiReasoningPanel reasoning={streamingReasoning} status={streamingReasoning?.status ?? 'idle'} compact />
              <p className="mt-3 text-xs text-gray-500">
                提示：流式模式只输出 Markdown，再由前端转换为通用数据卡；自由生成产物不会包含签名，因此会被视为非原生。
              </p>
            </div>
          ) : (
            (() => {
              const markdown = streamingMarkdown ?? streamedGeneralCard?.content ?? '';
              const { card } = buildGeneralCharacterCardFromMarkdown({ markdown, defaultName: '角色' });
              const promptForPortrait = buildGeneralPortraitPrompt(
                typeof card.name === 'string' ? card.name : '',
                markdown
              );

              return (
                <>
                  <GeneralCharacterCard
                    general={card}
                    isStreaming={submitting}
                    onStopGeneration={() => streamAbortControllerRef.current?.abort(STREAM_ABORT_REASON_USER)}
                    portraitAsset={characterPortraitAsset}
                  />
                  <AiReasoningPanel reasoning={streamingReasoning} status={streamingReasoning?.status ?? 'idle'} compact />
                  <div className="card !max-w-none">
                    <div className="text-center">
                      <h3 className="text-lg font-medium text-blue-900 mb-4">生成立绘</h3>
                      <CharacterPortraitAssetPanel
                        prompt={promptForPortrait}
                        onPortraitAssetChange={setCharacterPortraitAsset}
                      />
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-gray-500 text-center">
                    提示：流式模式只输出 Markdown，再由前端转换为通用数据卡；自由生成产物不会包含签名，因此会被视为非原生。
                  </p>
                </>
              );
            })()
          )}

          {streamedGeneralCard && (
            <>
              {streamedGeneralCard.templateId === GENERAL_SCENARIO_TEMPLATE_ID ? (
                <div className="card !max-w-none">
                  <h3 className="text-lg font-semibold text-gray-800 mb-3">通用情景卡 JSON</h3>
                  <div className="rounded-lg bg-gray-100 p-4 border border-gray-200 font-mono text-xs overflow-x-auto">
                    <pre>{JSON.stringify(streamedGeneralCard, null, 2)}</pre>
                  </div>
                </div>
              ) : null}

              <div className="card !max-w-none">
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

    const selectedOption = FREE_SCHEMA_OPTIONS.find(item => item.id === schemaId) ?? null;
    const kind = selectedOption?.kind ?? 'character';
    const nonStreamReasoningNode = nonStreamReasoning ? (
      <AiReasoningPanel
        reasoning={nonStreamReasoning}
        status={nonStreamReasoning.status}
        displayMode="content-only"
        compact
      />
    ) : null;

    if (schemaId === 'magical-girl') {
      const safe = normalizeMagicalGirlForCard(resultData);
      return (
        <>
          {nonStreamReasoningNode}
          <MagicalGirlCard
            magicalGirl={safe}
            gradientStyle="linear-gradient(135deg, #9775fa 0%, #b197fc 100%)"
            portraitAsset={characterPortraitAsset}
          />
          <div className="card !max-w-none">
            <div className="text-center">
              <h3 className="text-lg font-medium text-blue-900 mb-4">生成立绘</h3>
              <CharacterPortraitAssetPanel
                prompt={`${JSON.stringify(safe.appearance)} , Xiabanmo, 二次元, 魔法少女`}
                onPortraitAssetChange={setCharacterPortraitAsset}
              />
            </div>
          </div>
          <div className="card !max-w-none">
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-3">
                提示：自由生成产物不会包含签名，因此会被视为非原生卡。
              </p>
              {renderResultActions(safe, 'character')}
            </div>
          </div>
        </>
      );
    }

    if (schemaId === 'canshou') {
      const safe = normalizeCanshouForCard(resultData);
      const promptForPortrait = buildCanshouPortraitPrompt(safe);
      return (
        <>
          {nonStreamReasoningNode}
          <CanshouCard canshou={safe} portraitAsset={characterPortraitAsset} />
          <div className="card !max-w-none">
            <div className="text-center">
              <h3 className="text-lg font-medium text-blue-900 mb-4">生成立绘</h3>
              <CharacterPortraitAssetPanel
                prompt={promptForPortrait}
                onPortraitAssetChange={setCharacterPortraitAsset}
              />
            </div>
          </div>
          <div className="card !max-w-none">
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-3">
                提示：自由生成产物不会包含签名，因此会被视为非原生卡。
              </p>
              {renderResultActions(safe, 'character')}
            </div>
          </div>
        </>
      );
    }

    if (schemaId === 'general') {
      const promptForPortrait = buildGeneralPortraitPrompt(
        typeof resultData?.name === 'string' ? resultData.name : '',
        typeof resultData?.content === 'string' ? resultData.content : ''
      );
      return (
        <>
          {nonStreamReasoningNode}
          <GeneralCharacterCard general={resultData} portraitAsset={characterPortraitAsset} />
          <div className="card !max-w-none">
            <div className="text-center">
              <h3 className="text-lg font-medium text-blue-900 mb-4">生成立绘</h3>
              <CharacterPortraitAssetPanel
                prompt={promptForPortrait}
                onPortraitAssetChange={setCharacterPortraitAsset}
              />
            </div>
          </div>
          <div className="card !max-w-none">
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
          {nonStreamReasoningNode}
          <FreeResultPanel title={resultData.title || '通用情景卡'}>
            <div className="rounded-lg bg-gray-50 p-4 border border-gray-200">
              <MarkdownBlock content={resultData.content || ''} variant="light" mode="article" />
            </div>
          </FreeResultPanel>
          <div className="card !max-w-none">
            <h3 className="text-lg font-semibold text-gray-800 mb-3">通用情景卡 JSON</h3>
            <FreeJsonResult data={resultData} />
            <div className="mt-4 text-center">
              {renderResultActions(resultData, 'scenario')}
            </div>
          </div>
        </>
      );
    }

    // scenario（结构化）
    return (
      <>
        {nonStreamReasoningNode}
        <FreeResultPanel title={resultData.title || '结构化情景'}>
          <FreeJsonResult data={resultData} />
          <p className="mt-3 text-xs text-gray-500 text-center">
            提示：自由生成产物不会包含签名，因此会被视为非原生卡。
          </p>
          <div className="mt-4 text-center">
            {renderResultActions(resultData, kind)}
          </div>
        </FreeResultPanel>
      </>
    );
  };

  const resultNode = renderResult();

  return (
    <FreePageLayout
      controls={(
        <div className="space-y-4">
          <FreeSchemaFields
            schemaId={schemaId}
            options={schemaOptionsForMode}
            onChange={setSchemaId}
            showFieldGuide={showFieldGuide}
            onToggleFieldGuide={() => setShowFieldGuide(!showFieldGuide)}
            disabled={submitting}
          />

          <FreePromptField
            value={prompt}
            onChange={setPrompt}
            disabled={submitting}
            actions={(
              <>
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

              </>
            )}
          />

          <FreeAttachmentPanel
            state={attachmentState}
            disabled={submitting}
            errorContent={attachmentError ? <ErrorMessage message={attachmentError} /> : undefined}
          />

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

          <FreeLanguageField
            value={selectedLanguage}
            languages={languages}
            expanded={showLanguageSection}
            onToggle={() => setShowLanguageSection(!showLanguageSection)}
            onChange={setSelectedLanguage}
            disabled={submitting}
          />

          <div className="my-2 bg-gray-50 rounded-lg p-3">
            <AiProviderSelector onConfigChange={setUserProviderConfig} />
            <p className="mt-2 text-xs text-gray-500">使用自有 API Key 可缩短冷却至 3 秒，便于批量迭代生成。</p>
            <ProviderCooldownNotice
              currentMode={providerCooldownMode}
              currentIsCooldown={isCooldown}
              otherRemainingTime={otherRemainingTime}
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={submitting || isCooldown || isReadingAttachments}
            className="generate-button"
          >
            {isCooldown ? `冷却中 (${remainingTime}s)` : submitting ? '生成中...' : '开始生成'}
          </button>
          {submitting && generationMode === 'stream' ? (
            <div className="mt-3 flex justify-center">
              <StreamStopButton
                onClick={() => streamAbortControllerRef.current?.abort(STREAM_ABORT_REASON_USER)}
                label="停止生成"
              />
            </div>
          ) : null}

          <TokenIndicator
            text={tokenEstimateText}
            warningText="⚠️ 预计上下文较长，可能更易超时/失败。可尝试精简提示词或减少/拆分附件。"
          />

          {error && <ErrorMessage message={error} className="mt-3" />}
          {streamNotice ? <div className="mt-3 text-center text-sm text-amber-700">{streamNotice}</div> : null}

          <div className="mt-6 text-center">
            <Link href="/" className="footer-link">返回首页</Link>
          </div>
        </div>
      )}
      result={resultNode ? <div ref={resultSectionRef}>{resultNode}</div> : null}
      footer={<Footer className="footer" />}
    />
  );
}
