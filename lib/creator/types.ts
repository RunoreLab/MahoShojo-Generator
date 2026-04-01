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
