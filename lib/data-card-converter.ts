import {
  CanshouSchema,
  GeneralCharacterSchema,
  GeneralScenarioSchema,
  MagicalGirlSchema,
  ScenarioSchema,
  type CanshouData,
  type GeneralCharacterData,
  type GeneralScenarioData,
  type MagicalGirlData,
  type ScenarioData,
  GENERAL_CHARACTER_TEMPLATE_ID,
  GENERAL_SCENARIO_TEMPLATE_ID,
  inferCharacterKind,
  isGeneralScenario,
  isScenarioCard
} from './schemas';
import type { CurrentStateData } from './schemas/current-state';

const NON_SUBSTANTIVE_KEYS = new Set(['signature', 'templateId']);

export type DataCardTemplate = 'magical-girl' | 'canshou' | 'general' | 'scenario' | 'general-scenario';
export type InferableTemplate = DataCardTemplate | 'unknown';

export const TEMPLATE_LABELS: Record<DataCardTemplate, string> = {
  'magical-girl': '魔法少女',
  canshou: '残兽',
  general: '通用角色',
  scenario: '情景',
  'general-scenario': '通用情景'
};

type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'arrayOfString'
  | 'recordString'
  | 'object'
  | 'unknown';

interface FieldMeta {
  type: FieldType;
  children?: Record<string, FieldMeta>;
}

interface AssignResult<T> {
  data: T;
  warnings: string[];
}

interface UnmatchedField {
  path: string;
  value: unknown;
}

const createDefaultCurrentState = (): CurrentStateData => ({
  summary: '当前状态尚未记录，可在战报或编辑器中更新。',
  fields: [],
});

const MAGICAL_GIRL_META: Record<string, FieldMeta> = {
  codename: { type: 'string' },
  appearance: {
    type: 'object',
    children: {
      outfit: { type: 'string' },
      accessories: { type: 'string' },
      colorScheme: { type: 'string' },
      overallLook: { type: 'string' }
    }
  },
  magicConstruct: {
    type: 'object',
    children: {
      name: { type: 'string' },
      form: { type: 'string' },
      basicAbilities: { type: 'arrayOfString' },
      description: { type: 'string' }
    }
  },
  wonderlandRule: {
    type: 'object',
    children: {
      name: { type: 'string' },
      description: { type: 'string' },
      tendency: { type: 'string' },
      activation: { type: 'string' }
    }
  },
  blooming: {
    type: 'object',
    children: {
      name: { type: 'string' },
      evolvedAbilities: { type: 'arrayOfString' },
      evolvedForm: { type: 'string' },
      evolvedOutfit: { type: 'string' },
      powerLevel: { type: 'string' }
    }
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
        children: {
          belief: { type: 'string' },
          bonds: { type: 'string' }
        }
      }
    }
  },
  userAnswers: { type: 'unknown' },
  signature: { type: 'string' },
  templateId: { type: 'string' },
  isPreset: { type: 'boolean' },
  arena_history: { type: 'unknown' },
  adjudicationEvents: { type: 'unknown' },
  current_state: { type: 'unknown' }
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
  templateId: { type: 'string' },
  userAnswers: { type: 'unknown' },
  isPreset: { type: 'boolean' },
  signature: { type: 'string' },
  adjudicationEvents: { type: 'unknown' },
  arena_history: { type: 'unknown' },
  current_state: { type: 'unknown' }
};

const SCENARIO_META: Record<string, FieldMeta> = {
  title: { type: 'string' },
  scenario_type: { type: 'string' },
  description: { type: 'string' },
  adjudicationEvents: { type: 'array' },
  elements: {
    type: 'object',
    children: {
      scene: {
        type: 'object',
        children: {
          time: { type: 'string' },
          place: { type: 'string' },
          features: { type: 'string' }
        }
      },
      roles: { type: 'array' },
      events: { type: 'string' },
      atmosphere: { type: 'string' },
      development: { type: 'array' }
    }
  },
  metadata: {
    type: 'object',
    children: {
      created_at: { type: 'string' },
      signature: { type: 'string' }
    }
  }
};

const DEFAULT_MAGICAL_GIRL: MagicalGirlData = {
  codename: '未命名魔法少女',
  appearance: {
    outfit: '',
    accessories: '',
    colorScheme: '',
    overallLook: ''
  },
  magicConstruct: {
    name: '',
    form: '',
    basicAbilities: [],
    description: ''
  },
  wonderlandRule: {
    name: '',
    description: '',
    tendency: '',
    activation: ''
  },
  blooming: {
    name: '',
    evolvedAbilities: [],
    evolvedForm: '',
    evolvedOutfit: '',
    powerLevel: ''
  },
  analysis: {
    personalityAnalysis: '',
    abilityReasoning: '',
    coreTraits: [],
    predictionBasis: '',
    background: {
      belief: '',
      bonds: ''
    }
  },
  userAnswers: [],
  current_state: createDefaultCurrentState(),
  arena_history: {
    attributes: {
      world_line_id: '',
      created_at: '',
      updated_at: '',
      sublimation_count: 0,
      last_sublimation_at: null
    },
    entries: []
  },
  adjudicationEvents: [],
  templateId: '魔法少女/心之花/魔法少女（问卷生成）'
};

const DEFAULT_CANSHOU: CanshouData = {
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
  templateId: '魔法少女/心之花/残兽（问卷生成）',
  current_state: createDefaultCurrentState()
};

const DEFAULT_SCENARIO: ScenarioData = {
  title: '未命名情景',
  description: '',
  elements: {
    scene: {
      time: '',
      place: '',
      features: ''
    },
    roles: [],
    events: '',
    atmosphere: '',
    development: []
  },
  metadata: {},
  adjudicationEvents: []
};

const DEFAULT_GENERAL_SCENARIO: GeneralScenarioData = {
  templateId: GENERAL_SCENARIO_TEMPLATE_ID,
  title: '未命名情景',
  content: '请在此处补充情景设定，建议使用 Markdown 书写。',
};

const DEFAULT_GENERAL: GeneralCharacterData = {
  templateId: GENERAL_CHARACTER_TEMPLATE_ID,
  name: '未命名角色',
  content: '请在此处补充角色设定，建议使用 Markdown 书写。',
  current_state: createDefaultCurrentState()
};

export function inferTemplate(data: unknown): InferableTemplate {
  if (isGeneralScenario(data)) return 'general-scenario';
  const kind = inferCharacterKind(data);
  if (kind !== 'unknown') return kind;
  if (isScenarioCard(data)) return 'scenario';
  return 'unknown';
}

export function createBlankDataCard(template: DataCardTemplate): MagicalGirlData | CanshouData | GeneralCharacterData | ScenarioData | GeneralScenarioData {
  switch (template) {
    case 'magical-girl':
      return JSON.parse(JSON.stringify(DEFAULT_MAGICAL_GIRL));
    case 'canshou':
      return JSON.parse(JSON.stringify(DEFAULT_CANSHOU));
    case 'scenario':
      return JSON.parse(JSON.stringify(DEFAULT_SCENARIO));
    case 'general-scenario':
      return JSON.parse(JSON.stringify(DEFAULT_GENERAL_SCENARIO));
    case 'general':
    default:
      return JSON.parse(JSON.stringify(DEFAULT_GENERAL));
  }
}

function assignWithMeta<T extends Record<string, any>>(
  source: Record<string, any>,
  target: T,
  meta: Record<string, FieldMeta>,
  prefix = ''
): UnmatchedField[] {
  const unmatched: UnmatchedField[] = [];
  const targetRecord = target as Record<string, any>;

  Object.entries(source).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    const path = prefix ? `${prefix}.${key}` : key;

    if (key === 'templateId') {
      return;
    }

    const definition = meta[key];
    if (!definition) {
      unmatched.push({ path, value });
      return;
    }

    switch (definition.type) {
      case 'string':
        if (typeof value === 'string') {
          targetRecord[key] = value;
        } else {
          unmatched.push({ path, value });
        }
        break;
      case 'number':
        if (typeof value === 'number') {
          targetRecord[key] = value;
        } else {
          unmatched.push({ path, value });
        }
        break;
      case 'boolean':
        if (typeof value === 'boolean') {
          targetRecord[key] = value;
        } else {
          unmatched.push({ path, value });
        }
        break;
      case 'array':
        if (Array.isArray(value)) {
          targetRecord[key] = value;
        } else {
          unmatched.push({ path, value });
        }
        break;
      case 'arrayOfString':
        if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
          targetRecord[key] = value;
        } else {
          unmatched.push({ path, value });
        }
        break;
      case 'recordString':
        if (isPlainObject(value) && Object.values(value).every(item => typeof item === 'string')) {
          targetRecord[key] = value;
        } else {
          unmatched.push({ path, value });
        }
        break;
      case 'object':
        if (isPlainObject(value)) {
          const existing = (isPlainObject(targetRecord[key]) ? targetRecord[key] : {}) as Record<string, any>;
          targetRecord[key] = existing;
          const nestedUnmatched = assignWithMeta(value, existing, definition.children ?? {}, path);
          unmatched.push(...nestedUnmatched);
        } else {
          unmatched.push({ path, value });
        }
        break;
      case 'unknown':
      default:
        targetRecord[key] = value;
    }
  });

  return unmatched;
}

function valueToMarkdown(value: unknown, level = 1): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const lines = value
      .map(item => {
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          return `- ${item}`;
        }
        const nested = valueToMarkdown(item, level + 1);
        return nested ? `- ${nested.replace(/\n/g, `\n${' '.repeat(2)}`)}` : '';
      })
      .filter(Boolean);
    return lines.join('\n');
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .map(([key, val]) => {
        const heading = `${'#'.repeat(level)} ${key}`;
        const body = valueToMarkdown(val, level + 1);
        return body ? `${heading}\n${body}` : heading;
      })
      .filter(Boolean);
    return entries.join('\n\n');
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toMarkdownContent(rest: Record<string, unknown>): string {
  const markdown = valueToMarkdown(rest);
  return markdown.trim() || '暂无附加设定。';
}

function formatUnmatchedFields(unmatched: UnmatchedField[], ignoreTopLevel: string[] = []): string {
  if (unmatched.length === 0) return '';
  const ignoreSet = new Set(ignoreTopLevel);
  return unmatched
    .filter(({ path }) => {
      const [top] = path.split('.');
      return !ignoreSet.has(top);
    })
    .map(({ path, value }) => {
      let serialized: string;
      if (typeof value === 'string') serialized = value;
      else {
        try {
          serialized = JSON.stringify(value, null, 2);
        } catch {
          serialized = String(value);
        }
      }
      return `- ${path}: ${serialized}`;
    })
    .join('\n');
}

function convertToGeneral(data: any): AssignResult<GeneralCharacterData> {
  const name = data?.codename || data?.name || data?.title || '未命名角色';
  const rest = { ...data };
  delete rest.codename;
  delete rest.name;
  delete rest.title;
  delete rest.templateId;

  const content = toMarkdownContent(rest);
  const result: GeneralCharacterData = {
    templateId: GENERAL_CHARACTER_TEMPLATE_ID,
    name,
    content
  };
  if (data?.arena_history) {
    (result as any).arena_history = JSON.parse(JSON.stringify(data.arena_history));
  }
  if (data?.adjudicationEvents) {
    (result as any).adjudicationEvents = JSON.parse(JSON.stringify(data.adjudicationEvents));
  }
  if (data?.current_state) {
    (result as any).current_state = JSON.parse(JSON.stringify(data.current_state));
  }
  return { data: GeneralCharacterSchema.parse(result), warnings: [] };
}

function convertToGeneralScenario(data: any, sourceTemplate: InferableTemplate): AssignResult<GeneralScenarioData> {
  const title = data?.title || data?.name || data?.codename || '未命名情景';
  const rest = { ...data };
  delete rest.codename;
  delete rest.name;
  delete rest.title;
  delete rest.content;
  delete rest.templateId;
  delete rest.signature;
  delete rest.metadata;
  delete rest.arena_history;
  delete rest.current_state;
  delete rest.adjudicationEvents;

  const markdownBase =
    (sourceTemplate === 'general' || sourceTemplate === 'general-scenario') && typeof data?.content === 'string'
      ? data.content
      : '';

  const appendix = toMarkdownContent(rest);
  const content = markdownBase
    ? (appendix && appendix !== '暂无附加设定。' ? `${markdownBase.trim()}\n\n---\n\n${appendix}` : markdownBase.trim())
    : appendix;

  const result: GeneralScenarioData = {
    templateId: GENERAL_SCENARIO_TEMPLATE_ID,
    title,
    content,
  };

  if (data?.adjudicationEvents) {
    (result as any).adjudicationEvents = JSON.parse(JSON.stringify(data.adjudicationEvents));
  }

  return { data: GeneralScenarioSchema.parse(result), warnings: [] };
}

function convertToMagicalGirl(data: any, sourceTemplate: InferableTemplate): AssignResult<MagicalGirlData> {
  const base: MagicalGirlData = JSON.parse(JSON.stringify(DEFAULT_MAGICAL_GIRL));
  base.codename = data?.codename || data?.name || data?.title || base.codename;

  const source = { ...data };
  delete source.codename;
  delete source.name;
  delete source.title;
  if (sourceTemplate === 'general' || sourceTemplate === 'general-scenario') {
    delete source.content;
  }

  const unmatched = assignWithMeta(source, base as Record<string, any>, MAGICAL_GIRL_META);
  const appendix = formatUnmatchedFields(unmatched, ['arena_history', 'adjudicationEvents', 'current_state']);
  if (appendix) {
    if (!base.analysis) base.analysis = { predictionBasis: '' };
    base.analysis.predictionBasis = `${base.analysis?.predictionBasis?.trim() || ''}\n${appendix}`.trim();
  }

  if (data?.arena_history) {
    base.arena_history = JSON.parse(JSON.stringify(data.arena_history));
  }
  if (data?.adjudicationEvents) {
    base.adjudicationEvents = JSON.parse(JSON.stringify(data.adjudicationEvents));
  }
  if (data?.current_state) {
    (base as any).current_state = JSON.parse(JSON.stringify(data.current_state));
  }

  base.templateId = '魔法少女/心之花/魔法少女（问卷生成）';
  return { data: MagicalGirlSchema.parse(base), warnings: unmatched.length ? ['部分字段已追加至预测依据。'] : [] };
}

function convertToCanshou(data: any, sourceTemplate: InferableTemplate): AssignResult<CanshouData> {
  const base: CanshouData = JSON.parse(JSON.stringify(DEFAULT_CANSHOU));
  base.name = data?.name || data?.codename || data?.title || base.name;

  const source = { ...data };
  delete source.codename;
  delete source.name;
  delete source.title;
  if (sourceTemplate === 'general' || sourceTemplate === 'general-scenario') {
    delete source.content;
  }

  const unmatched = assignWithMeta(source, base as Record<string, any>, CANSHOU_META);
  const appendix = formatUnmatchedFields(unmatched, ['arena_history', 'adjudicationEvents', 'current_state']);
  if (appendix) {
    base.researcherNotes = `${base.researcherNotes?.trim() || ''}\n${appendix}`.trim();
  }

  if (data?.arena_history) {
    base.arena_history = JSON.parse(JSON.stringify(data.arena_history));
  }
  if (data?.adjudicationEvents) {
    base.adjudicationEvents = JSON.parse(JSON.stringify(data.adjudicationEvents));
  }
  if (data?.current_state) {
    (base as any).current_state = JSON.parse(JSON.stringify(data.current_state));
  }

  base.templateId = '魔法少女/心之花/残兽（问卷生成）';
  return { data: CanshouSchema.parse(base), warnings: unmatched.length ? ['部分字段已附加到研究员注记。'] : [] };
}

function convertToScenario(data: any, sourceTemplate: InferableTemplate): AssignResult<ScenarioData> {
  const base: ScenarioData = JSON.parse(JSON.stringify(DEFAULT_SCENARIO));
  base.title = data?.title || data?.codename || data?.name || base.title;

  const source = { ...data };
  delete source.codename;
  delete source.name;
  delete source.title;
  delete source.signature;
  delete source.templateId;
  delete source.arena_history;
  delete source.current_state;
  if (sourceTemplate === 'general-scenario') {
    delete source.content;
  }

  const unmatched = assignWithMeta(source, base as Record<string, any>, SCENARIO_META);

  if (sourceTemplate === 'general-scenario') {
    const markdown = typeof data?.content === 'string'
      ? data.content
      : toMarkdownContent({ ...data, templateId: undefined, name: undefined, codename: undefined, title: undefined });
    base.description = `${base.description?.trim() || ''}\n${markdown}`.trim();
  } else if (sourceTemplate === 'magical-girl' || sourceTemplate === 'canshou' || sourceTemplate === 'general') {
    const roleName = data?.codename || data?.name || base.title;
    let description = '';
    if (sourceTemplate === 'general') {
      description = typeof data?.content === 'string' ? data.content : toMarkdownContent({ ...data, templateId: undefined, name: undefined, codename: undefined, title: undefined });
    } else {
      const rest = { ...data };
      delete rest.codename;
      delete rest.name;
      delete rest.templateId;
      description = toMarkdownContent(rest);
    }
    base.elements.roles = base.elements.roles || [];
    base.elements.roles.push({
      name: roleName,
      description
    });
  }

  const appendix = formatUnmatchedFields(unmatched);
  if (appendix) {
    base.description = `${base.description?.trim() || ''}\n${appendix}`.trim();
  }

  if (data?.adjudicationEvents) {
    base.adjudicationEvents = JSON.parse(JSON.stringify(data.adjudicationEvents));
  }

  return { data: ScenarioSchema.parse(base), warnings: unmatched.length ? ['部分字段已合并至情景描述。'] : [] };
}

export function convertDataCard(data: any, target: DataCardTemplate, sourceTemplate: InferableTemplate = inferTemplate(data)): AssignResult<any> {
  if (!data || typeof data !== 'object') {
    throw new Error('无法转换：数据格式无效。');
  }

  const sanitized = sanitizeForConversion(data);

  switch (target) {
    case 'general':
      return convertToGeneral(sanitized);
    case 'general-scenario':
      return convertToGeneralScenario(sanitized, sourceTemplate);
    case 'magical-girl':
      return convertToMagicalGirl(sanitized, sourceTemplate);
    case 'canshou':
      return convertToCanshou(sanitized, sourceTemplate);
    case 'scenario':
      return convertToScenario(sanitized, sourceTemplate);
    default:
      throw new Error('未支持的目标模板。');
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeForConversion(data: any): any {
  if (Array.isArray(data)) {
    return data.map(item => sanitizeForConversion(item));
  }
  if (!isPlainObject(data)) return data;
  const clone: Record<string, any> = {};
  Object.entries(data).forEach(([key, value]) => {
    if (NON_SUBSTANTIVE_KEYS.has(key)) {
      return;
    }
    if (Array.isArray(value)) {
      clone[key] = value.map(item => sanitizeForConversion(item));
    } else if (isPlainObject(value)) {
      clone[key] = sanitizeForConversion(value);
    } else {
      clone[key] = value;
    }
  });
  return clone;
}
