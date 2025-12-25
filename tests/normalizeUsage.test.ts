import { describe, expect, test } from 'bun:test';

import { normalizeUsage } from '@/lib/arena/battle-report-log-utils';

describe('normalizeUsage', () => {
  test('supports snake_case usage keys', () => {
    const usage = normalizeUsage({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
      reasoning_tokens: 3,
    });
    expect(usage).not.toBeNull();
    expect(usage!.promptTokens).toBe(10);
    expect(usage!.completionTokens).toBe(20);
    expect(usage!.totalTokens).toBe(30);
    expect(usage!.reasoningTokens).toBe(3);
  });

  test('supports nested reasoning tokens details', () => {
    const usage = normalizeUsage({
      promptTokens: 1,
      completionTokens: 2,
      output_tokens_details: { reasoning_tokens: 99 },
    });
    expect(usage).not.toBeNull();
    expect(usage!.reasoningTokens).toBe(99);
  });

  test('maps inputTokens/outputTokens to prompt/completion tokens', () => {
    const usage = normalizeUsage({
      inputTokens: 123,
      outputTokens: 456,
      reasoningTokens: 7,
    });
    expect(usage).not.toBeNull();
    expect(usage!.promptTokens).toBe(123);
    expect(usage!.completionTokens).toBe(456);
    expect(usage!.reasoningTokens).toBe(7);
  });

  test('returns null when no usable token fields exist', () => {
    expect(normalizeUsage({})).toBeNull();
    expect(normalizeUsage({ usage: {} })).toBeNull();
  });
});

