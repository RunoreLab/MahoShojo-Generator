// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessagePreviewDto } from '@mahoshojo/contracts/messages';

import {
  classifyMessageActionUrl,
  CrowdReviewPromptCard,
  getMessagesPageRequestFilter,
  MessageCard,
  MessageFilters,
  reconcileMessagesPageStateForAuth,
  type MessagesPageState,
} from '../src/messages/index';

let container: HTMLDivElement;
let root: Root;

const render = (node: Parameters<Root['render']>[0]): void => {
  act(() => {
    root.render(node);
  });
};

const click = (el: Element, init?: MouseEventInit): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  });
};

const PREVIEW: MessagePreviewDto = {
  id: 'user:9',
  scope: 'user',
  numericId: 9,
  messageType: 'moderation',
  templateKey: 'user.moderation.data_card_rejected',
  title: '审核未通过',
  body: '请修改后重新提交。',
  actionUrl: '/character-manager',
  priority: 'high',
  isRead: false,
  readAt: null,
  createdAt: '2026-04-07T10:00:00.000Z',
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('classifyMessageActionUrl', () => {
  it('产品路径为 internal，http(s) 为 external，其余一律不渲染链接', () => {
    expect(classifyMessageActionUrl('/investigation')).toEqual({ kind: 'internal', href: '/investigation' });
    expect(classifyMessageActionUrl('/ok/path?x=1#frag')).toEqual({ kind: 'internal', href: '/ok/path?x=1#frag' });
    expect(classifyMessageActionUrl('https://example.com/x')).toEqual({ kind: 'external', href: 'https://example.com/x' });
    expect(classifyMessageActionUrl('javascript:alert(1)').kind).toBe('unsafe');
    expect(classifyMessageActionUrl('data:text/html,<p>').kind).toBe('unsafe');
    expect(classifyMessageActionUrl('not a url').kind).toBe('unsafe');
    expect(classifyMessageActionUrl(null).kind).toBe('unsafe');
  });

  it('internal 与服务端 admin action 同口径：//、反斜杠、控制字符/空白一律 unsafe', () => {
    // `//evil.example` 是 protocol-relative 外链，不是站内路径；
    // `/\evil.example` 会被浏览器折叠成 `//evil.example`。
    expect(classifyMessageActionUrl('//evil.example').kind).toBe('unsafe');
    expect(classifyMessageActionUrl('/\\evil.example').kind).toBe('unsafe');
    expect(classifyMessageActionUrl('/path\nheader').kind).toBe('unsafe');
    expect(classifyMessageActionUrl('/path tail').kind).toBe('unsafe');
    expect(classifyMessageActionUrl('/path\x7fedge').kind).toBe('unsafe');
  });

  it('external 与 native 同口径：带凭据、无 host、含空白/控制字符一律 unsafe', () => {
    expect(classifyMessageActionUrl('https://user:pass@example.com/').kind).toBe('unsafe');
    expect(classifyMessageActionUrl('https://user@example.com/').kind).toBe('unsafe');
    expect(classifyMessageActionUrl('https://example .com/').kind).toBe('unsafe');
    expect(classifyMessageActionUrl('https://example.com/\nSet-Cookie: x=1').kind).toBe('unsafe');
    expect(classifyMessageActionUrl('https://example.com/ok').kind).toBe('external');
  });

  it('external 与 native 同口径：先 trim 再校验，回传 trim 后的 href', () => {
    // native `validate_external_url` 第一步就是 trim——首尾空白折叠后放行。
    expect(classifyMessageActionUrl('  https://example.com/x  ')).toEqual({
      kind: 'external',
      href: 'https://example.com/x',
    });
    expect(classifyMessageActionUrl('   ').kind).toBe('unsafe');
  });

  it('external 与 native 同口径：长度按 UTF-8 字节 ≤ 2048', () => {
    // `https://example.com/` 恰 20 字节：总长 2048 放行、2049 拒绝。
    expect(classifyMessageActionUrl(`https://example.com/${'a'.repeat(2028)}`).kind).toBe('external');
    expect(classifyMessageActionUrl(`https://example.com/${'a'.repeat(2029)}`).kind).toBe('unsafe');
    // 680 个「中」= 2040 字节，码元长度远低于 2048——按字节计仍超限。
    expect(classifyMessageActionUrl(`https://example.com/${'中'.repeat(680)}`).kind).toBe('unsafe');
  });

  it('external 与 native 同口径：非 ASCII 空白/控制字符一律 unsafe', () => {
    // Rust `is_whitespace`/`is_control` ↔ Unicode `White_Space`/`Cc`：
    // NBSP、NEL、U+2028、U+3000 与 C1 控制字符都不得进入链接类别。
    const nonAsciiForbidden = [0x00a0, 0x0085, 0x2028, 0x3000, 0x009f].map((cp) => String.fromCodePoint(cp));
    for (const bad of nonAsciiForbidden) {
      expect(classifyMessageActionUrl(`https://example.com/${bad}x`).kind).toBe('unsafe');
    }
  });
});

describe('MessageCard', () => {
  it('renders 标题/正文/未读标记与解析后的内部 href', () => {
    render(
      <MessageCard
        message={PREVIEW}
        resolveInternalHref={(href) => `#${href}`}
      />,
    );
    expect(container.textContent).toContain('审核未通过');
    expect(container.textContent).toContain('未读');
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('#/character-manager');
  });

  it('普通主键点击拦截后交 onNavigate；修饰键点击不拦截', () => {
    const onNavigate = vi.fn();
    render(<MessageCard message={PREVIEW} onNavigate={onNavigate} />);
    const link = container.querySelector('a')!;

    click(link);
    expect(onNavigate).toHaveBeenCalledWith('/character-manager');

    onNavigate.mockClear();
    click(link, { ctrlKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('站外 actionUrl 交 onNavigateExternal；无 handler 时保留原生锚点', () => {
    const onNavigateExternal = vi.fn();
    const message = { ...PREVIEW, actionUrl: 'https://wantu-waystation.pages.dev/' };
    render(<MessageCard message={message} onNavigateExternal={onNavigateExternal} />);
    const link = container.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://wantu-waystation.pages.dev/');
    click(link);
    expect(onNavigateExternal).toHaveBeenCalledWith('https://wantu-waystation.pages.dev/');
  });

  it('javascript: 等非白名单 actionUrl 不渲染链接', () => {
    render(<MessageCard message={{ ...PREVIEW, actionUrl: 'javascript:alert(1)' }} />);
    expect(container.querySelector('a')).toBeNull();
    // 标记已读按钮与正文仍正常渲染。
    expect(container.textContent).toContain('审核未通过');
  });
});

describe('MessageFilters', () => {
  it('登录态四项、匿名态只保留 全部/全站', () => {
    render(<MessageFilters activeFilter="all" isAuthenticated={true} onChange={() => undefined} />);
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      '全部',
      '未读',
      '全站',
      '定向',
    ]);

    render(<MessageFilters activeFilter="site" isAuthenticated={false} onChange={() => undefined} />);
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['全部', '全站']);
  });
});

describe('CrowdReviewPromptCard', () => {
  it('renders 提示卡并把 actionUrl 解析为内部链接', () => {
    render(
      <CrowdReviewPromptCard
        prompt={{ title: '调查院有新的可处理案件', body: '你有新的众查案件待处理', actionUrl: '/investigation' }}
        resolveInternalHref={(href) => `#${href}`}
      />,
    );
    expect(container.textContent).toContain('调查院有新的可处理案件');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('#/investigation');
  });
});

describe('messages page state helpers', () => {
  const state: MessagesPageState = {
    isAuthenticated: true,
    filter: 'direct',
    appliedFilter: 'direct',
    messages: [PREVIEW],
    nextCursor: 'c1',
    loading: false,
    summary: null,
    error: null,
  };

  it('匿名态请求筛选强制落 site', () => {
    expect(getMessagesPageRequestFilter('unread', false)).toBe('site');
    expect(getMessagesPageRequestFilter('direct', false)).toBe('site');
    expect(getMessagesPageRequestFilter('all', true)).toBe('all');
  });

  it('降级到匿名清空私有列表与摘要', () => {
    const next = reconcileMessagesPageStateForAuth(state, false);
    expect(next.isAuthenticated).toBe(false);
    expect(next.messages).toHaveLength(0);
    expect(next.nextCursor).toBeNull();
    expect(next.appliedFilter).toBe('site');
  });
});
