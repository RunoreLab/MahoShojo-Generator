import {
  GENERAL_CHARACTER_TEMPLATE_ID,
  GENERAL_SCENARIO_TEMPLATE_ID,
  inferCharacterKind,
} from './data-cards';

export type SublimationCharacterTemplate = 'magical-girl' | 'canshou' | 'general';
export type SublimationSourceTemplate =
  | SublimationCharacterTemplate
  | 'scenario'
  | 'general-scenario'
  | 'unknown';

export const SUBLIMATION_TEMPLATE_LABELS: Record<SublimationCharacterTemplate, string> = {
  'magical-girl': '魔法少女',
  canshou: '残兽',
  general: '通用角色',
};

const MAGICAL_GIRL_TEMPLATE_ID = '魔法少女/心之花/魔法少女（问卷生成）';
const CANSHOU_TEMPLATE_ID = '魔法少女/心之花/残兽（问卷生成）';
const NON_SUBSTANTIVE_KEYS = new Set(['signature', 'templateId']);
const CREATOR_META_KEYS = ['creationInputs', 'buildState'] as const;

type FieldType = 'string' | 'boolean' | 'array' | 'arrayOfString' | 'object' | 'unknown';
type FieldMeta = { type: FieldType; children?: Record<string, FieldMeta> };
type UnmatchedField = { path: string; value: unknown };

export type SublimationCharacterConversionResult = {
  data: Record<string, unknown>;
  warnings: string[];
};

const MAGICAL_GIRL_META: Record<string, FieldMeta> = {
  codename: { type: 'string' },
  appearance: {
    type: 'object',
    children: {
      outfit: { type: 'string' },
      accessories: { type: 'string' },
      colorScheme: { type: 'string' },
      overallLook: { type: 'string' },
    },
  },
  magicConstruct: {
    type: 'object',
    children: {
      name: { type: 'string' },
      form: { type: 'string' },
      basicAbilities: { type: 'arrayOfString' },
      description: { type: 'string' },
    },
  },
  wonderlandRule: {
    type: 'object',
    children: {
      name: { type: 'string' },
      description: { type: 'string' },
      tendency: { type: 'string' },
      activation: { type: 'string' },
    },
  },
  blooming: {
    type: 'object',
    children: {
      name: { type: 'string' },
      evolvedAbilities: { type: 'arrayOfString' },
      evolvedForm: { type: 'string' },
      evolvedOutfit: { type: 'string' },
      powerLevel: { type: 'string' },
    },
  },
  analysis: {
    type: 'object',
    children: {
      personalityAnalysis: { type: 'string' },
      abilityReasoning: { type: 'string' },
      coreTraits: { type: 'arrayOfString' },
      predictionBasis: { type: 'string' },
      background: {
        type: 'object',
        children: { belief: { type: 'string' }, bonds: { type: 'string' } },
      },
    },
  },
  userAnswers: { type: 'unknown' },
  isPreset: { type: 'boolean' },
  arena_history: { type: 'unknown' },
  adjudicationEvents: { type: 'unknown' },
  current_state: { type: 'unknown' },
};

const CANSHOU_META: Record<string, FieldMeta> = {
  name: { type: 'string' },
  appearance: { type: 'string' },
  materialAndSkin: { type: 'string' },
  featuresAndAppendages: { type: 'string' },
  coreConcept: { type: 'string' },
  coreEmotion: { type: 'string' },
  evolutionStage: { type: 'string' },
  attackMethod: { type: 'string' },
  specialAbility: { type: 'string' },
  origin: { type: 'string' },
  birthEnvironment: { type: 'string' },
  researcherNotes: { type: 'string' },
  userAnswers: { type: 'unknown' },
  isPreset: { type: 'boolean' },
  arena_history: { type: 'unknown' },
  adjudicationEvents: { type: 'unknown' },
  current_state: { type: 'unknown' },
};

const DEFAULT_MAGICAL_GIRL: Record<string, unknown> = {
  codename: '未命名魔法少女',
  appearance: { outfit: '', accessories: '', colorScheme: '', overallLook: '' },
  magicConstruct: { name: '', form: '', basicAbilities: [], description: '' },
  wonderlandRule: { name: '', description: '', tendency: '', activation: '' },
  blooming: { name: '', evolvedAbilities: [], evolvedForm: '', evolvedOutfit: '', powerLevel: '' },
  analysis: {
    personalityAnalysis: '',
    abilityReasoning: '',
    coreTraits: [],
    predictionBasis: '',
    background: { belief: '', bonds: '' },
  },
  userAnswers: [],
  adjudicationEvents: [],
  templateId: MAGICAL_GIRL_TEMPLATE_ID,
};

const DEFAULT_CANSHOU: Record<string, unknown> = {
  name: '未命名残兽',
  appearance: '',
  materialAndSkin: '',
  featuresAndAppendages: '',
  coreConcept: '',
  coreEmotion: '',
  evolutionStage: '',
  attackMethod: '',
  specialAbility: '',
  origin: '',
  birthEnvironment: '',
  researcherNotes: '',
  templateId: CANSHOU_TEMPLATE_ID,
};

const DEFAULT_GENERAL: Record<string, unknown> = {
  templateId: GENERAL_CHARACTER_TEMPLATE_ID,
  name: '未命名角色',
  content: '请在此处补充角色设定，建议使用 Markdown 书写。',
};

const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
);

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const sanitizeForConversion = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizeForConversion);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => (
    NON_SUBSTANTIVE_KEYS.has(key) ? [] : [[key, sanitizeForConversion(child)]]
  )));
};

const assignWithMeta = (
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  meta: Record<string, FieldMeta>,
  prefix = '',
): UnmatchedField[] => {
  const unmatched: UnmatchedField[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null || key === 'templateId') continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const definition = meta[key];
    if (!definition) {
      unmatched.push({ path, value });
      continue;
    }
    if (definition.type === 'string') {
      if (typeof value === 'string') target[key] = value;
      else unmatched.push({ path, value });
    } else if (definition.type === 'boolean') {
      if (typeof value === 'boolean') target[key] = value;
      else unmatched.push({ path, value });
    } else if (definition.type === 'array') {
      if (Array.isArray(value)) target[key] = value;
      else unmatched.push({ path, value });
    } else if (definition.type === 'arrayOfString') {
      if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        target[key] = value;
      } else unmatched.push({ path, value });
    } else if (definition.type === 'object') {
      if (!isObject(value)) {
        unmatched.push({ path, value });
        continue;
      }
      const existing = isObject(target[key]) ? target[key] : {};
      target[key] = existing;
      unmatched.push(...assignWithMeta(value, existing, definition.children ?? {}, path));
    } else {
      target[key] = value;
    }
  }
  return unmatched;
};

const valueToMarkdown = (value: unknown, level = 1): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      const nested = valueToMarkdown(item, level + 1);
      return nested ? `- ${nested.replace(/\n/gu, '\n  ')}` : '';
    }).filter(Boolean).join('\n');
  }
  if (isObject(value)) {
    return Object.entries(value).map(([key, child]) => {
      const body = valueToMarkdown(child, level + 1);
      return `${'#'.repeat(level)} ${key}${body ? `\n${body}` : ''}`;
    }).filter(Boolean).join('\n\n');
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatUnmatchedFields = (items: UnmatchedField[], ignored: string[] = []): string => {
  const ignoreSet = new Set(ignored);
  return items.flatMap(({ path, value }) => {
    const [top] = path.split('.');
    if (top && ignoreSet.has(top)) return [];
    let serialized: string;
    try {
      serialized = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    } catch {
      serialized = String(value);
    }
    return [`- ${path}: ${serialized}`];
  }).join('\n');
};

const copyKnownMetadata = (
  source: Record<string, unknown>,
  target: Record<string, unknown>,
): void => {
  for (const key of CREATOR_META_KEYS) {
    if (source[key] !== undefined) target[key] = cloneJson(source[key]);
  }
};

export const inferSublimationSourceTemplate = (value: unknown): SublimationSourceTemplate => {
  if (
    isObject(value)
    && value.templateId === GENERAL_SCENARIO_TEMPLATE_ID
  ) return 'general-scenario';
  const characterKind = inferCharacterKind(value);
  if (characterKind !== 'unknown') return characterKind;
  if (isObject(value) && typeof value.title === 'string') return 'scenario';
  return 'unknown';
};

export const createBlankSublimationCharacterCard = (
  target: SublimationCharacterTemplate,
): Record<string, unknown> => cloneJson(
  target === 'magical-girl'
    ? DEFAULT_MAGICAL_GIRL
    : target === 'canshou'
      ? DEFAULT_CANSHOU
      : DEFAULT_GENERAL,
);

const convertToGeneral = (source: Record<string, unknown>): SublimationCharacterConversionResult => {
  const { codename, name, title } = source;
  const rest = { ...source };
  for (const key of [
    'codename', 'name', 'title', 'templateId', 'creationInputs', 'buildState', '_battle_story',
  ]) {
    delete rest[key];
  }
  const result: Record<string, unknown> = {
    templateId: GENERAL_CHARACTER_TEMPLATE_ID,
    name: codename || name || title || '未命名角色',
    content: valueToMarkdown(rest).trim() || '暂无附加设定。',
  };
  for (const key of ['arena_history', 'adjudicationEvents', 'current_state'] as const) {
    if (source[key]) result[key] = cloneJson(source[key]);
  }
  copyKnownMetadata(source, result);
  return { data: result, warnings: [] };
};

const convertToMagicalGirl = (
  source: Record<string, unknown>,
  sourceTemplate: SublimationSourceTemplate,
): SublimationCharacterConversionResult => {
  const result = createBlankSublimationCharacterCard('magical-girl');
  result.codename = source.codename || source.name || source.title || result.codename;
  const input = { ...source };
  for (const key of ['codename', 'name', 'title', 'creationInputs', 'buildState', '_battle_story']) {
    delete input[key];
  }
  if (sourceTemplate === 'general' || sourceTemplate === 'general-scenario') delete input.content;
  const unmatched = assignWithMeta(input, result, MAGICAL_GIRL_META);
  const appendix = formatUnmatchedFields(unmatched, [
    'arena_history', 'adjudicationEvents', 'current_state',
  ]);
  if (appendix) {
    const analysis = isObject(result.analysis) ? result.analysis : {};
    analysis.predictionBasis = `${String(analysis.predictionBasis ?? '').trim()}\n${appendix}`.trim();
    result.analysis = analysis;
  }
  for (const key of ['arena_history', 'adjudicationEvents', 'current_state'] as const) {
    if (source[key]) result[key] = cloneJson(source[key]);
  }
  copyKnownMetadata(source, result);
  result.templateId = MAGICAL_GIRL_TEMPLATE_ID;
  return {
    data: result,
    warnings: unmatched.length ? ['部分字段已追加至预测依据。'] : [],
  };
};

const convertToCanshou = (
  source: Record<string, unknown>,
  sourceTemplate: SublimationSourceTemplate,
): SublimationCharacterConversionResult => {
  const result = createBlankSublimationCharacterCard('canshou');
  result.name = source.name || source.codename || source.title || result.name;
  const input = { ...source };
  for (const key of ['codename', 'name', 'title', 'creationInputs', 'buildState', '_battle_story']) {
    delete input[key];
  }
  if (sourceTemplate === 'general' || sourceTemplate === 'general-scenario') delete input.content;
  const unmatched = assignWithMeta(input, result, CANSHOU_META);
  const appendix = formatUnmatchedFields(unmatched, [
    'arena_history', 'adjudicationEvents', 'current_state',
  ]);
  if (appendix) {
    result.researcherNotes = `${String(result.researcherNotes ?? '').trim()}\n${appendix}`.trim();
  }
  for (const key of ['arena_history', 'adjudicationEvents', 'current_state'] as const) {
    if (source[key]) result[key] = cloneJson(source[key]);
  }
  copyKnownMetadata(source, result);
  result.templateId = CANSHOU_TEMPLATE_ID;
  return {
    data: result,
    warnings: unmatched.length ? ['部分字段已附加到研究员注记。'] : [],
  };
};

export const convertSublimationCharacterCard = (
  value: unknown,
  target: SublimationCharacterTemplate,
  sourceTemplate: SublimationSourceTemplate = inferSublimationSourceTemplate(value),
): SublimationCharacterConversionResult => {
  if (!isObject(value)) throw new Error('无法转换：数据格式无效。');
  const sanitized = sanitizeForConversion(value);
  if (!isObject(sanitized)) throw new Error('无法转换：数据格式无效。');
  if (target === 'general') return convertToGeneral(sanitized);
  if (target === 'magical-girl') return convertToMagicalGirl(sanitized, sourceTemplate);
  return convertToCanshou(sanitized, sourceTemplate);
};

export type ArenaHistoryRetentionStrategy = 'keep-all' | 'keep-sublimation-only' | 'reset-all';
export const DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY: ArenaHistoryRetentionStrategy =
  'keep-sublimation-only';
export const ARENA_HISTORY_RETENTION_LABELS: Record<ArenaHistoryRetentionStrategy, string> = {
  'keep-all': '保留全部历史',
  'keep-sublimation-only': '只保留升华记录',
  'reset-all': '清空全部历史',
};
export const ARENA_HISTORY_RETENTION_DESCRIPTIONS: Record<ArenaHistoryRetentionStrategy, string> = {
  'keep-all': '保留全部既有历战，并追加本次升华记录',
  'keep-sublimation-only': '仅保留历次升华记录，并追加本次升华记录',
  'reset-all': '清空既有历战，仅保留本次升华记录，并重置世界线',
};

export const normalizeArenaHistoryRetentionStrategy = (
  value: unknown,
): ArenaHistoryRetentionStrategy => (
  value === 'keep-all' || value === 'keep-sublimation-only' || value === 'reset-all'
    ? value
    : DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY
);

export const buildSublimationHistoryEntry = (input: {
  title: string;
  impact: string;
  participantsName: string | null;
  finalUserGuidance: string | null;
  hasQuestionnaireLore: boolean;
  questionnaireSelectionCount: number;
  nonNativeDataInvolved: boolean;
}) => ({
  type: 'sublimation',
  title: input.title,
  participants: input.participantsName ? [input.participantsName] : [],
  winner: input.participantsName ?? '未知角色',
  impact: input.impact,
  metadata: {
    user_guidance: input.finalUserGuidance,
    scenario_title: null,
    non_native_data_involved: input.nonNativeDataInvolved,
    questionnaire_lore_used: input.hasQuestionnaireLore,
    questionnaire_selection_count: input.questionnaireSelectionCount,
  },
});

const canonicalizeEntryIds = (
  entries: Array<Record<string, unknown>>,
): { entries: Array<Record<string, unknown>>; maxId: number } => {
  const canonical: Array<Record<string, unknown>> = [];
  const used = new Set<number>();
  let currentMax = 0;
  for (const entry of entries) {
    const copy = { ...entry };
    const numeric = typeof copy.id === 'number' ? copy.id : Number(copy.id);
    if (Number.isFinite(numeric) && Number.isInteger(numeric) && numeric >= 1 && !used.has(numeric)) {
      copy.id = numeric;
      currentMax = Math.max(currentMax, numeric);
      used.add(numeric);
    } else {
      currentMax += 1;
      while (used.has(currentMax)) currentMax += 1;
      copy.id = currentMax;
      used.add(currentMax);
    }
    canonical.push(copy);
  }
  return { entries: canonical, maxId: currentMax };
};

export const applySublimationArenaHistoryStrategy = (input: {
  sourceArenaHistory: unknown;
  strategy: unknown;
  newEntry: unknown;
  nowISO: string;
  createWorldLineId?: () => string;
}) => {
  const history = isObject(input.sourceArenaHistory) ? input.sourceArenaHistory : {};
  const attributes = isObject(history.attributes) ? history.attributes : {};
  const sourceEntries = Array.isArray(history.entries)
    ? history.entries.filter(isObject)
    : [];
  const strategy = normalizeArenaHistoryRetentionStrategy(input.strategy);
  const retained = strategy === 'keep-all'
    ? cloneJson(sourceEntries)
    : strategy === 'keep-sublimation-only'
      ? cloneJson(sourceEntries.filter((entry) => entry.type === 'sublimation'))
      : [];
  const canonical = canonicalizeEntryIds(retained);
  const newEntry = isObject(input.newEntry) ? cloneJson(input.newEntry) : {};
  const createWorldLineId = input.createWorldLineId
    ?? (() => globalThis.crypto.randomUUID());
  const nextAttributes = strategy === 'reset-all'
    ? {
      world_line_id: createWorldLineId(),
      created_at: input.nowISO,
      updated_at: input.nowISO,
      sublimation_count: 1,
      last_sublimation_at: input.nowISO,
    }
    : {
      world_line_id: typeof attributes.world_line_id === 'string' && attributes.world_line_id
        ? attributes.world_line_id
        : createWorldLineId(),
      created_at: typeof attributes.created_at === 'string' && attributes.created_at
        ? attributes.created_at
        : input.nowISO,
      updated_at: input.nowISO,
      sublimation_count: typeof attributes.sublimation_count === 'number'
        ? attributes.sublimation_count + 1
        : Number(attributes.sublimation_count ?? 0) + 1 || 1,
      last_sublimation_at: input.nowISO,
    };
  return {
    attributes: nextAttributes,
    entries: [...canonical.entries, { ...newEntry, id: canonical.maxId + 1 }],
  };
};

export type BuildFinalSublimationDataInput = {
  originalCharacterData: Record<string, unknown>;
  baseOutputData: Record<string, unknown>;
  updatedDataFromAI: Record<string, unknown> | null | undefined;
  targetTemplate: SublimationCharacterTemplate;
  allowReshapeNames: boolean;
  writeArenaHistory: boolean;
  writeCurrentState: boolean;
  arenaHistoryRetentionStrategy: unknown;
  sublimationEvent: { title: string; impact: string };
  finalUserGuidance: string | null;
  hasNarrativeHistory: boolean;
  hasQuestionnaireLore: boolean;
  hasNonNativeQuestionnaireLore: boolean;
  questionnaireSelectionCount: number;
  isNative: boolean;
  nowISO?: string;
  createWorldLineId?: () => string;
};

const safeDeepMerge = (
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> => {
  const output = { ...target };
  for (const [key, value] of Object.entries(source)) {
    output[key] = isObject(value) && isObject(target[key])
      ? safeDeepMerge(target[key], value)
      : value;
  }
  return output;
};

export const buildFinalSublimationData = (
  input: BuildFinalSublimationDataInput,
): Record<string, unknown> => {
  const nowISO = input.nowISO ?? new Date().toISOString();
  const result = safeDeepMerge(cloneJson(input.baseOutputData ?? {}), input.updatedDataFromAI ?? {});
  result.templateId = input.targetTemplate === 'magical-girl'
    ? MAGICAL_GIRL_TEMPLATE_ID
    : input.targetTemplate === 'canshou'
      ? CANSHOU_TEMPLATE_ID
      : GENERAL_CHARACTER_TEMPLATE_ID;

  if (input.targetTemplate === 'magical-girl' && !input.allowReshapeNames) {
    for (const key of ['magicConstruct', 'wonderlandRule', 'blooming'] as const) {
      const base = input.baseOutputData[key];
      const generated = result[key];
      if (isObject(base) && base.name && isObject(generated)) generated.name = base.name;
    }
  }

  if (input.writeArenaHistory) {
    const participant = input.targetTemplate === 'magical-girl' ? result.codename : result.name;
    result.arena_history = applySublimationArenaHistoryStrategy({
      sourceArenaHistory: input.originalCharacterData.arena_history,
      strategy: input.arenaHistoryRetentionStrategy,
      newEntry: buildSublimationHistoryEntry({
        title: input.sublimationEvent.title,
        impact: input.sublimationEvent.impact,
        participantsName: typeof participant === 'string' ? participant : null,
        finalUserGuidance: input.finalUserGuidance,
        hasQuestionnaireLore: input.hasQuestionnaireLore,
        questionnaireSelectionCount: input.questionnaireSelectionCount,
        nonNativeDataInvolved: !input.isNative
          || Boolean(input.finalUserGuidance)
          || input.hasNarrativeHistory
          || input.hasNonNativeQuestionnaireLore,
      }),
      nowISO,
      createWorldLineId: input.createWorldLineId,
    });
  } else if (input.originalCharacterData.arena_history != null) {
    result.arena_history = cloneJson(input.originalCharacterData.arena_history);
  } else {
    delete result.arena_history;
  }

  if (input.writeCurrentState) {
    if (result.current_state) {
      const state = isObject(result.current_state) ? result.current_state : {};
      const originalState = isObject(input.originalCharacterData.current_state)
        ? input.originalCharacterData.current_state
        : {};
      state.fields = Array.isArray(originalState.fields)
        ? cloneJson(originalState.fields)
        : Array.isArray(state.fields)
          ? cloneJson(state.fields)
          : [];
      state['updated_at'] = nowISO;
      result.current_state = state;
    }
  } else if (input.originalCharacterData.current_state != null) {
    result.current_state = cloneJson(input.originalCharacterData.current_state);
  } else {
    delete result.current_state;
  }
  return result;
};
