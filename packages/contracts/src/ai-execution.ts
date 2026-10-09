import { z } from './zod';

import { OpaqueKeySchema } from './primitives';
import { SafeJsonValueSchema } from './json-value';
import { jsonUtf8ByteLength } from './wire-size';
import { ARENA_CANONICAL_CAPABILITIES, ARENA_CANONICAL_RESOURCE_LIMITS } from './arena-capabilities';

export const MAX_AI_EXECUTION_RESULT_BYTES = 1_000_000;

/** Fixed policy selection, never a renderer-supplied numeric budget. */
export const ARENA_AI_WIRE_METADATA_BYTES = 16 * 1024;
export const ARENA_AI_MAX_WIRE_BYTES = ARENA_CANONICAL_RESOURCE_LIMITS.outputContentBytes * 6 + ARENA_AI_WIRE_METADATA_BYTES;
export const aiOutputContentBytes = (output: { text?: string; reasoning?: string }): number =>
  new TextEncoder().encode(output.text ?? '').byteLength + new TextEncoder().encode(output.reasoning ?? '').byteLength;

/** Resource evidence only: it does not prove messages/source equivalence or grant authority. */
export const validateArenaAiInputJson = (value: string): boolean => {
  if (new TextEncoder().encode(value).byteLength > ARENA_CANONICAL_RESOURCE_LIMITS.requestBodyBytes) return false;
  try {
    const input = JSON.parse(value) as Record<string, unknown>;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
    const mode = input.mode as keyof typeof ARENA_CANONICAL_CAPABILITIES.minCombatantsByMode;
    if (typeof mode !== 'string' || !Object.prototype.hasOwnProperty.call(ARENA_CANONICAL_CAPABILITIES.minCombatantsByMode, mode)) return false;
    if (!Array.isArray(input.combatants)
      || input.combatants.length < ARENA_CANONICAL_CAPABILITIES.minCombatantsByMode[mode]
      || input.combatants.length > ARENA_CANONICAL_CAPABILITIES.maxCombatants) return false;
    if (mode === 'scenario' && (!input.scenario || typeof input.scenario !== 'object' || Array.isArray(input.scenario))) return false;
    let references = 0;
    for (const key of ['auxScenarios', 'materials', 'questionnaires', 'narrativeHistory']) {
      if (input[key] !== undefined && !Array.isArray(input[key])) return false;
      references += Array.isArray(input[key]) ? input[key].length : 0;
    }
    return references <= ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity
      && (input.adjudicationEvents === undefined || Array.isArray(input.adjudicationEvents)
        && input.adjudicationEvents.length <= ARENA_CANONICAL_RESOURCE_LIMITS.maxAdjudicationEvents);
  } catch { return false; }
};

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
  requestKind: z.literal('arena').optional(),
  arenaInputJson: z.string().optional(),
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
}).strict().superRefine((request, context) => {
  if (request.requestKind === 'arena') {
    if ((request.mode !== 'direct-local' && request.mode !== 'direct-remote')
      || request.arenaInputJson === undefined || !validateArenaAiInputJson(request.arenaInputJson)) {
      context.addIssue({ code: 'custom', message: 'invalid Arena Direct resource evidence' });
    }
  } else if (request.arenaInputJson !== undefined) {
    context.addIssue({ code: 'custom', message: 'Arena resource evidence requires the fixed arena kind' });
  }
});
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
    structured: SafeJsonValueSchema.optional(),
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

const AiExecutionResultShapeSchema = z
  .discriminatedUnion('status', [
    AiExecutionCompletedResultSchema,
    AiExecutionFailedResultSchema,
    AiExecutionCancelledResultSchema,
  ]);

export const AiExecutionResultSchema = AiExecutionResultShapeSchema
  .superRefine((result, context) => {
    if (jsonUtf8ByteLength(result) > MAX_AI_EXECUTION_RESULT_BYTES) {
      context.addIssue({
        code: 'too_big',
        maximum: MAX_AI_EXECUTION_RESULT_BYTES,
        origin: 'value',
        inclusive: true,
        message: `execution result must not exceed ${MAX_AI_EXECUTION_RESULT_BYTES} UTF-8 bytes`,
      });
    }
  });
export type AiExecutionResult = z.infer<typeof AiExecutionResultSchema>;

/** Arena counts decoded output content, not duplicated/escaped terminal JSON. */
export const ArenaAiExecutionResultSchema = AiExecutionResultShapeSchema.superRefine((result, context) => {
  const fail = () => context.addIssue({ code: 'custom', message: 'Arena execution result exceeds its fixed resource policy' });
  if (result.status === 'completed') {
    if (result.output.structured !== undefined || result.output.text === undefined
      || aiOutputContentBytes(result.output) > ARENA_CANONICAL_RESOURCE_LIMITS.outputContentBytes) fail();
    if (jsonUtf8ByteLength({ ...result, output: {} }) > ARENA_AI_WIRE_METADATA_BYTES) fail();
  } else if (jsonUtf8ByteLength(result) > ARENA_AI_WIRE_METADATA_BYTES) fail();
  if (jsonUtf8ByteLength(result) > ARENA_AI_MAX_WIRE_BYTES) fail();
});

export const aiExecutionResultSchemaForKind = (requestKind?: AiExecutionRequest['requestKind']) =>
  requestKind === 'arena' ? ArenaAiExecutionResultSchema : AiExecutionResultSchema;
