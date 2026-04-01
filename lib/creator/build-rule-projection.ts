import type { BuildRulePreset } from './types';

import { tryLoadBuildRulePresetById } from './build-rules';

export interface BuildRulePromptInput {
  ruleId: string;
  presetId: string;
  state?: Record<string, unknown>;
  derived?: Record<string, unknown>;
}

export interface BuildRulePromptProjection {
  ruleId: string;
  presetId: string;
  title: string | null;
  projectionPolicy: 'primary-structured' | 'reference-only';
  state: Record<string, unknown>;
  derived: Record<string, unknown>;
}

export interface ProjectBuildRulesForPromptParams {
  primaryRuleId?: string | null;
  rules: BuildRulePromptInput[];
  resolvePreset?: (presetId: string) => BuildRulePreset | null;
}

export interface ProjectBuildRulesForPromptResult {
  primary: BuildRulePromptProjection | null;
  references: BuildRulePromptProjection[];
}

const DEFAULT_POLICY: BuildRulePromptProjection['projectionPolicy'] = 'reference-only';

const resolvePresetWithFallback = (
  presetId: string,
  resolvePreset?: (presetId: string) => BuildRulePreset | null
): BuildRulePreset | null => {
  const resolved = resolvePreset?.(presetId) ?? null;
  if (resolved) {
    return resolved;
  }
  return tryLoadBuildRulePresetById(presetId);
};

const projectRule = (
  rule: BuildRulePromptInput,
  preset: BuildRulePreset | null
): BuildRulePromptProjection => ({
  ruleId: rule.ruleId,
  presetId: rule.presetId,
  title: preset?.title ?? null,
  projectionPolicy: preset?.projectionPolicy ?? DEFAULT_POLICY,
  state: rule.state ?? {},
  derived: rule.derived ?? {},
});

export function projectBuildRulesForPrompt(
  params: ProjectBuildRulesForPromptParams
): ProjectBuildRulesForPromptResult {
  let primary: BuildRulePromptProjection | null = null;
  const references: BuildRulePromptProjection[] = [];

  for (const rule of params.rules) {
    const preset = resolvePresetWithFallback(rule.presetId, params.resolvePreset);
    const projection = projectRule(rule, preset);
    const isPrimaryCandidate =
      Boolean(params.primaryRuleId) &&
      rule.ruleId === params.primaryRuleId &&
      projection.projectionPolicy === 'primary-structured';

    if (isPrimaryCandidate && primary === null) {
      primary = projection;
      continue;
    }

    references.push(projection);
  }

  return {
    primary,
    references,
  };
}
