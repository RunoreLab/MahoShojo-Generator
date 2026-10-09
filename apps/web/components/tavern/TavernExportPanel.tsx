import {
  TavernExportFields,
  TavernExportDialogueFields,
  TavernExportCreatorFields,
  TavernExportAdvancedFields,
  TavernExportChunkOptions,
  useTavernSourceSelection,
  readTavernSourceJson,
  readTavernBasePng,
} from '@mahoshojo/ui-web/tavern';
import { SafeJsonValueSchema } from '@mahoshojo/contracts/json-value';
import {
  buildDefaultFieldsFromDataCard,
  buildCreatorField,
  buildTavernExportCard,
  initialFields,
  parseTavernExportTags,
  parsePngChunkRanges,
  MAX_TAVERN_TEXT_BYTES,
  MAX_TAVERN_FILE_BYTES,
  type ExportFields,
  type ExportMeta,
  type ExportMetaRating,
} from '@mahoshojo/domain/tavern-card';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import BattleDataModal from '@/components/BattleDataModal';
import { ErrorMessage } from '@/components/ErrorMessage';
import TachieGenerator from '@/components/TachieGenerator';
import { TavernAiFillButton } from '@/components/tavern/TavernAiFillButton';
import { OFFICIAL_KEY_MAX_AI_COOLDOWN_MS, USER_PROVIDED_KEY_COOLDOWN_MS } from '@/lib/ai/cooldowns';
import { buildCustomProviderRequestPayload, isUsingUserProvidedKey } from '@/lib/ai/custom-provider';
import { authStorage } from '@/lib/auth';
import { downloadBlob } from '@/lib/client/blobUrl';
import { readJsonOrTextFromResponse, resolveApiErrorMessage } from '@/lib/client/apiError';
import { buildSafeFileName } from '@/lib/client/fileName';
import { formatHttpErrorMessage } from '@/lib/client/httpError';
import { useCooldown } from '@/lib/cooldown';
import { useAppRouterAdapter } from '@/lib/app-router-adapter';
import { inferTemplate, type InferableTemplate } from '@/lib/data-card-converter';
import { mapDataCardRuntimeSourceInfo, mapPublicDataCardRowToBattleSelectionPayload } from '@/lib/data-card-read-mappers';
import { computeTechIndex } from '@/lib/metrics/techIndex';
import {
  buildTavernScenarioFragment,
  getDefaultTavernBasePngBytes,
  writeTavernCardToPngBytes,
  type TavernScenarioFragment,
} from '@/lib/tavern-card';
import { useAuth } from '@/lib/useAuth';

type ExportStep = 'idle' | 'ready' | 'generating' | 'done' | 'error';

type ScenarioAttachment = TavernScenarioFragment & {
  id: string;
  fileName: string;
  source: 'cloud' | 'local';
  sourceDataCardId?: string;
};

type ApiTag = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  scope: 'user' | 'system' | 'admin';
  isActive: boolean;
};

type ApiMetrics = {
  techScore: number;
  techLevel: string;
  isNative: boolean | null;
  dataCardUpdatedAt: string;
  isStale: boolean;
};

type ApiRating = {
  queue: 'strict' | 'free';
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  tier: string;
  lastDelta: number | null;
  lastAppliedAt: string | null;
  publicRank: number | null;
  publicTotal: number | null;
};

type ApiMetaResponse =
  | {
      success: true;
      dataCardId: string;
      tags: ApiTag[];
      metrics: ApiMetrics | null;
      ratings: { strict: ApiRating | null; free: ApiRating | null };
    }
  | { success: false; error?: string };

interface ExportState {
  step: ExportStep;
  error: string | null;
  template: InferableTemplate;
  dataCard: unknown | null;
  exportMeta: ExportMeta | null;
  basePngBytes: Uint8Array | null;
  basePngName: string | null;
  overwriteExisting: boolean;
  includeCcv3: boolean;
  includeChara: boolean;
  includeSourceSnapshot: boolean;
  autoArenaScenario: boolean;
  includeArenaWorldbook: boolean;
  includeScenarioInScenario: boolean;
  includeScenarioInWorldbook: boolean;
  scenarios: ScenarioAttachment[];
  aiFilling: boolean;
  aiOverwriteFields: boolean;
  fields: ExportFields;
}

type ExportAction =
  | { type: 'reset' }
  | { type: 'setError'; message: string }
  | { type: 'setInlineError'; message: string | null }
  | { type: 'setDataCard'; data: unknown; template: InferableTemplate; fields: ExportFields; meta?: ExportMeta | null }
  | { type: 'setMetadata'; meta: ExportMeta; fields: Partial<ExportFields> }
  | { type: 'setBasePng'; bytes: Uint8Array; name: string }
  | { type: 'setField'; key: keyof ExportFields; value: string | number | boolean }
  | {
      type: 'setOption';
      key:
        | 'overwriteExisting'
        | 'includeCcv3'
        | 'includeChara'
        | 'includeSourceSnapshot'
        | 'autoArenaScenario'
        | 'includeArenaWorldbook'
        | 'includeScenarioInScenario'
        | 'includeScenarioInWorldbook';
      value: boolean;
    }
  | { type: 'addScenario'; scenario: ScenarioAttachment }
  | { type: 'removeScenario'; id: string }
  | { type: 'moveScenario'; from: number; to: number }
  | { type: 'clearScenarios' }
  | { type: 'setAiFilling'; value: boolean }
  | { type: 'setAiOverwriteFields'; value: boolean }
  | { type: 'generating' }
  | { type: 'done' }
  | { type: 'generationFailed'; message: string };

const DEFAULT_TAVERN_BASE_NAME = 'mahoshojo-logo.png';

const initialState: ExportState = {
  step: 'idle',
  error: null,
  template: 'unknown',
  dataCard: null,
  exportMeta: null,
  basePngBytes: null,
  basePngName: null,
  overwriteExisting: true,
  includeCcv3: true,
  includeChara: true,
  includeSourceSnapshot: true,
  autoArenaScenario: true,
  includeArenaWorldbook: true,
  includeScenarioInScenario: true,
  includeScenarioInWorldbook: true,
  scenarios: [],
  aiFilling: false,
  aiOverwriteFields: false,
  fields: initialFields,
};

function reducer(state: ExportState, action: ExportAction): ExportState {
  switch (action.type) {
    case 'reset':
      return { ...initialState };
    case 'setError':
      return { ...state, step: 'error', error: action.message };
    case 'setInlineError':
      return { ...state, error: action.message };
    case 'setDataCard':
      return {
        ...state,
        step: 'ready',
        error: null,
        dataCard: action.data,
        exportMeta: action.meta ?? null,
        template: action.template,
        fields: action.fields,
      };
    case 'setMetadata':
      return { ...state, exportMeta: action.meta, fields: { ...state.fields, ...action.fields } };
    case 'setBasePng':
      return { ...state, basePngBytes: action.bytes, basePngName: action.name };
    case 'setField':
      return { ...state, fields: { ...state.fields, [action.key]: action.value } as ExportFields };
    case 'setOption':
      if (!action.value && ((action.key === 'includeCcv3' && !state.includeChara) || (action.key === 'includeChara' && !state.includeCcv3))) return state;
      return { ...state, [action.key]: action.value } as ExportState;
    case 'addScenario':
      return { ...state, scenarios: [...state.scenarios, action.scenario] };
    case 'removeScenario':
      return { ...state, scenarios: state.scenarios.filter((item) => item.id !== action.id) };
    case 'moveScenario': {
      const next = [...state.scenarios];
      if (action.from < 0 || action.from >= next.length) return state;
      if (action.to < 0 || action.to >= next.length) return state;
      const [moved] = next.splice(action.from, 1);
      if (!moved) return state;
      next.splice(action.to, 0, moved);
      return { ...state, scenarios: next };
    }
    case 'clearScenarios':
      return { ...state, scenarios: [] };
    case 'setAiFilling':
      return { ...state, aiFilling: action.value };
    case 'setAiOverwriteFields':
      return { ...state, aiOverwriteFields: action.value };
    case 'generating':
      return { ...state, step: 'generating', error: null };
    case 'generationFailed':
      return { ...state, step: 'ready', error: action.message };
    case 'done':
      return { ...state, step: 'done' };
    default:
      return state;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const safeString = (value: unknown): string => (typeof value === 'string' ? value : '');

const safeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
};

const readCloudSourceCardId = (record: Record<string, unknown>): string => {
  const internalId = safeString(record['_cardId']).trim();
  if (internalId) return internalId;
  return safeString(record['dataCardId']).trim();
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

const readTavernMeta = (card: unknown): Record<string, unknown> | null => {
  if (!isRecord(card)) return null;
  const tavern = card['_tavern'];
  if (!isRecord(tavern)) return null;
  const meta = tavern['meta'];
  return isRecord(meta) ? meta : null;
};

const fetchDataCardMeta = async (dataCardId: string): Promise<Extract<ApiMetaResponse, { success: true }> | null> => {
  if (!dataCardId) return null;
  try {
    const authHeader = await authStorage.getAuthHeader();
    const headers: HeadersInit = authHeader ? { Authorization: authHeader } : {};
    const response = await fetch(`/api/data-card-meta?dataCardId=${encodeURIComponent(dataCardId)}`, { method: 'GET', headers });
    const json = (await response.json()) as ApiMetaResponse;
    if (!response.ok || !json || (json as any).success !== true) {
      return null;
    }
    return json as Extract<ApiMetaResponse, { success: true }>;
  } catch {
    return null;
  }
};

const buildExportRating = (rating: ApiRating | null): ExportMetaRating | null => {
  if (!rating) return null;
  const total = Number.isFinite(rating.games) ? rating.games : rating.wins + rating.losses + rating.draws;
  const winRate = total > 0 ? Math.round((rating.wins / total) * 1000) / 10 : null;
  return {
    rating: rating.rating,
    games: rating.games,
    wins: rating.wins,
    losses: rating.losses,
    draws: rating.draws,
    tier: rating.tier,
    lastDelta: rating.lastDelta ?? null,
    lastAppliedAt: rating.lastAppliedAt ?? null,
    publicRank: rating.publicRank ?? null,
    publicTotal: rating.publicTotal ?? null,
    winRate,
  };
};

const verifyNativeSignature = async (dataCard: unknown): Promise<boolean> => {
  if (!dataCard) return false;
  try {
    const response = await fetch('/api/verify-origin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataCard),
    });
    if (!response.ok) return false;
    const json = (await response.json()) as any;
    return Boolean(json?.isValid);
  } catch {
    return false;
  }
};

const buildExportMeta = async (dataCard: unknown): Promise<ExportMeta> => {
  const record = isRecord(dataCard) ? dataCard : {};
  const sourceInfo = mapDataCardRuntimeSourceInfo(record);
  const dataCardId = readCloudSourceCardId(record);
  const source: ExportMeta['source'] = dataCardId ? 'database' : 'local';

  const meta: ExportMeta = {
    source,
    dataCardId: dataCardId || undefined,
    dataCardName: sourceInfo.sourceDataCardName || safeString(record['codename']) || undefined,
    dataCardDescription: sourceInfo.sourceDataCardDescription || safeString(record['content']) || undefined,
    author: sourceInfo.sourceAuthor,
    isPublic: sourceInfo.sourceIsPublic,
    createdAt: sourceInfo.sourceDataCardCreatedAt,
    updatedAt: sourceInfo.sourceDataCardUpdatedAt,
    likeCount: sourceInfo.sourceDataCardLikeCount,
    favoriteCount: sourceInfo.sourceDataCardFavoriteCount,
    usageCount: sourceInfo.sourceDataCardUsageCount,
  };

  const apiMeta = dataCardId ? await fetchDataCardMeta(dataCardId) : null;
  if (apiMeta) {
    const apiTags = Array.isArray(apiMeta.tags) ? apiMeta.tags.map((tag) => tag.name).filter(Boolean) : [];
    if (apiTags.length > 0) meta.tags = uniqueStrings(apiTags);

    if (apiMeta.metrics) {
      meta.techScore = apiMeta.metrics.techScore;
      meta.techLevel = apiMeta.metrics.techLevel;
      if (typeof apiMeta.metrics.isNative === 'boolean') {
        meta.isNative = apiMeta.metrics.isNative;
      } else {
        meta.isNative = await verifyNativeSignature(dataCard);
      }
    } else {
      try {
        const tech = computeTechIndex(dataCard as any);
        meta.techScore = tech.techScore;
        meta.techLevel = tech.techLevel;
      } catch {
        meta.techScore = null;
        meta.techLevel = null;
      }
      meta.isNative = await verifyNativeSignature(dataCard);
    }

    const strictRating = buildExportRating(apiMeta.ratings?.strict ?? null);
    const freeRating = buildExportRating(apiMeta.ratings?.free ?? null);
    meta.ratings = { strict: strictRating, free: freeRating };
    meta.rankTier = strictRating?.tier || freeRating?.tier || undefined;
  } else {
    try {
      const tech = computeTechIndex(dataCard as any);
      meta.techScore = tech.techScore;
      meta.techLevel = tech.techLevel;
    } catch {
      meta.techScore = null;
      meta.techLevel = null;
    }

    meta.isNative = await verifyNativeSignature(dataCard);
  }

  const embeddedTags = uniqueStrings([
    ...safeStringArray(record['tags']),
    ...safeStringArray(readTavernMeta(dataCard)?.['tags']),
  ]);
  if (embeddedTags.length > 0) {
    meta.tags = meta.tags ? uniqueStrings([...meta.tags, ...embeddedTags]) : embeddedTags;
  }

  return meta;
};

const validateSourceData = (value: unknown): Record<string, unknown> => {
  if (!SafeJsonValueSchema.safeParse(value).success || !isRecord(value)) {
    throw new Error('数据卡必须为安全有效的 JSON 对象（不支持危险键、过深或过多节点）。');
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_TAVERN_TEXT_BYTES) {
    throw new Error('数据卡 JSON 超过 4 MiB 上限。');
  }
  return value;
};

const validateBasePng = (bytes: Uint8Array): Uint8Array => {
  if (bytes.byteLength > MAX_TAVERN_FILE_BYTES) throw new Error('底图 PNG 超过 32 MiB 上限。');
  parsePngChunkRanges(bytes);
  return bytes;
};

// The Web library adapter adds optional runtime metadata as undefined. Omit only
// those known absent fields; arbitrary source keys still pass strict SafeJson checks.
const normalizeCloudSource = (payload: unknown): unknown => {
  if (!isRecord(payload)) return payload;
  const optionalMetadata = new Set(['_updatedAt', '_createdAt', '_likeCount', '_favoriteCount', '_usageCount']);
  return Object.fromEntries(Object.entries(payload).filter(([key, value]) => value !== undefined || !optionalMetadata.has(key)));
};

const createId = (prefix: string): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    // ignore
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export function TavernExportPanel({ onBusyChange }: { onBusyChange?: (busy: boolean) => void } = {}) {
  const router = useAppRouterAdapter();
  const [state, dispatch] = useReducer(reducer, initialState);
  const { isAuthenticated, user } = useAuth();
  const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);
  const [showCharacterModal, setShowCharacterModal] = useState(false);
  const [showScenarioModal, setShowScenarioModal] = useState(false);
  const [isMatching, setIsMatching] = useState<'character' | 'scenario' | null>(null);
  const [tachieImageUrl, setTachieImageUrl] = useState<string | null>(null);
  const [isApplyingTachie, setIsApplyingTachie] = useState(false);
  const isUserCustomKey = isUsingUserProvidedKey(userProviderConfig);
  const tavernAiCooldownMs = isUserCustomKey ? USER_PROVIDED_KEY_COOLDOWN_MS : OFFICIAL_KEY_MAX_AI_COOLDOWN_MS;
  const tavernAiCooldownKey = isUserCustomKey ? 'tavernAiFillCooldown:custom' : 'tavernAiFillCooldown:system';
  const { isCooldown, startCooldown, remainingTime } = useCooldown(tavernAiCooldownKey, tavernAiCooldownMs);

  const busy = state.step === 'generating' || state.aiFilling || isApplyingTachie;
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);

  const sourceSelection = useTavernSourceSelection();
  const baseSelection = useTavernSourceSelection();
  const scenarioSelection = useTavernSourceSelection();
  const sourceToken = useRef(0);
  const pendingSourceRead = useRef(false);
  const fieldRevision = useRef(0);
  const fieldVersions = useRef<Partial<Record<keyof ExportFields, number>>>({});
  const aiRequest = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const matchingRequest = useRef(0);
  const matchingBusy = useRef(false);
  const generationBusy = useRef(false);

  useEffect(() => () => { aiRequest.current.controller?.abort(); aiRequest.current.id += 1; matchingRequest.current += 1; }, []);

  const cancelAiFill = () => {
    aiRequest.current.controller?.abort();
    aiRequest.current = { id: aiRequest.current.id + 1, controller: null };
    dispatch({ type: 'setAiFilling', value: false });
  };

  const onFieldChange = (key: keyof ExportFields, value: string | number | boolean) => {
    fieldRevision.current += 1;
    fieldVersions.current[key] = (fieldVersions.current[key] ?? 0) + 1;
    cancelAiFill();
    dispatch({ type: 'setField', key, value });
  };

  const beginSourceSelection = () => {
    cancelAiFill();
    const token = sourceSelection.begin();
    sourceToken.current = token;
    pendingSourceRead.current = true;
    return token;
  };

  const keepCurrentSource = () => {
    // An action on the visible card supersedes a still-reading file/random result.
    // Do not invalidate metadata already enriching this same visible source.
    if (pendingSourceRead.current) {
      sourceToken.current = sourceSelection.begin();
      pendingSourceRead.current = false;
    }
  };

  const applySource = async (payload: unknown, token: number) => {
    if (!sourceSelection.isCurrent(token)) return;
    const data = validateSourceData(payload);
    pendingSourceRead.current = false;
    const template = inferTemplate(data);
    const fields = buildDefaultFieldsFromDataCard(template, data, null, buildCreatorField(null, user));
    const versions = { ...fieldVersions.current };
    // Show the new source immediately. Later metadata may enrich only untouched fields.
    dispatch({ type: 'setDataCard', data, template, fields });
    const meta = await buildExportMeta(data);
    if (!sourceSelection.isCurrent(token)) return;
    const enriched = buildDefaultFieldsFromDataCard(template, data, meta, buildCreatorField(meta, user));
    const untouchedFields = Object.fromEntries(Object.entries(enriched).filter(([key]) => {
      const field = key as keyof ExportFields;
      return (fieldVersions.current[field] ?? 0) === (versions[field] ?? 0);
    })) as Partial<ExportFields>;
    dispatch({ type: 'setMetadata', meta, fields: untouchedFields });
  };

  const onDataCardSelected = async (file: File | null) => {
    if (!file) return;
    const token = beginSourceSelection();
    const revision = fieldRevision.current;
    try {
      const json = await readTavernSourceJson(file);
      if (!sourceSelection.isCurrent(token) || revision !== fieldRevision.current) return;
      await applySource(json, token);
    } catch (error) {
      if (sourceSelection.isCurrent(token) && revision === fieldRevision.current) {
        dispatch({ type: 'setInlineError', message: error instanceof Error ? error.message : '解析数据卡失败' });
      }
    } finally {
      if (sourceSelection.isCurrent(token)) pendingSourceRead.current = false;
    }
  };

  const onCloudCardPicked = async (payload: unknown) => {
    const token = beginSourceSelection();
    try {
      setShowCharacterModal(false);
      await applySource(normalizeCloudSource(payload), token);
    } catch (error) {
      if (sourceSelection.isCurrent(token)) dispatch({ type: 'setInlineError', message: error instanceof Error ? `解析档案馆数据卡失败：${error.message}` : '解析档案馆数据卡失败' });
    }
  };

  const onToggleScenarioPicked = (payload: any, nextSelected: boolean) => {
    try {
      const sourceInfo = mapDataCardRuntimeSourceInfo(payload);
      const sourceId = sourceInfo.sourceDataCardId ?? '';
      if (!sourceId) return;

      if (!nextSelected) {
        for (const item of state.scenarios) {
          if (item.source === 'cloud' && item.sourceDataCardId === sourceId) {
            dispatch({ type: 'removeScenario', id: item.id });
          }
        }
        return;
      }

      if (state.scenarios.some((item) => item.source === 'cloud' && item.sourceDataCardId === sourceId)) {
        return;
      }

      const fragment = buildTavernScenarioFragment(validateSourceData(normalizeCloudSource(payload)), { maxChars: 0 });
      if (!fragment) throw new Error('该数据卡无法识别为情景卡（支持：通用情景/情景问卷）');

      const cardName = sourceInfo.sourceDataCardName || fragment.title;

      dispatch({
        type: 'addScenario',
        scenario: {
          ...fragment,
          id: createId('scenario-cloud'),
          fileName: cardName,
          source: 'cloud',
          sourceDataCardId: sourceId,
        },
      });
    } catch (error) {
      dispatch({
        type: 'setInlineError',
        message: error instanceof Error ? `载入情景失败：${error.message}` : '载入情景失败',
      });
    }
  };

  const selectedScenarioCardIds = useMemo(() => {
    return state.scenarios
      .map((item) => (item.source === 'cloud' ? item.sourceDataCardId : null))
      .filter((id): id is string => typeof id === 'string' && Boolean(id));
  }, [state.scenarios]);

  const onRandomMatchCharacter = async () => {
    if (matchingBusy.current) return;
    matchingBusy.current = true;
    const request = ++matchingRequest.current;
    const token = beginSourceSelection();
    const revision = fieldRevision.current;
    setIsMatching('character');
    dispatch({ type: 'setInlineError', message: null });

    try {
      const response = await fetch('/api/random-public-card?type=character');
      const result = await response.json().catch(() => null as any);
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || '无法获取随机数据');
      }

      if (!sourceSelection.isCurrent(token) || revision !== fieldRevision.current) return;
      const payload = mapPublicDataCardRowToBattleSelectionPayload(result.card);
      await applySource(normalizeCloudSource(payload), token);
    } catch (error) {
      if (sourceSelection.isCurrent(token) && revision === fieldRevision.current) dispatch({ type: 'setInlineError', message: error instanceof Error ? `随机匹配失败：${error.message}` : '随机匹配失败' });
    } finally {
      if (request === matchingRequest.current) { matchingBusy.current = false; setIsMatching(null); }
    }
  };

  const onRandomMatchScenario = async () => {
    if (matchingBusy.current) return;
    matchingBusy.current = true;
    const request = ++matchingRequest.current;
    const token = scenarioSelection.begin();
    setIsMatching('scenario');
    dispatch({ type: 'setInlineError', message: null });

    try {
      const response = await fetch('/api/random-public-card?type=scenario');
      const result = await response.json().catch(() => null as any);
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || '无法获取随机数据');
      }

      if (!scenarioSelection.isCurrent(token)) return;
      const card = result.card;
      const payload = mapPublicDataCardRowToBattleSelectionPayload(card);

      onToggleScenarioPicked(payload, true);
    } catch (error) {
      if (scenarioSelection.isCurrent(token)) dispatch({ type: 'setInlineError', message: error instanceof Error ? `随机匹配失败：${error.message}` : '随机匹配失败' });
    } finally {
      if (request === matchingRequest.current) { matchingBusy.current = false; setIsMatching(null); }
    }
  };

  const onBasePngSelected = async (file: File | null) => {
    if (!file) return;
    const token = baseSelection.begin();
    setIsApplyingTachie(false);
    try {
      const bytes = await readTavernBasePng(file);
      if (baseSelection.isCurrent(token)) dispatch({ type: 'setBasePng', bytes, name: file.name || 'base.png' });
    } catch (error) {
      if (baseSelection.isCurrent(token)) dispatch({ type: 'setInlineError', message: error instanceof Error ? error.message : '读取底图失败' });
    }
  };

  const applyDefaultBasePng = async () => {
    const token = baseSelection.begin();
    setIsApplyingTachie(false);
    dispatch({ type: 'setInlineError', message: null });
    try {
      const bytes = validateBasePng(await getDefaultTavernBasePngBytes());
      if (baseSelection.isCurrent(token)) dispatch({ type: 'setBasePng', bytes, name: DEFAULT_TAVERN_BASE_NAME });
    } catch (error) {
      if (baseSelection.isCurrent(token)) dispatch({ type: 'setInlineError', message: error instanceof Error ? error.message : '默认底图加载失败' });
    }
  };

  const tagsArray = useMemo(() => parseTavernExportTags(state.fields.tags), [state.fields.tags]);

  const tachiePrompt = useMemo(() => {
    if (!state.dataCard) return '';
    if (state.template !== 'magical-girl' && state.template !== 'canshou' && state.template !== 'general') return '';

    const record = isRecord(state.dataCard) ? state.dataCard : {};

    if (state.template === 'magical-girl') {
      const appearance = isRecord(record['appearance']) ? record['appearance'] : {};
      return `${JSON.stringify(appearance)}, Xiabanmo, 二次元, 魔法少女`;
    }

    if (state.template === 'canshou') {
      const appearance = safeString(record['appearance']);
      const materialAndSkin = safeString(record['materialAndSkin']);
      const featuresAndAppendages = safeString(record['featuresAndAppendages']);
      const parts = [appearance, materialAndSkin, featuresAndAppendages].map((item) => item.trim()).filter(Boolean);
      return `${parts.join(', ')}, Xiabanmo, 二次元`;
    }

    const name = safeString(record['name']).trim();
    const content = safeString(record['content']).trim();
    const head = content.length > 800 ? content.slice(0, 800) : content;
    return `${name ? `${name}, ` : ''}${head}, Xiabanmo, 二次元, 角色立绘`;
  }, [state.dataCard, state.template]);

  const tachiePromptKey = useMemo(() => {
    const text = tachiePrompt.trim();
    if (!text) return '';
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return `${state.template}-${hash}`;
  }, [tachiePrompt, state.template]);

  useEffect(() => {
    setTachieImageUrl(null);
  }, [tachiePrompt]);

  const blobToPngBytes = async (blob: Blob): Promise<Uint8Array> => {
    if (blob.size > MAX_TAVERN_FILE_BYTES) throw new Error('立绘文件超过 32 MiB 上限。');
    if (blob.type === 'image/png') {
      return validateBasePng(new Uint8Array(await blob.arrayBuffer()));
    }

    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('立绘图片加载失败（可能是浏览器不支持的格式）'));
        img.src = objectUrl;
      });

      const width = image.naturalWidth || image.width || 0;
      const height = image.naturalHeight || image.height || 0;
      if (!width || !height) {
        throw new Error('立绘图片尺寸读取失败');
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建 Canvas 上下文');
      ctx.drawImage(image, 0, 0);

      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((next) => (next ? resolve(next) : reject(new Error('立绘转 PNG 失败'))), 'image/png');
      });

      if (pngBlob.size > MAX_TAVERN_FILE_BYTES) throw new Error('底图 PNG 超过 32 MiB 上限。');
      return validateBasePng(new Uint8Array(await pngBlob.arrayBuffer()));
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const onUseTachieAsBase = async () => {
    if (!tachieImageUrl || isApplyingTachie) return;
    const token = baseSelection.begin();
    const source = sourceToken.current;
    const isCurrent = () => baseSelection.isCurrent(token) && sourceSelection.isCurrent(source);
    setIsApplyingTachie(true);
    dispatch({ type: 'setInlineError', message: null });
    try {
      const response = await fetch(tachieImageUrl);
      if (!response.ok) {
        throw new Error(`下载立绘失败（HTTP ${response.status}）`);
      }
      const blob = await response.blob();
      const bytes = await blobToPngBytes(blob);
      if (isCurrent()) dispatch({ type: 'setBasePng', bytes, name: buildSafeFileName(`${state.fields.name || '角色'}_立绘`, 'png', 'tachie') });
    } catch (error) {
      if (isCurrent()) dispatch({ type: 'setInlineError', message: error instanceof Error ? error.message : '设置底图失败' });
    } finally {
      if (baseSelection.isCurrent(token)) setIsApplyingTachie(false);
    }
  };

  const onAiFill = async () => {
    if (aiRequest.current.controller) return;
    if (isCooldown) {
      dispatch({ type: 'setInlineError', message: `操作过于频繁，请等待 ${remainingTime} 秒后再试。` });
      return;
    }

    keepCurrentSource();
    const controller = new AbortController();
    const requestId = aiRequest.current.id + 1;
    aiRequest.current = { id: requestId, controller };
    const token = sourceToken.current;
    const isCurrent = () => aiRequest.current.id === requestId && sourceSelection.isCurrent(token);
    dispatch({ type: 'setAiFilling', value: true });
    dispatch({ type: 'setInlineError', message: null });

    const truncate = (value: string, maxChars: number): string => {
      const trimmed = value.trim();
      if (trimmed.length <= maxChars) return trimmed;
      return `${trimmed.slice(0, maxChars)}\n...[已截断]`;
    };

    try {
      if (userProviderConfig && userProviderConfig.providerId !== 'system' && !userProviderConfig.apiKey?.trim()) {
        throw new Error('⚠️ 已选择自定义 AI 供应商，但尚未填写 API Key。');
      }

      const customProviderPayload = buildCustomProviderRequestPayload(userProviderConfig);
      const requestBody: Record<string, unknown> = {
        name: (state.fields.name || '').trim() || '未命名角色',
        description: truncate(state.fields.description || '', 8_000),
        personality: truncate(state.fields.personality || '', 8_000),
        scenario: truncate(state.fields.scenario || '', 6_000),
        tags: tagsArray,
        language: 'zh-CN',
        ...(customProviderPayload
          ? {
              customProvider: customProviderPayload,
            }
          : {}),
      };

      const activityHeaders = await authStorage.getActivityHeaders();
      if (!isCurrent()) return;
      const response = await fetch('/api/tavern/ai-fill', {
        signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...activityHeaders },
        body: JSON.stringify(requestBody),
      });

      if (!isCurrent()) return;
      if (!response.ok) {
        const { payload } = await readJsonOrTextFromResponse(response);
        if (!isCurrent()) return;
        const errorJson = payload && typeof payload === 'object' ? (payload as any) : null;
        const redirectReason = errorJson?.reason || errorJson?.message || errorJson?.error || resolveApiErrorMessage({ payload, fallback: '' });
        if (errorJson?.shouldRedirect || errorJson?.redirect === '/arrested') {
          void router.push({
            pathname: '/arrested',
            query: { reason: redirectReason || '使用危险符文' },
          });
          return;
        }
        const serverMessage = resolveApiErrorMessage({ payload, fallback: 'AI 补全失败' });
        throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: 'AI 补全失败' }));
      }

      const json = (await response.json()) as any;
      if (!isCurrent()) return;
      const nextScenario = typeof json?.scenario === 'string' ? json.scenario : '';
      const nextFirstMes = typeof json?.first_mes === 'string' ? json.first_mes : '';
      const nextMesExample = typeof json?.mes_example === 'string' ? json.mes_example : '';

      const shouldOverwrite = state.aiOverwriteFields;
      if (shouldOverwrite || !state.fields.scenario.trim()) {
        fieldVersions.current.scenario = (fieldVersions.current.scenario ?? 0) + 1;
        dispatch({ type: 'setField', key: 'scenario', value: nextScenario });
      }
      if (shouldOverwrite || !state.fields.firstMes.trim()) {
        fieldVersions.current.firstMes = (fieldVersions.current.firstMes ?? 0) + 1;
        dispatch({ type: 'setField', key: 'firstMes', value: nextFirstMes });
      }
      if (shouldOverwrite || !state.fields.mesExample.trim()) {
        fieldVersions.current.mesExample = (fieldVersions.current.mesExample ?? 0) + 1;
        dispatch({ type: 'setField', key: 'mesExample', value: nextMesExample });
      }

      startCooldown(tavernAiCooldownMs);
    } catch (error) {
      if (isCurrent()) dispatch({ type: 'setInlineError', message: error instanceof Error ? error.message : 'AI 补全失败' });
    } finally {
      if (isCurrent()) { aiRequest.current.controller = null; dispatch({ type: 'setAiFilling', value: false }); }
    }
  };

  const exportInput = useMemo(() => ({
    fields: state.fields,
    dataCard: state.dataCard,
    options: {
      autoArenaScenario: state.autoArenaScenario,
      includeArenaWorldbook: state.includeArenaWorldbook,
      includeScenarioInScenario: state.includeScenarioInScenario,
      includeScenarioInWorldbook: state.includeScenarioInWorldbook,
      includeSourceSnapshot: state.includeSourceSnapshot,
    },
    scenarioFragments: state.scenarios,
    exportMeta: state.exportMeta,
    exporter: user,
  }), [state.dataCard, state.fields, state.autoArenaScenario, state.includeArenaWorldbook, state.includeScenarioInScenario, state.includeScenarioInWorldbook, state.includeSourceSnapshot, state.scenarios, state.exportMeta, user]);

  const exportPreview = useMemo(() => {
    if (!exportInput.dataCard) return null;
    try {
      return { result: buildTavernExportCard({ ...exportInput, exportedAt: new Date().toISOString() }), error: null };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : '导出内容无效' };
    }
  }, [exportInput]);

  const onGenerate = async () => {
    if (generationBusy.current) return;
    generationBusy.current = true;
    keepCurrentSource();
    baseSelection.begin();
    setIsApplyingTachie(false);
    const token = sourceToken.current;
    cancelAiFill();
    dispatch({ type: 'generating' });
    try {
      if (!exportPreview?.result) throw new Error(exportPreview?.error || '请先选择数据卡');
      if (!state.includeCcv3 && !state.includeChara) throw new Error('至少保留一种酒馆数据块。');
      const baseBytes = validateBasePng(state.basePngBytes ?? (await getDefaultTavernBasePngBytes()));
      if (!sourceSelection.isCurrent(token)) return;
      // The preview and download use the exact same bounded shared projection.
      const { card } = buildTavernExportCard({ ...exportInput, exportedAt: new Date().toISOString() });
      const outBytes = writeTavernCardToPngBytes(baseBytes, card, {
        overwriteExisting: state.overwriteExisting,
        includeCcv3Chunk: state.includeCcv3,
        includeCharaChunk: state.includeChara,
      });
      const copy = new Uint8Array(outBytes.byteLength);
      copy.set(outBytes);
      downloadBlob(new Blob([copy.buffer], { type: 'image/png' }), buildSafeFileName(state.fields.name || 'tavern-card', 'png', 'tavern-card'));
      dispatch({ type: 'done' });
    } catch (error) {
      if (sourceSelection.isCurrent(token)) dispatch({ type: 'generationFailed', message: error instanceof Error ? error.message : '导出失败' });
    } finally {
      generationBusy.current = false;
    }
  };

  const onDownloadSource = () => {
    if (!state.dataCard) return;
    const json = JSON.stringify(state.dataCard);
    downloadBlob(new Blob([json], { type: 'application/json;charset=utf-8' }), buildSafeFileName(`${state.fields.name || 'data-card'}_源数据`, 'json', 'source-card'));
  };

  const renderedSourceToken = sourceToken.current;
  const ready = state.step === 'ready' || state.step === 'generating' || state.step === 'done';

  return (
    <div className="mt-4">
      <div className="rounded-xl border border-pink-200 bg-white/70 p-4">
        <div className="text-sm text-gray-700">
          导出会把角色设定写入 PNG 元数据（tEXt 块）；底图仅作为外观载体。请确认不会把隐私信息写入 `creator_notes/system_prompt` 等字段。
        </div>
      </div>

      <div className="input-group mt-4">
        <label className="input-label" htmlFor="tavern-export-card">
          选择本项目数据卡 JSON
        </label>
        <input
          id="tavern-export-card"
          type="file"
          accept="application/json,.json"
          className="cursor-pointer input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-pink-50 file:text-pink-700 hover:file:bg-pink-100 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={state.step === 'generating'}
          onChange={(event) => { const file = event.target.files?.[0] ?? null; event.target.value = ''; void onDataCardSelected(file); }}
        />
        <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center">
          <button
            type="button"
            className="rounded-xl border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-semibold text-pink-800 transition-colors hover:bg-pink-100 disabled:opacity-50"
            disabled={state.step === 'generating'}
            onClick={() => setShowCharacterModal(true)}
          >
            浏览在线角色库
          </button>
          <button
            type="button"
            className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-semibold text-purple-800 transition-colors hover:bg-purple-100 disabled:opacity-50"
            disabled={state.step === 'generating' || isMatching !== null}
            onClick={() => void onRandomMatchCharacter()}
          >
            {isMatching === 'character' ? '匹配中...' : '随机匹配角色'}
          </button>
          <div className="text-xs text-gray-600 md:ml-auto">
            {isAuthenticated ? '已登录：可访问我的/收藏/私有数据卡。' : '未登录：仅可浏览公开数据卡；登录后可访问我的/收藏。'}
          </div>
        </div>
      </div>

      {state.error ? <ErrorMessage message={state.error} className="error-message mt-3" /> : null}

      {ready ? (
        <>
          <div className="mt-4 rounded-xl border border-pink-200 bg-white/70 p-4">
            <div className="text-sm text-gray-700">
              已识别数据卡类型：<span className="font-semibold text-pink-700">{state.template}</span>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <div className="space-y-4">
              <TavernExportFields fields={state.fields} disabled={state.step === 'generating'} onFieldChange={onFieldChange} scenarioTools={(<div className="mt-3 rounded-xl border border-pink-100 bg-white/60 p-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-pink-700">A.R.E.N.A. 世界书 / 情景拼接</div>
                        <div className="mt-1 text-xs text-gray-600">
                          可自动附带“魔法少女竞技场 A.R.E.N.A.”世界书，并将你选择的情景卡拼接进 scenario 与世界书（character_book）。
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <label className="flex items-start gap-2 rounded-xl border border-pink-100 bg-white/70 p-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={state.autoArenaScenario}
                          onChange={(e) => dispatch({ type: 'setOption', key: 'autoArenaScenario', value: e.target.checked })}
                          disabled={state.step === 'generating'}
                        />
                        <div className="min-w-0">
                          <div className="text-sm text-gray-900">scenario 为空时自动填入默认舞台</div>
                          <div className="mt-1 text-xs text-gray-600">默认舞台为 A.R.E.N.A.（可删改）。</div>
                        </div>
                      </label>

                      <label className="flex items-start gap-2 rounded-xl border border-pink-100 bg-white/70 p-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={state.includeArenaWorldbook}
                          onChange={(e) => dispatch({ type: 'setOption', key: 'includeArenaWorldbook', value: e.target.checked })}
                          disabled={state.step === 'generating'}
                        />
                        <div className="min-w-0">
                          <div className="text-sm text-gray-900">附带 A.R.E.N.A. 世界书</div>
                          <div className="mt-1 text-xs text-gray-600">写入到 SillyTavern 的 character_book。</div>
                        </div>
                      </label>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <label className="flex items-start gap-2 rounded-xl border border-pink-100 bg-white/70 p-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={state.includeScenarioInScenario}
                          onChange={(e) => dispatch({ type: 'setOption', key: 'includeScenarioInScenario', value: e.target.checked })}
                          disabled={state.step === 'generating'}
                        />
                        <div className="min-w-0">
                          <div className="text-sm text-gray-900">将附加情景拼接进 scenario</div>
                          <div className="mt-1 text-xs text-gray-600">会在导出时追加到 scenario 字段末尾。</div>
                        </div>
                      </label>

                      <label className="flex items-start gap-2 rounded-xl border border-pink-100 bg-white/70 p-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={state.includeScenarioInWorldbook}
                          onChange={(e) => dispatch({ type: 'setOption', key: 'includeScenarioInWorldbook', value: e.target.checked })}
                          disabled={state.step === 'generating'}
                        />
                        <div className="min-w-0">
                          <div className="text-sm text-gray-900">将附加情景写入世界书</div>
                          <div className="mt-1 text-xs text-gray-600">每个情景会写成一个常驻条目（constant=true）。</div>
                        </div>
                      </label>
                    </div>

                    <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
                      <button
                        type="button"
                        className="rounded-xl border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-semibold text-pink-800 transition-colors hover:bg-pink-100 disabled:opacity-50"
                        disabled={state.step === 'generating'}
                        onClick={() => setShowScenarioModal(true)}
                      >
                        浏览在线情景库
                      </button>

                      <button
                        type="button"
                        className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-800 transition-colors hover:bg-teal-100 disabled:opacity-50"
                        disabled={state.step === 'generating' || isMatching !== null}
                        onClick={() => void onRandomMatchScenario()}
                      >
                        {isMatching === 'scenario' ? '匹配中...' : '随机匹配情景'}
                      </button>

                      <label className="cursor-pointer rounded-xl border border-pink-200 bg-white/70 px-4 py-2 text-sm font-semibold text-pink-800 hover:bg-pink-50">
                        上传情景文件
                        <input
                          type="file"
                          accept="application/json,.json"
                          multiple
                          className="hidden"
                          disabled={state.step === 'generating'}
                          onChange={async (event) => {
                            const files = event.target.files ? Array.from(event.target.files) : [];
                            event.target.value = '';
                            if (files.length === 0) return;
                            const token = scenarioSelection.begin();
                            const errors: string[] = [];
                            for (const file of files) {
                              try {
                                const json = await readTavernSourceJson(file);
                                if (!scenarioSelection.isCurrent(token)) return;
                                const fragment = buildTavernScenarioFragment(json, { maxChars: 0 });
                                if (!fragment) {
                                  throw new Error('无法识别为情景卡（支持：通用情景/情景问卷）');
                                }
                                dispatch({
                                  type: 'addScenario',
                                  scenario: {
                                    ...fragment,
                                    id: createId('scenario-local'),
                                    fileName: file.name || fragment.title,
                                    source: 'local',
                                  },
                                });
                              } catch (error) {
                                const message = error instanceof Error ? error.message : '未知错误';
                                errors.push(`${file.name}: ${message}`);
                              }
                            }
                            if (!scenarioSelection.isCurrent(token)) return;
                            if (errors.length > 0) {
                              dispatch({
                                type: 'setInlineError',
                                message: `${errors.length}/${files.length} 个情景导入失败：${errors.join('；')}`,
                              });
                            }
                          }}
                        />
                      </label>

                      {state.scenarios.length > 0 ? (
                        <button
                          type="button"
                          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          onClick={() => { scenarioSelection.begin(); dispatch({ type: 'clearScenarios' }); }}
                          disabled={state.step === 'generating'}
                        >
                          清空附加情景（{state.scenarios.length}）
                        </button>
                      ) : null}
                    </div>

                    {state.scenarios.length > 0 ? (
                      <div className="mt-3 rounded-xl border border-pink-100 bg-white/70 p-3">
                        <div className="text-sm font-semibold text-gray-900">已添加的情景（顺序即拼接顺序）</div>
                        <ul className="mt-2 space-y-2">
                          {state.scenarios.map((item, index) => {
                            const canMoveUp = index > 0;
                            const canMoveDown = index < state.scenarios.length - 1;
                            return (
                              <li key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-pink-50 bg-white/80 p-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-gray-900 truncate">{item.title}</div>
                                  <div className="mt-1 text-xs text-gray-600">
                                    来源：{item.source === 'cloud' ? '档案馆' : '本地'} · 文件：{item.fileName}
                                  </div>
                                  {item.warnings.length > 0 ? (
                                    <div className="mt-1 text-xs text-amber-700">{item.warnings.join('；')}</div>
                                  ) : null}
                                </div>
                                <div className="flex shrink-0 flex-col gap-2">
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      className="h-8 w-8 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                      title="上移"
                                      disabled={state.step === 'generating' || !canMoveUp}
                                      onClick={() => dispatch({ type: 'moveScenario', from: index, to: index - 1 })}
                                    >
                                      ↑
                                    </button>
                                    <button
                                      type="button"
                                      className="h-8 w-8 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                      title="下移"
                                      disabled={state.step === 'generating' || !canMoveDown}
                                      onClick={() => dispatch({ type: 'moveScenario', from: index, to: index + 1 })}
                                    >
                                      ↓
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    className="h-8 rounded-lg border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed"
                                    disabled={state.step === 'generating'}
                                    onClick={() => dispatch({ type: 'removeScenario', id: item.id })}
                                  >
                                    移除
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : (
                      <div className="mt-3 text-xs text-gray-600">
                        未添加附加情景：你可以从在线情景库选择情景卡，或上传任意情景 JSON（通用情景/情景问卷）。
                      </div>
                    )}
                  </div>)} />

              <TavernExportDialogueFields fields={state.fields} disabled={state.step === 'generating'} onFieldChange={onFieldChange} />

              <TavernExportCreatorFields fields={state.fields} disabled={state.step === 'generating'} onFieldChange={onFieldChange} />

              <TavernExportAdvancedFields fields={state.fields} disabled={state.step === 'generating'} onFieldChange={onFieldChange} />
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-pink-200 bg-white/70 p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-pink-700">AI 补全文本字段（可选）</div>
                    <div className="mt-1 text-xs text-gray-600">
                      会把 name/description/personality/scenario/tags 等内容发送到生成接口，返回建议的 scenario/first_mes/mes_example。
                    </div>
                  </div>

                  <TavernAiFillButton
                    loading={state.aiFilling}
                    disabled={state.step === 'generating' || state.aiFilling || isCooldown}
                    cooldownSeconds={remainingTime}
                    onClick={onAiFill}
                  />
                </div>

                <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-pink-100 bg-white/70 p-3">
                  <input
                    type="checkbox"
                    checked={state.aiOverwriteFields}
                    onChange={(e) => dispatch({ type: 'setAiOverwriteFields', value: e.target.checked })}
                    disabled={state.step === 'generating' || state.aiFilling}
                    className="mt-1"
                  />
                  <div className="min-w-0">
                    <div className="text-sm text-gray-900">覆盖已填写的字段</div>
                    <div className="mt-1 text-xs text-gray-600">默认仅填充空字段；勾选后会覆盖你手动填写的内容。</div>
                  </div>
                </label>

                <details className="mt-3 rounded-xl border border-pink-100 bg-white/60 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-pink-700">自定义 AI（可选）</summary>
                  <div className="mt-3">
                    <AiProviderSelector onConfigChange={setUserProviderConfig} />
                    <div className="mt-2 text-xs text-gray-600">
                      可选：使用自有 API Key 冷却统一为 {Math.ceil(USER_PROVIDED_KEY_COOLDOWN_MS / 1000)} 秒；使用官方 Key 冷却为{' '}
                      {Math.ceil(OFFICIAL_KEY_MAX_AI_COOLDOWN_MS / 1000)} 秒。API Key 仅存储于浏览器本地（localStorage），不会上传到服务器。
                    </div>
                  </div>
                </details>
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="tavern-export-base">
                  选择底图 PNG（可选）
                </label>
                <input
                  id="tavern-export-base"
                  type="file"
                  accept="image/png"
                  className="cursor-pointer input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-pink-50 file:text-pink-700 hover:file:bg-pink-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={state.step === 'generating'}
                  onChange={(event) => { const file = event.target.files?.[0] ?? null; event.target.value = ''; void onBasePngSelected(file); }}
                />
                <div className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                  <button
                    type="button"
                    className="rounded-lg border border-pink-200 bg-white/70 px-3 py-1 text-pink-700 hover:bg-pink-50"
                    onClick={() => void applyDefaultBasePng()}
                    disabled={state.step === 'generating'}
                  >
                    使用默认底图（Logo）
                  </button>
                  {state.basePngName ? <span>当前底图：{state.basePngName}</span> : <span>未选择底图时将自动使用默认底图（项目 Logo）。</span>}
                </div>
              </div>

              {tachiePrompt.trim() ? (
                <div className="rounded-xl border border-pink-200 bg-white/70 p-4">
                  <div className="text-sm font-semibold text-pink-700">生成立绘（LibLib / ModelScope，可选）</div>
                  <div className="mt-1 text-xs text-gray-600">生成完成后可一键设为底图（会自动转为 PNG）。</div>
                  <div className="mt-3">
                    <TachieGenerator
                      key={`tavern-export-tachie-${tachiePromptKey}`}
                      prompt={tachiePrompt}
                      onImageUrlChange={(url) => { if (sourceSelection.isCurrent(renderedSourceToken)) setTachieImageUrl(url); }}
                    />
                  </div>
                  <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
                    <button
                      type="button"
                      className="rounded-lg border border-pink-200 bg-white/70 px-3 py-2 text-sm font-semibold text-pink-700 hover:bg-pink-50 disabled:opacity-50"
                      onClick={() => void onUseTachieAsBase()}
                      disabled={!tachieImageUrl || state.step === 'generating' || isApplyingTachie}
                    >
                      {isApplyingTachie ? '处理中...' : '一键设为底图'}
                    </button>
                    <div className="text-xs text-gray-600">
                      {tachieImageUrl ? '已捕获最新立绘，可直接设为底图。' : '尚未生成立绘或未通过审核。'}
                    </div>
                  </div>
                </div>
              ) : null}

              <TavernExportChunkOptions options={state} disabled={state.step === 'generating'} onOptionChange={(key, value) => dispatch({ type: 'setOption', key, value })} />

              <div className="rounded-xl border border-pink-200 bg-white/70 p-4">
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={state.includeSourceSnapshot} disabled={state.step === 'generating'} onChange={(event) => dispatch({ type: 'setOption', key: 'includeSourceSnapshot', value: event.target.checked })} />
                  附带来源诊断快照（可选，最多 24000 字符，不是完整备份）
                </label>
                <button type="button" className="mt-3 rounded-lg border border-pink-200 px-3 py-2 text-sm text-pink-700" onClick={onDownloadSource}>
                  下载完整源 JSON（保留未映射字段）
                </button>
                {exportPreview?.result?.warnings.length ? (
                  <ul className="mt-3 space-y-1 text-xs text-amber-800" aria-label="导出提示">
                    {exportPreview.result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                ) : null}
                {exportPreview?.error ? <div role="alert" className="mt-3 text-sm text-red-700">{exportPreview.error} 请调整字段；角色正文不会被自动截断。</div> : null}
              </div>

              <div className="rounded-xl border border-pink-200 bg-white/70 p-4">
                <button type="button" className="generate-button mb-0 w-full" disabled={state.step === 'generating' || !exportPreview?.result} onClick={onGenerate}>
                  生成并下载酒馆卡 PNG
                </button>

                {state.step === 'generating' ? <div className="mt-2 text-xs text-gray-700">生成中…（大字段可能需要数秒）</div> : null}
                {state.step === 'done' ? <div className="mt-2 text-xs text-green-700">已生成并开始下载。</div> : null}
              </div>
            </div>
          </div>
        </>
      ) : null}

      <BattleDataModal
        isOpen={showCharacterModal}
        onClose={() => setShowCharacterModal(false)}
        onSelectCard={onCloudCardPicked}
        selectedType="character"
        titleOverride="从在线数据库选择角色数据卡"
      />

      <BattleDataModal
        isOpen={showScenarioModal}
        onClose={() => setShowScenarioModal(false)}
        onToggleCard={onToggleScenarioPicked}
        selectedType="scenario"
        selectionMode="multi"
        selectedCardIds={selectedScenarioCardIds}
        maxSelected={10}
        titleOverride="从在线数据库选择情景数据卡（可多选）"
      />
    </div>
  );
}
