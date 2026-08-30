import {
  createNodeStructuredAiRuntime,
  LoadBalanceStrategy,
  type GenerationConfig,
  type GenerateWithAIOptions,
} from '@mahoshojo/hosted-runtime/node-runtime';

import { recordAiChannelOutcome } from '@/lib/ai/availability';
import { config } from '@/lib/config';
import { getLogger } from '@/lib/logger';

const runtime = createNodeStructuredAiRuntime({
  providers: config.PROVIDERS,
  loadBalanceStrategy: config.LOAD_BALANCE_STRATEGY,
  logger: getLogger('ai'),
  recordAiChannelOutcome,
});

export const generateWithAI = runtime.generateWithAI;
export { LoadBalanceStrategy };
export type { GenerationConfig, GenerateWithAIOptions };
