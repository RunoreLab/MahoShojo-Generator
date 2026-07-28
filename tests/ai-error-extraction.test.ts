import { describe, expect, test } from 'vitest';

import {
  enhanceErrorWithUpstreamMessage,
  extractUpstreamErrorMessage,
} from '@/lib/ai/utils/error-extraction';
import { classifyOutcome } from '@/lib/ai/availability/classify-outcome';

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

  test('enhanceErrorWithUpstreamMessage 保留 name/statusCode 供可用性分类', () => {
    const raw = Object.assign(
      new Error('ignored base message'),
      {
        name: 'AI_APICallError',
        statusCode: 503,
        data: {
          error: {
            message: '状态码=503，当前模型[鹿鹿10]gemini-3.1-pro-preview暂时不可用',
          },
        },
        responseBody: JSON.stringify({
          error: { message: '状态码=503，当前模型[鹿鹿10]gemini-3.1-pro-preview暂时不可用' },
        }),
      },
    );

    const enhanced = enhanceErrorWithUpstreamMessage(raw);
    expect(enhanced).toBeInstanceOf(Error);
    expect(enhanced.name).toBe('AI_APICallError');
    expect((enhanced as any).statusCode).toBe(503);
    expect((enhanced as any).originalError).toBe(raw);
    expect(enhanced.message).toContain('暂时不可用');
    expect(enhanced.message).toContain('HTTP 503');

    // 自定义渠道（鹿鹿）必须计入 failure，而不是 excluded
    expect(classifyOutcome(false, enhanced)).toEqual({
      outcome: 'failure',
      errorClass: 'server_error',
    });
  });
});

