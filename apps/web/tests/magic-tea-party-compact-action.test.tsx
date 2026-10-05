import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MagicTeaPartyChatMessage } from '@/components/magic-tea-party/ChatMessage';
import type { MagicTeaPartyMessage, MagicTeaPartyPreferences, MagicTeaPartySession } from '@/lib/magic-tea-party/types';

const preferences = { userDisplayName: '旅人', outputFormat: 'jsonl' } as unknown as MagicTeaPartyPreferences;

const buildSession = (): MagicTeaPartySession =>
  ({
    id: 's1',
    title: '会话',
    roles: [],
    scenario: null,
    settings: { providerId: 'p', modelId: 'm', outputFormat: 'jsonl' },
  }) as unknown as MagicTeaPartySession;

const buildMessage = (overrides: Partial<MagicTeaPartyMessage>): MagicTeaPartyMessage =>
  ({
    id: 'm1',
    sessionId: 's1',
    role: 'assistant',
    content: '正文',
    createdAt: 1,
    status: 'done',
    ...overrides,
  }) as unknown as MagicTeaPartyMessage;

const renderMessage = (message: MagicTeaPartyMessage, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <MagicTeaPartyChatMessage
      message={message}
      session={buildSession()}
      preferences={preferences}
      isGenerating={false}
      {...props}
    />
  );

const COMPACT_LABEL = '精简长消息';

describe('魔法茶会「精简长消息」入口显隐', () => {
  it('未超单条预算时不渲染该入口', () => {
    const html = renderMessage(buildMessage({ content: '短正文' }), {
      messageCharLimit: 8_000,
      onCompactMessage: () => {},
    });
    expect(html).not.toContain(COMPACT_LABEL);
  });

  it('超单条预算时渲染该入口', () => {
    const html = renderMessage(buildMessage({ content: '长'.repeat(20_000) }), {
      messageCharLimit: 8_000,
      onCompactMessage: () => {},
    });
    expect(html).toContain(COMPACT_LABEL);
  });

  it('未超预算时该入口不会撑出空操作行（回归防护）', () => {
    // 若显隐判断恒为真，每条消息下方都会多出一个空的操作行容器
    const html = renderMessage(buildMessage({ content: '短正文' }), {
      messageCharLimit: 8_000,
      onCompactMessage: () => {},
    });
    expect(html).not.toContain('items-center justify-end gap-2 text-xs text-gray-500');
  });

  it('缺少 messageCharLimit 时不渲染该入口', () => {
    const html = renderMessage(buildMessage({ content: '长'.repeat(50_000) }), {
      onCompactMessage: () => {},
    });
    expect(html).not.toContain(COMPACT_LABEL);
  });

  it('缺少 onCompactMessage 时不渲染该入口', () => {
    const html = renderMessage(buildMessage({ content: '长'.repeat(50_000) }), {
      messageCharLimit: 8_000,
    });
    expect(html).not.toContain(COMPACT_LABEL);
  });

  it('用户消息同样有该入口', () => {
    const html = renderMessage(buildMessage({ role: 'user', content: '长'.repeat(20_000) }), {
      messageCharLimit: 8_000,
      onCompactMessage: () => {},
    });
    expect(html).toContain(COMPACT_LABEL);
  });

  it('恰好等于预算时不渲染（边界不含）', () => {
    const html = renderMessage(buildMessage({ content: 'x'.repeat(8_000) }), {
      messageCharLimit: 8_000,
      onCompactMessage: () => {},
    });
    expect(html).not.toContain(COMPACT_LABEL);
  });

  // 助手消息有 4 条渲染分支（raw / segments / markdown / 纯文本），
  // 新增 prop 必须四条都传，否则「精简长消息」只在部分视图里出现。
  it.each([
    ['raw 视图', { outputView: 'raw' as const }],
    ['markdown 正文', { outputView: 'rendered' as const, sessionOutputFormat: 'markdown' as const }],
    ['jsonl 纯文本', {}],
    [
      '带 segments 的 jsonl',
      {
        segments: [{ type: 'narration' as const, text: '旁白' }],
      },
    ],
  ])('助手消息在 %s 分支同样有该入口', (_label, extra) => {
    const session = extra.sessionOutputFormat
      ? {
          ...buildSession(),
          settings: { ...buildSession().settings, outputFormat: 'markdown' as const },
        }
      : buildSession();
    const html = renderToStaticMarkup(
      <MagicTeaPartyChatMessage
        message={buildMessage({ content: '长'.repeat(20_000), ...extra })}
        session={session}
        preferences={preferences}
        isGenerating={false}
        messageCharLimit={8_000}
        onCompactMessage={() => {}}
        outputView={extra.outputView as 'raw' | 'rendered' | undefined}
      />
    );
    expect(html).toContain(COMPACT_LABEL);
  });
});
