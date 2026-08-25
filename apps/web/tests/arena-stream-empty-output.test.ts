import { describe, expect, test } from 'vitest';

import { buildEmptyStreamOutputErrorPayload } from '@/lib/arena/stream-empty-output';

describe('arena stream empty output diagnostics', () => {
  test('reasoning-only output uses a specific diagnostic instead of generic empty object copy', () => {
    const payload = buildEmptyStreamOutputErrorPayload({
      debug: true,
      outputBytes: 0,
      outputChars: 0,
      markdownCharsSent: 0,
      hasMeaningfulMarkdown: false,
      metaHasImpacts: false,
      inMeta: false,
      pendingMarkdownTailLength: 0,
      metaBufferLength: 0,
      metaFallbackTailLength: 0,
      reasoningCharsSent: 8527,
      hasReasoningStarted: true,
      hasReasoningDelta: true,
      reasoningCompleted: true,
      rawPreview: null,
    });

    expect(payload.errorCode).toBe('ai_reasoning_only_without_markdown');
    expect(payload.error).toContain('只返回了思考过程');
    expect(payload.error).toContain('未返回可展示的战报正文');
    expect(payload.debug?.reasoningCharsSent).toBe(8527);
  });

  test('plain empty output keeps the existing empty object diagnostic', () => {
    const payload = buildEmptyStreamOutputErrorPayload({
      debug: false,
      outputBytes: 0,
      outputChars: 0,
      markdownCharsSent: 0,
      hasMeaningfulMarkdown: false,
      metaHasImpacts: false,
      inMeta: false,
      pendingMarkdownTailLength: 0,
      metaBufferLength: 0,
      metaFallbackTailLength: 0,
      reasoningCharsSent: 0,
      hasReasoningStarted: false,
      hasReasoningDelta: false,
      reasoningCompleted: false,
      rawPreview: null,
    });

    expect(payload.errorCode).toBe('ai_empty_output');
    expect(payload.error).toContain('AI 返回空对象/空内容');
    expect(payload.debug).toBeNull();
  });
});
