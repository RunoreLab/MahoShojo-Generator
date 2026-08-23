import type { AiExecutionRequest, AiExecutionResult } from '@mahoshojo/contracts/ai-execution';

import {
  AI_STREAM_MAX_DELTA_CHARS,
  AiStreamEventSchema,
  AiStreamProtocolError,
  collectAiStreamResult,
} from '../src/stream-events';

const request: AiExecutionRequest = {
  requestId: 'request-1',
  contractVersion: 1,
  mode: 'direct-local',
  messages: [{ role: 'user', content: 'hello' }],
};

const completed: AiExecutionResult = {
  status: 'completed',
  requestId: request.requestId,
  contractVersion: request.contractVersion,
  mode: request.mode,
  output: { text: 'done' },
  finishReason: 'stop',
};

const validEvents = [
  { type: 'started', requestId: 'request-1', contractVersion: 1, mode: 'direct-local', sequence: 0 },
  { type: 'text-delta', requestId: 'request-1', contractVersion: 1, mode: 'direct-local', sequence: 1, delta: 'done' },
  { type: 'reasoning-delta', requestId: 'request-1', contractVersion: 1, mode: 'direct-local', sequence: 2, delta: 'reason' },
  { type: 'usage', requestId: 'request-1', contractVersion: 1, mode: 'direct-local', sequence: 3, usage: { outputTokens: 1 } },
  { type: 'result', requestId: 'request-1', contractVersion: 1, mode: 'direct-local', sequence: 4, result: completed },
] as const;

describe('AiStreamEvent v1', () => {
  it('accepts the normalized strict event set', () => {
    for (const event of validEvents) {
      expect(AiStreamEventSchema.parse(event)).toEqual(event);
    }

    expect(AiStreamEventSchema.safeParse({ ...validEvents[1], delta: '' }).success).toBe(false);
    expect(AiStreamEventSchema.safeParse({
      ...validEvents[1],
      delta: 'x'.repeat(AI_STREAM_MAX_DELTA_CHARS + 1),
    }).success).toBe(false);
    expect(AiStreamEventSchema.safeParse({ ...validEvents[1], credential: 'secret' }).success).toBe(false);
    expect(AiStreamEventSchema.safeParse({ ...validEvents[1], contractVersion: 2 }).success).toBe(false);
  });

  it('rejects a terminal result whose identity differs from the event', () => {
    expect(AiStreamEventSchema.safeParse({
      ...validEvents[4],
      result: { ...completed, requestId: 'other-request' },
    }).success).toBe(false);
    expect(AiStreamEventSchema.safeParse({
      ...validEvents[4],
      result: { ...completed, mode: 'hosted' },
    }).success).toBe(false);
  });
});

describe('collectAiStreamResult', () => {
  it('returns the unique terminal result for a valid stream', async () => {
    await expect(collectAiStreamResult(request, validEvents)).resolves.toEqual(completed);
  });

  it.each([
    {
      name: 'missing started event',
      events: validEvents.slice(1),
      code: 'missing-started',
    },
    {
      name: 'sequence gap',
      events: validEvents.map((event, index) => index === 2 ? { ...event, sequence: 7 } : event),
      code: 'sequence-mismatch',
    },
    {
      name: 'cross-request event',
      events: validEvents.map((event, index) => index === 1 ? { ...event, requestId: 'request-2' } : event),
      code: 'identity-mismatch',
    },
    {
      name: 'second started event',
      events: [validEvents[0], { ...validEvents[0], sequence: 1 }, { ...validEvents[4], sequence: 2 }],
      code: 'unexpected-started',
    },
    {
      name: 'event after terminal',
      events: [...validEvents, { ...validEvents[1], sequence: 5 }],
      code: 'event-after-terminal',
    },
    {
      name: 'missing terminal',
      events: validEvents.slice(0, -1),
      code: 'missing-terminal',
    },
  ])('rejects $name', async ({ events, code }) => {
    try {
      await collectAiStreamResult(request, events);
      throw new Error('expected stream protocol rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AiStreamProtocolError);
      expect((error as AiStreamProtocolError).code).toBe(code);
    }
  });

  it('sanitizes an upstream iterator failure', async () => {
    async function* failedSource() {
      yield validEvents[0];
      throw new Error('SECRET_KEY=upstream-secret');
    }

    try {
      await collectAiStreamResult(request, failedSource());
      throw new Error('expected source failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AiStreamProtocolError);
      expect((error as AiStreamProtocolError).code).toBe('source-failed');
      expect((error as Error).message).not.toContain('SECRET_KEY');
      expect((error as Error).message).not.toContain('upstream-secret');
    }
  });

  it.each([
    {
      name: 'event count',
      limits: { maxEvents: 2 },
      events: validEvents,
    },
    {
      name: 'total delta characters',
      limits: { maxTotalDeltaChars: 3 },
      events: validEvents,
    },
    {
      name: 'terminal text characters',
      limits: { maxResultChars: 3 },
      events: [validEvents[0], { ...validEvents[4], sequence: 1 }],
    },
    {
      name: 'terminal structured nodes',
      limits: { maxStructuredNodes: 2 },
      events: [
        validEvents[0],
        {
          ...validEvents[4],
          sequence: 1,
          result: { ...completed, output: { structured: { a: [1, 2] } } },
        },
      ],
    },
  ])('rejects streams beyond $name limit', async ({ events, limits }) => {
    try {
      await collectAiStreamResult(request, events, { limits });
      throw new Error('expected stream limit rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AiStreamProtocolError);
      expect((error as AiStreamProtocolError).code).toBe('limit-exceeded');
    }
  });
});
