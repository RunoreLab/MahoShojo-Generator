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
