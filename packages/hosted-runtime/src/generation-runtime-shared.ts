import type { z } from 'zod/v3';

import type { CustomProviderRuntimeOptions } from './custom-provider-runtime';

export {
  formatReferenceAttachmentsForPrompt,
} from '@mahoshojo/ai-core/reference-attachments';
export {
  buildScenarioCorePrinciples,
  buildScenarioMarkdownRequirements,
} from '@mahoshojo/ai-core/scenario-generation';

export type GenerationAiTelemetry = {
  providerName?: string;
  providerType?: 'openai' | 'google' | 'deepseek';
  providerBaseUrl?: string;
  model?: string;
  providerIndex?: number;
  attempt?: number;
  usage?: unknown;
  finishReason?: unknown;
  reasoning?: unknown;
};

export type StructuredGenerationConfig<Output, Input> = {
  systemPrompt: string;
  temperature: number;
  promptBuilder(_input: Input): string;
  schema: z.ZodType<Output>;
  taskName: string;
  modelOverride?: string;
  generationSettingsContext?: CustomProviderRuntimeOptions['generationSettingsContext'];
};

export type RawGenerationConfig = {
  prompt: string;
  temperature: number;
  modelOverride?: string;
  generationSettingsContext?: CustomProviderRuntimeOptions['generationSettingsContext'];
};

export type ReasoningStreamEvent =
  | { type: 'reasoning-start'; id?: string }
  | { type: 'reasoning-delta'; id?: string; text: string }
  | { type: 'reasoning-end'; id?: string };

export type StreamGenerationResult = {
  response: Response;
  usagePromise?: Promise<unknown>;
  finishReasonPromise?: Promise<unknown>;
  telemetry?: GenerationAiTelemetry;
};

export type StreamAiOptions = CustomProviderRuntimeOptions & {
  abortSignal: AbortSignal;
  telemetry: GenerationAiTelemetry;
  onReasoningEvent?: (_event: ReasoningStreamEvent) => void;
};

export type ReasoningSseBridge = {
  onReasoningEvent(_event: ReasoningStreamEvent): void;
  toResponse(
    _response: Response,
    _options: {
      usagePromise?: Promise<unknown>;
      aiModel: string | null;
    },
  ): Response;
};
