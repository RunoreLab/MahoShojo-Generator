import type { CreatorTemplateId } from './templates';

export type BuildRuleBlock = {
  id: string;
  type: string;
  label?: string;
  description?: string;
  hint?: string;
  [key: string]: unknown;
};

export interface BuildRulePreset {
  id: string;
  version: string;
  title?: string;
  supportedTemplates: CreatorTemplateId[];
  allowStandalone: boolean;
  mainRuleEligible: boolean;
  projectionPolicy: 'primary-structured' | 'reference-only';
  aiPromptHint?: string;
  uiSummary?: string;
  blocks: BuildRuleBlock[];
}

export interface BuildRulePresetIndexEntry {
  id: string;
  title: string;
  version: string;
}

export type BuildRulePresetIndex = BuildRulePresetIndexEntry[];
