import { describe, expect, it } from 'bun:test';
import { buildDataCardAiReviewPrompt, extractModerationTextFromJsonString } from '@/lib/review/data-card-ai-review';

describe('data-card-ai-review', () => {
  it('extractModerationTextFromJsonString returns parseError for invalid JSON', () => {
    const result = extractModerationTextFromJsonString('{not-json');
    expect(result.parseError).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe('');
  });

  it('extractModerationTextFromJsonString extracts string leaves with paths', () => {
    const json = JSON.stringify({
      templateId: '通用角色',
      name: '测试角色',
      content: '你好，世界',
      nested: { a: 'A', b: 123, c: ['x', 'y'] },
    });
    const result = extractModerationTextFromJsonString(json);
    expect(result.parseError).toBe(false);
    expect(result.text).toContain('data.templateId: 通用角色');
    expect(result.text).toContain('data.name: 测试角色');
    expect(result.text).toContain('data.content: 你好，世界');
    expect(result.text).toContain('data.nested.a: A');
    expect(result.text).toContain('data.nested.c[0]: x');
  });

  it('extractModerationTextFromJsonString truncates overly long strings', () => {
    const longText = 'A'.repeat(500);
    const json = JSON.stringify({ content: longText });
    const result = extractModerationTextFromJsonString(json, { maxStringLength: 50 });
    expect(result.parseError).toBe(false);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain(`data.content: ${'A'.repeat(50)}`);
  });

  it('buildDataCardAiReviewPrompt includes meta flags and JSON list', () => {
    const prompt = buildDataCardAiReviewPrompt([
      {
        id: 'card_1',
        name: '标题',
        description: '简介',
        data: JSON.stringify({ content: '合规内容' }),
      },
    ]);
    expect(prompt).toContain('待审查列表（JSON）：');
    expect(prompt).toContain('"id": "card_1"');
    expect(prompt).toContain('"contentTruncated"');
    expect(prompt).toContain('"contentParseError"');
  });
});

