import { describe, expect, test } from 'bun:test';

import { getEncyclopediaHelpForError, inferEncyclopediaSlugForError } from '@/lib/error-help';

describe('error-help', () => {
  test('infer by status: 524', () => {
    expect(inferEncyclopediaSlugForError({ status: 524, message: 'whatever' })).toBe('cloudflare-524-timeout');
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
});
