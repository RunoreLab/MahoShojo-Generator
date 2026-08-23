import { z } from 'zod';

import { OpaqueKeySchema } from './primitives';
import { JsonValueSchema } from './json-value';

export const AI_EXECUTION_CONTRACT_VERSION = 1 as const;
export const AiExecutionContractVersionSchema = z.literal(AI_EXECUTION_CONTRACT_VERSION);
export const SUPPORTED_AI_EXECUTION_CONTRACT_VERSION_RANGE: Readonly<{ minInclusive: number; maxInclusive: number; }> = Object.freeze({
  minInclusive: AI_EXECUTION_CONTRACT_VERSION,
  maxInclusive: AI_EXECUTION_CONTRACT_VERSION,
});

export const isSupportedAiExecutionContractVersion = (version: number): boolean =>
  Number.isInteger(version) &&
  version >= SUPPORTED_AI_EXECUTION_CONTRACT_VERSION_RANGE.minInclusive &&
  version <= SUPPORTED_AI_EXECUTION_CONTRACT_VERSION_RANGE.maxInclusive;

export const AiExecutionModeSchema = z.enum(['direct-local', 'direct-remote', 'hosted', 'authoritative']);
export type AiExecutionMode = z.infer<typeof AiExecutionModeSchema>;

const isNonBlankText = z
  .string()
  .superRefine((value, context) => {
    if (value.trim().length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'must not be empty or blank',
      });
    }
  });

export const AiExecutionMessageRoleSchema = z.enum(['system', 'user', 'assistant']);
export type AiExecutionMessageRole = z.infer<typeof AiExecutionMessageRoleSchema>;

export const AiExecutionMessageSchema = z.object({
  role: AiExecutionMessageRoleSchema,
  content: isNonBlankText,
}).strict();
export type AiExecutionMessage = z.infer<typeof AiExecutionMessageSchema>;

export const AiExecutionThinkingModeSchema = z.enum(['default', 'disabled', 'enabled']);
export const AiExecutionThinkingEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
export const AiExecutionThinkingSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('default') }).strict(),
  z.object({ mode: z.literal('disabled') }).strict(),
  z.object({ mode: z.literal('enabled'), effort: AiExecutionThinkingEffortSchema.optional() }).strict(),
]);
export type AiExecutionThinking = z.infer<typeof AiExecutionThinkingSchema>;

export const AiExecutionRequestSchema = z.object({
  requestId: OpaqueKeySchema,
  contractVersion: AiExecutionContractVersionSchema,
  mode: AiExecutionModeSchema,
  messages: z.array(AiExecutionMessageSchema).min(1),
  modelId: z.string().superRefine((value, context) => {
    if (value.trim().length === 0) {
      context.addIssue({ code: 'custom', message: 'modelId must be non-blank' });
    }
  }).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  temperature: z.number().finite().min(0).optional(),
  thinking: AiExecutionThinkingSchema.optional(),
  responseFormat: z.enum(['text', 'json']).optional(),
}).strict();
export type AiExecutionRequest = z.infer<typeof AiExecutionRequestSchema>;

export const AiExecutionFinishReasonSchema = z.enum(['stop', 'length', 'content-filter', 'tool-calls', 'other']);
export type AiExecutionFinishReason = z.infer<typeof AiExecutionFinishReasonSchema>;

export const AiExecutionErrorCodeSchema = z.enum([
  'invalid-request',
  'unsupported-model',
  'authentication-failed',
  'permission-denied',
  'rate-limited',
  'timeout',
  'service-unavailable',
  'content-filtered',
  'invalid-response',
  'output-too-large',
  'internal-error',
]);
export type AiExecutionErrorCode = z.infer<typeof AiExecutionErrorCodeSchema>;

export const AiExecutionErrorSchema = z.object({
  code: AiExecutionErrorCodeSchema,
  message: isNonBlankText.optional(),
  retryable: z.boolean().optional(),
  retryAfterMs: z.number().int().nonnegative().optional(),
}).strict();
export type AiExecutionError = z.infer<typeof AiExecutionErrorSchema>;

export const AiExecutionUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  })
  .strict();
export type AiExecutionUsage = z.infer<typeof AiExecutionUsageSchema>;

export const AiExecutionOutputSchema = z
  .object({
    text: isNonBlankText.optional(),
    structured: JsonValueSchema.optional(),
    reasoning: isNonBlankText.optional(),
  })
  .strict()
  .superRefine((output, context) => {
    if (output.text === undefined && output.structured === undefined) {
      context.addIssue({ code: 'custom', message: 'completed result requires either text or structured output' });
    }
  });
export type AiExecutionOutput = z.infer<typeof AiExecutionOutputSchema>;

export const AiExecutionCompletedResultSchema = z
  .object({
    status: z.literal('completed'),
    requestId: OpaqueKeySchema,
    contractVersion: AiExecutionContractVersionSchema,
    mode: AiExecutionModeSchema,
    output: AiExecutionOutputSchema,
    finishReason: AiExecutionFinishReasonSchema,
    resolvedModelId: z.string().superRefine((value, context) => {
      if (value.trim().length === 0) {
        context.addIssue({ code: 'custom', message: 'resolvedModelId must be non-blank' });
      }
    }).optional(),
    usage: AiExecutionUsageSchema.optional(),
  })
  .strict();
export type AiExecutionCompletedResult = z.infer<typeof AiExecutionCompletedResultSchema>;

export const AiExecutionFailedResultSchema = z.object({
  status: z.literal('failed'),
  requestId: OpaqueKeySchema,
  contractVersion: AiExecutionContractVersionSchema,
  mode: AiExecutionModeSchema,
  error: AiExecutionErrorSchema,
}).strict();
export type AiExecutionFailedResult = z.infer<typeof AiExecutionFailedResultSchema>;

export const AiExecutionCancelledResultSchema = z.object({
  status: z.literal('cancelled'),
  requestId: OpaqueKeySchema,
  contractVersion: AiExecutionContractVersionSchema,
  mode: AiExecutionModeSchema,
  reason: isNonBlankText.optional(),
}).strict();
export type AiExecutionCancelledResult = z.infer<typeof AiExecutionCancelledResultSchema>;

export const AiExecutionResultSchema = z.discriminatedUnion('status', [
  AiExecutionCompletedResultSchema,
  AiExecutionFailedResultSchema,
  AiExecutionCancelledResultSchema,
]);
export type AiExecutionResult = z.infer<typeof AiExecutionResultSchema>;
