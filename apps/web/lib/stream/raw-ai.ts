import {
  buildStreamTextAbortOptions,
  classifyStreamRuntimeOutcome,
  createNodeRawStreamAiRuntime,
  LoadBalanceStrategy,
  type GenerateWithAIOptions,
  type RawGenerationConfig,
  type RawReasoningStreamEvent,
} from '@mahoshojo/hosted-runtime/node-runtime';

import { recordAiChannelOutcome } from '@/lib/ai/availability';
import { config } from '@/lib/config';
import { getLogger } from '@/lib/logger';

const runtime = createNodeRawStreamAiRuntime({
  providers: config.PROVIDERS,
  loadBalanceStrategy: config.LOAD_BALANCE_STRATEGY,
  logger: getLogger('ai'),
  recordAiChannelOutcome,
});

export const generateWithStreamAI = runtime.generateWithStreamAI;
export {
  buildStreamTextAbortOptions,
  classifyStreamRuntimeOutcome,
  LoadBalanceStrategy,
};
export type {
  GenerateWithAIOptions,
  RawGenerationConfig,
  RawReasoningStreamEvent,
};
