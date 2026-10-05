import type { z } from 'zod/v3';

import type {
  GenerationSettingsContext,
  UserGenerationOverrides,
} from './generation-settings/types';
import type { NodeAiLogger } from './logger';
import type { OutcomeClassification } from './outcome-classification';
import type { StreamReadTimeoutMode } from './stream-timeout';

// canonical 定义在 @mahoshojo/contracts/ai-reasoning；此处 re-export 保持内部
// `node-runtime/types` 消费面不变。
export type {
  AIReasoningEnvelope,
  AIReasoningPart,
  AIReasoningSource,
  AIReasoningStatus,
} from '@mahoshojo/contracts/ai-reasoning';

import type { AIReasoningEnvelope } from '@mahoshojo/contracts/ai-reasoning';

export interface AIProvider {
  name: string;
  apiKey: string;
  allowAnonymous?: boolean;
  baseUrl: string;
  model: string | string[];
  type: 'openai' | 'google' | 'deepseek';
  retryCount?: number;
  skipProbability?: number;
  mode?: 'json' | 'auto' | 'tool';
  weight?: number;
  defaultMaxOutputTokens?: number;
  providerId?: string;
  generationOverrides?: UserGenerationOverrides;
}

export const LoadBalanceStrategy = Object.freeze({
  SEQUENTIAL: 'sequential',
  RANDOM: 'random',
  ROUND_ROBIN: 'round_robin',
  CUSTOM: 'custom',
} as const);

export type LoadBalanceStrategy = typeof LoadBalanceStrategy[keyof typeof LoadBalanceStrategy];

export type AiChannelContext = {
  providerId: string;
  modelId: string;
};

export type AiTelemetry = {
  providerName?: string;
  providerType?: AIProvider['type'];
  providerBaseUrl?: string;
  model?: string;
  providerIndex?: number;
  attempt?: number;
  usage?: unknown;
  finishReason?: unknown;
  streamCompletion?: Record<string, unknown>;
  reasoning?: AIReasoningEnvelope | null;
};

export interface GenerationConfig<T, I = string> {
  systemPrompt: string;
  temperature?: number;
  promptBuilder(_input: I): string;
  schema: z.ZodSchema<T>;
  taskName: string;
  maxOutputTokens?: number;
  modelOverride?: string;
  generationOverrides?: UserGenerationOverrides;
  generationSettingsContext?: GenerationSettingsContext;
}

export interface RawGenerationConfig {
  prompt: string;
  /** Sent as a real system message when present, ahead of the single user turn. */
  systemPrompt?: string;
  temperature?: number;
  maxOutputTokens?: number;
  modelOverride?: string;
  generationOverrides?: UserGenerationOverrides;
  generationSettingsContext?: GenerationSettingsContext;
}

export type RawReasoningStreamEvent =
  | { type: 'reasoning-start'; id?: string }
  | { type: 'reasoning-delta'; id?: string; text: string }
  | { type: 'reasoning-end'; id?: string };

export interface GenerateWithAIOptions {
  loadBalanceStrategy?: LoadBalanceStrategy;
  providerOverride?: AIProvider;
  abortSignal?: AbortSignal;
  streamReadTimeoutMode?: StreamReadTimeoutMode;
  telemetry?: AiTelemetry;
  onReasoningEvent?(_event: RawReasoningStreamEvent): void | Promise<void>;
  channelContext?: AiChannelContext;
  generationSettingsContext?: GenerationSettingsContext;
}

export type RecordAiChannelOutcome = (
  _input: AiChannelContext & OutcomeClassification,
) => void | Promise<void>;

export type NodeAiRuntimeDependencies = {
  providers: readonly AIProvider[];
  loadBalanceStrategy?: LoadBalanceStrategy | string;
  logger?: NodeAiLogger;
  recordAiChannelOutcome?: RecordAiChannelOutcome;
  fetch?: typeof fetch;
  streamReadIdleTimeoutMs?: number;
  streamReadTotalTimeoutMs?: number;
};
