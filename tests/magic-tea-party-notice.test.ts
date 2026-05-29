import { describe, expect, it } from 'vitest';

import { extractMagicTeaPartyNoticesFromMarkdown } from '@/lib/magic-tea-party/notice';

describe('magic tea party notice parser', () => {
  it('能从 Markdown 中识别松散 notice 行', () => {
    const input = [
      'notice: level=warning, message=请注意，上一轮输出包含多个 notice，请聚焦叙事。',
      '这里是正常正文。',
    ].join('\n');
    const result = extractMagicTeaPartyNoticesFromMarkdown(input);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toMatchObject({ level: 'warning', message: '请注意，上一轮输出包含多个 notice，请聚焦叙事。' });
    expect(result.cleanedText).toBe(input);
  });

  it('缺失 message 时会用整行作为 message', () => {
    const input = 'notice: level=warning';
    const result = extractMagicTeaPartyNoticesFromMarkdown(input);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toMatchObject({ level: 'warning', message: 'notice: level=warning' });
    expect(result.cleanedText).toBe(input);
  });

  it('能解析 Markdown 中的 JSON notice 行', () => {
    const input = ['{"notice":true,"level":"warning","message":"角色配置缺失"}', '后续正文'].join('\n');
    const result = extractMagicTeaPartyNoticesFromMarkdown(input);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toMatchObject({ level: 'warning', message: '角色配置缺失' });
    expect(result.cleanedText).toBe(input);
  });

  it('不会解析普通代码块内的 notice 文本', () => {
    const input = ['```txt', 'notice: level=warning, message=示例代码', '```', '正文'].join('\n');
    const result = extractMagicTeaPartyNoticesFromMarkdown(input);
    expect(result.notices).toHaveLength(0);
    expect(result.cleanedText).toBe(input);
  });
});
