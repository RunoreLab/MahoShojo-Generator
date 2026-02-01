import { convertDataCard, inferTemplate, type DataCardTemplate, type InferableTemplate } from '@/lib/data-card-converter';
import { GENERAL_CHARACTER_TEMPLATE_ID } from '@/lib/schemas/general-character';

export type TeamMergeOutputTemplate = 'auto' | 'general' | 'magical-girl' | 'canshou';

export interface TeamMergeMemberInput {
  name: string;
  data: unknown;
}

export interface TeamMergeResult {
  template: DataCardTemplate;
  data: Record<string, unknown>;
  warnings: string[];
}

const SYSTEM_KEYS_TO_DROP = new Set(['signature', 'isPreset']);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isNonEmptyValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
};

const toInlineText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => toInlineText(item))
      .filter(Boolean)
      .join('，');
  }
  if (isPlainObject(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return '[复杂数据]';
    }
  }
  return String(value);
};

const formatScalarBlock = (roleName: string, value: unknown): string => {
  const text = toInlineText(value);
  if (!text) return '';
  return `【${roleName}】${text}`;
};

const mergeScalarBlocks = (items: Array<{ roleName: string; value: unknown }>): string => {
  const blocks = items
    .map(({ roleName, value }) => formatScalarBlock(roleName, value))
    .filter(Boolean);
  return blocks.join('\n\n');
};

const collectOrderedKeysFromMembers = (
  objects: Array<{ roleName: string; value: Record<string, unknown> }>
): string[] => {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const { value } of objects) {
    for (const key of Object.keys(value)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
};

const prefixObjectLabel = (obj: Record<string, unknown>, roleName: string): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...obj };
  const labelKeys = ['title', 'name', 'label'] as const;
  for (const key of labelKeys) {
    const current = next[key];
    if (typeof current === 'string' && current.trim()) {
      next[key] = `【${roleName}】${current.trim()}`;
      break;
    }
  }
  return next;
};

const mergeArrays = (items: Array<{ roleName: string; value: unknown[] }>): unknown[] => {
  const arrays = items.map((item) => item.value).filter((value) => Array.isArray(value) && value.length > 0);
  if (arrays.length === 0) return [];

  const allElements = arrays.flat();
  const allPlainObjects = allElements.length > 0 && allElements.every((element) => isPlainObject(element));
  if (allPlainObjects) {
    const out: unknown[] = [];
    for (const { roleName, value } of items) {
      for (const element of value) {
        if (!isPlainObject(element)) continue;
        out.push(prefixObjectLabel(element, roleName));
      }
    }
    return out;
  }

  const out: string[] = [];
  for (const { roleName, value } of items) {
    for (const element of value) {
      const text = toInlineText(element);
      if (!text) continue;
      out.push(`【${roleName}】${text}`);
    }
  }
  return out;
};

const mergeValues = (items: Array<{ roleName: string; value: unknown }>): unknown => {
  const filtered = items.filter(({ value }) => isNonEmptyValue(value));
  if (filtered.length === 0) return undefined;

  const values = filtered.map(({ value }) => value);
  const allObjects = values.every((value) => isPlainObject(value));
  if (allObjects) {
    const asObjects = filtered as Array<{ roleName: string; value: Record<string, unknown> }>;
    const keys = collectOrderedKeysFromMembers(asObjects);
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (SYSTEM_KEYS_TO_DROP.has(key)) continue;
      const childItems = asObjects
        .map(({ roleName, value }) => ({ roleName, value: value[key] }))
        .filter(({ value }) => isNonEmptyValue(value));
      if (childItems.length === 0) continue;
      const mergedChild = mergeValues(childItems);
      if (mergedChild === undefined) continue;
      out[key] = mergedChild;
    }
    return out;
  }

  const allArrays = values.every((value) => Array.isArray(value));
  if (allArrays) {
    const asArrays = filtered as Array<{ roleName: string; value: unknown[] }>;
    return mergeArrays(asArrays);
  }

  return mergeScalarBlocks(filtered);
};

const pickOutputTemplate = (
  inferred: InferableTemplate[],
  outputTemplate: TeamMergeOutputTemplate
): DataCardTemplate => {
  if (outputTemplate !== 'auto') {
    if (outputTemplate === 'general') return 'general';
    const canUse = inferred.every((tpl) => tpl === outputTemplate);
    return canUse ? outputTemplate : 'general';
  }

  const first = inferred[0];
  const same = inferred.every((tpl) => tpl === first);
  if (same && (first === 'magical-girl' || first === 'canshou' || first === 'general')) {
    return first;
  }
  return 'general';
};

const guessDisplayName = (data: Record<string, unknown>, fallback: string): string => {
  const codename = typeof data.codename === 'string' ? data.codename.trim() : '';
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  return codename || name || fallback || '未命名角色';
};

const mergeAsGeneral = (members: Array<{ roleName: string; data: Record<string, unknown>; template: InferableTemplate }>): TeamMergeResult => {
  const warnings: string[] = [];
  const joinedName = members.map((m) => m.roleName).join(' & ');

  const blocks: string[] = [];
  for (const member of members) {
    try {
      const result = convertDataCard(member.data, 'general', member.template);
      warnings.push(...result.warnings.map((line) => `【${member.roleName}】${line}`));
      const general = result.data as Record<string, unknown>;
      const content = typeof general.content === 'string' ? general.content : '';
      blocks.push(`【${member.roleName}】${content.trim() ? content.trim() : JSON.stringify(member.data)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      warnings.push(`【${member.roleName}】转换为通用角色卡失败：${message}`);
      blocks.push(`【${member.roleName}】${JSON.stringify(member.data)}`);
    }
  }

  return {
    template: 'general',
    data: {
      templateId: GENERAL_CHARACTER_TEMPLATE_ID,
      name: joinedName,
      content: blocks.join('\n\n'),
    },
    warnings,
  };
};

const mergeAsStructured = (
  template: Exclude<DataCardTemplate, 'general' | 'scenario' | 'general-scenario'>,
  members: Array<{ roleName: string; data: Record<string, unknown> }>
): TeamMergeResult => {
  const warnings: string[] = [];
  const joinedName = members.map((m) => m.roleName).join(' & ');
  const nameKey = template === 'magical-girl' ? 'codename' : 'name';

  const base: Record<string, unknown> = {
    [nameKey]: joinedName,
    _teamMembers: members.map((m) => m.roleName),
  };

  const rootObjects = members.map((m) => ({ roleName: m.roleName, value: m.data }));
  const rootKeys = collectOrderedKeysFromMembers(rootObjects);
  for (const key of rootKeys) {
    if (key === nameKey) continue;
    if (SYSTEM_KEYS_TO_DROP.has(key)) continue;
    const items = members
      .map((m) => ({ roleName: m.roleName, value: m.data[key] }))
      .filter(({ value }) => isNonEmptyValue(value));
    if (items.length === 0) continue;
    const merged = mergeValues(items);
    if (merged === undefined) continue;
    base[key] = merged;
  }

  // 确保输出不会携带签名/预设标记（避免伪装原生卡）
  delete base.signature;
  delete base.isPreset;

  return { template, data: base, warnings };
};

export function mergeTeamDataCards(
  members: TeamMergeMemberInput[],
  options: { outputTemplate?: TeamMergeOutputTemplate } = {}
): TeamMergeResult {
  const normalizedMembers: Array<{ roleName: string; data: Record<string, unknown>; template: InferableTemplate }> = [];
  const warnings: string[] = [];

  for (const member of members) {
    if (!member || !isPlainObject(member.data)) {
      warnings.push(`已跳过无效队员：${member?.name || '未命名'}`);
      continue;
    }
    const template = inferTemplate(member.data);
    const roleName = member.name?.trim() ? member.name.trim() : guessDisplayName(member.data, member.name);
    normalizedMembers.push({ roleName, data: member.data, template });
  }

  if (normalizedMembers.length === 0) {
    return {
      template: 'general',
      data: {
        templateId: GENERAL_CHARACTER_TEMPLATE_ID,
        name: '空队伍',
        content: '未选中任何有效角色卡。',
      },
      warnings: [...warnings, '未选中任何有效角色卡。'],
    };
  }

  const inferred = normalizedMembers.map((m) => m.template);
  const outputTemplate = pickOutputTemplate(inferred, options.outputTemplate ?? 'auto');

  if (outputTemplate === 'general') {
    const result = mergeAsGeneral(normalizedMembers);
    return { ...result, warnings: [...warnings, ...result.warnings] };
  }

  if (outputTemplate === 'magical-girl' || outputTemplate === 'canshou') {
    const result = mergeAsStructured(outputTemplate, normalizedMembers);
    if ((options.outputTemplate ?? 'auto') !== 'auto' && inferred.some((tpl) => tpl !== outputTemplate)) {
      warnings.push('已选择强制输出模板，但队员模板不一致：已自动降级为通用角色卡。');
      const degraded = mergeAsGeneral(normalizedMembers);
      return { ...degraded, warnings: [...warnings, ...degraded.warnings] };
    }
    return { ...result, warnings: [...warnings, ...result.warnings] };
  }

  // outputTemplate === 'general-scenario'/'scenario' 不属于角色组队目标，降级为通用角色卡。
  warnings.push('角色组队暂不支持情景模板，已降级为通用角色卡。');
  const result = mergeAsGeneral(normalizedMembers);
  return { ...result, warnings: [...warnings, ...result.warnings] };
}
