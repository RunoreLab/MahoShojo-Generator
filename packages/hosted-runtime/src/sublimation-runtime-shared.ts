// Compatibility adapter: model routing and provider settings remain server-owned.
import {
  createSublimationGenerationCore,
  buildSublimationStreamCore,
} from '@mahoshojo/ai-core/sublimation-generation';
import type { CustomProviderRuntimeOptions } from './custom-provider-runtime';
import type { RawGenerationConfig, StructuredGenerationConfig } from './generation-runtime-shared';
import type { SublimationAiResult } from '@mahoshojo/ai-core/sublimation-generation';

export {
  SUBLIMATION_USER_GUIDANCE_MAX_CHARS,
  SUBLIMATION_NARRATIVE_HISTORY_MAX_CHARS,
  SUBLIMATION_FIELDS_TO_PRESERVE_MAX,
  getSublimationSchemaKeys,
  normalizeGeneratedSublimationAnswers,
  extractSublimationSafetyText,
  pruneSublimationStreamCard,
  type SublimationAiResult,
} from '@mahoshojo/ai-core/sublimation-generation';

type RuntimeSelection = {
  modelOverride?: string;
  generationSettingsContext?: CustomProviderRuntimeOptions['generationSettingsContext'];
};

export const createSublimationGenerationConfig = (
  input: Parameters<typeof createSublimationGenerationCore>[0] & RuntimeSelection & { isDowngrade: boolean },
): StructuredGenerationConfig<SublimationAiResult, null> => ({
  ...createSublimationGenerationCore(input),
  ...(input.modelOverride ?? (input.isDowngrade ? 'gemini-2.5-flash-lite' : undefined)
    ? { modelOverride: input.modelOverride ?? 'gemini-2.5-flash-lite' }
    : {}),
  ...(input.generationSettingsContext ? { generationSettingsContext: input.generationSettingsContext } : {}),
});

export const buildSublimationStreamConfig = (
  input: Parameters<typeof buildSublimationStreamCore>[0] & RuntimeSelection,
): RawGenerationConfig => ({
  ...buildSublimationStreamCore(input),
  ...(input.modelOverride ? { modelOverride: input.modelOverride } : {}),
  ...(input.generationSettingsContext ? { generationSettingsContext: input.generationSettingsContext } : {}),
});
