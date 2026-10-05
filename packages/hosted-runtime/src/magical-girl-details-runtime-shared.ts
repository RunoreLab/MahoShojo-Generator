import {
  createMagicalGirlDetailsGenerationConfig as createSharedGenerationConfig,
  type MagicalGirlDetailsGeneratedData,
  type MagicalGirlDetailsGenerationInput,
} from '@mahoshojo/ai-core/magical-girl-details-generation';

import type { CustomProviderRuntimeOptions } from './custom-provider-runtime';
import type { StructuredGenerationConfig } from './generation-runtime-shared';

export {
  MAGICAL_GIRL_DETAILS_SCHEMA,
  buildMagicalGirlDetailsStreamPrompt,
  type MagicalGirlDetailsGeneratedData,
  type MagicalGirlDetailsGenerationInput,
} from '@mahoshojo/ai-core/magical-girl-details-generation';

export const createMagicalGirlDetailsGenerationConfig = (
  getRandomFlowers: () => string,
  modelOverride: string | undefined,
  generationSettingsContext: CustomProviderRuntimeOptions['generationSettingsContext'],
): StructuredGenerationConfig<MagicalGirlDetailsGeneratedData, MagicalGirlDetailsGenerationInput> => ({
  ...createSharedGenerationConfig(getRandomFlowers),
  ...(modelOverride ? { modelOverride } : {}),
  ...(generationSettingsContext ? { generationSettingsContext } : {}),
});
