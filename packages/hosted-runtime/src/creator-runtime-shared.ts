import type {
  BuildRuleRuntimeResult,
  CreatorPromptInput as CanonicalCreatorPromptInput,
  CreatorQuestionnaireRef as CanonicalCreatorQuestionnaireRef,
  CreatorRequestInput as CanonicalCreatorRequestInput,
  ProjectedBuildRuleForPrompt,
} from './creator/types';
import {
  CREATOR_TEMPLATE_IDS,
  type CreatorGenerationMode,
  type CreatorTemplateId,
} from './creator/templates';

export { CREATOR_TEMPLATE_IDS };
export type { CreatorGenerationMode, CreatorTemplateId };
export type CreatorBuildRuleRuntimeResult = BuildRuleRuntimeResult;
export type CreatorQuestionnaireRef = CanonicalCreatorQuestionnaireRef;
export type CreatorRequestInput = CanonicalCreatorRequestInput;
export type CreatorProjectedBuildRule = ProjectedBuildRuleForPrompt;
export type CreatorPromptInput = CanonicalCreatorPromptInput;

export interface CreatorDomainRuntimeDependencies {
  resolveBuildRules(_raw: unknown): CreatorBuildRuleRuntimeResult[];
  validateCreatorRequest(_input: CreatorRequestInput): void;
  buildCreatorPromptInput(_input: CreatorRequestInput): CreatorPromptInput;
}

export const normalizeCreatorTemplate = (
  raw: unknown,
  mode: CreatorGenerationMode,
): CreatorTemplateId => {
  const candidate = typeof raw === 'string' ? raw.trim() : '';
  if (CREATOR_TEMPLATE_IDS.includes(candidate as CreatorTemplateId)) {
    return candidate as CreatorTemplateId;
  }
  return mode === 'stream' ? 'general' : 'magical-girl';
};

export const isCreatorTemplateSupported = (
  mode: CreatorGenerationMode,
  template: CreatorTemplateId,
): boolean => mode === 'stream'
  ? template === 'general' || template === 'general-scenario'
  : template === 'magical-girl' || template === 'canshou';

// `buildCreatorPromptText` 与 `buildCreatorStreamPrompt` 已上移
// `@mahoshojo/domain/creator`（D5.1-G3），此处仅保留同名重导出。
export { buildCreatorPromptText } from './creator/prompt';
export { buildCreatorStreamPrompt } from './creator/stream-prompt';
