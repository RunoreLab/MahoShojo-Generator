import { describe, expect, it } from 'vitest';

import { parseSillyTavernJsonl, stringifySillyTavernJsonl } from '@/lib/magic-tea-party/transfer';
import type { MagicTeaPartyMessage } from '@/lib/magic-tea-party/types';

describe('magic tea party transfer', () => {
  it('可以导入 SillyTavern JSONL', () => {
    const text = [
      '{"user_name":"旅人","character_name":"Narrator","create_date":"2024-01-01 @00h 00m 00s 000ms"}',
      '{"name":"旅人","is_user":true,"mes":"你好","send_date":"2024-01-01T00:00:00.000Z"}',
      '{"name":"Narrator","is_user":false,"mes":"欢迎来到茶会","send_date":1700000000}',
    ].join('\n');

    let counter = 0;
    const { messages, warnings } = parseSillyTavernJsonl({
      text,
      sessionId: 's1',
      createId: () => `m${(counter += 1)}`,
      userDisplayName: '旅人',
      now: 0,
    });

    expect(warnings).toHaveLength(0);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('你好');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('欢迎来到茶会');
  });

  it('导出 SillyTavern JSONL 会优先使用分段文本', () => {
    const messages: MagicTeaPartyMessage[] = [
      {
        id: 'm1',
        sessionId: 's1',
        role: 'assistant',
        content: '',
        createdAt: 0,
        segments: [{ type: 'dialogue', speakerId: 'r1', speakerName: '星见澪', text: '要来一杯草莓奶茶吗？' }],
      },
    ];
    const jsonl = stringifySillyTavernJsonl({
      messages,
      userDisplayName: '旅人',
      roleNameLookup: (id) => id,
    });
    const lines = jsonl.split('\n').map((row) => JSON.parse(row));
    expect(lines[0].user_name).toBe('旅人');
    expect(lines[0].character_name).toBe('星见澪');
    expect(lines[1].mes).toBe('星见澪: 要来一杯草莓奶茶吗？');
    expect(lines[1].is_user).toBe(false);
    expect(typeof lines[1].send_date).toBe('number');
  });

  it('优先使用 swipes 作为内容', () => {
    const text = [
      '{"user_name":"旅人","character_name":"Narrator","create_date":"2024-01-01 @00h 00m 00s 000ms"}',
      '{"name":"Narrator","is_user":false,"swipes":["候选 A","候选 B"],"swipe_id":1,"mes":""}',
    ].join('\n');

    const { messages, warnings } = parseSillyTavernJsonl({
      text,
      sessionId: 's1',
      createId: () => 'm1',
      userDisplayName: '',
      now: 0,
    });

    expect(warnings).toHaveLength(0);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('候选 B');
  });
});
