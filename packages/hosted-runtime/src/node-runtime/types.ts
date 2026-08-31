import type { z } from 'zod/v3';

import type {
  GenerationSettingsContext,
  UserGenerationOverrides,
} from './generation-settings/types';
import type { NodeAiLogger } from './logger';
import type { OutcomeClassification } from './outcome-classification';
import type { StreamReadTimeoutMode } from './stream-timeout';

export type AIReasoningStatus = 'idle' | 'thinking' | 'done' | 'unavailable' | 'error';
export type AIReasoningSource = 'sdk' | 'provider' | 'heuristic' | 'unknown';

export interface AIReasoningPart {
  id?: string;
  text: string;
  source?: AIReasoningSource;
  createdAt?: string;
}

export interface AIReasoningEnvelope {
  status: AIReasoningStatus;
  source: AIReasoningSource;
  summary?: string | null;
  text?: string | null;
  parts?: AIReasoningPart[];
  reasoningTokens?: number | null;
  anomalyFlags?: string[] | null;
  errorMessage?: string | null;
}

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
