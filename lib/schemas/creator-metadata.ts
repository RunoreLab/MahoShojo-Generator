import { z } from 'zod/v3';

export const CreatorBuildRuleSnapshotSchema = z.object({
  ruleId: z.string(),
  version: z.string().optional(),
  blockResults: z.record(z.unknown()).default({}),
  derived: z.record(z.unknown()).default({}),
  validationSummary: z.record(z.unknown()).default({}),
});

export const CreationInputsSchema = z.object({
  template: z.string(),
  freeformBrief: z.string().nullable().optional(),
  questionnaires: z.array(z.unknown()).default([]),
  questionnaireAnswers: z.array(z.unknown()).default([]),
  buildRules: z.array(CreatorBuildRuleSnapshotSchema).default([]),
  primaryRuleId: z.string().nullable().optional(),
});

export const BuildStateSchema = z.object({
  primaryRuleId: z.string().nullable().optional(),
  rules: z.array(CreatorBuildRuleSnapshotSchema).default([]),
});

export type CreatorBuildRuleSnapshot = z.infer<typeof CreatorBuildRuleSnapshotSchema>;
export type CreationInputs = z.infer<typeof CreationInputsSchema>;
export type BuildState = z.infer<typeof BuildStateSchema>;
