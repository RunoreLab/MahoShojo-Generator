import {
  AI_EXECUTION_CONTRACT_VERSION,
  AiExecutionContractVersionSchema,
  AiExecutionCancelledResultSchema,
  AiExecutionCompletedResultSchema,
  AiExecutionErrorCodeSchema,
  AiExecutionErrorSchema,
  AiExecutionMessageSchema,
  AiExecutionModeSchema,
  AiExecutionOutputSchema,
  AiExecutionRequestSchema,
  AiExecutionResultSchema,
  AiExecutionUsageSchema,
  isSupportedAiExecutionContractVersion,
  type AiExecutionErrorCode,
  type AiExecutionRequest as AiExecutionRequestFromSubpath,
} from '@mahoshojo/contracts/ai-execution';
import {
  AiExecutionCancelledResultSchema as RootAiExecutionCancelledResultSchema,
  AiExecutionCompletedResultSchema as RootAiExecutionCompletedResultSchema,
  AiExecutionContractVersionSchema as RootAiExecutionContractVersionSchema,
  AiExecutionErrorCodeSchema as RootAiExecutionErrorCodeSchema,
  AiExecutionErrorSchema as RootAiExecutionErrorSchema,
  AiExecutionMessageSchema as RootAiExecutionMessageSchema,
  AiExecutionModeSchema as RootAiExecutionModeSchema,
  AiExecutionOutputSchema as RootAiExecutionOutputSchema,
  AiExecutionRequestSchema as RootAiExecutionRequestSchema,
  AiExecutionResultSchema as RootAiExecutionResultSchema,
  AiExecutionUsageSchema as RootAiExecutionUsageSchema,
  isSupportedAiExecutionContractVersion as RootIsSupportedAiExecutionContractVersion,
  type AiExecutionRequest as RootAiExecutionRequest,
} from '@mahoshojo/contracts';

describe('AI execution request contract', () => {
  type SensitiveKeys = 'providerProfileId' | 'baseUrl' | 'apiKey' | 'headers' | 'cookie' | 'authkey' | 'activityToken';
  type EnsureNoSensitiveRequestKeys = Extract<SensitiveKeys, keyof AiExecutionRequestFromSubpath>;
  type EnsureNoRootSensitiveRequestKeys = Extract<SensitiveKeys, keyof RootAiExecutionRequest>;
  type AssertNoSensitiveRequestKeys = EnsureNoSensitiveRequestKeys extends never ? true : never;
  type AssertNoRootSensitiveRequestKeys = EnsureNoRootSensitiveRequestKeys extends never ? true : never;

  const expectType = <T extends true>(value: T) => value;
  void expectType<AssertNoSensitiveRequestKeys>(true);
  void expectType<AssertNoRootSensitiveRequestKeys>(true);

  it('requires strict request fields and excludes provider secrets', () => {
    expect(AiExecutionRequestSchema.parse({
      requestId: 'request-1',
      contractVersion: 1,
      mode: 'direct-local',
      modelId: 'gpt-4',
      maxOutputTokens: 32,
      temperature: 0.5,
      thinking: { mode: 'enabled', effort: 'minimal' },
      responseFormat: 'json',
      messages: [
        { role: 'system', content: 'you are a parser' },
        { role: 'assistant', content: 'ok' },
      ],
    })).toMatchObject({
      contractVersion: 1,
      mode: 'direct-local',
      thinking: { mode: 'enabled', effort: 'minimal' },
      responseFormat: 'json',
    });

    expect(() => AiExecutionRequestSchema.parse({
      requestId: 'request-1',
      contractVersion: 1,
      mode: 'hosted',
      messages: [{ role: 'system', content: 'Hello' }],
      providerProfileId: 'p1',
    })).toThrow();

    for (const field of ['providerProfileId', 'baseUrl', 'apiKey', 'headers', 'cookie', 'authkey', 'activityToken']) {
      expect(() => AiExecutionRequestSchema.parse({
        requestId: 'request-1',
        contractVersion: 1,
        mode: 'hosted',
        messages: [{ role: 'system', content: 'Hello' }],
        [field]: 'secret',
      } as never)).toThrow();
    }
  });

  it('requires contract metadata required and preserves raw text', () => {
    expect(AiExecutionRequestSchema.parse({
      requestId: 'request-1',
      contractVersion: 1,
      mode: 'hosted',
      messages: [{ role: 'system', content: '  hello  ' }],
    }).messages[0].content).toBe('  hello  ');

    expect(AiExecutionRequestSchema.safeParse({
      contractVersion: 1,
      mode: 'hosted',
      messages: [{ role: 'system', content: 'Hello' }],
    }).success).toBe(false);

    expect(AiExecutionRequestSchema.safeParse({
      requestId: 'request-1',
      contractVersion: 1,
      mode: 'hosted',
      messages: [{ role: 'system', content: '   ' }],
    }).success).toBe(false);
  });

  it('supports normalized thinking config and forbids disabled+effort', () => {
    expect(AiExecutionRequestSchema.parse({
      requestId: 'request-1',
      contractVersion: 1,
      mode: 'hosted',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { mode: 'disabled' },
    })).toMatchObject({ thinking: { mode: 'disabled' } });

    expect(() => AiExecutionRequestSchema.parse({
      requestId: 'request-1',
      contractVersion: 1,
      mode: 'hosted',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { mode: 'disabled', effort: 'low' } as never,
    })).toThrow();

    expect(AiExecutionRequestSchema.parse({
      requestId: 'request-1',
      contractVersion: 1,
      mode: 'hosted',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { mode: 'default' },
    })).toMatchObject({ thinking: { mode: 'default' } });

    expect(AiExecutionModeSchema.safeParse('bad').success).toBe(false);
  });

  it('validates message role/content shape', () => {
    expect(AiExecutionMessageSchema.safeParse({ role: 'assistant', content: 'done' }).success).toBe(true);
    expect(AiExecutionMessageSchema.safeParse({ role: 'tool', content: 'bad' }).success).toBe(false);
    expect(AiExecutionMessageSchema.safeParse({ role: 'user', content: '   ' }).success).toBe(false);
    expect(AiExecutionMessageSchema.safeParse({ role: 'user', content: '' }).success).toBe(false);
    expect(AiExecutionMessageSchema.safeParse({ role: 'user', content: '  x ' }).success).toBe(true);
  });

  it('re-exports version schema and helpers', () => {
    expect(AiExecutionContractVersionSchema.parse(1)).toBe(1);
    expect(RootAiExecutionContractVersionSchema).toBe(AiExecutionContractVersionSchema);
    expect(isSupportedAiExecutionContractVersion(1)).toBe(true);
    expect(isSupportedAiExecutionContractVersion(0)).toBe(false);
    expect(isSupportedAiExecutionContractVersion(2)).toBe(false);
    expect(RootIsSupportedAiExecutionContractVersion(1)).toBe(true);
    expect(RootAiExecutionModeSchema).toBe(AiExecutionModeSchema);
    expect(RootAiExecutionRequestSchema).toBe(AiExecutionRequestSchema);
    expect(AI_EXECUTION_CONTRACT_VERSION).toBe(1);
  });
});

describe('AI execution result contract', () => {
  it('requires contract version/requestId/mode and completion output guard', () => {
    const base = {
      requestId: 'request-1',
      contractVersion: 1,
      mode: 'hosted',
    } as const;

    expect(AiExecutionCompletedResultSchema.parse({
      status: 'completed',
      ...base,
      output: { text: 'text result' },
      finishReason: 'stop',
    })).toMatchObject({ status: 'completed', requestId: 'request-1', mode: 'hosted' });

    expect(AiExecutionCompletedResultSchema.parse({
      status: 'completed',
      ...base,
      output: { structured: { key: 'value', list: [1, 2, true] } },
      finishReason: 'length',
    })).toMatchObject({ status: 'completed', requestId: 'request-1', mode: 'hosted' });

    expect(() => AiExecutionCompletedResultSchema.parse({
      status: 'completed',
      ...base,
      output: { reasoning: 'notes only' },
      finishReason: 'stop',
    })).toThrow();

    expect(AiExecutionCompletedResultSchema.parse({
      status: 'completed',
      ...base,
      output: { text: 'ok', structured: undefined as never },
      finishReason: 'stop',
    })).toMatchObject({ status: 'completed', requestId: 'request-1', mode: 'hosted' });

    expect(() => AiExecutionCompletedResultSchema.parse({
      status: 'completed',
      requestId: 'request-1',
      contractVersion: 1,
      output: { text: 'ok' },
      finishReason: 'stop',
    })).toThrow();

    expect(AiExecutionCompletedResultSchema.parse({
      status: 'completed',
      ...base,
      output: { reasoning: '  reason  ', text: 'ok' },
      finishReason: 'other',
      usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 1 },
    })).toMatchObject({ status: 'completed' });
  });

  it('supports finish reason normalization', () => {
    for (const finishReason of ['stop', 'length', 'content-filter', 'tool-calls', 'other'] as const) {
      expect(AiExecutionCompletedResultSchema.parse({
        status: 'completed',
        requestId: 'request-1',
        contractVersion: 1,
        mode: 'hosted',
        output: { text: 'ok' },
        finishReason,
      }).finishReason).toBe(finishReason);
    }
    expect(() => AiExecutionCompletedResultSchema.parse({
      status: 'completed',
      requestId: 'request-1',
      contractVersion: 1,
      mode: 'hosted',
      output: { text: 'ok' },
      finishReason: 'completed',
    })).toThrow();
  });

  it('keeps failed/cancelled variants to safe payloads and required fields', () => {
    const stableCode: AiExecutionErrorCode = 'invalid-request';
    expect(AiExecutionErrorCodeSchema.safeParse(stableCode).success).toBe(true);
    expect(AiExecutionErrorCodeSchema.options).toEqual([
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

    expect(AiExecutionErrorSchema.parse({
      code: 'invalid-request',
      message: 'bad',
      retryable: true,
      retryAfterMs: 120,
    })).toMatchObject({
      code: 'invalid-request',
      retryable: true,
      retryAfterMs: 120,
    });

    expect(() => AiExecutionErrorSchema.parse({
      code: 'invalid-request',
      message: 'bad',
      cause: 'x',
    })).toThrow();

    expect(() => AiExecutionErrorSchema.parse({
      code: 'invalid-request',
      message: 'bad',
      stack: 'server',
    })).toThrow();

    expect(() => AiExecutionErrorSchema.parse({
      code: 'invalid-request',
      message: 'bad',
      rawUpstream: 'abc',
    })).toThrow();

    expect(() => AiExecutionErrorSchema.parse({
      code: 'invalid-request',
      message: 'bad',
      credential: 'x',
    })).toThrow();

    expect(AiExecutionResultSchema.parse({
      status: 'failed',
      requestId: 'request-1',
      contractVersion: 1,
      mode: 'direct-remote',
      error: { code: 'invalid-response', message: 'oops' },
    })).toMatchObject({ status: 'failed', requestId: 'request-1', mode: 'direct-remote' });

    expect(AiExecutionResultSchema.parse({
      status: 'cancelled',
      requestId: 'request-1',
      contractVersion: 1,
      mode: 'hosted',
      reason: 'cancel',
    })).toMatchObject({ status: 'cancelled' });

    expect(() => AiExecutionResultSchema.parse({
      status: 'cancelled',
      contractVersion: 1,
      mode: 'hosted',
      reason: 'cancel',
    })).toThrow();
  });

  it('exports output usage schemas from package root', () => {
    expect(RootAiExecutionOutputSchema).toBe(AiExecutionOutputSchema);
    expect(RootAiExecutionUsageSchema).toBe(AiExecutionUsageSchema);
    expect(RootAiExecutionCompletedResultSchema).toBe(AiExecutionCompletedResultSchema);
    expect(RootAiExecutionCancelledResultSchema).toBe(AiExecutionCancelledResultSchema);
    expect(RootAiExecutionErrorSchema).toBe(AiExecutionErrorSchema);
    expect(RootAiExecutionErrorCodeSchema).toBe(AiExecutionErrorCodeSchema);
    expect(RootAiExecutionResultSchema).toBe(AiExecutionResultSchema);
    expect(RootAiExecutionMessageSchema).toBe(AiExecutionMessageSchema);
  });
});
