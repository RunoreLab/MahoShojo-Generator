import type {
  BuildRuleBlockResults,
  BuildRuleRuntimeResult,
  BuildRuleValidationSummary,
} from './build-rule-runtime';
import type { CreatorTemplateId } from './templates';
import type { BuildRulePreset } from './types';

import { tryLoadBuildRulePresetById } from './build-rules';

export interface BuildRulePromptFacts {
  blockResults: BuildRuleBlockResults;
  derived: BuildRuleRuntimeResult['derived'];
  validationSummary: BuildRuleValidationSummary;
}

export interface BuildRulePromptProjection {
  ruleId: string;
  version: string;
  template: CreatorTemplateId;
  projectionPolicy: 'primary-structured' | 'reference-only';
  promptLayer: 'fixed-facts' | 'reference-context';
  facts: BuildRulePromptFacts;
}

export interface ProjectBuildRulesForPromptParams {
  primaryRuleId?: string | null;
  template: CreatorTemplateId;
  rules: BuildRuleRuntimeResult[];
  resolveRuleProjectionPolicy?: (
    ruleId: string
  ) => 'primary-structured' | 'reference-only' | null;
}

export interface ProjectBuildRulesForPromptResult {
  primary: BuildRulePromptProjection | null;
  references: BuildRulePromptProjection[];
}

const resolveProjectionPolicy = (
  ruleId: string,
  resolveRuleProjectionPolicy?: (
    ruleId: string
  ) => 'primary-structured' | 'reference-only' | null
): 'primary-structured' | 'reference-only' => {
  const override = resolveRuleProjectionPolicy?.(ruleId);
  if (override) {
    return override;
  }
  const preset: BuildRulePreset | null = tryLoadBuildRulePresetById(ruleId);
  return preset?.projectionPolicy ?? 'reference-only';
};

const buildPromptFacts = (runtimeResult: BuildRuleRuntimeResult): BuildRulePromptFacts => ({
  blockResults: runtimeResult.blockResults,
  derived: runtimeResult.derived,
  validationSummary: runtimeResult.validationSummary,
});

const buildPrimaryStructuredProjection = (
  runtimeResult: BuildRuleRuntimeResult,
  template: CreatorTemplateId,
  projectionPolicy: BuildRulePromptProjection['projectionPolicy']
): BuildRulePromptProjection => ({
  ruleId: runtimeResult.ruleId,
  version: runtimeResult.version,
  template,
  projectionPolicy,
  promptLayer: 'fixed-facts',
  facts: buildPromptFacts(runtimeResult),
});

const buildReferenceProjection = (
  runtimeResult: BuildRuleRuntimeResult,
  template: CreatorTemplateId,
  projectionPolicy: BuildRulePromptProjection['projectionPolicy']
): BuildRulePromptProjection => ({
  ruleId: runtimeResult.ruleId,
  version: runtimeResult.version,
  template,
  projectionPolicy,
  promptLayer: 'reference-context',
  facts: buildPromptFacts(runtimeResult),
});

export function projectBuildRulesForPrompt(
  params: ProjectBuildRulesForPromptParams
): ProjectBuildRulesForPromptResult {
  let primary: BuildRulePromptProjection | null = null;
  const references: BuildRulePromptProjection[] = [];

  for (const runtimeResult of params.rules) {
    const projectionPolicy = resolveProjectionPolicy(
      runtimeResult.ruleId,
      params.resolveRuleProjectionPolicy
    );
    const isPrimaryCandidate =
      Boolean(params.primaryRuleId) &&
      runtimeResult.ruleId === params.primaryRuleId &&
      projectionPolicy === 'primary-structured';
    if (isPrimaryCandidate && primary === null) {
      primary = buildPrimaryStructuredProjection(runtimeResult, params.template, projectionPolicy);
      continue;
    }

    references.push(buildReferenceProjection(runtimeResult, params.template, projectionPolicy));
  }

  return {
    primary,
    references,
  };
}
