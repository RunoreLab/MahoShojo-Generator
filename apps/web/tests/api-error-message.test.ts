import { describe, expect, test } from 'vitest';

import { getPublicAiErrorMessage } from '@mahoshojo/hosted-api/regular-generation';

import { INFRASTRUCTURE_ERROR_MESSAGES, resolveApiErrorMessage } from '@/lib/client/apiError';

describe('resolveApiErrorMessage', () => {
  test('prefer payload.message over generic payload.error', () => {
    expect(
      resolveApiErrorMessage({
        payload: { error: '生成失败', message: 'AI_APICallError: 余额不足（HTTP 401）' },
        fallback: '请求失败',
      }),
    ).toBe('AI_APICallError: 余额不足（HTTP 401）');
  });

  test('keeps specific payload.error when message missing', () => {
    expect(
      resolveApiErrorMessage({
        payload: { error: '缺少 API Key' },
        fallback: '请求失败',
      }),
    ).toBe('缺少 API Key');
  });

  test('combines error and message when both are meaningful', () => {
    expect(
      resolveApiErrorMessage({
        payload: { error: '请求参数无效', message: '缺少字段 roleId' },
        fallback: '请求失败',
      }),
    ).toBe('请求参数无效：缺少字段 roleId');
  });

  test('supports payload.details', () => {
    expect(
      resolveApiErrorMessage({
        payload: { error: '生成失败', message: '上游返回错误', details: 'request id: 20260101...' },
        fallback: '请求失败',
      }),
    ).toBe('上游返回错误\n详情：request id: 20260101...');
  });

  test.each(Object.entries(INFRASTRUCTURE_ERROR_MESSAGES))(
    'projects stable user copy for infrastructure code %s',
    (code, expectedMessage) => {
      expect(
        resolveApiErrorMessage({
          payload: { code, error: 'internal implementation detail' },
          fallback: '请求失败',
        }),
      ).toBe(expectedMessage);
    },
  );

  test('keeps safe Provider diagnostics instead of replacing AI upstream messages', () => {
    expect(
      resolveApiErrorMessage({
        payload: {
          code: 'AI_UPSTREAM_REQUEST_FAILED',
          error: '余额不足，请充值后重试',
        },
        fallback: '请求失败',
      }),
    ).toBe('余额不足，请充值后重试');
  });

  // Web 包目标校验失败曾经只剩一个 code，用户看到的是"服务器流式响应异常"。
  test.each([
    'ARENA_WEB_PACKAGE_OUTPUT_INVALID',
    'ARENA_WEB_PACKAGE_TARGET_INVALID',
    'ARENA_WEB_PACKAGE_TARGET_MALFORMED',
    'ARENA_WEB_PACKAGE_TARGET_SCHEMA',
  ])('surfaces the host-authored Web 包 failure copy for %s', (code) => {
    const message = getPublicAiErrorMessage(code);
    expect(message).toBeTruthy();
    expect(resolveApiErrorMessage({
      payload: { ok: false, status: 'failed', code, message },
      fallback: '服务器流式响应异常',
    })).toBe(message);
  });
});
