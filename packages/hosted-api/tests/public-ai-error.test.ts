import { describe, expect, it } from 'vitest';

import {
  HOSTED_GENERATION_ERROR_CODE,
  HOSTED_GENERATION_INTERNAL_MESSAGE,
  buildHostedGenerationErrorPayload,
  createSafePublicAiError,
  readSafePublicAiError,
} from '../src/regular-generation';

describe('hosted public AI error carrier', () => {
  it('只允许显式安全投影进入公共 payload，且日志 Error 保持低基数', () => {
    const error = createSafePublicAiError({
      code: 'AI_UPSTREAM_REQUEST_FAILED',
      message: 'AI_APICallError: 余额不足（HTTP 402）',
      upstreamStatus: 402,
      upstreamRequestId: 'req-provider-402',
    });

    expect(error).toMatchObject({
      name: 'AI_APICallError',
      message: 'AI_UPSTREAM_REQUEST_FAILED',
      status: 402,
      statusCode: 402,
    });
    expect(JSON.stringify(error)).not.toContain('余额不足');
    expect(readSafePublicAiError(error)).toEqual({
      code: 'AI_UPSTREAM_REQUEST_FAILED',
      message: 'AI_APICallError: 余额不足（HTTP 402）',
      upstreamStatus: 402,
      upstreamRequestId: 'req-provider-402',
    });
    expect(buildHostedGenerationErrorPayload(error, '生成失败')).toEqual({
      error: '生成失败',
      message: 'AI_APICallError: 余额不足（HTTP 402）',
      code: 'AI_UPSTREAM_REQUEST_FAILED',
      upstreamStatus: 402,
      upstreamRequestId: 'req-provider-402',
    });
  });

  it('未知内部错误继续使用 generic wire，不信任任意 Error.message', () => {
    const payload = buildHostedGenerationErrorPayload(
      new Error('数据库口令和请求正文 secret-canary'),
      '生成失败',
    );

    expect(payload).toEqual({
      error: '生成失败',
      message: HOSTED_GENERATION_INTERNAL_MESSAGE,
    });
    expect(JSON.stringify(payload)).not.toContain('secret-canary');
    expect(readSafePublicAiError(new Error(HOSTED_GENERATION_ERROR_CODE))).toBeNull();
  });

  it('拒绝把明显未脱敏的 credential 伪装成安全投影', () => {
    expect(() => createSafePublicAiError({
      code: 'AI_UPSTREAM_REQUEST_FAILED',
      message: 'Provider failed: "apiKey":"secret-canary"',
    })).toThrow('Invalid public AI error projection');
  });
});
