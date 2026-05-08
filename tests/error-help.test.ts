import { describe, expect, test } from 'bun:test';

import { getEncyclopediaHelpForError, inferEncyclopediaSlugForError, inferErrorCategoryForError } from '@/lib/error-help';

describe('error-help', () => {
  test('infer by status: 524', () => {
    expect(inferEncyclopediaSlugForError({ status: 524, message: 'whatever' })).toBe('cloudflare-524-timeout');
  });

  test('infer ai api call error over server 5xx status', () => {
    expect(
      inferEncyclopediaSlugForError({
        status: 500,
        message: '魔法失效了!失败:AI_APICallError：余额不足(request id:2026010518...)(HTTP500)',
      }),
    ).toBe('ai-api-call-error');
  });

  test('infer ai api call error for AI_APICaIIError variant', () => {
    expect(
      inferEncyclopediaSlugForError({
        status: 500,
        message: '魔法失效了!失败:AI_APICaIIError：用户已被封禁(request id:2026010518...)(HTTP500)',
      }),
    ).toBe('ai-api-call-error');
  });

  test('infer by status: 500 (fallback cloudflare errors)', () => {
    expect(inferEncyclopediaSlugForError({ status: 500, message: 'whatever' })).toBe('cloudflare-errors');
  });

  test('infer by message: HTTP 524', () => {
    expect(inferEncyclopediaSlugForError({ message: '服务器内部错误（HTTP 524）' })).toBe('cloudflare-524-timeout');
  });

  test('infer by message: rate limit', () => {
    expect(inferEncyclopediaSlugForError({ message: '请求过于频繁（HTTP 429）！请稍后再试。' })).toBe('rate-limit-429');
  });

  test('infer by message: network', () => {
    expect(inferEncyclopediaSlugForError({ message: 'TypeError: Failed to fetch' })).toBe('network-errors');
  });

  test('infer modelscope auth by HTTP 401 message', () => {
    expect(
      inferEncyclopediaSlugForError({
        message: 'ModelScope 鉴权失败（HTTP 401）：Authentication failed, please make sure that a valid ModelScope token is supplied.',
      }),
    ).toBe('tachie-auth-errors');
  });

  test('infer modelscope auth by message without explicit status', () => {
    expect(
      inferEncyclopediaSlugForError({
        message: 'ModelScope 任务查询失败：Authentication failed, invalid token',
      }),
    ).toBe('tachie-auth-errors');
  });

  test('infer modelscope auth by alibaba binding message', () => {
    expect(
      inferEncyclopediaSlugForError({
        message: 'ModelScope 鉴权失败（HTTP 401）：Please bind your Alibaba Cloud account before use.',
      }),
    ).toBe('tachie-auth-errors');
  });

  test('infer modelscope auth by aliyun real-name verified message', () => {
    expect(
      inferEncyclopediaSlugForError({
        message: 'ModelScope 权限不足（HTTP 403）：To use API-Inference,please make sure your associated Aliyun account is real name verified.',
      }),
    ).toBe('tachie-auth-errors');
  });

  test('infer liblib auth by signature error message', () => {
    expect(
      inferEncyclopediaSlugForError({
        message: 'LibLib 立绘任务提交失败（HTTP 401）：签名验证失败',
      }),
    ).toBe('tachie-auth-errors');
  });

  test('infer by message: data card', () => {
    expect(inferEncyclopediaSlugForError({ message: 'JSON 解析失败：Unexpected token' })).toBe('data-card-errors');
  });

  test('infer by message: ai output format', () => {
    expect(inferEncyclopediaSlugForError({ message: '魔法少女格式验证失败: 缺少必需字段 codename' })).toBe(
      'ai-output-format'
    );
  });

  test('infer by message: ai empty output', () => {
    expect(inferEncyclopediaSlugForError({ message: '服务端响应为空，未收到有效内容。' })).toBe('ai-empty-output');
  });

  test('infer by message: reasoning only without markdown', () => {
    expect(
      inferEncyclopediaSlugForError({
        message: 'AI 只返回了思考过程，但未返回可展示的战报正文，请重试或切换模型。',
      }),
    ).toBe('ai-empty-output');
  });

  test('infer by message: server returned {}', () => {
    expect(inferEncyclopediaSlugForError({ message: '✨ 生成失败，服务端返回信息：{}' })).toBe('ai-empty-output');
  });

  test('infer by message: ai', () => {
    expect(inferEncyclopediaSlugForError({ message: 'API Key 无效或已过期' })).toBe('ai-errors');
  });

  test('infer by message: ai refusal template', () => {
    expect(inferEncyclopediaSlugForError({ message: '身为一个语言模型，我没法提供这方面的帮助。' })).toBe('ai-refusal');
  });

  test('do not infer for trivial input validation', () => {
    expect(inferEncyclopediaSlugForError({ message: '名字太长啦，你怎么回事！' })).toBeNull();
  });

  test('get help link returns encyclopedia title', () => {
    const help = getEncyclopediaHelpForError({ message: 'Cloudflare 超时（HTTP 524），请稍后重试。' });
    expect(help?.slug).toBe('cloudflare-524-timeout');
    expect(help?.title).toContain('524');
  });

  test('category: timeout', () => {
    expect(inferErrorCategoryForError({ status: 524, message: 'whatever' })?.id).toBe('timeout');
  });

  test('category: ai api call error', () => {
    expect(inferErrorCategoryForError({ status: 500, message: '失败:AI_APICallError：余额不足(HTTP500)' })?.id).toBe('ai_api_call');
  });

  test('category: network', () => {
    expect(inferErrorCategoryForError({ message: 'TypeError: Failed to fetch' })?.id).toBe('network');
  });

  test('category: modelscope auth', () => {
    expect(
      inferErrorCategoryForError({
        message: 'ModelScope 任务查询失败：Authentication failed, invalid token',
      })?.id,
    ).toBe('auth');
  });

  test('category: liblib auth', () => {
    expect(
      inferErrorCategoryForError({
        message: 'LibLib 立绘任务提交失败（HTTP 401）：签名验证失败',
      })?.id,
    ).toBe('auth');
  });
});
