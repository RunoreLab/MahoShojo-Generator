import React, { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';

import Footer from '@/components/Footer';
import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import { ErrorMessage } from '@/components/ErrorMessage';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import { GenerationModeSwitcher, type GenerationMode } from '@/components/shared/GenerationModeSwitcher';
import { TokenIndicator } from '@/components/shared/TokenIndicator';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import MagicalGirlCard from '@/components/MagicalGirlCard';
import CanshouCard from '@/components/CanshouCard';
import GeneralCharacterCard from '@/components/GeneralCharacterCard';

import { useCooldown } from '@/lib/cooldown';
import { getSensitiveWordRedirectTarget } from '@/lib/content-safety/client';
import { readTextStreamFromResponse } from '@/lib/stream/read-text-stream';
import { buildGeneralCharacterCardFromMarkdown, buildGeneralScenarioCardFromMarkdown } from '@/lib/stream/markdown-card';
import { USER_PROVIDED_KEY_COOLDOWN_MS, OFFICIAL_KEY_MAX_AI_COOLDOWN_MS } from '@/lib/ai/cooldowns';
import { buildCustomProviderPayload, isUsingUserProvidedKey } from '@/lib/ai/custom-provider';
import { FREE_GENERATION_ATTACHMENT_LIMITS, formatReferenceAttachmentsForPrompt } from '@/lib/ai/attachments';
import { GENERAL_SCENARIO_TEMPLATE_ID } from '@/lib/schemas/general-scenario';
import { formatHttpErrorMessage } from '@/lib/client/httpError';

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

type FreeAttachmentInput = {
  name: string;
  type: string;
  size: number;
  content: string;
  truncated?: boolean;
};

type FreeAttachmentState = FreeAttachmentInput & {
  id: string;
  includedBytes: number;
};

const MAX_ATTACHMENT_BYTES_PER_FILE = FREE_GENERATION_ATTACHMENT_LIMITS.maxBytesPerFile;
const MAX_ATTACHMENT_BYTES_TOTAL = FREE_GENERATION_ATTACHMENT_LIMITS.maxBytesTotal;
const MAX_ATTACHMENT_CHARS_PER_FILE = FREE_GENERATION_ATTACHMENT_LIMITS.maxCharsPerFile;
const MAX_ATTACHMENT_CHARS_TOTAL = FREE_GENERATION_ATTACHMENT_LIMITS.maxCharsTotal;
const SENSITIVE_CHECK_MAX_CHARS = 50_000;

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
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
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const [schemaId, setSchemaId] = useState<FreeSchemaId>('general');
  const [generationMode, setGenerationMode] = useState<GenerationMode>('non-stream');
  const [prompt, setPrompt] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isReadingAttachments, setIsReadingAttachments] = useState(false);

  const [resultData, setResultData] = useState<any | null>(null);

  const [streamingMarkdown, setStreamingMarkdown] = useState<string | null>(null);
  const [streamedGeneralCard, setStreamedGeneralCard] = useState<any | null>(null);

  const [showFieldGuide, setShowFieldGuide] = useState(false);
  const [showLanguageSection, setShowLanguageSection] = useState(false);
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('zh-CN');

  const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);
  const isUserCustomKey = isUsingUserProvidedKey(userProviderConfig);
  const freeCooldownMs = isUserCustomKey ? USER_PROVIDED_KEY_COOLDOWN_MS : OFFICIAL_KEY_MAX_AI_COOLDOWN_MS;
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
    setAttachmentError(null);
    setAttachments([]);
  };

  const [attachments, setAttachments] = useState<FreeAttachmentState[]>([]);

  const totalAttachmentChars = useMemo(
    () => attachments.reduce((sum, attachment) => sum + attachment.content.length, 0),
    [attachments]
  );

  const totalAttachmentBytes = useMemo(
    () => attachments.reduce((sum, attachment) => sum + attachment.includedBytes, 0),
    [attachments]
  );

  const tokenEstimateText = useMemo(() => {
    const blocks: string[] = [];
    if (prompt.trim()) blocks.push(prompt);
    const attachmentsText = formatReferenceAttachmentsForPrompt(attachments);
    if (attachmentsText.trim()) blocks.push(attachmentsText);
    return blocks.join('\n\n');
  }, [attachments, prompt]);

  const handleAddAttachments = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsReadingAttachments(true);
    setAttachmentError(null);

    const currentChars = totalAttachmentChars;
    const currentBytes = totalAttachmentBytes;
    let remainingChars = Math.max(0, MAX_ATTACHMENT_CHARS_TOTAL - currentChars);
    let remainingBytes = Math.max(0, MAX_ATTACHMENT_BYTES_TOTAL - currentBytes);

    const next: FreeAttachmentState[] = [];
    let skipped = 0;

    try {
      for (const file of Array.from(files)) {
        if (remainingChars <= 0 || remainingBytes <= 0) {
          skipped += 1;
          continue;
        }

        const sliceBytes = Math.min(file.size, MAX_ATTACHMENT_BYTES_PER_FILE, remainingBytes);
        if (sliceBytes <= 0) {
          skipped += 1;
          continue;
        }

        const blob = file.slice(0, sliceBytes);
        let text = await blob.text();
        let truncated = blob.size < file.size;

        if (text.length > MAX_ATTACHMENT_CHARS_PER_FILE) {
          text = text.slice(0, MAX_ATTACHMENT_CHARS_PER_FILE);
          truncated = true;
        }

        if (text.length > remainingChars) {
          text = text.slice(0, remainingChars);
          truncated = true;
        }

        remainingChars -= text.length;
        remainingBytes -= sliceBytes;

        next.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          name: file.name || 'untitled',
          type: file.type || 'application/octet-stream',
          size: file.size,
          includedBytes: sliceBytes,
          content: text,
          ...(truncated ? { truncated: true } : {}),
        });
      }

      if (skipped > 0) {
        setAttachmentError(`⚠️ 附件总量超过限制：已忽略 ${skipped} 个文件（总上限 ${formatBytes(MAX_ATTACHMENT_BYTES_TOTAL)} / ${MAX_ATTACHMENT_CHARS_TOTAL.toLocaleString()} 字符）。`);
      }

      if (next.length > 0) {
        setAttachments((prev) => [...prev, ...next]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '读取附件失败';
      setAttachmentError(`⚠️ 附件读取失败：${message}`);
    } finally {
      setIsReadingAttachments(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearAttachments = () => {
    setAttachments([]);
    setAttachmentError(null);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
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

    if (isReadingAttachments) {
      setError('附件读取中，请稍候再试。');
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
        requestBody.attachments = attachments.map<FreeAttachmentInput>((item) => ({
          name: item.name,
          type: item.type,
          size: item.size,
          content: item.content,
          ...(item.truncated ? { truncated: true } : {}),
        }));
      }

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
        throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: '生成失败' }));
      }

      if (generationMode === 'stream') {
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json') || contentType.includes('+json')) {
          const errorJson = await response.json().catch(() => null as any);
          const serverMessage = errorJson?.message || errorJson?.error;
          throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: '生成失败' }));
        }

        setStreamingMarkdown('');
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
          {isGeneralScenario ? (
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
          ) : (
            <>
              {(() => {
                const markdown = streamingMarkdown ?? streamedGeneralCard?.content ?? '';
                const { card } = buildGeneralCharacterCardFromMarkdown({ markdown, defaultName: '角色' });
                return <GeneralCharacterCard general={card} isStreaming={submitting} />;
              })()}
              <p className="mt-3 text-xs text-gray-500 text-center">
                提示：流式模式只输出 Markdown，再由前端转换为通用数据卡；自由生成产物不会包含签名，因此会被视为非原生。
              </p>
            </>
          )}

          {streamedGeneralCard && (
            <>
              {streamedGeneralCard.templateId === GENERAL_SCENARIO_TEMPLATE_ID ? (
                <div className="card" style={{ marginTop: '1rem' }}>
                  <h3 className="text-lg font-semibold text-gray-800 mb-3">通用情景卡 JSON</h3>
                  <div className="rounded-lg bg-gray-100 p-4 border border-gray-200 font-mono text-xs overflow-x-auto">
                    <pre>{JSON.stringify(streamedGeneralCard, null, 2)}</pre>
                  </div>
                </div>
              ) : null}

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
      const safe = normalizeMagicalGirlForCard(resultData);
      return (
        <>
          <MagicalGirlCard
            magicalGirl={safe}
            gradientStyle="linear-gradient(135deg, #9775fa 0%, #b197fc 100%)"
          />
          <div className="card" style={{ marginTop: '1rem' }}>
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
      return (
        <>
          <CanshouCard canshou={safe} />
          <div className="card" style={{ marginTop: '1rem' }}>
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
                自由输入任意提示词，选择 Schema 后生成数据卡（角色 / 情景）。自由生成产物将被视为非原生卡（不生成签名）。
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
                <div className="input-group">
                  <label className="input-label" htmlFor="free-attachments-upload">参考附件（可选）</label>
                  <input
                    ref={attachmentInputRef}
                    id="free-attachments-upload"
                    type="file"
                    multiple
                    onChange={(e) => void handleAddAttachments(e.target.files)}
                    disabled={submitting || isReadingAttachments}
                    className="cursor-pointer input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-pink-50 file:text-pink-700 hover:file:bg-pink-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <div className="mt-2 flex items-center justify-between text-xs text-gray-600 flex-wrap gap-2">
                    <span>
                      已添加 {attachments.length} 个附件｜累计 {totalAttachmentChars.toLocaleString()} 字符｜已读取大小 {formatBytes(totalAttachmentBytes)}
                    </span>
                    <button
                      type="button"
                      className="text-red-600 hover:underline"
                      onClick={handleClearAttachments}
                      disabled={attachments.length === 0 || submitting || isReadingAttachments}
                    >
                      清空附件
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    说明：附件会按“文本”注入提示词供 AI 参考；单文件最多读取 {formatBytes(MAX_ATTACHMENT_BYTES_PER_FILE)} / {MAX_ATTACHMENT_CHARS_PER_FILE.toLocaleString()} 字符，总上限 {formatBytes(MAX_ATTACHMENT_BYTES_TOTAL)} / {MAX_ATTACHMENT_CHARS_TOTAL.toLocaleString()} 字符。
                  </p>
                  {attachments.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {attachments.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/80 border border-gray-200 px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-800 truncate" title={item.name}>{item.name}</div>
                            <div className="text-xs text-gray-500">
                              {(item.includedBytes < item.size
                                ? `${formatBytes(item.includedBytes)} / ${formatBytes(item.size)}`
                                : formatBytes(item.size))}{' '}
                              · {item.type} · {item.content.length.toLocaleString()} 字符{item.truncated ? ' · 已截断' : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="text-xs text-red-600 hover:underline shrink-0"
                            onClick={() => handleRemoveAttachment(item.id)}
                            disabled={submitting || isReadingAttachments}
                          >
                            移除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {attachmentError && <div className="mt-3"><ErrorMessage message={attachmentError} /></div>}
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
                disabled={submitting || isCooldown || isReadingAttachments}
                className="generate-button"
              >
                {isCooldown ? `冷却中 (${remainingTime}s)` : submitting ? '生成中...' : '开始生成'}
              </button>

              <TokenIndicator
                text={tokenEstimateText}
                warningText="⚠️ 预计上下文较长，可能更易超时/失败。可尝试精简提示词或减少/拆分附件。"
              />

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
