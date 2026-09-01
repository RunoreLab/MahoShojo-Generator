import { describe, expect, it } from 'vitest';
import { readSafePublicAiError } from '@mahoshojo/hosted-api/regular-generation';

import {
  enhanceErrorWithUpstreamMessage,
  extractUpstreamErrorMessage,
  sanitizePublicErrorMessage,
} from '../src/node-runtime/error-extraction';

const fallbackMessage = '生成服务暂时不可用，请稍后重试';

describe('public error message sanitizer', () => {
  it('保留 Provider 已有的可行动诊断', () => {
    expect(sanitizePublicErrorMessage(
      'AI_APICallError: 余额不足，请充值或更换 Provider（HTTP 402）',
      { fallbackMessage },
    )).toBe('AI_APICallError: 余额不足，请充值或更换 Provider（HTTP 402）');

    const enhanced = enhanceErrorWithUpstreamMessage(Object.assign(
      new Error('余额不足，请充值或更换 Provider'),
      { name: 'AI_APICallError', statusCode: 402 },
    ));
    expect(readSafePublicAiError(enhanced)).toMatchObject({
      message: 'AI_APICallError: 余额不足，请充值或更换 Provider（HTTP 402）',
      upstreamStatus: 402,
    });
  });

  it.each([
    ['API key', '调用失败，x-api-key: api-key-canary，请检查额度', 'api-key-canary'],
    ['Bearer', '调用失败，Authorization: Bearer bearer-token-canary，请重试', 'bearer-token-canary'],
    ['Cookie', '调用失败，Cookie: auth=cookie-canary，请重新登录', 'cookie-canary'],
    ['session', '会话失效 session=session-token-canary，请重新登录', 'session-token-canary'],
    ['JSON credential', '上游拒绝 {"apiKey":"json-api-key-canary"}', 'json-api-key-canary'],
    ['private key field', '签名失败 privateKey=private-key-field-canary', 'private-key-field-canary'],
    ['session id', '会话失效 sessionId=session-id-canary', 'session-id-canary'],
  ])('清洗 %s 并保留安全上下文', (_label, message, canary) => {
    const sanitized = sanitizePublicErrorMessage(message, { fallbackMessage });
    expect(sanitized).not.toContain(canary);
    expect(sanitized).toContain('[REDACTED]');
    expect(sanitized).not.toBe(fallbackMessage);
  });

  it('清洗 signed URL query 与数据库连接串', () => {
    const signedUrl = sanitizePublicErrorMessage(
      '对象存储请求失败 https://bucket.example/output?X-Amz-Credential=url-credential-canary&X-Amz-Signature=url-signature-canary&X-Amz-Expires=3600',
      { fallbackMessage },
    );
    expect(signedUrl).toContain('对象存储请求失败');
    expect(signedUrl).not.toMatch(/url-(?:credential|signature)-canary/u);

    const connection = sanitizePublicErrorMessage(
      '数据库连接失败 postgresql://admin:connection-password-canary@db.internal:5432/private_schema',
      { fallbackMessage },
    );
    expect(connection).toContain('数据库连接失败');
    expect(connection).not.toMatch(/admin|connection-password-canary|db\.internal|private_schema/u);

    expect(sanitizePublicErrorMessage(
      '数据库连接失败 host=db.private;port=5432;user=admin;password=dsn-canary',
      { fallbackMessage },
    )).toBe(fallbackMessage);
  });

  it('清洗 Unix 与 Windows 绝对路径', () => {
    const sanitized = sanitizePublicErrorMessage(
      '无法读取 /home/service/private/config.json 或 C:\\service\\private\\config.json',
      { fallbackMessage },
    );
    expect(sanitized).toContain('无法读取');
    expect(sanitized).not.toMatch(/\/home\/service|C:\\service/u);
    expect(sanitized).toContain('[PATH]');

    expect(sanitizePublicErrorMessage('无法读取 /secret', { fallbackMessage }))
      .toBe('无法读取 [PATH]');
  });

  it.each([
    ['stack', 'Error: failed\n    at createSecret (/home/service/private.ts:12:3)'],
    ['private key', '签名失败 -----BEGIN PRIVATE KEY-----\nprivate-key-canary\n-----END PRIVATE KEY-----'],
    ['PEM certificate', 'TLS 失败 -----BEGIN CERTIFICATE-----\npem-canary\n-----END CERTIFICATE-----'],
    ['SQL', 'D1_ERROR: no such column users.password; SELECT password FROM users'],
    ['DB schema', 'relation "battle_report_generations_private" does not exist'],
    ['DB constraint', 'duplicate key value violates unique constraint "users_private_key"'],
  ])('%s 细节无法安全清洗时回退稳定文案', (_label, message) => {
    expect(sanitizePublicErrorMessage(message, { fallbackMessage })).toBe(fallbackMessage);
  });

  it('hostile error 与显式 sensitive text 无法安全读取时回退稳定文案', () => {
    const hostile = Object.defineProperty({}, 'message', {
      get: () => { throw new Error('getter-canary'); },
    });
    expect(sanitizePublicErrorMessage(hostile, { fallbackMessage })).toBe(fallbackMessage);
    expect(sanitizePublicErrorMessage('请求包含 prompt-sensitive-canary-1234567890', {
      fallbackMessage,
      sensitiveTexts: ['prompt-sensitive-canary-1234567890'],
    })).toBe(fallbackMessage);
    expect(sanitizePublicErrorMessage('上游回显 arbitrary-custom-key-canary', {
      fallbackMessage,
      secrets: ['arbitrary-custom-key-canary'],
    })).toBe('上游回显 [REDACTED]');
  });

  it('Provider 原始诊断无法清洗时沿用调用方稳定回退文案', () => {
    expect(extractUpstreamErrorMessage({
      name: 'AI_APICallError',
      message: 'provider leaked -----BEGIN PRIVATE KEY----- secret',
    }, undefined, '上游 AI 请求失败')).toBe('上游 AI 请求失败');
  });
});
