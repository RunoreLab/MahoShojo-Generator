import { describe, expect, test } from 'vitest';

import {
  enhanceErrorWithUpstreamMessage,
  extractUpstreamErrorMessage,
} from '@/lib/ai/utils/error-extraction';
import { classifyOutcome } from '@/lib/ai/availability/classify-outcome';

describe('ai-error-extraction', () => {
  test('不投影 capturedError.message 与 statusCode', () => {
    const capturedError = {
      name: 'AI_APICallError',
      message: '余额不足(request id:2026010518...)',
      statusCode: 402,
    };

    expect(extractUpstreamErrorMessage(capturedError, null, 'fallback')).toBe('fallback');
  });

  test('不投影 capturedError.responseBody', () => {
    const capturedError = {
      name: 'AI_APICallError',
      message: '',
      statusCode: 401,
      responseBody: JSON.stringify({ error: { message: 'API Key 无效或已过期' } }),
    };

    expect(extractUpstreamErrorMessage(capturedError, null, 'fallback')).toBe('fallback');
  });

  test('falls back when nothing can be extracted', () => {
    expect(extractUpstreamErrorMessage(null, null, 'fallback')).toBe('fallback');
    expect(extractUpstreamErrorMessage(undefined, undefined, 'fallback')).toBe('fallback');
  });

  test('enhanceErrorWithUpstreamMessage 只保留安全 name/statusCode 供可用性分类', () => {
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
    expect((enhanced as any).status).toBe(503);
    expect((enhanced as any).originalError).toBeUndefined();
    expect((enhanced as any).cause).toBeUndefined();
    expect(enhanced.message).toBe('AI_UPSTREAM_REQUEST_FAILED');
    expect(JSON.stringify(enhanced)).not.toContain('鹿鹿10');
    expect(JSON.stringify(enhanced)).not.toContain('暂时不可用');

    // 自定义渠道（鹿鹿）必须计入 failure，而不是 excluded
    expect(classifyOutcome(false, enhanced)).toEqual({
      outcome: 'failure',
      errorClass: 'server_error',
    });
  });

  test('将 abort、timeout 与 redirect 投影为固定错误码', () => {
    expect(enhanceErrorWithUpstreamMessage({ name: 'AbortError' }).message).toBe('AI_REQUEST_ABORTED');
    expect(enhanceErrorWithUpstreamMessage({ name: 'StreamReadTimeoutError' }).message).toBe('AI_UPSTREAM_TIMEOUT');
    expect(enhanceErrorWithUpstreamMessage({ name: 'AIProviderRedirectError' }).message).toBe(
      'AI_PROVIDER_REDIRECT_BLOCKED',
    );
  });
});
