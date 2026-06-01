import type { CreatorTemplateId } from './templates';
import type { QuestionnaireAnswerItem } from '@/lib/questionnaires';

export type BuildRuleBlockType =
  | 'select'
  | 'point-buy'
  | 'multi-select'
  | 'derived'
  | 'section'
  | 'stat-array'
  | 'number-group';

export type BuildRuleOption = Readonly<{
  value: string;
  label: string;
  description?: string;
  meta?: Record<string, unknown>;
}>;

export type BuildRuleField = Readonly<{
  id: string;
  label: string;
  description?: string;
  min?: number;
  max?: number;
  defaultValue?: number;
}>;

export type BuildRuleBlock = Readonly<{
  id: string;
  type: BuildRuleBlockType;
  label?: string;
  description?: string;
  hint?: string;
  defaultValue?: string;
  options?: readonly BuildRuleOption[];
  fields?: readonly BuildRuleField[];
  [key: string]: unknown;
}>;

export interface BuildRulePresetIndexEntry {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly description?: string;
}

export type BuildRulePresetIndex = readonly BuildRulePresetIndexEntry[];

export interface BuildRulePreset {
  readonly id: string;
  readonly version: string;
  readonly title?: string;
  readonly description?: string;
  readonly supportedTemplates: readonly CreatorTemplateId[];
  readonly allowStandalone: boolean;
  readonly mainRuleEligible: boolean;
  readonly projectionPolicy: 'primary-structured' | 'reference-only';
  readonly aiPromptHint?: string;
  readonly uiSummary?: string;
  readonly blocks: readonly BuildRuleBlock[];
}

export interface BuildRuleValidationBudgetSummary {
  attributePointsUsed: number;
  attributePointsLimit: number | null;
  skillPointsUsed?: number;
  skillPointsLimit?: number | null;
  specialtyPointsUsed: number;
  specialtyPointsLimit: number | null;
}

export interface BuildRuleValidationSummary {
  valid: boolean;
  issues: string[];
  missingRequiredBlockKeys: string[];
  budget?: BuildRuleValidationBudgetSummary;
}

export interface BuildRuleRuntimeResult {
  ruleId: string;
  version: string;
  blockResults: Record<string, unknown>;
  derived: Record<string, unknown>;
  validationSummary: BuildRuleValidationSummary;
}

export interface BuildRuleRequestInput {
  ruleId: string;
  version?: string | null;
  inputs: Record<string, unknown>;
}

export interface ProjectedBuildRuleForPrompt {
  ruleId: string;
  template: CreatorTemplateId;
  facts: {
    ruleId: string;
    version: string;
    blockResults: Record<string, unknown>;
    derived: Record<string, unknown>;
    validationSummary: BuildRuleValidationSummary;
  };
  summary: string;
}

export interface ProjectBuildRulesForPromptResult {
  primary: ProjectedBuildRuleForPrompt | null;
  references: ProjectedBuildRuleForPrompt[];
}

export interface CreatorQuestionnaireRef {
  questionnaireId: string;
  title?: string;
}

export type CreatorQuestionnaireAnswer = QuestionnaireAnswerItem;

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
