import {
  AiExecutionContractVersionSchema,
  AiExecutionModeSchema,
  AiExecutionRequestSchema,
  AiExecutionResultSchema,
  AiExecutionUsageSchema,
  type AiExecutionRequest,
  type AiExecutionResult,
  type AiExecutionUsage,
} from '@mahoshojo/contracts/ai-execution';
import { z } from 'zod';

export const AI_STREAM_MAX_DELTA_CHARS = 65_536;

const eventIdentityShape = {
  requestId: AiExecutionRequestSchema.shape.requestId,
  contractVersion: AiExecutionContractVersionSchema,
  mode: AiExecutionModeSchema,
  sequence: z.number().int().nonnegative(),
};

export const AiStreamStartedEventSchema = z
  .object({
    type: z.literal('started'),
    ...eventIdentityShape,
  })
  .strict();

export const AiStreamTextDeltaEventSchema = z
  .object({
    type: z.literal('text-delta'),
    ...eventIdentityShape,
    delta: z.string().min(1).max(AI_STREAM_MAX_DELTA_CHARS),
  })
  .strict();

export const AiStreamReasoningDeltaEventSchema = z
  .object({
    type: z.literal('reasoning-delta'),
    ...eventIdentityShape,
    delta: z.string().min(1).max(AI_STREAM_MAX_DELTA_CHARS),
  })
  .strict();

export const AiStreamUsageEventSchema = z
  .object({
    type: z.literal('usage'),
    ...eventIdentityShape,
    usage: AiExecutionUsageSchema,
  })
  .strict();

export const AiStreamResultEventSchema = z
  .object({
    type: z.literal('result'),
    ...eventIdentityShape,
    result: AiExecutionResultSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.result.requestId !== event.requestId) {
      context.addIssue({ code: 'custom', path: ['result', 'requestId'], message: 'result request identity must match event' });
    }
    if (event.result.contractVersion !== event.contractVersion) {
      context.addIssue({ code: 'custom', path: ['result', 'contractVersion'], message: 'result contract version must match event' });
    }
    if (event.result.mode !== event.mode) {
      context.addIssue({ code: 'custom', path: ['result', 'mode'], message: 'result mode must match event' });
    }
  });

export const AiStreamEventSchema = z.discriminatedUnion('type', [
  AiStreamStartedEventSchema,
  AiStreamTextDeltaEventSchema,
  AiStreamReasoningDeltaEventSchema,
  AiStreamUsageEventSchema,
  AiStreamResultEventSchema,
]);
export type AiStreamEvent = z.infer<typeof AiStreamEventSchema>;
export type AiStreamStartedEvent = z.infer<typeof AiStreamStartedEventSchema>;
export type AiStreamTextDeltaEvent = z.infer<typeof AiStreamTextDeltaEventSchema>;
export type AiStreamReasoningDeltaEvent = z.infer<typeof AiStreamReasoningDeltaEventSchema>;
export type AiStreamUsageEvent = z.infer<typeof AiStreamUsageEventSchema>;
export type AiStreamResultEvent = z.infer<typeof AiStreamResultEventSchema>;

export const AI_STREAM_PROTOCOL_ERROR_CODES = [
  'invalid-event',
  'source-failed',
  'limit-exceeded',
  'missing-started',
  'unexpected-started',
  'sequence-mismatch',
  'identity-mismatch',
  'event-after-terminal',
  'missing-terminal',
] as const;
export type AiStreamProtocolErrorCode = (typeof AI_STREAM_PROTOCOL_ERROR_CODES)[number];

const protocolErrorMessages: Record<AiStreamProtocolErrorCode, string> = {
  'invalid-event': 'stream event is invalid',
  'source-failed': 'stream source failed',
  'limit-exceeded': 'stream exceeded a safety limit',
  'missing-started': 'stream must begin with a started event',
  'unexpected-started': 'stream contains more than one started event',
  'sequence-mismatch': 'stream event sequence is not continuous',
  'identity-mismatch': 'stream event identity does not match the request',
  'event-after-terminal': 'stream contains an event after its terminal result',
  'missing-terminal': 'stream ended without a terminal result',
};

export class AiStreamProtocolError extends Error {
  readonly code: AiStreamProtocolErrorCode;

  constructor(code: AiStreamProtocolErrorCode) {
    super(protocolErrorMessages[code]);
    this.name = 'AiStreamProtocolError';
    this.code = code;
  }
}

type AiStreamSource = Iterable<unknown> | AsyncIterable<unknown>;
type AiStreamRequestIdentity = Pick<AiExecutionRequest, 'requestId' | 'contractVersion' | 'mode'>;

export type AiStreamLimits = {
  maxEvents: number;
  maxDeltaChars: number;
  maxTotalDeltaChars: number;
  maxResultChars: number;
  maxStructuredNodes: number;
};

export const DEFAULT_AI_STREAM_LIMITS: Readonly<AiStreamLimits> = Object.freeze({
  maxEvents: 100_000,
  maxDeltaChars: AI_STREAM_MAX_DELTA_CHARS,
  maxTotalDeltaChars: 1_000_000,
  maxResultChars: 1_000_000,
  maxStructuredNodes: 10_000,
});

export type CollectAiStreamResultOptions = {
  limits?: Partial<AiStreamLimits>;
};

const resolveAiStreamLimits = (limits?: Partial<AiStreamLimits>): AiStreamLimits => {
  const resolve = (value: unknown, fallback: number): number => (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback
  );

  return {
    maxEvents: resolve(limits?.maxEvents, DEFAULT_AI_STREAM_LIMITS.maxEvents),
    maxDeltaChars: Math.min(
      resolve(limits?.maxDeltaChars, DEFAULT_AI_STREAM_LIMITS.maxDeltaChars),
      AI_STREAM_MAX_DELTA_CHARS,
    ),
    maxTotalDeltaChars: resolve(
      limits?.maxTotalDeltaChars,
      DEFAULT_AI_STREAM_LIMITS.maxTotalDeltaChars,
    ),
    maxResultChars: resolve(limits?.maxResultChars, DEFAULT_AI_STREAM_LIMITS.maxResultChars),
    maxStructuredNodes: resolve(
      limits?.maxStructuredNodes,
      DEFAULT_AI_STREAM_LIMITS.maxStructuredNodes,
    ),
  };
};

const protocolError = (code: AiStreamProtocolErrorCode): AiStreamProtocolError =>
  new AiStreamProtocolError(code);

const parseEvent = (value: unknown): AiStreamEvent => {
  try {
    const parsed = AiStreamEventSchema.safeParse(value);
    if (parsed.success) return parsed.data;
  } catch {
    // Provider values are untrusted. Expose only the stable protocol error.
  }
  throw protocolError('invalid-event');
};

const assertStructuredResultWithinLimits = (
  value: unknown,
  limits: AiStreamLimits,
): number => {
  const pending: unknown[] = [value];
  let nodes = 0;
  let chars = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    nodes += 1;
    if (nodes > limits.maxStructuredNodes) throw protocolError('limit-exceeded');

    if (typeof current === 'string') {
      chars += current.length;
    } else if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) pending.push(current[index]);
    } else if (current !== null && typeof current === 'object') {
      for (const [key, child] of Object.entries(current)) {
        chars += key.length;
        pending.push(child);
      }
    }

    if (chars > limits.maxResultChars) throw protocolError('limit-exceeded');
  }

  return chars;
};

const assertTerminalResultWithinLimits = (
  result: AiExecutionResult,
  limits: AiStreamLimits,
): void => {
  let chars = 0;
  if (result.status === 'completed') {
    chars += result.output.text?.length ?? 0;
    chars += result.output.reasoning?.length ?? 0;
    if (result.output.structured !== undefined) {
      chars += assertStructuredResultWithinLimits(result.output.structured, limits);
    }
  } else if (result.status === 'failed') {
    chars += result.error.message?.length ?? 0;
  } else {
    chars += result.reason?.length ?? 0;
  }
  if (chars > limits.maxResultChars) throw protocolError('limit-exceeded');
};

export const collectAiStreamResult = async (
  request: AiStreamRequestIdentity,
  source: AiStreamSource,
  options: CollectAiStreamResultOptions = {},
): Promise<AiExecutionResult> => {
  const limits = resolveAiStreamLimits(options.limits);
  let expectedSequence = 0;
  let sawEvent = false;
  let terminalResult: AiExecutionResult | undefined;
  let eventCount = 0;
  let totalDeltaChars = 0;

  try {
    for await (const rawEvent of source) {
      eventCount += 1;
      if (eventCount > limits.maxEvents) throw protocolError('limit-exceeded');
      if (terminalResult !== undefined) {
        throw protocolError('event-after-terminal');
      }

      const event = parseEvent(rawEvent);

      if (!sawEvent) {
        sawEvent = true;
        if (event.type !== 'started') {
          throw protocolError('missing-started');
        }
      } else if (event.type === 'started') {
        throw protocolError('unexpected-started');
      }

      if (event.sequence !== expectedSequence) {
        throw protocolError('sequence-mismatch');
      }
      if (
        event.requestId !== request.requestId ||
        event.contractVersion !== request.contractVersion ||
        event.mode !== request.mode
      ) {
        throw protocolError('identity-mismatch');
      }

      if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
        if (event.delta.length > limits.maxDeltaChars) throw protocolError('limit-exceeded');
        totalDeltaChars += event.delta.length;
        if (totalDeltaChars > limits.maxTotalDeltaChars) throw protocolError('limit-exceeded');
      }

      expectedSequence += 1;
      if (event.type === 'result') {
        assertTerminalResultWithinLimits(event.result, limits);
        terminalResult = event.result;
      }
    }
  } catch (error) {
    if (error instanceof AiStreamProtocolError) throw error;
    throw protocolError('source-failed');
  }

  if (!sawEvent) {
    throw protocolError('missing-started');
  }
  if (terminalResult === undefined) {
    throw protocolError('missing-terminal');
  }
  return terminalResult;
};

export type { AiExecutionResult, AiExecutionUsage };
