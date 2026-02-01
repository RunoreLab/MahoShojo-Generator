import { isAllowedExternalMediaUrl } from '@/lib/markdown/externalMedia';

export type QuestionnaireKind = 'magical-girl' | 'canshou';

export type QuestionnaireLogoPreset = {
  id: string;
  label: string;
  url: string;
  kind: QuestionnaireKind | 'common';
};

export const DEFAULT_QUESTIONNAIRE_LOGO_BY_KIND: Record<QuestionnaireKind, string> = {
  'magical-girl': '/questionnaire-logo.svg',
  'canshou': '/beast-logo.svg',
};

export const QUESTIONNAIRE_LOGO_PRESETS: QuestionnaireLogoPreset[] = [
  {
    id: 'magical-girl-default',
    label: '魔法少女预设问卷（默认）',
    url: '/questionnaire-logo.svg',
    kind: 'magical-girl',
  },
  {
    id: 'magical-girl-title',
    label: '魔法少女问卷标题',
    url: '/questionnaire-title.svg',
    kind: 'magical-girl',
  },
  {
    id: 'canshou-default',
    label: '残兽预设问卷',
    url: '/beast-logo.svg',
    kind: 'canshou',
  },
  {
    id: 'canshou-title',
    label: '残兽问卷标题',
    url: '/beast-title.svg',
    kind: 'canshou',
  },
  {
    id: 'project-logo',
    label: '项目 Logo',
    url: '/logo.svg',
    kind: 'common',
  },
  {
    id: 'project-logo-white',
    label: '项目 Logo（白色）',
    url: '/logo-white.svg',
    kind: 'common',
  },
];

export const sanitizeQuestionnaireLogoUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!isAllowedExternalMediaUrl(trimmed, 'image')) return undefined;
  return trimmed;
};

export type QuestionnaireOption = string | { value: string; label: string; disabled?: boolean };

export type QuestionnaireQuestionRef = string | {
  key?: string;
  questionId?: string;
  questionnaireId?: string;
};

export type QuestionnaireConditionOperator =
  | 'equals'
  | 'eq'
  | 'notEquals'
  | 'neq'
  | 'includes'
  | 'contains'
  | 'notIncludes'
  | 'notContains'
  | 'empty'
  | 'notEmpty';

export interface QuestionnaireCondition {
  any?: QuestionnaireCondition[];
  all?: QuestionnaireCondition[];
  not?: QuestionnaireCondition;
  key?: string;
  questionId?: string;
  questionnaireId?: string;
  operator?: QuestionnaireConditionOperator;
  value?: string | string[];
}

export interface QuestionnaireJumpRule {
  when: QuestionnaireCondition;
  to?: QuestionnaireQuestionRef;
  toEnd?: boolean;
}

export interface QuestionnaireQuestion {
  id: string;
  question: string;
  type?: 'text' | 'select';
  options?: QuestionnaireOption[];
  optionsFrom?: QuestionnaireQuestionRef;
  placeholder?: string;
  suggestions?: string[];
  suggestionsFrom?: QuestionnaireQuestionRef;
  allowCustom?: boolean;
  helperText?: string;
  maxLength?: number | null;
  required?: boolean;
  displayIf?: QuestionnaireCondition | QuestionnaireCondition[];
  jump?: QuestionnaireJumpRule | QuestionnaireJumpRule[];
}

export interface QuestionnaireDefinition {
  id: string;
  kind: QuestionnaireKind;
  title: string;
  description?: string;
  logoUrl?: string;
  version?: string;
  nativeAllowed?: boolean | null;
  questions: QuestionnaireQuestion[];
}

export interface QuestionnairePresetEntry {
  id: string;
  kind: QuestionnaireKind;
  title: string;
  description?: string;
  path: string;
  isDefault?: boolean;
}

export interface QuestionnaireAnswerItem {
  question: string;
  answer: string;
  questionId?: string;
  questionnaireId?: string;
  questionnaireTitle?: string;
}

export interface MagicalQuestionMeta {
  id: string;
  placeholder?: string;
  suggestions?: string[];
  options?: Array<{ value: string; label: string; disabled?: boolean }>;
  allowCustom?: boolean;
  helperText?: string;
  maxLength?: number;
}

// 预设选项与提示，参考预设角色回答
const MAGICAL_META_CATALOG: MagicalQuestionMeta[] = [
  {
    id: 'MG-1',
    placeholder: '请填写角色的名字',
    suggestions: ['白思与', '二阶堂祥子', '雪莉', '咕咕嘎嘎！', '真名只不过是表面之物罢了，不足挂齿'],
    maxLength: 180
  },
  {
    id: 'MG-2',
    suggestions: [
      '违背嘱托冲上去救她',
      '呼叫支援掩护撤退',
      '想办法调虎离山',
      '冲过去救她，命令可以事后解释',
      '用尽一切手段去救她，即使因此受罚',
      '我会尊重她的意志，直到最后一刻',
      '把我的护身符塞给她后并肩突进'
    ],
    helperText: '描述你在危急时刻的本能反应',
    maxLength: 260
  },
  {
    id: 'MG-3',
    suggestions: [
      '握住她的手告诉她已经足够好了',
      '主动请缨承担失误的后果',
      '提议暂停任务总结经验',
      '告诉她这是团队的战斗，错误由我们一起承担',
      '先治愈她，再约定下一次一起赢回来',
      '比起沉湎于复杂的懊悔，用简单的行动来弥补，才是正道',
      '把失败的乐章拆开，与她一起重新编曲',
      '让她先把恐惧唱出来，再陪她修补破口'
    ],
    helperText: '聚焦你与搭档的关系',
    maxLength: 260
  },
  {
    id: 'MG-4',
    options: [
      { value: '毫不犹豫地答应', label: '毫不犹豫地答应' },
      { value: '会慎重衡量', label: '会慎重衡量风险与代价' },
      { value: '坚持寻找替代方案', label: '坚持寻找替代方案' },
      { value: '先护住她们撤离', label: '先护住她们撤离，再想办法逆转局势' },
      { value: '先打开退路再决战', label: '先架设撤离通道，再由我断后' }
    ],
    allowCustom: true,
    helperText: '你愿意牺牲到什么程度？',
    maxLength: 220
  },
  {
    id: 'MG-5',
    options: [
      { value: '守护重要之人', label: '守护重要之人' },
      { value: '修复破碎的城市', label: '修复破碎的城市' },
      { value: '治愈自己或他人的伤痛', label: '治愈自己或他人的伤痛' },
      { value: '带回失落的光芒', label: '把光带回被黑暗笼罩的城市' },
      { value: '点亮迷航灯塔', label: '为迷失的人点亮回家的灯塔' },
      { value: '缝合破碎故事', label: '缝合被战争撕裂的故事' }
    ],
    allowCustom: true,
    placeholder: '第一次想完成的事情…',
    maxLength: 220
  },
  {
    id: 'MG-6',
    options: [
      { value: '防御与支援型魔法', label: '防御与支援型魔法' },
      { value: '瞬间爆发的攻击魔法', label: '瞬间爆发的攻击魔法' },
      { value: '改变局势的策略魔法', label: '改变局势的策略魔法' },
      { value: '协调多系魔法共鸣', label: '让不同系别的魔法同频共鸣' }
    ],
    allowCustom: true,
    placeholder: '描述你期望的能力',
    suggestions: ['治愈一切伤痕的力量', '让时间倒流，挽回失去的人', '把诗句写进现实的力量', '召回迷失灵魂的灯火'],
    maxLength: 220
  },
  {
    id: 'MG-7',
    suggestions: ['灯火', '羽翼', '晨星', '流星', '余烬', '潮汐', '港灯', '星港', '棋盘', '潮声'],
    maxLength: 200
  },
  {
    id: 'MG-8',
    options: [
      { value: '挫败敌人', label: '挫败敌人' },
      { value: '保护队友', label: '保护队友' },
      { value: '依据情况权衡', label: '依据情况权衡' },
      { value: '先护队友再反击', label: '先保护队友，再寻找反击机会' },
      { value: '布局诱敌', label: '先布置陷阱诱敌入局，再一举反扑' }
    ],
    allowCustom: true,
    maxLength: 200
  },
  {
    id: 'MG-9',
    options: [
      { value: '命运可以被改变', label: '命运可以被改变' },
      { value: '命运注定但可迂回', label: '命运注定但可迂回' },
      { value: '顺应命运寻求意义', label: '顺应命运寻求意义' },
      { value: '命运注定但意义可改写', label: '命运或许注定，但结果的意义由自己决定' },
      { value: '命运如棋可再布局', label: '命运如棋，可在关键时刻重新布局' }
    ],
    allowCustom: true,
    maxLength: 200
  },
  {
    id: 'MG-10',
    options: [
      { value: '选择拯救多数人', label: '选择拯救多数人' },
      { value: '绝不牺牲无辜', label: '绝不牺牲无辜' },
      { value: '尝试寻找第三条路', label: '尝试寻找第三条路' },
      { value: '成为那个“少数”', label: '如果必须牺牲，就由我成为那个“少数”' },
      { value: '承担抉择代价', label: '由我承担抉择的代价，让她们都活下来' }
    ],
    allowCustom: true,
    maxLength: 200
  },
  {
    id: 'MG-11',
    options: [
      { value: '必要之恶可以被接受', label: '必要之恶可以被接受' },
      { value: '必要之恶会腐蚀初心', label: '必要之恶会腐蚀初心' },
      { value: '只有在明确边界时才允许', label: '只有在明确边界时才允许' },
      { value: '以契约划界', label: '只有在全员签署明确约定时才允许必要之恶' }
    ],
    allowCustom: true,
    helperText: '谈谈你对“代价”与“底线”的理解',
    maxLength: 220
  },
  {
    id: 'MG-12',
    options: [
      { value: '直接指出并提出改进', label: '直接指出并提出改进' },
      { value: '先搜集证据再报告', label: '先搜集证据再报告' },
      { value: '尊重但寻求其他队友协助', label: '尊重但寻求其他队友协助' },
      { value: '独自承担风险', label: '选择独自承担，避免牵连他人' },
      { value: '公开透明沟通', label: '在行动简报会上公开讨论并记录' }
    ],
    allowCustom: true,
    maxLength: 200
  },
  {
    id: 'MG-13',
    options: [
      { value: '更喜欢独自行动', label: '更喜欢独自行动' },
      { value: '依赖团队合作', label: '依赖团队合作' },
      { value: '根据任务灵活切换', label: '根据任务灵活切换' },
      { value: '取决于队友是谁', label: '取决于队友是谁' },
      { value: '先侦查再召集', label: '习惯先单独侦查，再召集伙伴合力完成' }
    ],
    allowCustom: true,
    maxLength: 200
  },
  {
    id: 'MG-14',
    options: [
      { value: '计划为先', label: '计划为先' },
      { value: '凭直觉行动', label: '凭直觉行动' },
      { value: '先计划再顺势调整', label: '先计划再顺势调整' },
      { value: '计划与直觉并重', label: '先制定蓝图，再视战况灵活调整' }
    ],
    allowCustom: true,
    maxLength: 200
  },
  {
    id: 'MG-15',
    suggestions: ['夏夜烟花下的约定', '第一次见到魔法少女的瞬间', '与家人重逢的拥抱', '被前辈救起的瞬间', '雨中的葬礼与粉色樱花的凋零', '我……没有经历过……', '星港上的誓约', '第一次在雨夜点亮灯海', '在指挥席上听见全队呼吸整齐的瞬间', '陌生人留给我的潮汐提灯', '咕咕嘎嘎！'],
    maxLength: 280
  },
  {
    id: 'MG-16',
    suggestions: ['曾经撤退导致同伴受伤', '因为犹豫而错失机会', '没有勇敢说出的告白', '没能阻止亲人遭遇不幸', '如果当时我更强就好了', '我曾经因为顾虑一份复杂的人情，而没有及时出手，导致同伴受到了本可以避免的伤害。现在我不会再犹豫。', '没能守住承诺的港口', '为了遵守命令而错过救援朋友', '当年没有握住前辈递来的指挥棒', '咕咕嘎嘎！'],
    helperText: '描述你想弥补的遗憾',
    maxLength: 280
  }
];

export const buildMagicalQuestionMeta = (length: number): MagicalQuestionMeta[] => {
  if (length <= 0) return [];
  return Array.from({ length }).map((_, index) => {
    const catalogMeta = MAGICAL_META_CATALOG[index];
    return {
      id: catalogMeta?.id ?? `MG-${index + 1}`,
      placeholder: catalogMeta?.placeholder,
      suggestions: catalogMeta?.suggestions ?? [],
      options: catalogMeta?.options,
      allowCustom: catalogMeta?.allowCustom !== undefined ? catalogMeta.allowCustom : true,
      helperText: catalogMeta?.helperText,
      maxLength: catalogMeta?.maxLength ?? 200
    };
  });
};

export const buildQuestionKey = (questionnaireId: string | undefined, questionId: string | undefined, index: number) => {
  const base = (questionId ?? '').trim() || `Q${index + 1}`;
  const prefix = (questionnaireId ?? '').trim();
  return prefix ? `${prefix}::${base}` : base;
};

type QuestionFlowItem = {
  key: string;
  questionnaireId: string;
  question: QuestionnaireQuestion;
};

type QuestionLookup = {
  keyByCompositeId: Map<string, string>;
  keysByQuestionId: Map<string, string[]>;
  indexByKey: Map<string, number>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJumpRule = (value: unknown): value is QuestionnaireJumpRule =>
  isRecord(value) && 'when' in value;

const buildQuestionLookup = <T extends QuestionFlowItem>(items: T[]): QuestionLookup => {
  const keyByCompositeId = new Map<string, string>();
  const keysByQuestionId = new Map<string, string[]>();
  const indexByKey = new Map<string, number>();

  items.forEach((item, index) => {
    indexByKey.set(item.key, index);
    const questionId = item.question.id?.trim();
    if (!questionId) return;
    const composite = `${item.questionnaireId}::${questionId}`;
    if (!keyByCompositeId.has(composite)) {
      keyByCompositeId.set(composite, item.key);
    }
    const existing = keysByQuestionId.get(questionId) ?? [];
    existing.push(item.key);
    keysByQuestionId.set(questionId, existing);
  });

  return { keyByCompositeId, keysByQuestionId, indexByKey };
};

const resolveKeyFromRef = (ref: QuestionnaireQuestionRef | undefined, lookup: QuestionLookup): string | null => {
  if (!ref) return null;

  if (typeof ref === 'string') {
    if (lookup.indexByKey.has(ref)) return ref;
    if (lookup.keyByCompositeId.has(ref)) return lookup.keyByCompositeId.get(ref) ?? null;
    const keys = lookup.keysByQuestionId.get(ref);
    if (keys && keys.length === 1) return keys[0];
    return null;
  }

  if (ref.key && lookup.indexByKey.has(ref.key)) {
    return ref.key;
  }

  if (ref.questionnaireId && ref.questionId) {
    const composite = `${ref.questionnaireId}::${ref.questionId}`;
    if (lookup.keyByCompositeId.has(composite)) return lookup.keyByCompositeId.get(composite) ?? null;
  }

  if (ref.questionId) {
    const keys = lookup.keysByQuestionId.get(ref.questionId);
    if (keys && keys.length === 1) return keys[0];
  }

  return null;
};

const normalizeConditionValue = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (value === null || value === undefined) return [];
  return [String(value)];
};

const evaluateCondition = (
  raw: QuestionnaireCondition | QuestionnaireCondition[] | undefined,
  answersByKey: Record<string, string>,
  lookup: QuestionLookup,
  fallbackResult: boolean
): boolean => {
  if (!raw) return true;
  const condition = Array.isArray(raw) ? { all: raw } : raw;
  if (!condition || typeof condition !== 'object') return fallbackResult;

  if (condition.not) {
    return !evaluateCondition(condition.not, answersByKey, lookup, fallbackResult);
  }

  if (Array.isArray(condition.all) && condition.all.length > 0) {
    return condition.all.every((item) => evaluateCondition(item, answersByKey, lookup, fallbackResult));
  }

  if (Array.isArray(condition.any) && condition.any.length > 0) {
    return condition.any.some((item) => evaluateCondition(item, answersByKey, lookup, fallbackResult));
  }

  const key = resolveKeyFromRef(condition, lookup);
  if (!key) return fallbackResult;
  const answer = String(answersByKey[key] ?? '');
  const values = normalizeConditionValue(condition.value);
  const operator = condition.operator ?? (values.length > 0 ? 'equals' : 'notEmpty');

  switch (operator) {
    case 'empty':
      return answer.trim().length === 0;
    case 'notEmpty':
      return answer.trim().length > 0;
    case 'includes':
    case 'contains':
      return values.length === 0
        ? answer.trim().length > 0
        : values.some((value) => answer.includes(value));
    case 'notIncludes':
    case 'notContains':
      return values.length === 0
        ? answer.trim().length === 0
        : values.every((value) => !answer.includes(value));
    case 'notEquals':
    case 'neq':
      return values.length === 0
        ? answer.trim().length === 0
        : values.every((value) => answer !== value);
    case 'equals':
    case 'eq':
    default:
      return values.length === 0
        ? answer.trim().length > 0
        : values.some((value) => answer === value);
  }
};

const normalizeJumpRules = (raw: QuestionnaireJumpRule | QuestionnaireJumpRule[] | undefined): QuestionnaireJumpRule[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === 'object');
  return [raw];
};

const resolveJumpTargetKey = (
  raw: QuestionnaireJumpRule | QuestionnaireJumpRule[] | undefined,
  answersByKey: Record<string, string>,
  lookup: QuestionLookup
): string | 'END' | null => {
  const rules = normalizeJumpRules(raw);
  for (const rule of rules) {
    if (!rule || !rule.when) continue;
    const matched = evaluateCondition(rule.when, answersByKey, lookup, false);
    if (!matched) continue;
    if (rule.toEnd) return 'END';
    const targetKey = resolveKeyFromRef(rule.to, lookup);
    if (targetKey) return targetKey;
  }
  return null;
};

export const resolveQuestionnaireReferences = <T extends QuestionFlowItem>(items: T[]): T[] => {
  if (items.length === 0) return items;
  const lookup = buildQuestionLookup(items);
  return items.map((item) => {
    const sourceRef = item.question.optionsFrom;
    const suggestionsRef = item.question.suggestionsFrom;
    const nextOptionsKey = resolveKeyFromRef(sourceRef, lookup);
    const nextSuggestionsKey = resolveKeyFromRef(suggestionsRef, lookup);
    if (!nextOptionsKey && !nextSuggestionsKey) return item;

    const sourceOptions = nextOptionsKey ? items[lookup.indexByKey.get(nextOptionsKey) ?? -1]?.question.options : undefined;
    const sourceSuggestions = nextSuggestionsKey ? items[lookup.indexByKey.get(nextSuggestionsKey) ?? -1]?.question.suggestions : undefined;
    const hasOptions = Array.isArray(item.question.options) && item.question.options.length > 0;
    const hasSuggestions = Array.isArray(item.question.suggestions) && item.question.suggestions.length > 0;
    const nextQuestion: QuestionnaireQuestion = {
      ...item.question,
      options: hasOptions ? item.question.options : sourceOptions ?? item.question.options,
      suggestions: hasSuggestions ? item.question.suggestions : sourceSuggestions ?? item.question.suggestions,
    };
    if (nextQuestion === item.question) return item;
    return { ...item, question: nextQuestion };
  });
};

export const buildQuestionnaireFlow = <T extends QuestionFlowItem>(
  items: T[],
  answersByKey: Record<string, string>
): { flow: T[]; visibleKeys: Set<string>; indexByKey: Map<string, number> } => {
  if (items.length === 0) {
    return { flow: [], visibleKeys: new Set(), indexByKey: new Map() };
  }

  const lookup = buildQuestionLookup(items);

  const computeFlow = (activeAnswers: Record<string, string>) => {
    const visibleFlags = items.map((item) => evaluateCondition(item.question.displayIf, activeAnswers, lookup, true));
    const findNextVisibleIndex = (startIndex: number) => {
      for (let i = startIndex + 1; i < items.length; i += 1) {
        if (visibleFlags[i]) return i;
      }
      return null;
    };
    const findVisibleFromIndex = (startIndex: number) => {
      for (let i = startIndex; i < items.length; i += 1) {
        if (visibleFlags[i]) return i;
      }
      return null;
    };

    const firstIndex = findVisibleFromIndex(0);
    if (firstIndex === null) {
      const fallbackKeys = new Set(items.map((item) => item.key));
      const indexByKey = new Map(items.map((item, index) => [item.key, index]));
      return { flow: items, visibleKeys: fallbackKeys, indexByKey };
    }

    const visited = new Set<number>();
    const flow: T[] = [];
    let index: number | null = firstIndex;
    let guard = 0;

    while (index !== null && index >= 0 && index < items.length && guard < items.length + 5) {
      guard += 1;
      if (visited.has(index)) break;
      visited.add(index);
      const item = items[index];
      if (visibleFlags[index]) {
        flow.push(item);
      }

      const jumpTargetKey = resolveJumpTargetKey(item.question.jump, activeAnswers, lookup);
      if (jumpTargetKey === 'END') break;

      let nextIndex: number | null = null;
      if (jumpTargetKey) {
        const targetIndex = lookup.indexByKey.get(jumpTargetKey);
        if (typeof targetIndex === 'number' && targetIndex > index) {
          nextIndex = findVisibleFromIndex(targetIndex);
        }
      }

      if (nextIndex === null) {
        nextIndex = findNextVisibleIndex(index);
      }

      if (nextIndex === null) break;
      index = nextIndex;
    }

    const visibleKeys = new Set(flow.map((item) => item.key));
    const indexByKey = new Map(flow.map((item, idx) => [item.key, idx]));
    return { flow, visibleKeys, indexByKey };
  };

  let activeAnswers = answersByKey;
  let result = computeFlow(activeAnswers);
  for (let i = 0; i < 3; i += 1) {
    const hiddenKeys = Object.keys(activeAnswers).filter((key) => !result.visibleKeys.has(key));
    if (hiddenKeys.length === 0) break;
    const nextAnswers: Record<string, string> = {};
    Object.entries(activeAnswers).forEach(([key, value]) => {
      if (result.visibleKeys.has(key)) nextAnswers[key] = value;
    });
    activeAnswers = nextAnswers;
    result = computeFlow(activeAnswers);
  }

  return result;
};

export const normalizeQuestionnaireDefinition = (
  raw: unknown,
  options: {
    fallbackId?: string;
    fallbackKind?: QuestionnaireKind;
    fallbackTitle?: string;
    applyMagicalMeta?: boolean;
    nativeAllowed?: boolean | null;
  } = {}
): QuestionnaireDefinition | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const rawQuestions = record.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) return null;

  const resolvedKind = (record.kind as QuestionnaireKind) || options.fallbackKind;
  if (resolvedKind !== 'magical-girl' && resolvedKind !== 'canshou') return null;

  const resolvedId = typeof record.id === 'string' && record.id.trim()
    ? record.id.trim()
    : (options.fallbackId?.trim() || `${resolvedKind}-custom`);
  const resolvedTitle = typeof record.title === 'string' && record.title.trim()
    ? record.title.trim()
    : (options.fallbackTitle?.trim() || '未命名问卷');

  const baseQuestions: QuestionnaireQuestion[] = rawQuestions.map((item, index) => {
    if (typeof item === 'string') {
      return {
        id: `${resolvedKind === 'magical-girl' ? 'MG' : 'Q'}-${index + 1}`,
        question: item,
        required: true,
      };
    }
    if (!item || typeof item !== 'object') {
      return {
        id: `${resolvedKind === 'magical-girl' ? 'MG' : 'Q'}-${index + 1}`,
        question: `问题 ${index + 1}`,
        required: true,
      };
    }
    const q = item as Record<string, unknown>;
    const id = typeof q.id === 'string' && q.id.trim() ? q.id.trim() : `${resolvedKind === 'magical-girl' ? 'MG' : 'Q'}-${index + 1}`;
    const question = typeof q.question === 'string' && q.question.trim() ? q.question.trim() : `问题 ${index + 1}`;
    const required = typeof q.required === 'boolean' ? q.required : true;
    const maxLength = typeof q.maxLength === 'number' && Number.isFinite(q.maxLength)
      ? Math.max(0, Math.floor(q.maxLength))
      : q.maxLength === null
        ? null
        : undefined;

    const optionsFrom = typeof q.optionsFrom === 'string'
      ? q.optionsFrom
      : (isRecord(q.optionsFrom) ? {
        key: typeof q.optionsFrom.key === 'string' ? q.optionsFrom.key : undefined,
        questionId: typeof q.optionsFrom.questionId === 'string' ? q.optionsFrom.questionId : undefined,
        questionnaireId: typeof q.optionsFrom.questionnaireId === 'string' ? q.optionsFrom.questionnaireId : undefined,
      } : undefined);
    const suggestionsFrom = typeof q.suggestionsFrom === 'string'
      ? q.suggestionsFrom
      : (isRecord(q.suggestionsFrom) ? {
        key: typeof q.suggestionsFrom.key === 'string' ? q.suggestionsFrom.key : undefined,
        questionId: typeof q.suggestionsFrom.questionId === 'string' ? q.suggestionsFrom.questionId : undefined,
        questionnaireId: typeof q.suggestionsFrom.questionnaireId === 'string' ? q.suggestionsFrom.questionnaireId : undefined,
      } : undefined);
    const displayIf = Array.isArray(q.displayIf)
      ? (q.displayIf.filter((entry) => isRecord(entry)) as QuestionnaireCondition[])
      : (isRecord(q.displayIf) ? (q.displayIf as QuestionnaireCondition) : undefined);
    const jump = Array.isArray(q.jump)
      ? q.jump.filter((entry) => isJumpRule(entry))
      : (isJumpRule(q.jump) ? q.jump : undefined);

    return {
      id,
      question,
      type: typeof q.type === 'string' ? (q.type as 'text' | 'select') : undefined,
      options: Array.isArray(q.options) ? (q.options as QuestionnaireOption[]) : undefined,
      optionsFrom: optionsFrom as QuestionnaireQuestionRef | undefined,
      placeholder: typeof q.placeholder === 'string' ? q.placeholder : undefined,
      suggestions: Array.isArray(q.suggestions) ? (q.suggestions as string[]) : undefined,
      suggestionsFrom: suggestionsFrom as QuestionnaireQuestionRef | undefined,
      allowCustom: typeof q.allowCustom === 'boolean' ? q.allowCustom : undefined,
      helperText: typeof q.helperText === 'string' ? q.helperText : undefined,
      maxLength: maxLength === undefined ? undefined : maxLength,
      required,
      displayIf,
      jump,
    };
  });

  const questions = options.applyMagicalMeta
    ? applyMagicalMeta(baseQuestions)
    : baseQuestions.map((question) => ({
      ...question,
      maxLength: question.maxLength === undefined ? null : question.maxLength,
    }));

  return {
    id: resolvedId,
    kind: resolvedKind,
    title: resolvedTitle,
    description: typeof record.description === 'string' ? record.description.trim() : undefined,
    logoUrl: sanitizeQuestionnaireLogoUrl(record.logoUrl),
    version: typeof record.version === 'string' ? record.version.trim() : undefined,
    nativeAllowed: typeof record.nativeAllowed === 'boolean' ? record.nativeAllowed : options.nativeAllowed ?? null,
    questions,
  };
};

const applyMagicalMeta = (questions: QuestionnaireQuestion[]): QuestionnaireQuestion[] => {
  const metaList = buildMagicalQuestionMeta(questions.length);
  return questions.map((question, index) => {
    const meta = metaList[index];
    return {
      ...question,
      id: question.id || meta?.id || `MG-${index + 1}`,
      placeholder: question.placeholder ?? meta?.placeholder,
      suggestions: question.suggestions ?? meta?.suggestions,
      options: question.options ?? meta?.options,
      allowCustom: question.allowCustom ?? meta?.allowCustom,
      helperText: question.helperText ?? meta?.helperText,
      maxLength: question.maxLength ?? meta?.maxLength ?? 200,
      required: question.required ?? true,
    };
  });
};

export const normalizeUserAnswers = (userAnswers: unknown, fallbackQuestions: string[] = []): QuestionnaireAnswerItem[] => {
  if (!userAnswers) return [];

  if (Array.isArray(userAnswers)) {
    const normalizedArray = userAnswers.map((item, index) => {
      if (typeof item === 'string') {
        const question = fallbackQuestions[index] || `问题 ${index + 1}`;
        return { question, answer: item };
      }
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const answer = typeof record.answer === 'string' ? record.answer : '';
        const question = typeof record.question === 'string'
          ? record.question
          : fallbackQuestions[index] || `问题 ${index + 1}`;
        return {
          question,
          answer,
          questionId: typeof record.questionId === 'string' ? record.questionId : undefined,
          questionnaireId: typeof record.questionnaireId === 'string' ? record.questionnaireId : undefined,
          questionnaireTitle: typeof record.questionnaireTitle === 'string' ? record.questionnaireTitle : undefined,
        };
      }
      const question = fallbackQuestions[index] || `问题 ${index + 1}`;
      return { question, answer: '' };
    });
    return normalizedArray.filter((item) => item.answer.trim().length > 0);
  }

  if (typeof userAnswers === 'object') {
    const entries = Object.entries(userAnswers as Record<string, unknown>);
    return entries
      .map(([key, value]) => {
        if (value && typeof value === 'object') {
          const record = value as Record<string, unknown>;
          const answer = typeof record.answer === 'string' ? record.answer : '';
          const question = typeof record.question === 'string' ? record.question : key;
          return {
            question,
            answer,
            questionId: typeof record.questionId === 'string' ? record.questionId : undefined,
            questionnaireId: typeof record.questionnaireId === 'string' ? record.questionnaireId : undefined,
            questionnaireTitle: typeof record.questionnaireTitle === 'string' ? record.questionnaireTitle : undefined,
          };
        }
        const answerText = typeof value === 'string' ? value : JSON.stringify(value);
        return { question: key, answer: answerText };
      })
      .filter((item) => item.answer.trim().length > 0);
  }

  return [];
};

export const formatQuestionnaireAnswers = (answers: QuestionnaireAnswerItem[]): string => {
  if (!answers.length) return '';
  const grouped = new Map<string, QuestionnaireAnswerItem[]>();
  for (const item of answers) {
    const groupKey = item.questionnaireTitle?.trim() || '';
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey)!.push(item);
  }

  const blocks: string[] = [];
  for (const [groupTitle, items] of grouped.entries()) {
    if (groupTitle) {
      blocks.push(`【${groupTitle}】`);
    }
    items.forEach((item, index) => {
      const qLabel = item.question?.trim() ? item.question.trim() : `问题 ${index + 1}`;
      blocks.push(`Q: ${qLabel}`);
      blocks.push(`A: ${item.answer}`);
    });
  }
  return blocks.join('\n');
};
