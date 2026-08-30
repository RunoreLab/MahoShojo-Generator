import { z } from 'zod';

import { MAX_GENERATION_BRIDGE_BATCH_BYTES, MAX_STORY_BATCH_BYTES } from './limits';
import { ArenaContractError, ArenaErrorCodeSchema } from './errors';
import { IsoTimestampSchema, OpaqueKeySchema } from './primitives';
import { GENERATION_BRIDGE_VERSION } from './versions';
import {
  decodeRawJson,
  jsonUtf8ByteLength,
  rawUtf8ByteLength,
  type RawWireInput,
  utf8ByteLimitedStringSchema,
} from './wire-size';

export const GenerationBridgeScopeSchema = z
  .object({
    bridgeVersion: z.literal(GENERATION_BRIDGE_VERSION),
    roomId: OpaqueKeySchema,
    generationRequestId: OpaqueKeySchema,
    generationId: OpaqueKeySchema,
    attempt: z.number().int().min(1),
    expiresAt: IsoTimestampSchema,
  })
  .strict();
export type GenerationBridgeScope = z.infer<typeof GenerationBridgeScopeSchema>;

const GenerationBridgeMetadataSchema = {
  ...GenerationBridgeScopeSchema.shape,
  batchSeq: z.number().int().nonnegative(),
};

const StoryDeltaPayloadSchema = z
  .object({
    delta: utf8ByteLimitedStringSchema(MAX_STORY_BATCH_BYTES),
  })
  .strict();

const CompletedPayloadSchema = z
  .object({
    generationRecordId: OpaqueKeySchema,
  })
  .strict();

const FailedPayloadSchema = z
  .object({
    errorCode: ArenaErrorCodeSchema,
  })
  .strict();

export const GenerationBridgeBatchSchema = z.discriminatedUnion('type', [
  z.object({ ...GenerationBridgeMetadataSchema, type: z.literal('story.delta'), payload: StoryDeltaPayloadSchema }).strict(),
  z.object({ ...GenerationBridgeMetadataSchema, type: z.literal('generation.completed'), payload: CompletedPayloadSchema }).strict(),
  z.object({ ...GenerationBridgeMetadataSchema, type: z.literal('generation.failed'), payload: FailedPayloadSchema }).strict(),
]).superRefine((batch, context) => {
  if (jsonUtf8ByteLength(batch) > MAX_GENERATION_BRIDGE_BATCH_BYTES) {
    context.addIssue({ code: 'custom', path: [], message: 'payload-too-large' });
  }
});
export type GenerationBridgeBatch = z.infer<typeof GenerationBridgeBatchSchema>;

/**
 * Parses a canonical serialized object. It cannot account for bytes discarded
 * by a prior JSON decoder; use parseGenerationBridgeBatchFrame for raw input.
 */
export const parseGenerationBridgeBatch = (input: unknown): GenerationBridgeBatch => {
  if (jsonUtf8ByteLength(input) > MAX_GENERATION_BRIDGE_BATCH_BYTES) {
    throw new ArenaContractError('payload-too-large');
  }
  try {
    return GenerationBridgeBatchSchema.parse(input);
  } catch (error) {
    throw new ArenaContractError('validation-failed', 'invalid Generation Bridge batch', undefined, error);
  }
};

/** Parses a raw JSON Generation Bridge batch before JSON normalization. */
export const parseGenerationBridgeBatchFrame = (input: RawWireInput): GenerationBridgeBatch => {
  if (rawUtf8ByteLength(input) > MAX_GENERATION_BRIDGE_BATCH_BYTES) {
    throw new ArenaContractError('payload-too-large');
  }
  return parseGenerationBridgeBatch(decodeRawJson(input));
};

export const GenerationBridgeReplayClassificationSchema = z.enum([
  'scope-mismatch',
  'next',
  'idempotent-replay',
  'conflicting-replay',
  'stale',
  'out-of-order',
]);
export type GenerationBridgeReplayClassification = z.infer<typeof GenerationBridgeReplayClassificationSchema>;

const sameBridgeScope = (previous: GenerationBridgeBatch, next: GenerationBridgeBatch): boolean =>
  previous.bridgeVersion === next.bridgeVersion &&
  previous.roomId === next.roomId &&
  previous.generationRequestId === next.generationRequestId &&
  previous.generationId === next.generationId &&
  previous.attempt === next.attempt &&
  previous.expiresAt === next.expiresAt;

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

/** Classifies replay and ordering using the complete canonical batch, not a digest field. */
export const classifyGenerationBridgeBatchReplay = (
  previous: GenerationBridgeBatch,
  next: GenerationBridgeBatch,
): GenerationBridgeReplayClassification => {
  if (!sameBridgeScope(previous, next)) return 'scope-mismatch';
  if (next.batchSeq === previous.batchSeq) {
    return canonicalJson(previous) === canonicalJson(next) ? 'idempotent-replay' : 'conflicting-replay';
  }
  if (next.batchSeq === previous.batchSeq + 1) return 'next';
  if (next.batchSeq < previous.batchSeq) return 'stale';
  return 'out-of-order';
};

/** @deprecated Use classifyGenerationBridgeBatchReplay for explicit replay semantics. */
export const isGenerationBridgeBatchSequenceMonotonic = (
  previous: Pick<GenerationBridgeBatch, 'bridgeVersion' | 'roomId' | 'generationRequestId' | 'generationId' | 'attempt' | 'expiresAt' | 'batchSeq'>,
  next: Pick<GenerationBridgeBatch, 'bridgeVersion' | 'roomId' | 'generationRequestId' | 'generationId' | 'attempt' | 'expiresAt' | 'batchSeq'>,
): boolean => {
  if (previous.batchSeq + 1 !== next.batchSeq) return false;
  return previous.bridgeVersion === next.bridgeVersion &&
    previous.roomId === next.roomId &&
    previous.generationRequestId === next.generationRequestId &&
    previous.generationId === next.generationId &&
    previous.attempt === next.attempt &&
    previous.expiresAt === next.expiresAt;
};
