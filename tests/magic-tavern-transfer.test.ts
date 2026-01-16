import { describe, expect, it } from 'bun:test';

import { parseSillyTavernJsonl, stringifySillyTavernJsonl } from '@/lib/magic-tavern/transfer';
import type { MagicTavernMessage } from '@/lib/magic-tavern/types';

describe('magic tavern transfer', () => {
  it('可以导入 SillyTavern JSONL', () => {
    const text = [
      '{"name":"旅人","is_user":true,"mes":"你好","send_date":"2024-01-01T00:00:00.000Z"}',
      '{"name":"Narrator","is_user":false,"mes":"欢迎光临","send_date":1700000000}',
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
    expect(messages[1].content).toBe('欢迎光临');
  });

  it('导出 SillyTavern JSONL 会优先使用分段文本', () => {
    const messages: MagicTavernMessage[] = [
      {
        id: 'm1',
        sessionId: 's1',
        role: 'assistant',
        content: '',
        createdAt: 0,
        segments: [{ type: 'dialogue', speakerId: 'r1', speakerName: '星见澪', text: '要来一杯热可可吗？' }],
      },
    ];
    const jsonl = stringifySillyTavernJsonl({
      messages,
      userDisplayName: '旅人',
      roleNameLookup: (id) => id,
    });
    const line = JSON.parse(jsonl);
    expect(line.mes).toBe('星见澪: 要来一杯热可可吗？');
    expect(line.is_user).toBe(false);
  });
});
