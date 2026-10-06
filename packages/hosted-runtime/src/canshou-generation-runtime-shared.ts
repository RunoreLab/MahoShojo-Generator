import {
  createCanshouGenerationConfig as createSharedGenerationConfig,
  type CanshouGeneratedData,
  type CanshouGenerationInput,
} from '@mahoshojo/ai-core/canshou-generation';

import type { CustomProviderRuntimeOptions } from './custom-provider-runtime';
import type { StructuredGenerationConfig } from './generation-runtime-shared';

export {
  CANSHOU_GENERATION_SCHEMA,
  buildCanshouStreamPrompt,
  buildUnsignedCanshouCard,
  type CanshouGeneratedData,
  type CanshouGenerationInput,
} from '@mahoshojo/ai-core/canshou-generation';

export const createCanshouGenerationConfig = (
  canshouLore: string,
  modelOverride: string | undefined,
  generationSettingsContext: CustomProviderRuntimeOptions['generationSettingsContext'],
): StructuredGenerationConfig<CanshouGeneratedData, CanshouGenerationInput> => ({
  ...createSharedGenerationConfig(canshouLore),
  ...(modelOverride ? { modelOverride } : {}),
  ...(generationSettingsContext ? { generationSettingsContext } : {}),
});
