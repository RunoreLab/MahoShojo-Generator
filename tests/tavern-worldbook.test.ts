import { describe, expect, it } from 'bun:test';

import { buildArenaDefaultScenario, buildArenaWorldbook, buildTavernScenarioFragment } from '@/lib/tavern-card';

const hasKey = (obj: unknown, key: string): boolean => {
  return Boolean(obj && typeof obj === 'object' && !Array.isArray(obj) && key in (obj as any));
};

describe('tavern-worldbook', () => {
  it('builds default arena scenario', () => {
    const text = buildArenaDefaultScenario();
    expect(typeof text).toBe('string');
    expect(text).toContain('A.R.E.N.A');
    expect(text).toContain('{{user}}');
    expect(text).toContain('{{char}}');
  });

  it('formats general-scenario fragments', () => {
    const fragment = buildTavernScenarioFragment({ templateId: '通用情景', title: '箱庭测试', content: '这里是一段情景正文。' });
    expect(fragment).not.toBeNull();
    expect(fragment?.kind).toBe('general-scenario');
    expect(fragment?.title).toBe('箱庭测试');
    expect(fragment?.content).toContain('【情景】箱庭测试');
    expect(fragment?.content).toContain('这里是一段情景正文');
  });

  it('formats scenario fragments', () => {
    const fragment = buildTavernScenarioFragment({
      title: '情景问卷测试',
      description: '一个结构化情景。',
      elements: {
        scene: { time: '午夜', place: '屋顶', features: '风很大' },
        atmosphere: '紧张',
        events: '进行一次短暂的对峙',
        development: ['有人突然闯入', '出现意外的广播'],
        roles: [{ name: '临时NPC', description: '负责递台词。' }],
      },
    });
    expect(fragment).not.toBeNull();
    expect(fragment?.kind).toBe('scenario');
    expect(fragment?.content).toContain('【情景】情景问卷测试');
    expect(fragment?.content).toContain('【场景要素】');
    expect(fragment?.content).toContain('地点：屋顶');
  });

  it('builds arena worldbook entries with SillyTavern-compatible shape', () => {
    const book = buildArenaWorldbook();
    expect(typeof book.name).toBe('string');
    expect(Array.isArray(book.entries)).toBe(true);
    expect(book.entries.length).toBeGreaterThan(0);

    const first = book.entries[0] as any;
    expect(hasKey(first, 'id')).toBe(true);
    expect(hasKey(first, 'keys')).toBe(true);
    expect(hasKey(first, 'secondary_keys')).toBe(true);
    expect(hasKey(first, 'comment')).toBe(true);
    expect(hasKey(first, 'content')).toBe(true);
    expect(hasKey(first, 'constant')).toBe(true);
    expect(hasKey(first, 'selective')).toBe(true);
    expect(hasKey(first, 'insertion_order')).toBe(true);
    expect(hasKey(first, 'enabled')).toBe(true);
    expect(hasKey(first, 'position')).toBe(true);
    expect(hasKey(first, 'use_regex')).toBe(true);
    expect(hasKey(first, 'extensions')).toBe(true);
    expect(hasKey(first.extensions, 'probability')).toBe(true);
    expect(hasKey(first.extensions, 'useProbability')).toBe(true);
  });

  it('appends scenario fragments into worldbook as constant entries', () => {
    const fragment = buildTavernScenarioFragment({ templateId: '通用情景', title: '附加箱庭', content: '附加内容。' });
    expect(fragment).not.toBeNull();

    const book = buildArenaWorldbook({ includeCore: false, scenarioFragments: fragment ? [fragment] : [] });
    expect(book.entries.length).toBe(1);
    expect((book.entries[0] as any).constant).toBe(true);
    expect(String((book.entries[0] as any).comment)).toContain('附加情景');
    expect(String((book.entries[0] as any).content)).toContain('附加箱庭');
  });
});

