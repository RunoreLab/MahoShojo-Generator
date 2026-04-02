import type { BuildRuleRuntimeResult } from './build-rule-runtime';
import type { ProjectBuildRulesForPromptResult } from './build-rule-projection';
import type { CreatorTemplateId } from './templates';

export type BuildRuleBlock = Readonly<{
  id: string;
  type: string;
  label?: string;
  description?: string;
  hint?: string;
  [key: string]: unknown;
}>;

export interface BuildRulePreset {
  readonly id: string;
  readonly version: string;
  readonly title?: string;
  readonly supportedTemplates: readonly CreatorTemplateId[];
  readonly allowStandalone: boolean;
  readonly mainRuleEligible: boolean;
  readonly projectionPolicy: 'primary-structured' | 'reference-only';
  readonly aiPromptHint?: string;
  readonly uiSummary?: string;
  readonly blocks: readonly BuildRuleBlock[];
}

export interface BuildRulePresetIndexEntry {
  readonly id: string;
  readonly title: string;
  readonly version: string;
}

export type BuildRulePresetIndex = readonly BuildRulePresetIndexEntry[];

export interface CreatorQuestionnaireRef {
  questionnaireId: string;
  questionnaireSourceId?: string;
  title?: string;
  [key: string]: unknown;
}

export interface CreatorQuestionnaireAnswer {
  questionnaireId?: string;
  questionnaireSourceId?: string;
  questionnaireTitle?: string;
  questionId?: string;
  question?: string;
  answer?: string;
  [key: string]: unknown;
}

export interface CreatorRequestInput {
  template: CreatorTemplateId;
  freeformBrief?: string | null;
  questionnaires: CreatorQuestionnaireRef[];
  questionnaireAnswers?: CreatorQuestionnaireAnswer[];
  buildRules: BuildRuleRuntimeResult[];
  primaryRuleId?: string | null;
}

export interface CreatorPromptInput {
  template: CreatorTemplateId;
  userIntent: string;
  questionnaireSummary: string;
  buildRuleProjection: ProjectBuildRulesForPromptResult;
}
