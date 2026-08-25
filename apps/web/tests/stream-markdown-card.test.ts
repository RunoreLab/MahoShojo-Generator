import { describe, expect, test } from 'vitest';

import {
  buildGeneralCharacterCardFromMarkdown,
  buildGeneralScenarioCardFromMarkdown,
  parseMarkdownCardFields,
} from '@/lib/stream/markdown-card';

describe('stream/markdown-card', () => {
  test('parseMarkdownCardFields: 解析代号/名字/标题与首个标题行', () => {
    const markdown = [
      '# 白百合「晨曦之刃」',
      '',
      '- 代号：白百合',
      '- 名字：林悠',
      '',
      '正文……',
      '',
      '标题：这行不应覆盖情景标题（它不是情景）',
    ].join('\n');

    expect(parseMarkdownCardFields(markdown)).toEqual({
      codename: '白百合',
      name: '林悠',
      title: '这行不应覆盖情景标题（它不是情景）',
      headline: '白百合「晨曦之刃」',
    });
  });

  test('buildGeneralCharacterCardFromMarkdown: 优先用解析出的名字，其次代号/标题，再回退', () => {
    const markdown = [
      '# 白百合「晨曦之刃」',
      '',
      '代号：白百合',
      '',
      '外观：……',
    ].join('\n');

    const { card, parsed } = buildGeneralCharacterCardFromMarkdown({
      markdown,
      fallbackName: '用户输入的真实名',
      defaultName: '魔法少女',
    });

    expect(parsed.codename).toBe('白百合');
    expect(card.templateId).toBe('通用角色');
    expect(card.name).toBe('白百合「晨曦之刃」');
    expect(card.codename).toBe('白百合');
    expect(card.content).toBe(markdown);
  });

  test('buildGeneralScenarioCardFromMarkdown: 解析标题/首标题并回退', () => {
    const markdown = [
      '# 深夜车站',
      '',
      '氛围：……',
    ].join('\n');

    const { card } = buildGeneralScenarioCardFromMarkdown({
      markdown,
      fallbackTitle: '用户输入标题',
      defaultTitle: '情景',
    });

    expect(card.templateId).toBe('通用情景');
    expect(card.title).toBe('深夜车站');
    expect(card.content).toBe(markdown);
  });
});

