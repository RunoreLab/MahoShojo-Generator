import type { BuildRulePreset, BuildRuleRuntimeResult, CreatorPromptInput, CreatorRequestInput } from './types';

import { projectBuildRulesForPrompt } from './build-rule-projection';
import { buildCreatorUserIntent, summarizeQuestionnaires } from './prompt';
import { tryLoadBuildRulePresetById } from './build-rules';

interface CreatorServerOptions {
  resolvePreset?: (ruleId: string) => BuildRulePreset | null;
}

const getBuildRulePresetOrThrow = (
  ruleId: string,
  resolvePreset?: (ruleId: string) => BuildRulePreset | null
): BuildRulePreset => {
  const preset = resolvePreset?.(ruleId) ?? tryLoadBuildRulePresetById(ruleId);
  if (!preset) {
    throw new Error(`BUILD_RULE_PRESET_NOT_FOUND:${ruleId}`);
  }
  return preset;
};

const hasBuildRuleValidationErrors = (rule: BuildRuleRuntimeResult): boolean => {
  const validationSummary = rule.validationSummary;
  const issues = Array.isArray(validationSummary?.issues)
    ? validationSummary.issues.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const missingRequiredBlockKeys = Array.isArray(validationSummary?.missingRequiredBlockKeys)
    ? validationSummary.missingRequiredBlockKeys.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  return validationSummary?.valid !== true || issues.length > 0 || missingRequiredBlockKeys.length > 0;
};

export function validateCreatorRequest(
  input: CreatorRequestInput,
  options: CreatorServerOptions = {}
): void {
  const questionnaires = input.questionnaires ?? [];
  const buildRules = input.buildRules ?? [];
  const freeformBrief = buildCreatorUserIntent(input);
  const primaryRuleId = input.primaryRuleId?.trim() ?? '';

  if (buildRules.length > 0 && !primaryRuleId) {
    throw new Error('PRIMARY_RULE_REQUIRED');
  }

  if (buildRules.length > 0 && !buildRules.some((rule) => rule.ruleId === primaryRuleId)) {
    throw new Error('PRIMARY_RULE_NOT_SELECTED');
  }

  if (buildRules.length === 0 && questionnaires.length === 0 && !freeformBrief) {
    throw new Error('FREEFORM_BRIEF_REQUIRED');
  }

  for (const rule of buildRules) {
    if (hasBuildRuleValidationErrors(rule)) {
      throw new Error('RULE_VALIDATION_FAILED');
    }

    const preset = getBuildRulePresetOrThrow(rule.ruleId, options.resolvePreset);
    if (!preset.supportedTemplates.includes(input.template)) {
      throw new Error('RULE_TEMPLATE_UNSUPPORTED');
    }
    if (!preset.allowStandalone && questionnaires.length === 0) {
      throw new Error('QUESTIONNAIRE_REQUIRED_FOR_RULE');
    }
  }

  if (primaryRuleId) {
    const primaryPreset = getBuildRulePresetOrThrow(primaryRuleId, options.resolvePreset);
    if (!primaryPreset.mainRuleEligible) {
      throw new Error('PRIMARY_RULE_INELIGIBLE');
    }
  }
}

export function buildCreatorPromptInput(
  input: CreatorRequestInput,
  options: CreatorServerOptions = {}
): CreatorPromptInput {
  const resolveProjectionPolicy = (ruleId: string) =>
    getBuildRulePresetOrThrow(ruleId, options.resolvePreset).projectionPolicy;

  return {
    template: input.template,
    userIntent: buildCreatorUserIntent(input),
    questionnaireSummary: summarizeQuestionnaires(
      input.questionnaires ?? [],
      input.questionnaireAnswers ?? []
    ),
    buildRuleProjection: projectBuildRulesForPrompt({
      template: input.template,
      primaryRuleId: input.primaryRuleId ?? null,
      rules: input.buildRules ?? [],
      resolveRuleProjectionPolicy: resolveProjectionPolicy,
    }),
  };
}
