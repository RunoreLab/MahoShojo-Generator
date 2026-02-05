import { describe, expect, test } from 'bun:test';

import { extractUpstreamErrorMessage } from '@/lib/ai/utils/error-extraction';

describe('ai-error-extraction', () => {
  test('extract from capturedError.message with name/statusCode', () => {
    const capturedError = {
      name: 'AI_APICallError',
      message: '余额不足(request id:2026010518...)',
      statusCode: 402,
    };

    expect(extractUpstreamErrorMessage(capturedError, null, 'fallback')).toBe(
      'AI_APICallError: 余额不足(request id:2026010518...)（HTTP 402）',
    );
  });

  test('extract from capturedError.responseBody (string json)', () => {
    const capturedError = {
      name: 'AI_APICallError',
      message: '',
      statusCode: 401,
      responseBody: JSON.stringify({ error: { message: 'API Key 无效或已过期' } }),
    };

    expect(extractUpstreamErrorMessage(capturedError, null, 'fallback')).toBe('AI_APICallError: API Key 无效或已过期（HTTP 401）');
  });

  test('falls back when nothing can be extracted', () => {
    expect(extractUpstreamErrorMessage(null, null, 'fallback')).toBe('fallback');
    expect(extractUpstreamErrorMessage(undefined, undefined, 'fallback')).toBe('fallback');
  });
});

