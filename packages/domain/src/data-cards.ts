export const GENERAL_CHARACTER_TEMPLATE_ID = '通用角色' as const;
export const GENERAL_SCENARIO_TEMPLATE_ID = '通用情景' as const;

export type DataCardTemplateId =
  | typeof GENERAL_CHARACTER_TEMPLATE_ID
  | typeof GENERAL_SCENARIO_TEMPLATE_ID
  | '魔法少女/心之花/魔法少女（问卷生成）'
  | '魔法少女/心之花/魔法少女（名字生成）'
  | '魔法少女/心之花/残兽（问卷生成）'
  | '魔法少女/心之花/未知'
  | (string & {});

export type CharacterKind = 'magical-girl' | 'canshou' | 'general' | 'unknown';

const MAGICAL_GIRL_TEMPLATE_IDS = new Set<string>([
  '魔法少女/心之花/魔法少女（问卷生成）',
  '魔法少女/心之花/魔法少女（名字生成）',
  '魔法少女/心之花/未知',
]);

const CANSHOU_TEMPLATE_IDS = new Set<string>(['魔法少女/心之花/残兽（问卷生成）']);

const MAGICAL_SIGNATURE_KEYS = ['magicConstruct', 'wonderlandRule', 'blooming', 'analysis'] as const;
const CANSHOU_SIGNATURE_KEYS = [
  'materialAndSkin',
  'featuresAndAppendages',
  'coreConcept',
  'coreEmotion',
  'evolutionStage',
  'attackMethod',
  'specialAbility',
  'origin',
  'birthEnvironment',
  'researcherNotes',
  'appearance',
] as const;

/**
 * 根据字段特征推断角色类型，用于补全 templateId 或容错解析。
 * 推断顺序：显式模板 > 通用角色 content 字段 > 魔法少女特征 > 残兽特征 > 名字兜底通用角色。
 */
export function inferCharacterKind(data: unknown): CharacterKind {
  if (!data || typeof data !== 'object') return 'unknown';
  const record = data as Record<string, unknown>;

  const templateId = typeof record.templateId === 'string' ? record.templateId : undefined;
  if (templateId === GENERAL_CHARACTER_TEMPLATE_ID) return 'general';
  if (templateId === GENERAL_SCENARIO_TEMPLATE_ID) return 'unknown';
  if (templateId && MAGICAL_GIRL_TEMPLATE_IDS.has(templateId)) return 'magical-girl';
  if (templateId && CANSHOU_TEMPLATE_IDS.has(templateId)) return 'canshou';

  if (typeof record.content === 'string') return 'general';

  const hasMagicalSignature =
    typeof record.codename === 'string' || MAGICAL_SIGNATURE_KEYS.some((key) => record[key] !== undefined);
  if (hasMagicalSignature) return 'magical-girl';

  const hasCanshouSignature =
    typeof record.name === 'string' &&
    !record.codename &&
    CANSHOU_SIGNATURE_KEYS.some((key) => record[key] !== undefined);
  if (hasCanshouSignature) return 'canshou';

  if (typeof record.name === 'string' && !record.codename) return 'general';

  return 'unknown';
}

/** 为缺失 templateId 的旧数据补充模板标记。 */
export function inferTemplateId(record: Record<string, unknown>): DataCardTemplateId {
  const kind = inferCharacterKind(record);
  if (kind === 'magical-girl') {
    return record.magicConstruct !== undefined
      ? '魔法少女/心之花/魔法少女（问卷生成）'
      : '魔法少女/心之花/魔法少女（名字生成）';
  }
  if (kind === 'canshou') return '魔法少女/心之花/残兽（问卷生成）';
  if (kind === 'general') return GENERAL_CHARACTER_TEMPLATE_ID;
  return '魔法少女/心之花/未知';
}

/**
 * 通用角色卡：显式 templateId + name/content 两个正文字段。
 * 与 `inferCharacterKind` 的 `content` 兜底一致，但要求显式模板标记——schema 校验口径。
 */
export function isGeneralCharacterCard(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  return record.templateId === GENERAL_CHARACTER_TEMPLATE_ID
    && typeof record.name === 'string'
    && typeof record.content === 'string';
}

/**
 * 通用情景卡：显式 `templateId === '通用情景'`，或缺 templateId 的 legacy title+content 结构。
 *
 * 注意保留一个历史副作用：显式模板卡只有 `name` 没有 `title` 时，原地改写为
 * `title`（`name` 字段删除）——Web 角色管理依赖这个「读即升级」语义，调用方看到的是同一引用。
 */
export function isGeneralScenarioCard(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;

  const hasExplicitTemplate = record.templateId === GENERAL_SCENARIO_TEMPLATE_ID;
  const isTemplateLessLegacyGeneralScenario =
    typeof record.templateId === 'undefined' &&
    typeof record.title === 'string' &&
    typeof record.content === 'string' &&
    typeof record.name !== 'string';

  // 兼容不规范通用情景卡：部分卡缺少 templateId，但仍使用 title + content 结构。
  if (!hasExplicitTemplate && !isTemplateLessLegacyGeneralScenario) return false;
  if (typeof record.content !== 'string') return false;

  if (typeof record.title === 'string') return true;

  // 兼容旧版通用情景卡：name -> title（原地升级，便于后续逻辑统一读取 title）
  if (hasExplicitTemplate && typeof record.name === 'string') {
    record.title = record.name;
    delete record.name;
    return true;
  }

  return false;
}

/** 结构化情景卡：title + elements 对象，且不属于其它显式模板。 */
export function isScenarioCard(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  if (typeof record.title !== 'string') return false;
  if (record.templateId === GENERAL_CHARACTER_TEMPLATE_ID) return false;
  if (record.templateId === GENERAL_SCENARIO_TEMPLATE_ID) return false;
  if (record.templateId === 'narrative-history') return false;
  return typeof record.elements === 'object' && record.elements !== null;
}

/** 角色管理页的可推断模板集合（与 Web `data-card-converter` 的模板维度一致）。 */
export type DataCardTemplate = 'magical-girl' | 'canshou' | 'general' | 'scenario' | 'general-scenario';
export type InferableDataCardTemplate = DataCardTemplate | 'unknown';

export const DATA_CARD_TEMPLATE_LABELS: Record<DataCardTemplate, string> = {
  'magical-girl': '魔法少女',
  canshou: '残兽',
  general: '通用角色',
  scenario: '情景',
  'general-scenario': '通用情景'
};

export function inferDataCardTemplate(data: unknown): InferableDataCardTemplate {
  if (isGeneralScenarioCard(data)) return 'general-scenario';
  const kind = inferCharacterKind(data);
  if (kind !== 'unknown') return kind;
  if (isScenarioCard(data)) return 'scenario';
  return 'unknown';
}
