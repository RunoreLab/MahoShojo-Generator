import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import CanshouCard from '@/components/CanshouCard';
import { ErrorMessage } from '@/components/ErrorMessage';
import GeneralCharacterCard from '@/components/GeneralCharacterCard';
import GeneralScenarioCard from '@/components/GeneralScenarioCard';
import MagicalGirlCard from '@/components/MagicalGirlCard';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import TachieGenerator from '@/components/TachieGenerator';
import { GenerationModeSwitcher, type GenerationMode } from '@/components/shared/GenerationModeSwitcher';
import { ImagePreviewModal } from '@/components/shared/ImagePreviewModal';
import { OFFICIAL_KEY_MAX_AI_COOLDOWN_MS, USER_PROVIDED_KEY_COOLDOWN_MS } from '@/lib/ai/cooldowns';
import { buildCustomProviderPayload, isUsingUserProvidedKey } from '@/lib/ai/custom-provider';
import { authStorage } from '@/lib/auth';
import { buildSafeFileName } from '@/lib/client/fileName';
import { readJsonOrTextFromResponse, resolveApiErrorMessage } from '@/lib/client/apiError';
import { formatHttpErrorMessage } from '@/lib/client/httpError';
import { downloadBlob } from '@/lib/client/blobUrl';
import { useCooldown } from '@/lib/cooldown';
import { createBlankDataCard, type DataCardTemplate } from '@/lib/data-card-converter';
import { formatKilobytes, MAX_DATA_CARD_BYTES } from '@/lib/data-card-size';
import { buildGeneralCharacterCardFromMarkdown, buildGeneralScenarioCardFromMarkdown } from '@/lib/stream/markdown-card';
import { readTextStreamFromResponse } from '@/lib/stream/read-text-stream';
import {
  buildTavernCloudSavePayload,
  buildTavernAiAttachment,
  normalizeTavernCard,
  parseTavernCardFromPngFile,
  type TavernCardCandidate,
  type TavernCardNormalized,
  type TavernCloudSavePreset,
  type TavernImportMeta,
  type TavernParseResult,
} from '@/lib/tavern-card';
import { buildTavernScenarioFragment } from '@/lib/tavern-card/scenario';
import type { CanshouData, GeneralCharacterData, GeneralScenarioData, MagicalGirlData, ScenarioData } from '@/lib/schemas';
import { useAuth } from '@/lib/useAuth';

import { TavernCardPreview } from './TavernCardPreview';

type ImportStep = 'idle' | 'parsing' | 'parsed' | 'converting' | 'done' | 'error';
type ConvertMode = 'rules' | 'ai';
type ImageSaveMode = 'download' | 'modal';
type JsonSaveMode = 'download' | 'text';
type DeviceType = 'mobile' | 'desktop' | 'unknown';

type PlaceholderReplaceMode = 'auto' | 'custom';

interface PlaceholderPreference {
  enabled: boolean;
  userReplacement: string;
  charReplacementMode: PlaceholderReplaceMode;
  customCharReplacement: string;
}

interface ImportState {
  step: ImportStep;
  error: string | null;
  parseResult: TavernParseResult | null;
  selectedCandidateIndex: number;
  targetTemplate: DataCardTemplate;
  keepRaw: boolean;
  convertMode: ConvertMode;
  outputDataCard: unknown | null;
  outputKey: string | null;
}

type ImportAction =
  | { type: 'reset' }
  | { type: 'parsing' }
  | { type: 'parseError'; message: string }
  | { type: 'setError'; message: string | null }
  | { type: 'parsed'; result: TavernParseResult }
  | { type: 'selectCandidate'; index: number }
  | { type: 'setTemplate'; template: DataCardTemplate }
  | { type: 'setKeepRaw'; value: boolean }
  | { type: 'setConvertMode'; mode: ConvertMode }
  | { type: 'converting' }
  | { type: 'done'; output: unknown; outputKey: string };

const initialState: ImportState = {
  step: 'idle',
  error: null,
  parseResult: null,
  selectedCandidateIndex: 0,
  targetTemplate: 'general',
  keepRaw: false,
  convertMode: 'rules',
  outputDataCard: null,
  outputKey: null,
};

function reducer(state: ImportState, action: ImportAction): ImportState {
  switch (action.type) {
    case 'reset':
      return { ...initialState };
    case 'parsing':
      return { ...state, step: 'parsing', error: null, parseResult: null, outputDataCard: null, outputKey: null };
    case 'parseError':
      return { ...state, step: 'error', error: action.message, parseResult: null, outputDataCard: null, outputKey: null };
    case 'setError':
      return { ...state, error: action.message };
    case 'parsed':
      return {
        ...state,
        step: 'parsed',
        error: null,
        parseResult: action.result,
        selectedCandidateIndex: Math.max(0, action.result.candidates.findIndex((c) => c.keyword === action.result.selected.keyword)),
        outputDataCard: null,
        outputKey: null,
      };
    case 'selectCandidate':
      return { ...state, step: 'parsed', selectedCandidateIndex: action.index, outputDataCard: null, outputKey: null };
    case 'setTemplate':
      return { ...state, step: 'parsed', targetTemplate: action.template, outputDataCard: null, outputKey: null };
    case 'setKeepRaw':
      return { ...state, step: 'parsed', keepRaw: action.value, outputDataCard: null, outputKey: null };
    case 'setConvertMode':
      return { ...state, step: 'parsed', convertMode: action.mode, outputDataCard: null, outputKey: null };
    case 'converting':
      return { ...state, step: 'converting', error: null };
    case 'done':
      return { ...state, step: 'done', outputDataCard: action.output, outputKey: action.outputKey };
    default:
      return state;
  }
}

const isRecord = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);

const ensureString = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

const normalizeCanshouForCard = (input: unknown): any => {
  const record = isRecord(input) ? input : {};
  return {
    ...record,
    name: ensureString(record.name, ensureString(record.codename, '未命名残兽')),
    coreConcept: ensureString(record.coreConcept),
    coreEmotion: ensureString(record.coreEmotion),
    evolutionStage: ensureString(record.evolutionStage),
    appearance: ensureString(record.appearance),
    materialAndSkin: ensureString(record.materialAndSkin),
    featuresAndAppendages: ensureString(record.featuresAndAppendages),
    attackMethod: ensureString(record.attackMethod),
    specialAbility: ensureString(record.specialAbility),
    origin: ensureString(record.origin),
    birthEnvironment: ensureString(record.birthEnvironment),
    researcherNotes: ensureString(record.researcherNotes),
  };
};

const uniqueStrings = (items: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

const guessTemplate = (result: TavernParseResult): DataCardTemplate => {
  const tags = result.normalized.tags?.join(' ') ?? '';
  const text = `${tags} ${result.normalized.description ?? ''} ${result.normalized.personality ?? ''}`.toLowerCase();
  if (/(残兽|怪物|monster|beast|abomination)/i.test(text)) return 'canshou';
  if (/(魔法少女|mahou|magical girl)/i.test(text)) return 'magical-girl';
  return 'general';
};

const buildGeneralMarkdown = (normalized: TavernParseResult['normalized']): string => {
  const lines: string[] = [];
  lines.push(`# 角色：${normalized.name}`);
  if (normalized.description?.trim()) {
    lines.push('');
    lines.push('## 描述');
    lines.push(normalized.description.trim());
  }
  if (normalized.personality?.trim()) {
    lines.push('');
    lines.push('## 性格');
    lines.push(normalized.personality.trim());
  }
  if (normalized.scenario?.trim()) {
    lines.push('');
    lines.push('## 场景');
    lines.push(normalized.scenario.trim());
  }
  if (normalized.firstMes?.trim()) {
    lines.push('');
    lines.push('## 开场白');
    lines.push(normalized.firstMes.trim());
  }
  if (normalized.mesExample?.trim()) {
    lines.push('');
    lines.push('## 对话样例');
    lines.push(normalized.mesExample.trim());
  }
  if (normalized.tags && normalized.tags.length > 0) {
    lines.push('');
    lines.push('## 标签');
    lines.push(normalized.tags.join('、'));
  }
  return lines.join('\n');
};

const PLACEHOLDER_PREFERENCE_KEY = 'mahoshojo.tavern.import.placeholder.v1';
const DEFAULT_USER_REPLACEMENT = '【某人】';
const DEFAULT_CHAR_FALLBACK = '角色';

const replacePlaceholderToken = (input: string, token: string, replacement: string): string => {
  if (!input.includes(token)) return input;
  return input.split(token).join(replacement);
};

const applyPlaceholderReplacement = (
  value: string | undefined,
  config: { enabled: boolean; userReplacement: string; charReplacement: string }
): string | undefined => {
  if (!config.enabled || typeof value !== 'string') return value;
  let next = value;
  next = replacePlaceholderToken(next, '{{user}}', config.userReplacement);
  next = replacePlaceholderToken(next, '{{char}}', config.charReplacement);
  return next;
};

const applyPlaceholderReplacementToList = (
  value: string[] | undefined,
  config: { enabled: boolean; userReplacement: string; charReplacement: string }
): string[] | undefined => {
  if (!config.enabled || !Array.isArray(value)) return value;
  return value.map((item) => applyPlaceholderReplacement(item, config) ?? '');
};

const applyPlaceholderReplacementToNormalized = (
  normalized: TavernCardNormalized,
  config: { enabled: boolean; userReplacement: string; charReplacement: string }
): TavernCardNormalized => {
  if (!config.enabled) return normalized;
  return {
    ...normalized,
    name: applyPlaceholderReplacement(normalized.name, config) ?? normalized.name,
    description: applyPlaceholderReplacement(normalized.description, config),
    personality: applyPlaceholderReplacement(normalized.personality, config),
    scenario: applyPlaceholderReplacement(normalized.scenario, config),
    firstMes: applyPlaceholderReplacement(normalized.firstMes, config),
    mesExample: applyPlaceholderReplacement(normalized.mesExample, config),
    creatorComment: applyPlaceholderReplacement(normalized.creatorComment, config),
    creatorNotes: applyPlaceholderReplacement(normalized.creatorNotes, config),
    systemPrompt: applyPlaceholderReplacement(normalized.systemPrompt, config),
    postHistoryInstructions: applyPlaceholderReplacement(normalized.postHistoryInstructions, config),
    alternateGreetings: applyPlaceholderReplacementToList(normalized.alternateGreetings, config),
    groupOnlyGreetings: applyPlaceholderReplacementToList(normalized.groupOnlyGreetings, config),
  };
};

const buildGeneralScenarioMarkdown = (normalized: TavernParseResult['normalized']): string => {
  const title = normalized.name?.trim() || '未命名情景';
  const lines: string[] = [];
  lines.push(`# ${title}`);

  if (normalized.scenario?.trim()) {
    lines.push('');
    lines.push('## 场景概览');
    lines.push(normalized.scenario.trim());
  }

  if (normalized.description?.trim()) {
    lines.push('');
    lines.push('## 背景摘要');
    lines.push(normalized.description.trim());
  }

  if (normalized.personality?.trim()) {
    lines.push('');
    lines.push('## 氛围');
    lines.push(normalized.personality.trim());
  }

  if (normalized.firstMes?.trim()) {
    lines.push('');
    lines.push('## 开场白');
    lines.push(normalized.firstMes.trim());
  }

  if (normalized.mesExample?.trim()) {
    lines.push('');
    lines.push('## 对话样例');
    lines.push(normalized.mesExample.trim());
  }

  if (normalized.tags && normalized.tags.length > 0) {
    lines.push('');
    lines.push('## 标签');
    lines.push(normalized.tags.join('、'));
  }

  return lines.join('\n');
};

const buildStructuredScenarioFromTavern = (normalized: TavernParseResult['normalized']): ScenarioData => {
  const base = createBlankDataCard('scenario') as ScenarioData;
  const title = normalized.name?.trim() || base.title || '未命名情景';
  const scenarioText = normalized.scenario?.trim() || '';
  const description = normalized.description?.trim() || scenarioText;
  const scenarioType = normalized.tags && normalized.tags.length > 0 ? normalized.tags[0] : '';

  const eventsParts: string[] = [];
  if (normalized.firstMes?.trim()) {
    eventsParts.push(`【开场白】\n${normalized.firstMes.trim()}`);
  }
  if (normalized.mesExample?.trim()) {
    eventsParts.push(`【对话样例】\n${normalized.mesExample.trim()}`);
  }

  const events = eventsParts.length > 0 ? eventsParts.join('\n\n') : scenarioText;
  const atmosphere = normalized.personality?.trim() || '';
  const sceneFeatures = scenarioText && scenarioText !== description ? scenarioText : '';

  return {
    ...base,
    title,
    scenario_type: scenarioType,
    description,
    elements: {
      ...base.elements,
      scene: {
        ...(base.elements?.scene ?? {}),
        features: sceneFeatures,
      },
      roles: base.elements?.roles ?? [],
      events: events,
      atmosphere: atmosphere,
      development: base.elements?.development ?? [],
    },
  };
};

const buildTavernMeta = (parseResult: TavernParseResult, candidate: TavernCardCandidate): TavernImportMeta => {
  const normalized = normalizeTavernCard(candidate).normalized;
  const selectionWarnings = normalizeTavernCard(candidate).warnings;
  const baseWarnings = parseResult.meta.warnings ?? [];

  const meta: TavernImportMeta = {
    ...parseResult.meta,
    sourceChunk: candidate.keyword,
    spec: normalized.spec,
    specVersion: normalized.specVersion,
    name: normalized.name,
    description: normalized.description,
    personality: normalized.personality,
    scenario: normalized.scenario,
    firstMes: normalized.firstMes,
    mesExample: normalized.mesExample,
    tags: normalized.tags,
    warnings: uniqueStrings([...baseWarnings, ...selectionWarnings]),
  };

  return meta;
};

type TavernAttachment = { meta: TavernImportMeta; raw?: unknown };
type WithTavern<T> = T & { _tavern: TavernAttachment };

export function TavernImportPanel() {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, initialState);
  const { user } = useAuth();
  const [cloudPreset, setCloudPreset] = useState<TavernCloudSavePreset>('standard');
  const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('non-stream');
  const [streamingMarkdown, setStreamingMarkdown] = useState<string | null>(null);
  const [streamedGeneralCard, setStreamedGeneralCard] = useState<any | null>(null);
  const isUserCustomKey = isUsingUserProvidedKey(userProviderConfig);
  const tavernAiCooldownMs = isUserCustomKey ? USER_PROVIDED_KEY_COOLDOWN_MS : OFFICIAL_KEY_MAX_AI_COOLDOWN_MS;
  const tavernAiCooldownKey = isUserCustomKey ? 'tavernConvertCooldown:custom' : 'tavernConvertCooldown:system';
  const { isCooldown, startCooldown, remainingTime } = useCooldown(tavernAiCooldownKey, tavernAiCooldownMs);

  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('zh-CN');
  const [showLanguageSection, setShowLanguageSection] = useState(false);

  const [deviceType, setDeviceType] = useState<DeviceType>('unknown');
  const [imageSaveMode, setImageSaveMode] = useState<ImageSaveMode>('download');
  const [jsonSaveMode, setJsonSaveMode] = useState<JsonSaveMode>('download');
  const [showImageModal, setShowImageModal] = useState(false);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [placeholderEnabled, setPlaceholderEnabled] = useState(true);
  const [userReplacement, setUserReplacement] = useState(DEFAULT_USER_REPLACEMENT);
  const [charReplacementMode, setCharReplacementMode] = useState<PlaceholderReplaceMode>('auto');
  const [customCharReplacement, setCustomCharReplacement] = useState('');

  const recommendedImageMode: ImageSaveMode = deviceType === 'mobile' ? 'modal' : 'download';
  const recommendedJsonMode: JsonSaveMode = deviceType === 'mobile' ? 'text' : 'download';
  const preferenceButtonClass = (active: boolean) =>
    `flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
      active ? 'border-pink-300 bg-pink-50 text-pink-700 shadow-sm' : 'border-slate-200 text-slate-600 hover:border-pink-300 hover:text-pink-700'
    }`;

  useEffect(() => {
    fetch('/languages.json')
      .then((res) => res.json())
      .then((data) => setLanguages(Array.isArray(data) ? data : []))
      .catch((error) => {
        console.warn('加载 languages.json 失败（已忽略）', error);
        setLanguages([]);
      });
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const userAgent = navigator.userAgent.toLowerCase();
    const isMobile = /mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(userAgent);
    const detectedType: DeviceType = isMobile ? 'mobile' : 'desktop';
    setDeviceType(detectedType);
    setImageSaveMode(isMobile ? 'modal' : 'download');
    setJsonSaveMode(isMobile ? 'text' : 'download');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem(PLACEHOLDER_PREFERENCE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<PlaceholderPreference>;
      if (typeof parsed?.enabled === 'boolean') setPlaceholderEnabled(parsed.enabled);
      if (typeof parsed?.userReplacement === 'string') setUserReplacement(parsed.userReplacement);
      if (parsed?.charReplacementMode === 'auto' || parsed?.charReplacementMode === 'custom') {
        setCharReplacementMode(parsed.charReplacementMode);
      }
      if (typeof parsed?.customCharReplacement === 'string') setCustomCharReplacement(parsed.customCharReplacement);
    } catch {
      // localStorage 可能不可用或内容损坏，忽略
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const payload: PlaceholderPreference = {
        enabled: placeholderEnabled,
        userReplacement,
        charReplacementMode,
        customCharReplacement,
      };
      window.localStorage.setItem(PLACEHOLDER_PREFERENCE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage 可能不可用，忽略
    }
  }, [placeholderEnabled, userReplacement, charReplacementMode, customCharReplacement]);

  const selectedCandidate = useMemo(() => {
    if (!state.parseResult) return null;
    return state.parseResult.candidates[state.selectedCandidateIndex] ?? state.parseResult.selected;
  }, [state.parseResult, state.selectedCandidateIndex]);

  const selectedNormalized = useMemo(() => {
    if (!selectedCandidate) return null;
    return normalizeTavernCard(selectedCandidate).normalized;
  }, [selectedCandidate]);

  const resolvedCharReplacement = useMemo(() => {
    if (charReplacementMode === 'custom') return customCharReplacement;
    const name = (selectedNormalized?.name ?? '').trim();
    const hasPlaceholder = name.includes('{{user}}') || name.includes('{{char}}');
    const safeName = hasPlaceholder ? '' : name;
    return safeName || DEFAULT_CHAR_FALLBACK;
  }, [charReplacementMode, customCharReplacement, selectedNormalized?.name]);

  const placeholderConfig = useMemo(() => ({
    enabled: placeholderEnabled,
    userReplacement,
    charReplacement: resolvedCharReplacement,
  }), [placeholderEnabled, userReplacement, resolvedCharReplacement]);

  const normalizedForConvert = useMemo(() => {
    if (!selectedNormalized) return null;
    return applyPlaceholderReplacementToNormalized(selectedNormalized, placeholderConfig);
  }, [selectedNormalized, placeholderConfig]);

  const isScenarioTemplate = state.targetTemplate === 'scenario' || state.targetTemplate === 'general-scenario';
  const targetLabel = isScenarioTemplate ? '情景' : '角色';

  const selectionWarnings = useMemo(() => {
    if (!selectedCandidate) return [];
    return normalizeTavernCard(selectedCandidate).warnings;
  }, [selectedCandidate]);

  const aiAttachmentPreview = useMemo(() => {
    if (!normalizedForConvert) return null;
    if (state.convertMode !== 'ai') return null;
    return buildTavernAiAttachment(normalizedForConvert);
  }, [normalizedForConvert, state.convertMode]);

  const combinedWarnings = useMemo(() => {
    if (!state.parseResult) return selectionWarnings;
    return uniqueStrings([...(state.parseResult.meta.warnings ?? []), ...selectionWarnings, ...(aiAttachmentPreview?.warnings ?? [])]);
  }, [state.parseResult, selectionWarnings, aiAttachmentPreview]);

  const defaultCloudCardName = useMemo(() => {
    const fallback = isScenarioTemplate ? '未命名情景' : '未命名角色';
    return (selectedNormalized?.name ?? '').trim() || fallback;
  }, [selectedNormalized?.name, isScenarioTemplate]);

  const defaultCloudCardDescription = useMemo(() => {
    if (!selectedNormalized) return 'SillyTavern 导入';
    const spec = selectedNormalized.spec ? `${selectedNormalized.spec}${selectedNormalized.specVersion ? `@${selectedNormalized.specVersion}` : ''}` : 'unknown';
    return `SillyTavern 导入（${spec}）`;
  }, [selectedNormalized]);

  const handleSaveImage = (imageUrl: string) => {
    setSavedImageUrl(imageUrl);
    setShowImageModal(true);
  };

  const imageSaveButtonLabel = imageSaveMode === 'download' ? '💾 一键保存长图' : '📱 打开长按保存弹窗';

  const resetGeneratedPreview = () => {
    setStreamingMarkdown(null);
    setStreamedGeneralCard(null);
    setCopyStatus('idle');
  };

  const handleAiProviderConfigChange = useCallback((config: UserAIProviderConfig | null) => {
    setUserProviderConfig(config);
    setStreamingMarkdown(null);
    setStreamedGeneralCard(null);
    setCopyStatus('idle');
  }, []);

  const streamedGeneralCardForDisplay = useMemo(() => {
    if (state.convertMode !== 'ai') return null;
    if (generationMode !== 'stream') return null;
    const markdown = streamingMarkdown ?? streamedGeneralCard?.content ?? null;
    if (markdown === null) return null;

    const fallbackName = (selectedNormalized?.name ?? '').trim();
    const isScenarioTarget = state.targetTemplate === 'scenario' || state.targetTemplate === 'general-scenario';

    if (isScenarioTarget) {
      const { card } = buildGeneralScenarioCardFromMarkdown({
        markdown,
        fallbackTitle: fallbackName,
        defaultTitle: '情景',
      });
      return card;
    }

    const defaultName =
      state.targetTemplate === 'magical-girl' ? '魔法少女' : state.targetTemplate === 'canshou' ? '残兽' : '角色';

    const { card } = buildGeneralCharacterCardFromMarkdown({
      markdown,
      fallbackName,
      defaultName,
    });
    return card;
  }, [state.convertMode, generationMode, streamingMarkdown, streamedGeneralCard, selectedNormalized?.name, state.targetTemplate]);

  const onFileSelected = async (file: File | null) => {
    if (!file) return;
    dispatch({ type: 'parsing' });
    setStreamingMarkdown(null);
    setStreamedGeneralCard(null);
    setCopyStatus('idle');
    setShowImageModal(false);
    setSavedImageUrl(null);

    try {
      const parsed = await parseTavernCardFromPngFile(file);
      if ('code' in parsed) {
        dispatch({ type: 'parseError', message: `${parsed.message}（${parsed.code}）` });
        return;
      }

      dispatch({ type: 'parsed', result: parsed });
      dispatch({ type: 'setTemplate', template: guessTemplate(parsed) });
    } catch (error) {
      dispatch({ type: 'parseError', message: error instanceof Error ? error.message : '解析失败' });
    }
  };

  const buildOutputKey = (): string | null => {
    if (!state.parseResult) return null;
    const parts: string[] = [
      state.parseResult.meta.extractedAt,
      String(state.selectedCandidateIndex),
      state.targetTemplate,
      state.keepRaw ? 'raw' : 'no-raw',
      state.convertMode,
      placeholderEnabled ? 'replace=1' : 'replace=0',
      `user=${userReplacement}`,
      `charMode=${charReplacementMode}`,
      charReplacementMode === 'custom' ? `char=${customCharReplacement}` : `char=${resolvedCharReplacement}`,
    ];

    if (state.convertMode === 'ai') {
      parts.push(generationMode);
      parts.push(selectedLanguage);
      const providerId = userProviderConfig?.providerId ?? 'system';
      const modelId = userProviderConfig?.modelId ?? 'default';
      parts.push(`provider=${providerId}`);
      parts.push(`model=${modelId}`);
    }

    return parts.join('|');
  };

  const convertToDataCard = async (): Promise<unknown> => {
    if (!state.parseResult || !selectedCandidate || !selectedNormalized || !normalizedForConvert) {
      throw new Error('尚未解析到可用的 SillyTavern 候选块');
    }

    const meta = buildTavernMeta(state.parseResult, selectedCandidate);
    const tavernPayload: TavernAttachment = state.keepRaw ? { meta, raw: selectedCandidate.parsed } : { meta };

    if (state.convertMode === 'ai') {
      if (userProviderConfig && userProviderConfig.providerId !== 'system' && !userProviderConfig.apiKey?.trim()) {
        throw new Error('⚠️ 已选择自定义 AI 供应商，但尚未填写 API Key。');
      }

      const aiAttachment = aiAttachmentPreview ?? buildTavernAiAttachment(normalizedForConvert);
      const customProviderPayload = buildCustomProviderPayload(userProviderConfig);
      const requestBody: Record<string, unknown> = {
        template: state.targetTemplate,
        sourceName: selectedNormalized.name,
        language: selectedLanguage,
        attachments: [
          {
            name: aiAttachment.attachment.name,
            type: aiAttachment.attachment.type,
            content: aiAttachment.attachment.content,
            ...(aiAttachment.attachment.truncated ? { truncated: true } : {}),
          },
        ],
        ...(customProviderPayload
          ? {
              customProvider: {
                providerId: customProviderPayload.providerId,
                modelId: customProviderPayload.modelId,
                apiKey: customProviderPayload.apiKey.trim(),
              },
            }
          : {}),
      };

      const activityHeaders = await authStorage.getActivityHeaders();
      if (generationMode === 'stream') {
        setStreamingMarkdown('');
        setStreamedGeneralCard(null);
        setCopyStatus('idle');

        const response = await fetch('/api/tavern/convert-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...activityHeaders },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const { payload } = await readJsonOrTextFromResponse(response);
          const errorJson = payload && typeof payload === 'object' ? (payload as any) : null;
          const redirectReason = errorJson?.reason || errorJson?.message || errorJson?.error || resolveApiErrorMessage({ payload, fallback: '' });
          if (errorJson?.shouldRedirect || errorJson?.redirect === '/arrested') {
            void router.push({
              pathname: '/arrested',
              query: { reason: redirectReason || '使用危险符文' },
            });
            throw new Error('已跳转到被捕页面');
          }
          const serverMessage = resolveApiErrorMessage({ payload, fallback: 'AI 转换失败' });
          throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: 'AI 转换失败' }));
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json') || contentType.includes('+json')) {
          const { payload } = await readJsonOrTextFromResponse(response);
          const serverMessage = resolveApiErrorMessage({ payload, fallback: 'AI 转换失败' });
          throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: 'AI 转换失败' }));
        }

        const markdown = await readTextStreamFromResponse(response, {
          label: '酒馆导入（流式）',
          onText: (text) => setStreamingMarkdown(text),
        });

        const isScenarioTarget = state.targetTemplate === 'scenario' || state.targetTemplate === 'general-scenario';
        if (isScenarioTarget) {
          const { card } = buildGeneralScenarioCardFromMarkdown({
            markdown,
            fallbackTitle: selectedNormalized.name,
            defaultTitle: '情景',
          });
          setStreamedGeneralCard(card);
          startCooldown(tavernAiCooldownMs);
          return { ...card, _tavern: tavernPayload };
        }

        const defaultName =
          state.targetTemplate === 'magical-girl' ? '魔法少女' : state.targetTemplate === 'canshou' ? '残兽' : '角色';
        const { card } = buildGeneralCharacterCardFromMarkdown({
          markdown,
          fallbackName: selectedNormalized.name,
          defaultName,
        });

        setStreamedGeneralCard(card);
        startCooldown(tavernAiCooldownMs);
        return { ...card, _tavern: tavernPayload };
      }

      const response = await fetch('/api/tavern/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...activityHeaders },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const { payload } = await readJsonOrTextFromResponse(response);
        const errorJson = payload && typeof payload === 'object' ? (payload as any) : null;
        const redirectReason = errorJson?.reason || errorJson?.message || errorJson?.error || resolveApiErrorMessage({ payload, fallback: '' });
        if (errorJson?.shouldRedirect || errorJson?.redirect === '/arrested') {
          void router.push({
            pathname: '/arrested',
            query: { reason: redirectReason || '使用危险符文' },
          });
          throw new Error('已跳转到被捕页面');
        }
        const serverMessage = resolveApiErrorMessage({ payload, fallback: 'AI 转换失败' });
        throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: 'AI 转换失败' }));
      }

      const generated = (await response.json()) as unknown;
      const generatedRecord = typeof generated === 'object' && generated !== null ? (generated as Record<string, unknown>) : {};
      startCooldown(tavernAiCooldownMs);
      return { ...generatedRecord, _tavern: tavernPayload };
    }

    if (state.targetTemplate === 'general-scenario') {
      const base = createBlankDataCard('general-scenario') as GeneralScenarioData;
      const output: WithTavern<GeneralScenarioData> = {
        ...base,
        title: normalizedForConvert.name || base.title || '未命名情景',
        content: buildGeneralScenarioMarkdown(normalizedForConvert),
        _tavern: tavernPayload,
      };
      return output;
    }

    if (state.targetTemplate === 'scenario') {
      const structured = buildStructuredScenarioFromTavern(normalizedForConvert);
      const output: WithTavern<ScenarioData> = {
        ...structured,
        _tavern: tavernPayload,
      };
      return output;
    }

    if (state.targetTemplate === 'general') {
      const base = createBlankDataCard('general') as GeneralCharacterData;
      const output: WithTavern<GeneralCharacterData> = {
        ...base,
        name: normalizedForConvert.name,
        content: buildGeneralMarkdown(normalizedForConvert),
        _tavern: tavernPayload,
      };
      return output;
    }

    if (state.targetTemplate === 'magical-girl') {
      const base = createBlankDataCard('magical-girl') as MagicalGirlData;
      const output: WithTavern<MagicalGirlData> = {
        ...base,
        codename: normalizedForConvert.name,
        appearance: {
          ...(base.appearance ?? {}),
          overallLook: normalizedForConvert.description ?? base.appearance?.overallLook ?? '',
        },
        analysis: {
          ...(base.analysis ?? {}),
          personalityAnalysis: normalizedForConvert.personality ?? base.analysis?.personalityAnalysis ?? '',
          predictionBasis: [
            base.analysis?.predictionBasis ? String(base.analysis.predictionBasis) : '',
            normalizedForConvert.scenario ? `【场景】\n${normalizedForConvert.scenario}` : '',
            normalizedForConvert.firstMes ? `【开场白】\n${normalizedForConvert.firstMes}` : '',
            normalizedForConvert.mesExample ? `【对话样例】\n${normalizedForConvert.mesExample}` : '',
          ]
            .filter((part) => part.trim())
            .join('\n\n'),
        },
        _tavern: tavernPayload,
      };
      return output;
    }

    const base = createBlankDataCard('canshou') as CanshouData;
    const output: WithTavern<CanshouData> = {
      ...base,
      name: normalizedForConvert.name,
      appearance: normalizedForConvert.description ?? base.appearance ?? '',
      coreEmotion: normalizedForConvert.personality ?? base.coreEmotion ?? '',
      researcherNotes: [
        base.researcherNotes ? String(base.researcherNotes) : '',
        normalizedForConvert.scenario ? `【场景】\n${normalizedForConvert.scenario}` : '',
        normalizedForConvert.mesExample ? `【对话样例】\n${normalizedForConvert.mesExample}` : '',
      ]
        .filter((part) => part.trim())
        .join('\n\n'),
      _tavern: tavernPayload,
    };
    return output;
  };

  const ensureConverted = async (): Promise<{ output: unknown; outputKey: string } | null> => {
    const outputKey = buildOutputKey();
    if (!outputKey) return null;
    if (state.outputDataCard && state.outputKey === outputKey) {
      return { output: state.outputDataCard, outputKey };
    }

    if (state.convertMode === 'ai' && isCooldown) {
      dispatch({ type: 'setError', message: `操作过于频繁，请等待 ${remainingTime} 秒后再试。` });
      return null;
    }

    dispatch({ type: 'converting' });
    const output = await convertToDataCard();
    dispatch({ type: 'done', output, outputKey });
    return { output, outputKey };
  };

  const onGenerate = async () => {
    if (!state.parseResult || !selectedCandidate || !selectedNormalized) return;
    try {
      await ensureConverted();
    } catch (error) {
      dispatch({ type: 'parseError', message: error instanceof Error ? error.message : '转换失败' });
    }
  };

  const downloadOutputJson = (data: unknown) => {
    if (!selectedNormalized) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, buildSafeFileName(selectedNormalized.name, 'json', 'tavern-import'));
  };

  const onDownloadJson = async () => {
    if (!state.parseResult || !selectedCandidate || !selectedNormalized) return;
    setCopyStatus('idle');
    try {
      const result = await ensureConverted();
      if (!result) return;
      downloadOutputJson(result.output);
    } catch (error) {
      dispatch({ type: 'parseError', message: error instanceof Error ? error.message : '下载失败' });
    }
  };

  const onCopyJson = async () => {
    if (!state.parseResult || !selectedCandidate || !selectedNormalized) return;
    try {
      const result = await ensureConverted();
      if (!result) return;
      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        throw new Error('当前环境不支持剪贴板');
      }
      await navigator.clipboard.writeText(JSON.stringify(result.output, null, 2));
      setCopyStatus('success');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (error) {
      setCopyStatus('error');
      dispatch({ type: 'parseError', message: error instanceof Error ? error.message : '复制失败' });
    }
  };

  const currentOutputKey = buildOutputKey();
  const outputDataCard = currentOutputKey && state.outputKey === currentOutputKey ? state.outputDataCard : null;
  const outputTemplateForPreview: DataCardTemplate =
    state.convertMode === 'ai' && generationMode === 'stream'
      ? (state.targetTemplate === 'scenario' || state.targetTemplate === 'general-scenario' ? 'general-scenario' : 'general')
      : state.targetTemplate;

  const previewDataCard = outputDataCard ?? streamedGeneralCardForDisplay;
  const isPreviewStreaming = state.convertMode === 'ai' && generationMode === 'stream' && state.step === 'converting';

  const scenarioPreview = useMemo(() => {
    if (!previewDataCard) return null;

    if (outputTemplateForPreview === 'general-scenario') {
      const record = isRecord(previewDataCard) ? previewDataCard : {};
      return {
        title: ensureString(record.title, '未命名情景'),
        content: ensureString(record.content),
      };
    }

    if (outputTemplateForPreview === 'scenario') {
      const fragment = buildTavernScenarioFragment(previewDataCard);
      if (fragment) {
        return {
          title: fragment.title,
          content: fragment.content,
        };
      }
      return {
        title: '情景',
        content: JSON.stringify(previewDataCard, null, 2),
      };
    }

    return null;
  }, [previewDataCard, outputTemplateForPreview]);

  const cloudCardType = outputTemplateForPreview === 'scenario' || outputTemplateForPreview === 'general-scenario'
    ? 'scenario'
    : 'character';

  const resolvedCloudAuthor = useMemo(() => {
    if (user && typeof user.id === 'number' && user.username) {
      return { id: user.id, username: user.username };
    }
    return { id: 0, username: '未登录用户' };
  }, [user]);

  const cloudSavePreview = useMemo(() => {
    if (!outputDataCard) return null;
    return buildTavernCloudSavePayload(outputDataCard, resolvedCloudAuthor, cloudPreset, { maxBytes: MAX_DATA_CARD_BYTES });
  }, [outputDataCard, resolvedCloudAuthor, cloudPreset]);

  const getCloudPayload = async () => {
    if (!cloudSavePreview) {
      throw new Error('尚未生成可保存的数据卡');
    }
    if ('error' in cloudSavePreview) {
      throw new Error(cloudSavePreview.error);
    }
    if (cloudSavePreview.overLimit) {
      throw new Error(`数据卡内容过大，最大允许 ${MAX_DATA_CARD_BYTES / 1024}KB，当前预估 ${formatKilobytes(cloudSavePreview.estimatedBytes)}KB`);
    }
    return cloudSavePreview.data;
  };

  const tachiePrompt = useMemo(() => {
    if (!outputDataCard) return '';

    if (outputTemplateForPreview === 'scenario' || outputTemplateForPreview === 'general-scenario') {
      return '';
    }

    if (outputTemplateForPreview === 'magical-girl') {
      const record = isRecord(outputDataCard) ? outputDataCard : {};
      const appearance = isRecord(record.appearance) ? record.appearance : {};
      return `${JSON.stringify(appearance)}, Xiabanmo, 二次元, 魔法少女`;
    }

    if (outputTemplateForPreview === 'canshou') {
      const safe = normalizeCanshouForCard(outputDataCard);
      const parts = [safe.appearance, safe.materialAndSkin, safe.featuresAndAppendages].filter((item) => typeof item === 'string' && item.trim());
      return `${parts.join(', ')}, Xiabanmo, 二次元`;
    }

    const record = isRecord(outputDataCard) ? outputDataCard : {};
    const name = ensureString(record.name).trim();
    const content = ensureString(record.content).trim();
    const head = content.length > 800 ? content.slice(0, 800) : content;
    return `${name ? `${name}, ` : ''}${head}, Xiabanmo, 二次元, 角色立绘`;
  }, [outputDataCard, outputTemplateForPreview]);

  const outputJsonPayload = useMemo(() => {
    if (!outputDataCard) return null;
    try {
      return JSON.stringify(outputDataCard, null, 2);
    } catch {
      return null;
    }
  }, [outputDataCard]);

  return (
    <div className="mt-4">
      <div className="rounded-xl border border-pink-200 bg-white/70 p-4">
        <div className="text-sm text-gray-700">
          本页面默认仅在浏览器本地解析 PNG 元数据，不会上传图片。只有当你选择 AI 深度转换时才会发起网络请求（会自动裁剪输入包以满足附件限制）。
        </div>
      </div>

      <div className="input-group mt-4">
        <label className="input-label" htmlFor="tavern-import-file">
          上传 SillyTavern 角色卡 PNG
        </label>
        <input
          id="tavern-import-file"
          type="file"
          accept="image/png"
          className="cursor-pointer input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-pink-50 file:text-pink-700 hover:file:bg-pink-100 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={state.step === 'parsing' || state.step === 'converting'}
          onChange={(event) => onFileSelected(event.target.files?.[0] ?? null)}
        />
      </div>

      {state.error ? <ErrorMessage message={state.error} className="error-message mt-3" /> : null}

      {state.step === 'parsing' ? <div className="mt-3 text-sm text-gray-700">解析中…</div> : null}

      {state.parseResult && selectedCandidate && selectedNormalized ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="rounded-xl border border-pink-200 bg-white/70 p-4">
              <div className="text-sm font-semibold text-pink-700">候选来源块</div>
              <div className="mt-2 grid grid-cols-1 gap-2">
                {state.parseResult.candidates.map((candidate, index) => {
                  const info = normalizeTavernCard(candidate).normalized;
                  return (
                    <label
                      key={`${candidate.keyword}-${candidate.chunkType}-${index}`}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border border-pink-100 bg-white/70 p-2 hover:bg-pink-50"
                    >
                      <input
                        type="radio"
                        name="tavern-candidate"
                        checked={state.selectedCandidateIndex === index}
                        onChange={() => {
                          dispatch({ type: 'selectCandidate', index });
                          resetGeneratedPreview();
                        }}
                        className="mt-1"
                      />
                      <div className="min-w-0">
                        <div className="text-sm text-gray-900">
                          <span className="font-semibold">{candidate.keyword}</span>
                          <span className="ml-2 text-xs text-gray-600">
                            {candidate.chunkType} · {candidate.parseMethod}
                            {info.spec ? ` · ${info.spec}` : ''}
                            {info.specVersion ? `@${info.specVersion}` : ''}
                          </span>
                        </div>
                        <div className="text-xs text-gray-700">name：{info.name}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-pink-200 bg-white/70 p-4">
              <div className="grid gap-4">
                <div>
                  <label className="block text-sm font-semibold text-pink-700">导入为</label>
                  <select
                    className="mt-2 w-full rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                    value={state.targetTemplate}
                    onChange={(e) => {
                      dispatch({ type: 'setTemplate', template: e.target.value as DataCardTemplate });
                      resetGeneratedPreview();
                    }}
                    disabled={state.step === 'converting'}
                  >
                    <option value="general">通用角色（最稳，推荐）</option>
                    <option value="general-scenario">通用情景（规则映射推荐）</option>
                    <option value="magical-girl">魔法少女（保守填充）</option>
                    <option value="canshou">残兽（保守填充）</option>
                    <option value="scenario">情景（结构化 JSON）</option>
                  </select>
                  <div className="mt-2 text-xs text-gray-600">
                    {isScenarioTemplate
                      ? '规则映射更推荐通用情景卡；结构化情景建议使用 AI 转换。'
                      : '“保守填充”会尽量不做过度推理，无法结构化的信息会被放入分析/研究备注中。'}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-pink-700">保真选项</label>
                  <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-xl border border-pink-100 bg-white/80 p-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={state.keepRaw}
                      onChange={(e) => {
                        dispatch({ type: 'setKeepRaw', value: e.target.checked });
                        resetGeneratedPreview();
                      }}
                      disabled={state.step === 'converting'}
                    />
                    <div className="min-w-0">
                      <div className="text-sm text-gray-900">同时保存 `_tavern.raw`（体积很大，仅建议本地下载）</div>
                      <div className="mt-1 text-xs text-gray-600">
                        若你计划未来回导到 SillyTavern 或需要完整诊断信息，可开启；保存到档案馆时建议关闭。
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-semibold text-pink-700">转换模式</label>
                <div className="mt-2 grid gap-2">
                  <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-pink-100 bg-white/80 p-3">
                    <input
                      type="radio"
                      name="tavern-convert-mode"
                      className="mt-1"
                      checked={state.convertMode === 'rules'}
                      onChange={() => {
                        dispatch({ type: 'setConvertMode', mode: 'rules' });
                        resetGeneratedPreview();
                      }}
                      disabled={state.step === 'converting'}
                    />
                    <div className="min-w-0">
                      <div className="text-sm text-gray-900">规则映射（不调用 AI）</div>
                      <div className="mt-1 text-xs text-gray-600">稳定、可解释、不会发起网络请求。</div>
                    </div>
                  </label>

                  <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-pink-100 bg-white/80 p-3">
                    <input
                      type="radio"
                      name="tavern-convert-mode"
                      className="mt-1"
                      checked={state.convertMode === 'ai'}
                      onChange={() => {
                        dispatch({ type: 'setConvertMode', mode: 'ai' });
                        resetGeneratedPreview();
                      }}
                      disabled={state.step === 'converting'}
                    />
                    <div className="min-w-0">
                      <div className="text-sm text-gray-900">AI 深度转换（可选）</div>
                      <div className="mt-1 text-xs text-gray-600">
                        结构化质量更高，但会发送裁剪后的输入包到生成接口；输出会通过 schema 校验。
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {state.convertMode === 'ai' ? (
                <div className="mt-4 rounded-xl border border-pink-100 bg-white/60 p-3">
                  <div className="grid gap-3">
                    <div className="rounded-xl border border-pink-100 bg-white/70 p-3">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between text-left text-sm font-semibold text-pink-700"
                        onClick={() => setShowLanguageSection(!showLanguageSection)}
                        disabled={state.step === 'converting'}
                      >
                        <span>生成语言</span>
                        <span className="text-xs">{showLanguageSection ? '▲' : '▼'}</span>
                      </button>
                      {showLanguageSection ? (
                        <div className="mt-3">
                          <select
                            className="w-full rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                            value={selectedLanguage}
                            onChange={(e) => {
                              setSelectedLanguage(e.target.value);
                              resetGeneratedPreview();
                            }}
                            disabled={state.step === 'converting'}
                          >
                            {languages.map((lang) => (
                              <option key={lang.code} value={lang.code}>
                                {lang.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-gray-600">当前：{selectedLanguage}</div>
                      )}
                    </div>

                    <div className="rounded-xl border border-pink-100 bg-white/70 p-3">
                      <GenerationModeSwitcher
                        label="生成方式"
                        value={generationMode}
                        disabled={state.step === 'converting'}
                        helper={false}
                        onChange={(mode) => {
                          setGenerationMode(mode);
                          resetGeneratedPreview();
                        }}
                      />
                      <div className="mt-2 text-xs text-gray-600">
                        {generationMode === 'stream'
                          ? (isScenarioTemplate
                            ? '提示：流式生成会实时输出 Markdown，并生成【通用情景卡】。'
                            : '提示：流式生成会实时输出 Markdown，并生成【通用角色卡】；若需要结构化的魔法少女/残兽字段与 userAnswers，请切换为非流式。')
                          : (isScenarioTemplate
                            ? '提示：非流式生成会返回结构化情景 JSON（包含 elements 等字段），更适合进阶玩法。'
                            : '提示：非流式生成会返回结构化数据卡（魔法少女/残兽会同时生成 userAnswers），适合后续升华/导出酒馆卡。')}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <AiProviderSelector
                      onConfigChange={handleAiProviderConfigChange}
                    />
                    <div className="mt-2 text-xs text-gray-600">
                      可选：使用自有 API Key 冷却统一为 3 秒；使用官方 Key 冷却为 {Math.ceil(OFFICIAL_KEY_MAX_AI_COOLDOWN_MS / 1000)} 秒。API Key 仅存储于浏览器本地（localStorage），不会上传到服务器。
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mt-4">
                <button
                  type="button"
                  className="generate-button mb-0 w-full"
                  disabled={state.step === 'converting' || (state.convertMode === 'ai' && isCooldown)}
                  onClick={onGenerate}
                >
                  {state.step === 'converting'
                    ? '生成中…'
                    : state.convertMode === 'ai' && isCooldown
                      ? `冷却中 (${remainingTime}s)`
                      : `生成${targetLabel}卡`}
                </button>
                <div className="mt-2 text-xs text-gray-600">
                  生成后会在下方展示{targetLabel}卡预览；你可以保存图片、下载/复制 JSON，或保存到云端（档案馆）。
                </div>

                <div>
                  <label className="block text-sm font-semibold text-pink-700">占位符替换</label>
                  <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-xl border border-pink-100 bg-white/80 p-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={placeholderEnabled}
                      onChange={(e) => {
                        setPlaceholderEnabled(e.target.checked);
                        resetGeneratedPreview();
                      }}
                      disabled={state.step === 'converting'}
                    />
                    <div className="min-w-0">
                      <div className="text-sm text-gray-900">
                        替换 <code>{'{{user}}'}</code> / <code>{'{{char}}'}</code>
                      </div>
                      <div className="mt-1 text-xs text-gray-600">
                        规则映射与 AI 输入都会使用替换后的文本，避免导入后出现角色/用户占位符残留。
                      </div>
                    </div>
                  </label>

                  <div className="mt-3 grid gap-3">
                    <div>
                      <div className="text-xs font-semibold text-gray-700">
                        <code>{'{{user}}'}</code> →
                      </div>
                      <input
                        className="mt-1 w-full rounded-lg border border-pink-100 bg-white/80 px-3 py-2 text-sm text-gray-900"
                        value={userReplacement}
                        onChange={(e) => {
                          setUserReplacement(e.target.value);
                          resetGeneratedPreview();
                        }}
                        disabled={!placeholderEnabled || state.step === 'converting'}
                      />
                      <div className="mt-1 text-[11px] text-gray-500">默认：{DEFAULT_USER_REPLACEMENT}</div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-xs font-semibold text-gray-700">
                        <span>
                          <code>{'{{char}}'}</code> →
                        </span>
                        <label className="flex items-center gap-2 text-[11px] font-normal text-gray-600">
                          <input
                            type="checkbox"
                            checked={charReplacementMode === 'auto'}
                            onChange={(e) => {
                              const nextAuto = e.target.checked;
                              if (!nextAuto && !customCharReplacement.trim()) {
                                const fallback = selectedNormalized?.name?.trim() || DEFAULT_CHAR_FALLBACK;
                                setCustomCharReplacement(fallback);
                              }
                              setCharReplacementMode(nextAuto ? 'auto' : 'custom');
                              resetGeneratedPreview();
                            }}
                            disabled={!placeholderEnabled || state.step === 'converting'}
                          />
                          使用角色名
                        </label>
                      </div>
                      <input
                        className="mt-1 w-full rounded-lg border border-pink-100 bg-white/80 px-3 py-2 text-sm text-gray-900"
                        value={charReplacementMode === 'auto' ? resolvedCharReplacement : customCharReplacement}
                        onChange={(e) => {
                          setCustomCharReplacement(e.target.value);
                          setCharReplacementMode('custom');
                          resetGeneratedPreview();
                        }}
                        disabled={!placeholderEnabled || charReplacementMode === 'auto' || state.step === 'converting'}
                      />
                      <div className="mt-1 text-[11px] text-gray-500">默认：角色名（{resolvedCharReplacement}）</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <TavernCardPreview normalized={selectedNormalized} warnings={combinedWarnings} />

            {previewDataCard ? (
              <div>
                <div className="rounded-xl border border-pink-200 bg-white/70 p-4">
                  <div className="text-sm font-semibold text-pink-700">{targetLabel}卡预览</div>
                  <div className="mt-3">
                    {outputTemplateForPreview === 'magical-girl' ? (
                      <MagicalGirlCard
                        magicalGirl={previewDataCard as any}
                        gradientStyle="linear-gradient(135deg, #9775fa 0%, #b197fc 100%)"
                        onSaveImage={handleSaveImage}
                        imageSaveMode={imageSaveMode}
                        saveButtonLabel={imageSaveButtonLabel}
                      />
                    ) : outputTemplateForPreview === 'canshou' ? (
                      <CanshouCard
                        canshou={normalizeCanshouForCard(previewDataCard)}
                        onSaveImage={handleSaveImage}
                        imageSaveMode={imageSaveMode}
                        saveButtonLabel={imageSaveButtonLabel}
                      />
                    ) : outputTemplateForPreview === 'scenario' || outputTemplateForPreview === 'general-scenario' ? (
                      <GeneralScenarioCard
                        scenario={scenarioPreview ?? { title: '未命名情景', content: '' }}
                        isStreaming={isPreviewStreaming}
                        onSaveImage={handleSaveImage}
                        imageSaveMode={imageSaveMode}
                        saveButtonLabel={imageSaveButtonLabel}
                      />
                    ) : (
                      <GeneralCharacterCard
                        general={previewDataCard as any}
                        isStreaming={isPreviewStreaming}
                        onSaveImage={handleSaveImage}
                        imageSaveMode={imageSaveMode}
                        saveButtonLabel={imageSaveButtonLabel}
                      />
                    )}
                  </div>
                </div>

                {outputDataCard ? (
                  <div className="mt-4 rounded-xl border border-pink-200 bg-white/70 p-4">
                    <div className="space-y-5 text-left">
                      <div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-gray-800">设定长图保存方式</span>
                          <span className="text-xs text-gray-500">推荐：{recommendedImageMode === 'download' ? '下载' : '弹窗'}</span>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <button type="button" className={preferenceButtonClass(imageSaveMode === 'download')} onClick={() => setImageSaveMode('download')}>
                            💾 一键下载
                          </button>
                          <button type="button" className={preferenceButtonClass(imageSaveMode === 'modal')} onClick={() => setImageSaveMode('modal')}>
                            📱 弹窗长按保存
                          </button>
                        </div>
                        <p className="mt-2 text-xs text-gray-500">提示：保存按钮在{targetLabel}卡最底部；移动端建议弹窗方式。</p>
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-gray-800">数据卡 JSON 保存方式</span>
                          <span className="text-xs text-gray-500">推荐：{recommendedJsonMode === 'download' ? '下载' : '复制'}</span>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <button type="button" className={preferenceButtonClass(jsonSaveMode === 'download')} onClick={() => setJsonSaveMode('download')}>
                            下载 JSON
                          </button>
                          <button type="button" className={preferenceButtonClass(jsonSaveMode === 'text')} onClick={() => setJsonSaveMode('text')}>
                            复制 JSON
                          </button>
                        </div>
                        <p className="mt-2 text-xs text-gray-500">两种方式可随时切换；若你开启了 `_tavern.raw`，JSON 会变大。</p>
                      </div>

                      <div className="rounded-xl border border-pink-100 bg-white/60 p-3">
                        <div className="text-sm font-semibold text-pink-700">保存到档案馆（可选）</div>
                        <div className="mt-2 grid gap-2 md:grid-cols-3">
                          <button
                            type="button"
                            className={preferenceButtonClass(cloudPreset === 'standard')}
                            onClick={() => setCloudPreset('standard')}
                          >
                            标准
                          </button>
                          <button type="button" className={preferenceButtonClass(cloudPreset === 'light')} onClick={() => setCloudPreset('light')}>
                            轻量
                          </button>
                          <button type="button" className={preferenceButtonClass(cloudPreset === 'minimal')} onClick={() => setCloudPreset('minimal')}>
                            极简
                          </button>
                        </div>

                        {cloudSavePreview ? (
                          <div className="mt-3 text-xs text-gray-600">
                            {'error' in cloudSavePreview ? (
                              <div className="text-red-600">预估失败：{cloudSavePreview.error}</div>
                            ) : (
                              <>
                                <div>
                                  预估写入大小：{formatKilobytes(cloudSavePreview.estimatedBytes)}KB / {MAX_DATA_CARD_BYTES / 1024}KB
                                  {cloudSavePreview.overLimit ? <span className="ml-2 font-semibold text-red-600">超限</span> : null}
                                </div>
                                {cloudSavePreview.warnings.length > 0 ? (
                                  <ul className="mt-2 list-disc space-y-1 pl-5">
                                    {cloudSavePreview.warnings.map((warning, idx) => (
                                      <li key={`tavern-cloud-warning-${idx}`}>{warning}</li>
                                    ))}
                                  </ul>
                                ) : null}
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="mt-3 text-xs text-gray-600">生成后会在此处显示体积预估与裁剪提示。</div>
                        )}
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
                        {jsonSaveMode === 'download' ? (
                          <button type="button" onClick={() => void onDownloadJson()} className="generate-button flex-1">
                            下载数据卡 JSON
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void onCopyJson()}
                            className="generate-button flex-1"
                            style={{ backgroundColor: '#3b82f6', backgroundImage: 'linear-gradient(to right, #3b82f6, #2563eb)' }}
                          >
                            {copyStatus === 'success' ? '已复制 ✓' : copyStatus === 'error' ? '复制失败' : '复制数据卡 JSON'}
                          </button>
                        )}

                        <SaveToCloudButton
                          data={outputDataCard}
                          getData={getCloudPayload}
                          cardType={cloudCardType}
                          buttonText="保存到云端"
                          defaultName={defaultCloudCardName}
                          defaultDescription={defaultCloudCardDescription}
                          className="generate-button flex-1"
                          style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }}
                        />
                      </div>

                      {jsonSaveMode === 'text' && outputJsonPayload ? (
                        <div className="mt-4 rounded-xl border border-pink-100 bg-white/60 p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-xs text-gray-600">
                              {copyStatus === 'success'
                                ? '✅ JSON 已复制，记得粘贴到编辑器中保存为 .json 文件'
                                : copyStatus === 'error'
                                  ? '⚠️ 复制遇到问题，可点击文本框全选后手动复制'
                                  : '提示：点击文本框可一键全选；复制后粘贴到文本编辑器保存为 .json。'}
                            </span>
                            <button
                              type="button"
                              onClick={() => void onCopyJson()}
                              className="rounded-md border border-indigo-200 bg-white px-3 py-1 text-xs font-medium text-indigo-600 hover:border-indigo-400 hover:text-indigo-700"
                            >
                              复制
                            </button>
                          </div>
                          <textarea
                            value={outputJsonPayload}
                            readOnly
                            className="h-64 w-full rounded-lg border bg-gray-50 p-3 font-mono text-xs text-gray-900"
                            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                          />
                          <div className="mt-2 text-center text-xs text-gray-400">点击文本框可全选内容</div>
                        </div>
                      ) : null}

                      <p className="text-xs text-gray-400 text-center">
                        提示：云端保存会自动移除大体积字段（如 `_tavern.raw`），并按所选预设裁剪正文；本地下载不受影响。
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-gray-700">生成中…（生成结束后将出现保存/下载选项）</div>
                )}

              {outputDataCard && tachiePrompt.trim() ? (
                <div className="mt-4 rounded-xl border border-pink-200 bg-white/70 p-4">
                  <div className="text-sm font-semibold text-pink-700">生成立绘（LibLib，可选）</div>
                  <div className="mt-2 text-xs text-gray-600">提示：立绘生成会直接调用 LibLib API；凭据仅存于本地。</div>
                  <div className="mt-3">
                    <TachieGenerator prompt={tachiePrompt} />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          </div>
        </div>
      ) : null}

      <ImagePreviewModal
        isOpen={showImageModal}
        imageUrl={savedImageUrl}
        onClose={() => {
          setShowImageModal(false);
          setSavedImageUrl(null);
        }}
      />
    </div>
  );
}
