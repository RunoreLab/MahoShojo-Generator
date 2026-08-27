import { describe, expect, test } from 'vitest';

import {
  enhanceErrorWithUpstreamMessage,
  extractUpstreamErrorMessage,
} from '@/lib/ai/utils/error-extraction';
import { readSafePublicAiError } from '@mahoshojo/hosted-api/regular-generation';
import { classifyOutcome } from '@/lib/ai/availability/classify-outcome';

describe('ai-error-extraction', () => {
  test('投影 capturedError.message 与 statusCode 中的可诊断信息', () => {
    const capturedError = {
      name: 'AI_APICallError',
      message: '余额不足(request id:2026010518...)',
      statusCode: 402,
    };

    expect(extractUpstreamErrorMessage(capturedError, null, 'fallback')).toBe(
      'AI_APICallError: 余额不足(request id:2026010518...)（HTTP 402）',
    );
  });

  test('投影 capturedError.responseBody 中的可诊断信息', () => {
    const capturedError = {
      name: 'AI_APICallError',
      message: '',
      statusCode: 401,
      responseBody: JSON.stringify({ error: { message: 'API Key 无效或已过期' } }),
    };

    expect(extractUpstreamErrorMessage(capturedError, null, 'fallback')).toBe(
      'AI_APICallError: API Key 无效或已过期（HTTP 401）',
    );
  });

  test('falls back when nothing can be extracted', () => {
    expect(extractUpstreamErrorMessage(null, null, 'fallback')).toBe('fallback');
    expect(extractUpstreamErrorMessage(undefined, undefined, 'fallback')).toBe('fallback');
  });

  test('enhanceErrorWithUpstreamMessage 同时保留安全公共投影与低基数日志 Error', () => {
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
    expect(readSafePublicAiError(enhanced)).toEqual({
      code: 'AI_UPSTREAM_REQUEST_FAILED',
      message: 'AI_APICallError: 状态码=503，当前模型[鹿鹿10]gemini-3.1-pro-preview暂时不可用（HTTP 503）',
      upstreamStatus: 503,
    });

    // 自定义渠道（鹿鹿）必须计入 failure，而不是 excluded
    expect(classifyOutcome(false, enhanced)).toEqual({
      outcome: 'failure',
      errorClass: 'server_error',
    });
  });

  test('脱敏 secret/header/URL query，仅保留安全诊断与 Provider request ID', () => {
    const raw = Object.assign(new Error(
      '余额不足；Authorization: Bearer bearer-secret；api_key=query-secret；https://user:pass@example.test/v1?token=url-secret',
    ), {
      name: 'AI_APICallError',
      statusCode: 402,
      requestId: 'req-safe-402',
      responseBody: JSON.stringify({
        error: { message: '不应优先于顶层诊断' },
        prompt: 'prompt-secret-canary',
      }),
    });

    const enhanced = enhanceErrorWithUpstreamMessage(raw, {
      secrets: ['bearer-secret', 'query-secret', 'url-secret', 'pass'],
    });
    const projection = readSafePublicAiError(enhanced);
    const serialized = JSON.stringify(projection);

    expect(projection).toMatchObject({
      code: 'AI_UPSTREAM_REQUEST_FAILED',
      upstreamStatus: 402,
      upstreamRequestId: 'req-safe-402',
    });
    expect(serialized).toContain('余额不足');
    expect(serialized).not.toMatch(
      /bearer-secret|query-secret|url-secret|prompt-secret-canary|user:pass/u,
    );
  });

  test.each([
    [403, '当前凭据无权访问该模型'],
    [404, '请求的模型不存在'],
    [429, '请求过于频繁，请稍后重试'],
    [503, '模型暂时不可用'],
  ])('安全投影常见 Provider HTTP %i 诊断', (statusCode, message) => {
    const enhanced = enhanceErrorWithUpstreamMessage({
      name: 'AI_APICallError',
      statusCode,
      data: { error: { message } },
    });

    expect(readSafePublicAiError(enhanced)).toEqual({
      code: 'AI_UPSTREAM_REQUEST_FAILED',
      message: `AI_APICallError: ${message}（HTTP ${statusCode}）`,
      upstreamStatus: statusCode,
    });
  });

  test('恶意 getter 保留低风险 Provider 归类，普通内部 Error 不取得公共投影信任', () => {
    const hostile = Object.defineProperty({
      name: 'AI_APICallError',
      statusCode: 502,
    }, 'data', {
      get() {
        throw new Error('getter-secret-canary');
      },
    });
    Object.assign(hostile, { responseBody: '{not-json' });

    const hostileProjection = readSafePublicAiError(enhanceErrorWithUpstreamMessage(hostile));
    const ordinaryProjection = readSafePublicAiError(
      enhanceErrorWithUpstreamMessage(new Error('database-secret-canary')),
    );

    expect(hostileProjection).toEqual({
      code: 'AI_UPSTREAM_REQUEST_FAILED',
      message: '上游 AI 请求失败',
      upstreamStatus: 502,
    });
    expect(ordinaryProjection).toBeNull();
    expect(JSON.stringify([hostileProjection, ordinaryProjection])).not.toMatch(
      /getter-secret-canary|database-secret-canary/u,
    );
  });

  test('带 status/responseBody 的普通内部 Error 仍不取得 Provider 信任', () => {
    const internal = Object.assign(new Error('database-secret-canary'), {
      statusCode: 500,
      responseBody: JSON.stringify({ error: { message: 'sql-secret-canary' } }),
    });

    expect(readSafePublicAiError(enhanceErrorWithUpstreamMessage(internal))).toBeNull();
  });

  test('Provider request ID 命中 secret 值时不进入公共投影', () => {
    const secret = 'private-secret-canary';
    const projection = readSafePublicAiError(enhanceErrorWithUpstreamMessage({
      name: 'AI_APICallError',
      statusCode: 402,
      message: '余额不足',
      requestId: secret,
    }, { secrets: [secret] }));

    expect(projection).toEqual({
      code: 'AI_UPSTREAM_REQUEST_FAILED',
      message: 'AI_APICallError: 余额不足（HTTP 402）',
      upstreamStatus: 402,
    });
  });

  test('Provider 回显 prompt/附件片段、HTML 或 stack 时退回固定文案', () => {
    const sensitivePrompt = '仅限本次请求的私密角色设定：她真正的名字和隐藏能力不能公开。';
    const cases = [
      `上游拒绝了内容：${sensitivePrompt.slice(0, 28)}`,
      '<html><body>proxy diagnostics</body></html>',
      'provider failure\n    at internal (/home/service/provider.ts:42:7)',
    ];

    for (const message of cases) {
      const projection = readSafePublicAiError(enhanceErrorWithUpstreamMessage({
        name: 'AI_APICallError',
        statusCode: 500,
        message,
      }, { sensitiveTexts: [sensitivePrompt] }));
      expect(projection).toEqual({
        code: 'AI_UPSTREAM_REQUEST_FAILED',
        message: '上游 AI 请求失败',
        upstreamStatus: 500,
      });
    }
  });

  test('将 abort、timeout 与 redirect 投影为固定错误码', () => {
    expect(enhanceErrorWithUpstreamMessage({ name: 'AbortError' }).message).toBe('AI_REQUEST_ABORTED');
    expect(enhanceErrorWithUpstreamMessage({ name: 'StreamReadTimeoutError' }).message).toBe('AI_UPSTREAM_TIMEOUT');
    expect(enhanceErrorWithUpstreamMessage({ name: 'AIProviderRedirectError' }).message).toBe(
      'AI_PROVIDER_REDIRECT_BLOCKED',
    );
  });
});
