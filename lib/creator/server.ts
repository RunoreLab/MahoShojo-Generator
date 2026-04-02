import { evaluateBuildRuleState, type BuildRuleRuntimeResult } from './build-rule-runtime';
import type { BuildRulePreset, CreatorPromptInput, CreatorRequestInput } from './types';

import type {
  BuildState,
  CreationInputs,
  CreatorBuildRuleSnapshot,
} from '@/lib/schemas/creator-metadata';

import { BuildStateSchema, CreationInputsSchema } from '@/lib/schemas/creator-metadata';
import { projectBuildRulesForPrompt } from './build-rule-projection';
import { buildCreatorUserIntent, summarizeQuestionnaires } from './prompt';
import { tryLoadBuildRulePresetById } from './build-rules';

interface CreatorServerOptions {
  resolvePreset?: (ruleId: string) => BuildRulePreset | null;
}

export interface CreatorGenerationArtifacts {
  prompt: string;
  creationInputs: CreationInputs;
  buildState?: BuildState;
}

export interface NormalizedCreatorRequestError {
  code: string;
  ruleId?: string;
}

const KNOWN_CREATOR_REQUEST_ERROR_CODES = new Set([
  'FREEFORM_BRIEF_REQUIRED',
  'PRIMARY_RULE_REQUIRED',
  'PRIMARY_RULE_NOT_SELECTED',
  'RULE_TEMPLATE_UNSUPPORTED',
  'QUESTIONNAIRE_REQUIRED_FOR_RULE',
  'PRIMARY_RULE_INELIGIBLE',
  'BUILD_RULE_VALIDATION_FAILED',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

  const invalidRule = buildRules.find((rule) => !rule.validationSummary.valid);
  if (invalidRule) {
    throw new Error(`BUILD_RULE_VALIDATION_FAILED:${invalidRule.ruleId}`);
  }
}

const buildCreationInputs = (input: CreatorRequestInput): CreationInputs =>
  CreationInputsSchema.parse({
    template: input.template,
    freeformBrief: input.freeformBrief ?? null,
    questionnaires: input.questionnaires ?? [],
    questionnaireAnswers: input.questionnaireAnswers ?? [],
    buildRules: input.buildRules ?? [],
    primaryRuleId: input.primaryRuleId ?? null,
  });

const buildPersistedBuildState = (input: CreatorRequestInput): BuildState | undefined => {
  const buildRules = input.buildRules ?? [];
  if (buildRules.length === 0) {
    return undefined;
  }

  return BuildStateSchema.parse({
    primaryRuleId: input.primaryRuleId ?? null,
    rules: buildRules,
  });
};

const formatProjectionFacts = (
  label: string,
  projection: NonNullable<CreatorPromptInput['buildRuleProjection']['primary']>,
  resolvePreset?: (ruleId: string) => BuildRulePreset | null
): string => {
  const sections = [`### ${label}`];
  const preset = resolvePreset?.(projection.ruleId) ?? tryLoadBuildRulePresetById(projection.ruleId);
  if (preset?.title) {
    sections.push(`规则名称：${preset.title}`);
  }
  if (preset?.aiPromptHint?.trim()) {
    sections.push(`规则提示：${preset.aiPromptHint.trim()}`);
  }
  sections.push(
    '```json',
    JSON.stringify(
      {
        ruleId: projection.ruleId,
        version: projection.version,
        projectionPolicy: projection.projectionPolicy,
        promptLayer: projection.promptLayer,
        facts: projection.facts,
      },
      null,
      2
    ),
    '```'
  );
  return sections.join('\n');
};

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

export function renderCreatorPrompt(
  input: CreatorPromptInput,
  options: CreatorServerOptions = {}
): string {
  const sections = [
    `你将为模板「${input.template}」生成最终内容。`,
    '请综合下面的多源输入进行创作，不要在结果中暴露“问卷摘要”“规则投影”“程序维护”等工程术语。',
    '输入优先级：1. 主规则固定事实（若存在，不得改写或重算） 2. 用户自由说明 3. 问卷摘要 4. 参考规则。',
  ];

  if (input.userIntent) {
    sections.push(`## 用户自由说明\n${input.userIntent}`);
  }

  if (input.questionnaireSummary) {
    sections.push(`## 问卷摘要\n${input.questionnaireSummary}`);
  }

  if (input.buildRuleProjection.primary) {
    sections.push(
      '## 主规则固定事实\n以下内容为程序给出的权威事实，必须遵守，不得擅自改写数值、缺失项或约束关系。',
      formatProjectionFacts('主规则', input.buildRuleProjection.primary, options.resolvePreset)
    );
  }

  if (input.buildRuleProjection.references.length > 0) {
    const referenceSections = input.buildRuleProjection.references.map((projection, index) =>
      formatProjectionFacts(`参考规则 ${index + 1}`, projection, options.resolvePreset)
    );
    sections.push(
      '## 参考规则\n以下内容只作为补充上下文，可用于世界观、风格、限制或灵感，不得覆盖主规则固定事实。',
      referenceSections.join('\n\n')
    );
  }

  sections.push(
    '## 输出约束\n- 把所有输入整合成最终模板内容。\n- 若用户自由说明与问卷摘要冲突，以用户自由说明的风格与偏好为准。\n- 若任意输入与主规则固定事实冲突，以主规则固定事实为准。'
  );

  return sections.join('\n\n').trim();
}

export function buildCreatorGenerationArtifacts(
  input: CreatorRequestInput,
  options: CreatorServerOptions = {}
): CreatorGenerationArtifacts {
  const promptInput = buildCreatorPromptInput(input, options);
  const buildState = buildPersistedBuildState(input);

  return {
    prompt: renderCreatorPrompt(promptInput, options),
    creationInputs: buildCreationInputs(input),
    ...(buildState ? { buildState } : {}),
  };
}

export function normalizeCreatorBuildRules(
  buildRules: CreatorBuildRuleSnapshot[] = []
): BuildRuleRuntimeResult[] {
  return buildRules.map((rule) =>
    evaluateBuildRuleState({
      ruleId: rule.ruleId,
      inputs: isRecord(rule.blockResults) ? rule.blockResults : {},
    })
  );
}

export function normalizeCreatorRequestError(
  error: unknown
): NormalizedCreatorRequestError | null {
  if (!(error instanceof Error)) {
    return null;
  }

  if (KNOWN_CREATOR_REQUEST_ERROR_CODES.has(error.message)) {
    return {
      code: error.message,
    };
  }

  const buildRulePresetPrefix = 'BUILD_RULE_PRESET_NOT_FOUND:';
  if (error.message.startsWith(buildRulePresetPrefix)) {
    const ruleId = error.message.slice(buildRulePresetPrefix.length).trim();
    return {
      code: 'BUILD_RULE_PRESET_NOT_FOUND',
      ...(ruleId ? { ruleId } : {}),
    };
  }

  const buildRuleValidationPrefix = 'BUILD_RULE_VALIDATION_FAILED:';
  if (error.message.startsWith(buildRuleValidationPrefix)) {
    const ruleId = error.message.slice(buildRuleValidationPrefix.length).trim();
    return {
      code: 'BUILD_RULE_VALIDATION_FAILED',
      ...(ruleId ? { ruleId } : {}),
    };
  }

  return null;
}
