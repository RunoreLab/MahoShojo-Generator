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
  resolveRuleProjectionPolicy?: (ruleId: string) => 'primary-structured' | 'reference-only';
};

type SpecialtyPromptMeta = {
  id: string;
  label: string;
  cost: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

const buildRuleSummary = (template: CreatorTemplateId, rule: BuildRuleRuntimeResult): string => {
  const powerLevel = typeof rule.blockResults.powerLevel === 'string' ? rule.blockResults.powerLevel : 'seed';
  const attributes = isRecord(rule.blockResults.coreAttributes) ? rule.blockResults.coreAttributes : {};
  const specialties = Array.isArray(rule.blockResults.specialties)
    ? rule.blockResults.specialties.filter((item): item is string => typeof item === 'string')
    : [];
  const specialtyMap = getSpecialtyMap(rule.ruleId);
  const specialtyLabels = specialties.map((specialtyId) => specialtyMap.get(specialtyId)?.label ?? specialtyId);
  const budget = rule.validationSummary.budget;

  return [
    `模板：${template}`,
    `力量层级：${powerLevel}`,
    `属性：STR ${attributes.STR ?? '-'} / CON ${attributes.CON ?? '-'} / AGI ${attributes.AGI ?? '-'} / MAG ${attributes.MAG ?? '-'} / WILL ${attributes.WILL ?? '-'} / PER ${attributes.PER ?? '-'} / CHM ${attributes.CHM ?? '-'}`,
    `衍生值：HP ${rule.derived.HP ?? '-'} / MP ${rule.derived.MP ?? '-'} / Radiance ${rule.derived.Radiance ?? '-'}`,
    `专长：${specialtyLabels.length > 0 ? specialtyLabels.join('、') : '未选择'}`,
    budget
      ? `预算：属性点 ${budget.attributePointsUsed}/${budget.attributePointsLimit ?? '无限'}；专长点 ${budget.specialtyPointsUsed}/${budget.specialtyPointsLimit ?? '无限'}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
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
