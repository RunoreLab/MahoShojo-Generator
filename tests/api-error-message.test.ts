import { describe, expect, test } from 'vitest';

import { resolveApiErrorMessage } from '@/lib/client/apiError';

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
});

