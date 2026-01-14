import { useRouter } from 'next/router';
import { useMemo, useReducer, useState } from 'react';

import AiProviderSelector, { type UserAIProviderConfig } from '@/components/AiProviderSelector';
import BattleDataModal from '@/components/BattleDataModal';
import { ErrorMessage } from '@/components/ErrorMessage';
import { TavernAiFillButton } from '@/components/tavern/TavernAiFillButton';
import { buildCustomProviderPayload } from '@/lib/ai/custom-provider';
import { downloadBlob } from '@/lib/client/blobUrl';
import { buildSafeFileName } from '@/lib/client/fileName';
import { inferTemplate, type InferableTemplate } from '@/lib/data-card-converter';
import {
  buildArenaDefaultScenario,
  buildArenaWorldbook,
  buildTavernScenarioFragment,
  createTavernV3Card,
  getPlaceholderPngBytes,
  recommendTavernExportFields,
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

interface ExportFields {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  tags: string;
  creatorNotes: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  talkativeness: number;
  fav: boolean;
}

interface ExportState {
  step: ExportStep;
  error: string | null;
  template: InferableTemplate;
  dataCard: unknown | null;
  basePngBytes: Uint8Array | null;
  basePngName: string | null;
  overwriteExisting: boolean;
  includeCcv3: boolean;
  includeChara: boolean;
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
  | { type: 'setDataCard'; data: unknown; template: InferableTemplate; fields: ExportFields }
  | { type: 'setBasePng'; bytes: Uint8Array; name: string }
  | { type: 'usePlaceholder' }
  | { type: 'setField'; key: keyof ExportFields; value: string | number | boolean }
  | {
      type: 'setOption';
      key:
        | 'overwriteExisting'
        | 'includeCcv3'
        | 'includeChara'
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
  | { type: 'done' };

const DEFAULT_CREATOR_NOTES = '来源：MahoShojo-Generator / 魔法少女竞技场 A.R.E.N.A.';

const initialFields: ExportFields = {
  name: '',
  description: '',
  personality: '',
  scenario: '',
  firstMes: '',
  mesExample: '',
  tags: '',
  creatorNotes: DEFAULT_CREATOR_NOTES,
  systemPrompt: '',
  postHistoryInstructions: '',
  talkativeness: 0.5,
  fav: false,
};

const initialState: ExportState = {
  step: 'idle',
  error: null,
  template: 'unknown',
  dataCard: null,
  basePngBytes: null,
  basePngName: null,
  overwriteExisting: true,
  includeCcv3: true,
  includeChara: true,
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
        template: action.template,
        fields: action.fields,
      };
    case 'setBasePng':
      return { ...state, basePngBytes: action.bytes, basePngName: action.name };
    case 'usePlaceholder':
      return { ...state, basePngBytes: getPlaceholderPngBytes(), basePngName: 'placeholder.png' };
    case 'setField':
      return { ...state, fields: { ...state.fields, [action.key]: action.value } as ExportFields };
    case 'setOption':
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

const readTavernMeta = (card: unknown): Record<string, unknown> | null => {
  if (!isRecord(card)) return null;
  const tavern = card['_tavern'];
  if (!isRecord(tavern)) return null;
  const meta = tavern['meta'];
  return isRecord(meta) ? meta : null;
};

const DEFAULT_CLOUD_CARD_DESCRIPTIONS = new Set(['角色数据卡', '情景数据卡', '叙事历史数据卡']);

const appendCreatorNotes = (base: string, block: string): string => {
  const left = base.trim();
  const right = block.trim();
  if (!right) return left;
  if (left.includes(right)) return left;
  if (!left) return right;
  return `${left}\n\n${right}`;
};

const buildCreatorNotesWithCloudDescription = (dataCard: unknown, baseCreatorNotes: string): string => {
  if (!isRecord(dataCard)) return baseCreatorNotes;

  const cloudId = safeString(dataCard['_cardId']).trim();
  if (!cloudId) return baseCreatorNotes;

  const cloudDescription = safeString(dataCard['_cardDescription']).trim();
  if (!cloudDescription) return baseCreatorNotes;
  if (DEFAULT_CLOUD_CARD_DESCRIPTIONS.has(cloudDescription)) return baseCreatorNotes;

  const capped = cloudDescription.replace(/\r\n/g, '\n').slice(0, 800);
  const block = `【档案馆简介】\n${capped}${cloudDescription.length > 800 ? '\n...[已截断]' : ''}`;
  return appendCreatorNotes(baseCreatorNotes, block);
};

const buildDefaultFieldsFromDataCard = (template: InferableTemplate, card: unknown): ExportFields => {
  const meta = readTavernMeta(card);
  const metaTags = meta ? safeStringArray(meta['tags']) : [];
  const recommended = recommendTavernExportFields(template, card, metaTags);
  const recommendedTags = recommended.tags.join(', ');

  if (!isRecord(card)) {
    return { ...initialFields };
  }

  const fromMeta = (key: string): string => (meta ? safeString(meta[key]) : '');
  const fromMetaFirstMes = fromMeta('firstMes') || fromMeta('first_mes');
  const fromMetaMesExample = fromMeta('mesExample') || fromMeta('mes_example');
  const baseCreatorNotes = fromMeta('creatorNotes') || fromMeta('creator_notes') || DEFAULT_CREATOR_NOTES;
  const creatorNotes = buildCreatorNotesWithCloudDescription(card, baseCreatorNotes);

  if (template === 'magical-girl') {
    const codename = safeString(card['codename']) || safeString(card['name']) || '未命名角色';
    const appearance = isRecord(card['appearance']) ? card['appearance'] : null;
    const analysis = isRecord(card['analysis']) ? card['analysis'] : null;
    const magicConstruct = isRecord(card['magicConstruct']) ? card['magicConstruct'] : null;
    const wonderlandRule = isRecord(card['wonderlandRule']) ? card['wonderlandRule'] : null;
    const blooming = isRecord(card['blooming']) ? card['blooming'] : null;

    const descParts: string[] = [];
    const overallLook = appearance ? safeString(appearance['overallLook']) : '';
    const outfit = appearance ? safeString(appearance['outfit']) : '';
    const accessories = appearance ? safeString(appearance['accessories']) : '';
    const colorScheme = appearance ? safeString(appearance['colorScheme']) : '';
    if (overallLook || outfit || accessories || colorScheme) {
      descParts.push(
        ['【外观】', overallLook, outfit && `服装：${outfit}`, accessories && `饰品：${accessories}`, colorScheme && `配色：${colorScheme}`]
          .filter(Boolean)
          .join('\n')
      );
    }
    if (magicConstruct) {
      const mcName = safeString(magicConstruct['name']);
      const mcForm = safeString(magicConstruct['form']);
      const mcDesc = safeString(magicConstruct['description']);
      const mcAbilities = Array.isArray(magicConstruct['basicAbilities']) ? safeStringArray(magicConstruct['basicAbilities']) : [];
      if (mcName || mcForm || mcDesc || mcAbilities.length > 0) {
        descParts.push(
          ['【魔装】', mcName && `名称：${mcName}`, mcForm && `形态：${mcForm}`, mcAbilities.length > 0 ? `能力：${mcAbilities.join('、')}` : '', mcDesc]
            .filter(Boolean)
            .join('\n')
        );
      }
    }
    if (wonderlandRule) {
      const wlName = safeString(wonderlandRule['name']);
      const wlDesc = safeString(wonderlandRule['description']);
      const wlActivation = safeString(wonderlandRule['activation']);
      const wlTendency = safeString(wonderlandRule['tendency']);
      if (wlName || wlDesc || wlActivation || wlTendency) {
        descParts.push(
          ['【奇境规则】', wlName && `名称：${wlName}`, wlTendency && `倾向：${wlTendency}`, wlActivation && `触发：${wlActivation}`, wlDesc]
            .filter(Boolean)
            .join('\n')
        );
      }
    }
    if (blooming) {
      const blName = safeString(blooming['name']);
      const blPower = safeString(blooming['powerLevel']);
      const blForm = safeString(blooming['evolvedForm']);
      const blOutfit = safeString(blooming['evolvedOutfit']);
      const blAbilities = Array.isArray(blooming['evolvedAbilities']) ? safeStringArray(blooming['evolvedAbilities']) : [];
      if (blName || blPower || blForm || blOutfit || blAbilities.length > 0) {
        descParts.push(
          [
            '【繁开】',
            blName && `名称：${blName}`,
            blPower && `强度：${blPower}`,
            blForm && `形态：${blForm}`,
            blOutfit && `装束：${blOutfit}`,
            blAbilities.length > 0 ? `能力：${blAbilities.join('、')}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        );
      }
    }

    const personality = safeString(analysis?.['personalityAnalysis']) || fromMeta('personality');

    return {
      ...initialFields,
      name: fromMeta('name') || codename,
      description: fromMeta('description') || descParts.filter(Boolean).join('\n\n'),
      personality,
      scenario: fromMeta('scenario'),
      firstMes: fromMetaFirstMes || recommended.firstMes || '',
      mesExample: fromMetaMesExample || recommended.mesExample || '',
      tags: recommendedTags,
      creatorNotes,
    };
  }

  if (template === 'canshou') {
    const name = safeString(card['name']) || '未命名残兽';
    const descParts: string[] = [];
    const appearance = safeString(card['appearance']);
    const skin = safeString(card['materialAndSkin']);
    const appendages = safeString(card['featuresAndAppendages']);
    const evolution = safeString(card['evolutionStage']);
    const attack = safeString(card['attackMethod']);
    const ability = safeString(card['specialAbility']);
    if (appearance) descParts.push(`【外观】\n${appearance}`);
    if (skin) descParts.push(`【材质与皮肤】\n${skin}`);
    if (appendages) descParts.push(`【特征与附肢】\n${appendages}`);
    if (evolution) descParts.push(`【进化阶段】\n${evolution}`);
    if (attack) descParts.push(`【攻击方式】\n${attack}`);
    if (ability) descParts.push(`【特殊能力】\n${ability}`);

    const personality = safeString(card['coreEmotion']) || fromMeta('personality');

    return {
      ...initialFields,
      name: fromMeta('name') || name,
      description: fromMeta('description') || descParts.filter(Boolean).join('\n\n'),
      personality,
      scenario: fromMeta('scenario'),
      firstMes: fromMetaFirstMes,
      mesExample: fromMetaMesExample,
      tags: recommendedTags,
      creatorNotes,
    };
  }

  const name = safeString(card['name']) || safeString(card['codename']) || fromMeta('name') || '未命名角色';
  const content = safeString(card['content']) || safeString(card['description']) || '';
  return {
    ...initialFields,
    name,
    description: fromMeta('description') || content,
    personality: fromMeta('personality'),
    scenario: fromMeta('scenario'),
    firstMes: fromMetaFirstMes,
    mesExample: fromMetaMesExample,
    tags: recommendedTags,
    creatorNotes,
  };
};

const createId = (prefix: string): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    // ignore
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export function TavernExportPanel() {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, initialState);
  const { isAuthenticated } = useAuth();
  const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);
  const [showCharacterModal, setShowCharacterModal] = useState(false);
  const [showScenarioModal, setShowScenarioModal] = useState(false);
  const [isMatching, setIsMatching] = useState<'character' | 'scenario' | null>(null);

  const onDataCardSelected = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text) as unknown;
      const template = inferTemplate(json);
      const fields = buildDefaultFieldsFromDataCard(template, json);
      dispatch({ type: 'setDataCard', data: json, template, fields });
    } catch (error) {
      dispatch({ type: 'setError', message: error instanceof Error ? error.message : '解析数据卡失败' });
    }
  };

  const onCloudCardPicked = (payload: any) => {
    try {
      const template = inferTemplate(payload);
      const fields = buildDefaultFieldsFromDataCard(template, payload);
      dispatch({ type: 'setDataCard', data: payload, template, fields });
      setShowCharacterModal(false);
    } catch (error) {
      dispatch({ type: 'setInlineError', message: error instanceof Error ? `解析档案馆数据卡失败：${error.message}` : '解析档案馆数据卡失败' });
    }
  };

  const onToggleScenarioPicked = (payload: any, nextSelected: boolean) => {
    try {
      const sourceId = typeof payload?._cardId === 'string' ? payload._cardId : '';
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

      const fragment = buildTavernScenarioFragment(payload, { maxChars: 24_000 });
      if (!fragment) throw new Error('该数据卡无法识别为情景卡（支持：通用情景/情景问卷）');

      const cardName = typeof payload?._cardName === 'string' ? payload._cardName : fragment.title;

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
    if (isMatching !== null) return;
    setIsMatching('character');
    dispatch({ type: 'setInlineError', message: null });

    try {
      const response = await fetch('/api/random-public-card?type=character');
      const result = await response.json().catch(() => null as any);
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || '无法获取随机数据');
      }

      const card = result.card;
      const json = typeof card?.data === 'string' ? JSON.parse(card.data) : card?.data;
      const payload = {
        ...(json && typeof json === 'object' ? json : {}),
        _cardId: card.id,
        _cardName: card.name,
        _cardDescription: card.description || '',
        _isPublic: card.is_public,
        _updatedAt: card.updated_at,
        _createdAt: card.created_at,
        _author: card.username || '未知',
        _likeCount: typeof card.like_count === 'number' ? card.like_count : undefined,
        _favoriteCount: typeof card.favorite_count === 'number' ? card.favorite_count : undefined,
        _usageCount: typeof card.usage_count === 'number' ? card.usage_count : undefined,
      };

      onCloudCardPicked(payload);
    } catch (error) {
      dispatch({ type: 'setInlineError', message: error instanceof Error ? `随机匹配失败：${error.message}` : '随机匹配失败' });
    } finally {
      setIsMatching(null);
    }
  };

  const onRandomMatchScenario = async () => {
    if (isMatching !== null) return;
    setIsMatching('scenario');
    dispatch({ type: 'setInlineError', message: null });

    try {
      const response = await fetch('/api/random-public-card?type=scenario');
      const result = await response.json().catch(() => null as any);
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || '无法获取随机数据');
      }

      const card = result.card;
      const json = typeof card?.data === 'string' ? JSON.parse(card.data) : card?.data;
      const payload = {
        ...(json && typeof json === 'object' ? json : {}),
        _cardId: card.id,
        _cardName: card.name,
        _cardDescription: card.description || '',
        _isPublic: card.is_public,
        _updatedAt: card.updated_at,
        _createdAt: card.created_at,
        _author: card.username || '未知',
        _likeCount: typeof card.like_count === 'number' ? card.like_count : undefined,
        _favoriteCount: typeof card.favorite_count === 'number' ? card.favorite_count : undefined,
        _usageCount: typeof card.usage_count === 'number' ? card.usage_count : undefined,
      };

      onToggleScenarioPicked(payload, true);
    } catch (error) {
      dispatch({ type: 'setInlineError', message: error instanceof Error ? `随机匹配失败：${error.message}` : '随机匹配失败' });
    } finally {
      setIsMatching(null);
    }
  };

  const onBasePngSelected = async (file: File | null) => {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      dispatch({ type: 'setBasePng', bytes, name: file.name || 'base.png' });
    } catch (error) {
      dispatch({ type: 'setError', message: error instanceof Error ? error.message : '读取底图失败' });
    }
  };

  const tagsArray = useMemo(() => {
    return state.fields.tags
      .split(/[,\n]/g)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 50);
  }, [state.fields.tags]);

  const onAiFill = async () => {
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

      const customProviderPayload = buildCustomProviderPayload(userProviderConfig);
      const requestBody: Record<string, unknown> = {
        name: (state.fields.name || '').trim() || '未命名角色',
        description: truncate(state.fields.description || '', 8_000),
        personality: truncate(state.fields.personality || '', 8_000),
        scenario: truncate(state.fields.scenario || '', 6_000),
        tags: tagsArray,
        language: 'zh-CN',
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

      const response = await fetch('/api/tavern/ai-fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => null as any);
        const redirectReason = errorJson?.reason || errorJson?.message || errorJson?.error;
        if (errorJson?.shouldRedirect || errorJson?.redirect === '/arrested') {
          void router.push({
            pathname: '/arrested',
            query: { reason: redirectReason || '使用危险符文' },
          });
          return;
        }
        const serverMessage = errorJson?.message || errorJson?.error;
        throw new Error(serverMessage ? `${serverMessage}（HTTP ${response.status}）` : `AI 补全失败（HTTP ${response.status}）`);
      }

      const json = (await response.json()) as any;
      const nextScenario = typeof json?.scenario === 'string' ? json.scenario : '';
      const nextFirstMes = typeof json?.first_mes === 'string' ? json.first_mes : '';
      const nextMesExample = typeof json?.mes_example === 'string' ? json.mes_example : '';

      const shouldOverwrite = state.aiOverwriteFields;
      if (shouldOverwrite || !state.fields.scenario.trim()) {
        dispatch({ type: 'setField', key: 'scenario', value: nextScenario });
      }
      if (shouldOverwrite || !state.fields.firstMes.trim()) {
        dispatch({ type: 'setField', key: 'firstMes', value: nextFirstMes });
      }
      if (shouldOverwrite || !state.fields.mesExample.trim()) {
        dispatch({ type: 'setField', key: 'mesExample', value: nextMesExample });
      }
    } catch (error) {
      dispatch({ type: 'setInlineError', message: error instanceof Error ? error.message : 'AI 补全失败' });
    } finally {
      dispatch({ type: 'setAiFilling', value: false });
    }
  };

  const onGenerate = async () => {
    dispatch({ type: 'generating' });
    try {
      const baseBytes = state.basePngBytes ?? getPlaceholderPngBytes();

      const baseScenario = state.fields.scenario.trim();
      const scenarioParts: string[] = [];
      if (baseScenario) {
        scenarioParts.push(baseScenario);
      } else if (state.autoArenaScenario) {
        scenarioParts.push(buildArenaDefaultScenario());
      }
      if (state.includeScenarioInScenario && state.scenarios.length > 0) {
        for (const fragment of state.scenarios) {
          scenarioParts.push(fragment.content);
        }
      }
      const finalScenario = scenarioParts.filter(Boolean).join('\n\n---\n\n').trim();

      const shouldWriteBook = state.includeArenaWorldbook || (state.includeScenarioInWorldbook && state.scenarios.length > 0);
      const characterBook = shouldWriteBook
        ? buildArenaWorldbook({
            includeCore: state.includeArenaWorldbook,
            scenarioFragments: state.includeScenarioInWorldbook ? state.scenarios : [],
          })
        : undefined;

      const card = createTavernV3Card({
        name: state.fields.name.trim() || '未命名角色',
        description: state.fields.description,
        personality: state.fields.personality,
        scenario: finalScenario,
        first_mes: state.fields.firstMes,
        mes_example: state.fields.mesExample,
        creator_notes: state.fields.creatorNotes,
        system_prompt: state.fields.systemPrompt,
        post_history_instructions: state.fields.postHistoryInstructions,
        tags: tagsArray,
        extensions: { talkativeness: Number(state.fields.talkativeness) || 0.5, fav: Boolean(state.fields.fav) },
        character_book: characterBook,
      });

      const outBytes = writeTavernCardToPngBytes(baseBytes, card, {
        overwriteExisting: state.overwriteExisting,
        includeCcv3Chunk: state.includeCcv3,
        includeCharaChunk: state.includeChara,
      });

      const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        return copy.buffer;
      };
      const blob = new Blob([toArrayBuffer(outBytes)], { type: 'image/png' });
      downloadBlob(blob, buildSafeFileName(state.fields.name || 'tavern-card', 'png', 'tavern-card'));
      dispatch({ type: 'done' });
    } catch (error) {
      dispatch({ type: 'setInlineError', message: error instanceof Error ? error.message : '导出失败' });
      dispatch({ type: 'setAiFilling', value: false });
    }
  };

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
          onChange={(event) => onDataCardSelected(event.target.files?.[0] ?? null)}
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

          <div className="mt-4 rounded-xl border border-pink-200 bg-white/70 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-pink-700">AI 补全文本字段（可选）</div>
                <div className="mt-1 text-xs text-gray-600">
                  会把 name/description/personality/scenario/tags 等内容发送到生成接口，返回建议的 scenario/first_mes/mes_example。
                </div>
              </div>

              <TavernAiFillButton loading={state.aiFilling} disabled={state.step === 'generating' || state.aiFilling} onClick={onAiFill} />
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
              </div>
            </details>
          </div>

          <div className="input-group mt-4">
            <label className="input-label" htmlFor="tavern-export-base">
              选择底图 PNG（可选）
            </label>
            <input
              id="tavern-export-base"
              type="file"
              accept="image/png"
              className="cursor-pointer input-field file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-pink-50 file:text-pink-700 hover:file:bg-pink-100 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={state.step === 'generating'}
              onChange={(event) => onBasePngSelected(event.target.files?.[0] ?? null)}
            />
            <div className="mt-2 flex items-center gap-2 text-xs text-gray-600">
              <button
                type="button"
                className="rounded-lg border border-pink-200 bg-white/70 px-3 py-1 text-pink-700 hover:bg-pink-50"
                onClick={() => dispatch({ type: 'usePlaceholder' })}
                disabled={state.step === 'generating'}
              >
                使用占位图
              </button>
              {state.basePngName ? <span>当前底图：{state.basePngName}</span> : <span>未选择底图时将自动使用占位图。</span>}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-pink-200 bg-white/70 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-start gap-2 rounded-xl border border-pink-100 bg-white/70 p-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={state.overwriteExisting}
                  onChange={(e) => dispatch({ type: 'setOption', key: 'overwriteExisting', value: e.target.checked })}
                  disabled={state.step === 'generating'}
                />
                <div className="min-w-0">
                  <div className="text-sm text-gray-900">覆盖已有酒馆块（推荐）</div>
                  <div className="mt-1 text-xs text-gray-600">避免重复块导致导入结果不确定。</div>
                </div>
              </label>

              <div className="grid gap-2">
                <label className="flex items-center gap-2 rounded-xl border border-pink-100 bg-white/70 p-3">
                  <input
                    type="checkbox"
                    checked={state.includeCcv3}
                    onChange={(e) => dispatch({ type: 'setOption', key: 'includeCcv3', value: e.target.checked })}
                    disabled={state.step === 'generating'}
                  />
                  <span className="text-sm text-gray-900">写入 ccv3</span>
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-pink-100 bg-white/70 p-3">
                  <input
                    type="checkbox"
                    checked={state.includeChara}
                    onChange={(e) => dispatch({ type: 'setOption', key: 'includeChara', value: e.target.checked })}
                    disabled={state.step === 'generating'}
                  />
                  <span className="text-sm text-gray-900">写入 chara（旧版兼容）</span>
                </label>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-pink-200 bg-white/70 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-pink-700">name</label>
                <input
                  className="mt-2 w-full rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                  value={state.fields.name}
                  onChange={(e) => dispatch({ type: 'setField', key: 'name', value: e.target.value })}
                  disabled={state.step === 'generating'}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-pink-700">tags（逗号或换行分隔）</label>
                <input
                  className="mt-2 w-full rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                  value={state.fields.tags}
                  onChange={(e) => dispatch({ type: 'setField', key: 'tags', value: e.target.value })}
                  disabled={state.step === 'generating'}
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-semibold text-pink-700">description</label>
              <textarea
                className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                value={state.fields.description}
                onChange={(e) => dispatch({ type: 'setField', key: 'description', value: e.target.value })}
                disabled={state.step === 'generating'}
                rows={6}
              />
            </div>

            <div className="mt-4">
              <label className="block text-sm font-semibold text-pink-700">personality</label>
              <textarea
                className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                value={state.fields.personality}
                onChange={(e) => dispatch({ type: 'setField', key: 'personality', value: e.target.value })}
                disabled={state.step === 'generating'}
                rows={4}
              />
            </div>

          <div className="mt-4">
            <label className="block text-sm font-semibold text-pink-700">scenario</label>
            <textarea
              className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
              value={state.fields.scenario}
              onChange={(e) => dispatch({ type: 'setField', key: 'scenario', value: e.target.value })}
              disabled={state.step === 'generating'}
              rows={3}
            />

            <div className="mt-3 rounded-xl border border-pink-100 bg-white/60 p-3">
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
                      if (files.length === 0) return;
                      const errors: string[] = [];
                      for (const file of files) {
                        try {
                          const text = await file.text();
                          const json = JSON.parse(text) as unknown;
                          const fragment = buildTavernScenarioFragment(json, { maxChars: 24_000 });
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
                      if (errors.length > 0) {
                        dispatch({
                          type: 'setInlineError',
                          message: `${errors.length}/${files.length} 个情景导入失败：${errors.join('；')}`,
                        });
                      }
                      event.target.value = '';
                    }}
                  />
                </label>

                {state.scenarios.length > 0 ? (
                  <button
                    type="button"
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    onClick={() => dispatch({ type: 'clearScenarios' })}
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
            </div>
          </div>

            <div className="grid gap-4 md:grid-cols-2 mt-4">
              <div>
                <label className="block text-sm font-semibold text-pink-700">first_mes</label>
                <textarea
                  className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                  value={state.fields.firstMes}
                  onChange={(e) => dispatch({ type: 'setField', key: 'firstMes', value: e.target.value })}
                  disabled={state.step === 'generating'}
                  rows={4}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-pink-700">mes_example</label>
                <textarea
                  className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                  value={state.fields.mesExample}
                  onChange={(e) => dispatch({ type: 'setField', key: 'mesExample', value: e.target.value })}
                  disabled={state.step === 'generating'}
                  rows={4}
                />
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-pink-700">creator_notes</label>
                <textarea
                  className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                  value={state.fields.creatorNotes}
                  onChange={(e) => dispatch({ type: 'setField', key: 'creatorNotes', value: e.target.value })}
                  disabled={state.step === 'generating'}
                  rows={3}
                />
              </div>
              <div className="grid gap-3">
                <div>
                  <label className="block text-sm font-semibold text-pink-700">talkativeness（0~1）</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    className="mt-2 w-full rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                    value={String(state.fields.talkativeness)}
                    onChange={(e) => dispatch({ type: 'setField', key: 'talkativeness', value: Number(e.target.value) })}
                    disabled={state.step === 'generating'}
                  />
                  <div className="mt-1 text-xs text-gray-600">
                    SillyTavern 常用的“话多程度”参数。参考值：0.3（更简洁）/ 0.5（中性，默认）/ 0.8（更健谈）。不确定就保持 0.5。
                  </div>
                </div>
                <label className="flex items-start gap-2 rounded-xl border border-pink-100 bg-white/70 p-3">
                  <input
                    type="checkbox"
                    checked={state.fields.fav}
                    onChange={(e) => dispatch({ type: 'setField', key: 'fav', value: e.target.checked })}
                    disabled={state.step === 'generating'}
                    className="mt-1"
                  />
                  <div className="min-w-0">
                    <div className="text-sm text-gray-900">fav（收藏标记）</div>
                    <div className="mt-1 text-xs text-gray-600">通常仅影响 SillyTavern 侧的排序/显示，不影响角色设定；默认不勾选。</div>
                  </div>
                </label>
              </div>
            </div>

            <details className="mt-4 rounded-xl border border-pink-100 bg-white/60 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-pink-700">高级字段（谨慎写入）</summary>
              <div className="mt-3">
                <label className="block text-sm font-semibold text-pink-700">system_prompt</label>
                <textarea
                  className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                  value={state.fields.systemPrompt}
                  onChange={(e) => dispatch({ type: 'setField', key: 'systemPrompt', value: e.target.value })}
                  disabled={state.step === 'generating'}
                  rows={3}
                />
              </div>
              <div className="mt-3">
                <label className="block text-sm font-semibold text-pink-700">post_history_instructions</label>
                <textarea
                  className="mt-2 w-full resize-y rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                  value={state.fields.postHistoryInstructions}
                  onChange={(e) => dispatch({ type: 'setField', key: 'postHistoryInstructions', value: e.target.value })}
                  disabled={state.step === 'generating'}
                  rows={3}
                />
              </div>
              <div className="mt-2 text-xs text-gray-600">
                注意：这些字段很容易携带隐私信息或提示注入内容。默认推荐保持为空。
              </div>
            </details>

            <button type="button" className="generate-button mt-4 mb-0" disabled={state.step === 'generating'} onClick={onGenerate}>
              生成并下载酒馆卡 PNG
            </button>

            {state.step === 'generating' ? <div className="mt-2 text-xs text-gray-700">生成中…（大字段可能需要数秒）</div> : null}
            {state.step === 'done' ? <div className="mt-2 text-xs text-green-700">已生成并开始下载。</div> : null}
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
