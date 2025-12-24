import { describe, expect, test } from 'bun:test';

import { extractWinnerLineFromMarkdown, parsePvpWinnerFromText } from '@/lib/pvp/winner-parse';

describe('pvp: winner parse (stream fallback)', () => {
  const candidates = [
    { token: 'P1', name: '雪绒' },
    { token: 'P2', name: '雪绒二号' },
  ];

  test('识别平局', () => {
    const parsed = parsePvpWinnerFromText({ raw: '平局', candidates, source: 'test' });
    expect(parsed.kind).toBe('draw');
  });

  test('优先解析 token（直接）', () => {
    const parsed = parsePvpWinnerFromText({ raw: 'P2', candidates, source: 'test' });
    expect(parsed.kind).toBe('index');
    if (parsed.kind !== 'index') return;
    expect(parsed.index).toBe(1);
  });

  test('优先解析 token（括号）', () => {
    const parsed = parsePvpWinnerFromText({ raw: '雪绒（P1）', candidates, source: 'test' });
    expect(parsed.kind).toBe('index');
    if (parsed.kind !== 'index') return;
    expect(parsed.index).toBe(0);
  });

  test('token 多命中视为无效', () => {
    const parsed = parsePvpWinnerFromText({ raw: 'P1 / P2', candidates, source: 'test' });
    expect(parsed.kind).toBe('invalid');
  });

  test('解析唯一角色名（精确）', () => {
    const parsed = parsePvpWinnerFromText({ raw: '雪绒二号', candidates, source: 'test' });
    expect(parsed.kind).toBe('index');
    if (parsed.kind !== 'index') return;
    expect(parsed.index).toBe(1);
  });

  test('重复角色名时不做名字精确匹配', () => {
    const dup = [
      { token: 'P1', name: '同名' },
      { token: 'P2', name: '同名' },
    ];
    const parsed = parsePvpWinnerFromText({ raw: '同名', candidates: dup, source: 'test' });
    expect(parsed.kind).toBe('invalid');
  });

  test('从 Markdown 的“胜利者”章节提取首行', () => {
    const markdown = [
      '# 测试战报',
      '',
      '## 胜利者',
      '雪绒（P1）',
      '',
      '## 最终结果',
      '- ……',
    ].join('\n');
    expect(extractWinnerLineFromMarkdown(markdown)).toBe('雪绒（P1）');
  });
});

