import { describe, expect, it } from 'bun:test';

import { FREE_GENERATION_ATTACHMENT_LIMITS } from '@/lib/ai/attachments';
import { buildTavernAiAttachment, type TavernCardNormalized } from '@/lib/tavern-card';

describe('tavern-ai-attachment', () => {
  it('builds a single attachment within size limits', () => {
    const big = '很长的文本。'.repeat(20_000);
    const normalized: TavernCardNormalized = {
      name: '测试角色',
      description: big,
      personality: big,
      scenario: big,
      firstMes: big,
      mesExample: big,
      creatorNotes: big,
      tags: Array.from({ length: 200 }, (_, i) => `tag-${i}`),
    };

    const result = buildTavernAiAttachment(normalized);
    expect(result.attachment.content.length).toBeLessThanOrEqual(FREE_GENERATION_ATTACHMENT_LIMITS.maxCharsPerFile);
    expect(result.attachment.truncated).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);

    const parsed = JSON.parse(result.attachment.content) as Record<string, unknown>;
    expect(parsed.name).toBe('测试角色');
    expect(typeof parsed.description).toBe('string');
    expect(typeof parsed.personality).toBe('string');
    expect(typeof parsed.scenario).toBe('string');
    expect(typeof parsed.first_mes).toBe('string');
    expect(typeof parsed.mes_example).toBe('string');
    expect(Array.isArray(parsed.tags)).toBe(true);
    expect((parsed.tags as unknown[]).length).toBeLessThanOrEqual(50);
  });

  it('keeps short payload untruncated', () => {
    const normalized: TavernCardNormalized = {
      name: '短文本角色',
      description: '短描述',
      personality: '短性格',
      scenario: '短场景',
      firstMes: '你好。',
      mesExample: '{{user}}: 你好\\n{{char}}: 你好呀。',
      tags: ['测试'],
      creatorNotes: '来源：测试',
    };

    const result = buildTavernAiAttachment(normalized);
    expect(result.attachment.content.length).toBeLessThanOrEqual(FREE_GENERATION_ATTACHMENT_LIMITS.maxCharsPerFile);
    expect(result.warnings.length).toBe(0);
    expect(result.attachment.truncated).toBeUndefined();
  });
});

