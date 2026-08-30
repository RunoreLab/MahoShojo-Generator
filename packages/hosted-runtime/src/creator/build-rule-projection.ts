import { loadBuildRulePresetById, tryLoadBuildRulePresetById } from './build-rules';
import type { CreatorTemplateId } from './templates';

import type {
  BuildRuleRuntimeResult,
  ProjectBuildRulesForPromptResult,
  ProjectedBuildRuleForPrompt,
} from './types';

type ProjectBuildRulesForPromptInput = {
  template: CreatorTemplateId;
  primaryRuleId?: string | null;
  rules: BuildRuleRuntimeResult[];
  resolveRuleProjectionPolicy?: (_ruleId: string) => 'primary-structured' | 'reference-only';
};

type SpecialtyPromptMeta = {
  id: string;
  label: string;
  cost: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getSelectOptionLabel = (ruleId: string, blockId: string, value: unknown): string => {
  const preset = tryLoadBuildRulePresetById(ruleId) as unknown as Record<string, unknown> | null;
  if (!preset || typeof value !== 'string') return typeof value === 'string' ? value : '-';
  const blocks = Array.isArray(preset.blocks) ? preset.blocks : [];
  const block = blocks.find((item) => isRecord(item) && item.id === blockId);
  if (!isRecord(block) || !Array.isArray(block.options)) return value;
  const option = block.options.find((item) => isRecord(item) && item.value === value);
  return isRecord(option) && typeof option.label === 'string' ? option.label.trim() : value;
};

const getMultiSelectLabels = (ruleId: string, blockId: string, values: unknown): string[] => {
  const preset = tryLoadBuildRulePresetById(ruleId) as unknown as Record<string, unknown> | null;
  if (!preset || !Array.isArray(values)) return [];
  const blocks = Array.isArray(preset.blocks) ? preset.blocks : [];
  const block = blocks.find((item) => isRecord(item) && item.id === blockId);
  if (!isRecord(block) || !Array.isArray(block.groups)) return [];

  const labelMap = new Map<string, string>();
  block.groups
    .filter(isRecord)
    .flatMap((group) => (Array.isArray(group.items) ? group.items : []))
    .filter(isRecord)
    .forEach((item) => {
      const itemId = typeof item.id === 'string' ? item.id.trim() : '';
      const itemLabel = typeof item.label === 'string' ? item.label.trim() : itemId;
      if (itemId) {
        labelMap.set(itemId, itemLabel);
      }
    });

  return values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => labelMap.get(item) ?? item);
};

const formatSignedNumber = (value: unknown): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value > 0 ? `+${Math.trunc(value)}` : `${Math.trunc(value)}`;
};

const translateSpellcastingKind = (value: unknown): string => {
  switch (value) {
    case 'full':
      return '完整施法';
    case 'half':
      return '半施法';
    case 'pact':
      return '契约施法';
    case 'none':
      return '无施法';
    default:
      return typeof value === 'string' && value.trim() ? value.trim() : '无施法';
  }
};

const getSpecialtyMap = (ruleId: string): Map<string, SpecialtyPromptMeta> => {
  const preset = tryLoadBuildRulePresetById(ruleId) as unknown as Record<string, unknown> | null;
  if (!preset) return new Map();
  const blocks = Array.isArray(preset.blocks) ? preset.blocks : [];
  const specialtiesBlock = blocks.find((block) => isRecord(block) && block.id === 'specialties');
  const groups = specialtiesBlock && isRecord(specialtiesBlock) && Array.isArray(specialtiesBlock.groups)
    ? specialtiesBlock.groups
    : [];

  const specialtyMap = new Map<string, SpecialtyPromptMeta>();
  groups.filter(isRecord).forEach((group) => {
    const items = Array.isArray(group.items) ? group.items : [];
    items.filter(isRecord).forEach((item) => {
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (!id) return;
      specialtyMap.set(id, {
        id,
        label: typeof item.label === 'string' ? item.label.trim() : id,
        cost: typeof item.cost === 'number' && Number.isFinite(item.cost) ? Math.trunc(item.cost) : 0,
      });
    });
  });

  return specialtyMap;
};

const buildArenaRuleSummary = (template: CreatorTemplateId, rule: BuildRuleRuntimeResult): string => {
  const blockResults = isRecord(rule.blockResults) ? rule.blockResults : {};
  const derived = isRecord(rule.derived) ? rule.derived : {};
  const powerLevel = getSelectOptionLabel(rule.ruleId, 'powerLevel', blockResults.powerLevel);
  const attributes = isRecord(blockResults.coreAttributes) ? blockResults.coreAttributes : {};
  const specialties = Array.isArray(blockResults.specialties)
    ? blockResults.specialties.filter((item): item is string => typeof item === 'string')
    : [];
  const specialtyMap = getSpecialtyMap(rule.ruleId);
  const specialtyLabels = specialties.map((specialtyId) => specialtyMap.get(specialtyId)?.label ?? specialtyId);
  const budget = rule.validationSummary.budget;

  return [
    `模板：${template}`,
    `力量层级：${powerLevel}`,
    `属性：STR ${attributes.STR ?? '-'} / CON ${attributes.CON ?? '-'} / AGI ${attributes.AGI ?? '-'} / MAG ${attributes.MAG ?? '-'} / WILL ${attributes.WILL ?? '-'} / PER ${attributes.PER ?? '-'} / CHM ${attributes.CHM ?? '-'}`,
    `衍生值：HP ${derived.HP ?? '-'} / MP ${derived.MP ?? '-'} / Radiance ${derived.Radiance ?? '-'}`,
    `专长：${specialtyLabels.length > 0 ? specialtyLabels.join('、') : '未选择'}`,
    budget
      ? `预算：属性点 ${budget.attributePointsUsed}/${budget.attributePointsLimit ?? '无限'}；专长点 ${budget.specialtyPointsUsed}/${budget.specialtyPointsLimit ?? '无限'}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
};

const buildDndRuleSummary = (template: CreatorTemplateId, rule: BuildRuleRuntimeResult): string => {
  const blockResults = isRecord(rule.blockResults) ? rule.blockResults : {};
  const derived = isRecord(rule.derived) ? rule.derived : {};
  const abilityScores = isRecord(blockResults.abilityScores) ? blockResults.abilityScores : {};
  const combatProfile = isRecord(blockResults.combatProfile) ? blockResults.combatProfile : {};
  const abilityModifiers = isRecord(derived.abilityModifiers) ? derived.abilityModifiers : {};

  return [
    `模板：${template}`,
    `等级：${getSelectOptionLabel(rule.ruleId, 'level', blockResults.level)} / 职业：${getSelectOptionLabel(rule.ruleId, 'class', blockResults.class)} / 族裔：${getSelectOptionLabel(rule.ruleId, 'lineage', blockResults.lineage)}`,
    `属性：STR ${abilityScores.STR ?? '-'} (${formatSignedNumber(abilityModifiers.STR)}) / DEX ${abilityScores.DEX ?? '-'} (${formatSignedNumber(abilityModifiers.DEX)}) / CON ${abilityScores.CON ?? '-'} (${formatSignedNumber(abilityModifiers.CON)}) / INT ${abilityScores.INT ?? '-'} (${formatSignedNumber(abilityModifiers.INT)}) / WIS ${abilityScores.WIS ?? '-'} (${formatSignedNumber(abilityModifiers.WIS)}) / CHA ${abilityScores.CHA ?? '-'} (${formatSignedNumber(abilityModifiers.CHA)})`,
    `战斗：AC ${combatProfile.armorClass ?? '-'} / HP ${combatProfile.hitPoints ?? '-'} / Speed ${combatProfile.speed ?? '-'} / Passive Perception ${combatProfile.passivePerception ?? '-'}`,
    `派生：熟练加值 ${formatSignedNumber(derived.proficiencyBonus)} / 命中骰 ${typeof derived.hitDie === 'string' ? derived.hitDie : '-'} / ${translateSpellcastingKind(derived.spellcastingKind)}`,
  ]
    .filter(Boolean)
    .join('\n');
};

const buildCocRuleSummary = (template: CreatorTemplateId, rule: BuildRuleRuntimeResult): string => {
  const blockResults = isRecord(rule.blockResults) ? rule.blockResults : {};
  const derived = isRecord(rule.derived) ? rule.derived : {};
  const coreAttributes = isRecord(blockResults.coreAttributes) ? blockResults.coreAttributes : {};
  const secondaryInputs = isRecord(blockResults.secondaryInputs) ? blockResults.secondaryInputs : {};
  const signatureSkills = getMultiSelectLabels(rule.ruleId, 'signatureSkills', blockResults.signatureSkills);

  return [
    `模板：${template}`,
    `年代：${getSelectOptionLabel(rule.ruleId, 'eraTone', blockResults.eraTone)} / 职业：${getSelectOptionLabel(rule.ruleId, 'occupation', blockResults.occupation)}`,
    `属性：STR ${coreAttributes.STR ?? '-'} / CON ${coreAttributes.CON ?? '-'} / SIZ ${coreAttributes.SIZ ?? '-'} / DEX ${coreAttributes.DEX ?? '-'} / APP ${coreAttributes.APP ?? '-'} / INT ${coreAttributes.INT ?? '-'} / POW ${coreAttributes.POW ?? '-'} / EDU ${coreAttributes.EDU ?? '-'}`,
    `补充：Luck ${secondaryInputs.luck ?? '-'} / Credit Rating ${secondaryInputs.creditRating ?? '-'} / Age ${secondaryInputs.age ?? '-'}`,
    `派生：SAN ${derived.SAN ?? '-'} / HP ${derived.HP ?? '-'} / MP ${derived.MP ?? '-'} / Build ${derived.Build ?? '-'} / Damage Bonus ${derived.DamageBonus ?? '-'}`,
    `技能倾向：${signatureSkills.length > 0 ? signatureSkills.join('、') : '未选择'}`,
  ]
    .filter(Boolean)
    .join('\n');
};

const buildTerrorInfinityFxRuleSummary = (template: CreatorTemplateId, rule: BuildRuleRuntimeResult): string => {
  const blockResults = isRecord(rule.blockResults) ? rule.blockResults : {};
  const derived = isRecord(rule.derived) ? rule.derived : {};
  const coreAttributes = isRecord(blockResults.coreAttributes) ? blockResults.coreAttributes : {};
  const skills = isRecord(blockResults.skills) ? blockResults.skills : {};
  const bodyProfile = isRecord(blockResults.bodyProfile) ? blockResults.bodyProfile : {};
  const specialties = getMultiSelectLabels(rule.ruleId, 'specialties', blockResults.specialties);
  const budget = rule.validationSummary.budget;

  return [
    `模板：${template}`,
    '规则：无限恐怖FXv137 标准人物卡',
    `属性：智力 ${coreAttributes.INT ?? '-'} / 感知 ${coreAttributes.PER ?? '-'} / 决心 ${coreAttributes.RES ?? '-'} / 力量 ${coreAttributes.STR ?? '-'} / 敏捷 ${coreAttributes.DEX ?? '-'} / 耐力 ${coreAttributes.STA ?? '-'} / 风度 ${coreAttributes.PRE ?? '-'} / 操控 ${coreAttributes.MAN ?? '-'} / 沉着 ${coreAttributes.COM ?? '-'}`,
    `技能：学识 ${skills.academics ?? '-'} / 器用 ${skills.devices ?? '-'} / 手艺 ${skills.craft ?? '-'} / 专注 ${skills.focus ?? '-'} / 运动 ${skills.athletics ?? '-'} / 生存 ${skills.survival ?? '-'} / 射击 ${skills.firearms ?? '-'} / 武技 ${skills.combat ?? '-'} / 洞察 ${skills.insight ?? '-'} / 隐秘 ${skills.stealth ?? '-'} / 表达 ${skills.expression ?? '-'} / 社交 ${skills.social ?? '-'}`,
    `衍生：体积 ${bodyProfile.size ?? '-'} / 速度 ${derived.Speed ?? '-'} / 先攻 ${derived.Initiative ?? '-'} / 基础防御 ${derived.BaseDefense ?? '-'} / 生命值 ${derived.Health ?? '-'} / 意志力 ${derived.Willpower ?? '-'}`,
    `专长：${specialties.length > 0 ? specialties.join('、') : '未选择'}`,
    budget
      ? `预算：属性点 ${budget.attributePointsUsed}/${budget.attributePointsLimit ?? '无限'}；技能点 ${budget.skillPointsUsed ?? 0}/${budget.skillPointsLimit ?? '无限'}；专长点 ${budget.specialtyPointsUsed}/${budget.specialtyPointsLimit ?? '无限'}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
};

const buildRuleSummary = (template: CreatorTemplateId, rule: BuildRuleRuntimeResult): string => {
  if (rule.ruleId === 'dnd-5e-lite') {
    return buildDndRuleSummary(template, rule);
  }
  if (rule.ruleId === 'coc-7e-lite') {
    return buildCocRuleSummary(template, rule);
  }
  if (rule.ruleId === 'terrorinfinity-fx-v137') {
    return buildTerrorInfinityFxRuleSummary(template, rule);
  }

  return buildArenaRuleSummary(template, rule);
};

const toProjectedRule = (
  template: CreatorTemplateId,
  rule: BuildRuleRuntimeResult
): ProjectedBuildRuleForPrompt => ({
  ruleId: rule.ruleId,
  template,
  facts: {
    ruleId: rule.ruleId,
    version: rule.version,
    blockResults: rule.blockResults,
    derived: rule.derived,
    validationSummary: rule.validationSummary,
  },
  summary: buildRuleSummary(template, rule),
});

export function projectBuildRulesForPrompt({
  template,
  primaryRuleId,
  rules,
  resolveRuleProjectionPolicy,
}: ProjectBuildRulesForPromptInput): ProjectBuildRulesForPromptResult {
  const projected: ProjectBuildRulesForPromptResult = {
    primary: null,
    references: [],
  };

  for (const rule of rules) {
    const projectionPolicy =
      resolveRuleProjectionPolicy?.(rule.ruleId) ?? loadBuildRulePresetById(rule.ruleId).projectionPolicy;
    const projectedRule = toProjectedRule(template, rule);

    if (primaryRuleId && rule.ruleId === primaryRuleId && projectionPolicy === 'primary-structured') {
      projected.primary = projectedRule;
      continue;
    }

    projected.references.push(projectedRule);
  }

  return projected;
}
