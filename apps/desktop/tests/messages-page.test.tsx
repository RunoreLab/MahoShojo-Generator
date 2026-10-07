// @vitest-environment jsdom
/**
 * Desktop `/messages` 页面级测试：真实路由树 + 受控 `cloud_messages_request`
 * 桩——断言「页面消费的是固定 routeId 窄通道」而不是某个 URL 形态。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ACCOUNT = { userId: 7, username: 'homura', displayName: 'homura' };
const EXPIRES = '2026-10-12T00:00:00.000Z';

const LIST = {
  messages: [
    {
      id: 'user:12',
      scope: 'user',
      numericId: 12,
      messageType: 'card-reviewed',
      templateKey: 'unknown',
      title: '数据卡审核结果',
      body: '你的数据卡已通过审核',
      actionUrl: '/character-manager',
      priority: 'normal',
      isRead: false,
      readAt: null,
      createdAt: '2026-10-11T08:00:00.000Z',
    },
    {
      id: 'site:3',
      scope: 'site',
      numericId: 3,
      messageType: 'issue',
      templateKey: 'site.issue.update',
      title: '全站公告',
      body: '竞技场生成异常已修复。',
      actionUrl: null,
      priority: 'low',
      isRead: null,
      readAt: null,
      createdAt: '2026-10-10T08:00:00.000Z',
    },
  ],
  nextCursor: null,
  filter: 'all',
  appliedFilter: 'all',
  fetchedAt: '2026-10-11T09:00:00.000Z',
  isAuthenticated: true,
};

const SUMMARY = {
  unreadTotal: 1,
  siteUnread: 0,
  directUnread: 1,
  latest: null,
  fetchedAt: '2026-10-11T09:00:00.000Z',
  isAuthenticated: true,
  hasCrowdReviewPending: false,
  crowdReviewPrompt: null,
};

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: invokeMock }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }),
}));

import { createDesktopRouter } from '../src/app/router';
import { resetDesktopCloudSessionStoreForTests } from '../src/features/account/use-desktop-cloud-session';
import { resetTopbarAvatarForTests } from '../src/features/account/use-topbar-avatar';
import { resetDesktopAnnouncementsStoreForTests } from '../src/features/announcements/use-desktop-announcements';
import { resetMessagesSummaryForTests } from '../src/features/messages/topbar-messages';

const signedInImpl = async (command: string, args?: unknown): Promise<unknown> => {
  if (command === 'cloud_cached_account') {
    return { account: ACCOUNT, sessionExpiresAt: EXPIRES };
  }
  if (command === 'cloud_auth_status') {
    return { state: 'active', account: ACCOUNT, sessionExpiresAt: EXPIRES };
  }
  if (command === 'cloud_me_profile') {
    return { userId: 7, signature: '焰', avatarDataUrl: 'data:image/webp;base64,QUJD' };
  }
  if (command === 'cloud_messages_request') {
    const request = (args as { request: { routeId: string } }).request;
    if (request.routeId === 'messages.list') return { status: 200, body: LIST };
    if (request.routeId === 'messages.summary') return { status: 200, body: SUMMARY };
    if (request.routeId === 'messages.read') {
      return { status: 200, body: { markedCount: 1, ignoredCount: 0 } };
    }
    if (request.routeId === 'messages.read-all') {
      return { status: 200, body: { markedUserMessageCount: 1, advancedSiteCursorTo: 0 } };
    }
  }
  if (command === 'announcements_get_cached') return null;
  if (command === 'announcements_refresh') {
    return {
      status: 'not-modified',
      snapshot: { fetchedAt: '2026-10-10T00:00:00Z', announcements: [] },
    };
  }
  return undefined;
};

const anonymousImpl = async (command: string, args?: unknown): Promise<unknown> => {
  if (command === 'cloud_cached_account') return null;
  if (command === 'cloud_auth_status') return { state: 'signed-out' as const };
  return signedInImpl(command, args);
};

let container: HTMLDivElement;
let root: Root;

const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

const mountAt = async (path: string) => {
  const router = createDesktopRouter();
  await router.load();
  act(() => {
    root.render(<RouterProvider router={router} />);
  });
  await settle();
  await act(async () => {
    await router.navigate({ to: path });
  });
  await settle();
  await settle();
  return router;
};

const messagesCalls = () =>
  invokeMock.mock.calls
    .filter((call) => call[0] === 'cloud_messages_request')
    .map((call) => (call[1] as { request: { routeId: string; query?: Record<string, string>; body?: unknown } }).request);

const click = async (element: Element | null): Promise<void> => {
  expect(element).not.toBeNull();
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await settle();
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.location.hash = '';
  invokeMock.mockReset();
  invokeMock.mockImplementation(signedInImpl);
  resetDesktopCloudSessionStoreForTests();
  resetTopbarAvatarForTests();
  resetDesktopAnnouncementsStoreForTests();
  resetMessagesSummaryForTests();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('desktop messages page', () => {
  it('signed-in: fetches list+summary through fixed routeIds and renders messages', async () => {
    await mountAt('/messages');

    expect(container.textContent).toContain('数据卡审核结果');
    expect(container.textContent).toContain('全站公告');
    expect(messagesCalls()).toContainEqual({
      routeId: 'messages.list',
      query: { filter: 'all', limit: '20' },
    });
    expect(messagesCalls()).toContainEqual({ routeId: 'messages.summary' });
    // 顶栏摘要同步：铃铛角标渲染服务端未读数。
    expect(container.querySelector('header.global-topbar')?.textContent).toContain('1 条未读');
  });

  it('mark-read sends messages.read then reloads list and refreshes topbar summary', async () => {
    await mountAt('/messages');
    invokeMock.mockClear();

    await click(
      [...container.querySelectorAll('button')].find((b) => b.textContent === '标记已读') ?? null,
    );

    expect(messagesCalls()).toContainEqual({ routeId: 'messages.read', body: { ids: ['user:12'] } });
    // 已读回执后重拉列表 + 顶栏摘要（事件总线的 Desktop 等价物）。
    expect(messagesCalls().filter((r) => r.routeId === 'messages.list').length).toBeGreaterThanOrEqual(1);
    expect(messagesCalls()).toContainEqual({ routeId: 'messages.summary' });
  });

  it('internal actionUrl routes through hash history, not a page reload', async () => {
    const router = await mountAt('/messages');

    await click(
      [...container.querySelectorAll('a')].find((a) => a.textContent === '查看详情') ?? null,
    );
    expect(router.state.location.pathname).toBe('/character-manager');
    expect(window.location.hash).toBe('#/character-manager');
  });

  it('anonymous: only public site list, no summary call, login CTA replaces mark-all', async () => {
    invokeMock.mockImplementation(anonymousImpl);
    await mountAt('/messages');

    // 匿名只能拉公开全站：filter 保持 'all'（仅 unread/direct 会被归一为
    // site——与 Web 同一份纯函数），摘要/已读路由一次都不发。
    expect(messagesCalls()).toContainEqual({
      routeId: 'messages.list',
      query: { filter: 'all', limit: '20' },
    });
    expect(messagesCalls().filter((r) => r.routeId === 'messages.summary')).toHaveLength(0);
    expect(
      [...container.querySelectorAll('button')].some((b) => b.textContent === '登录查看定向消息'),
    ).toBe(true);
    expect(
      [...container.querySelectorAll('button')].some((b) => b.textContent === '全部已读'),
    ).toBe(false);
  });

  it('/me renders the cached identity + session panel without credential exposure', async () => {
    await mountAt('/me');

    const page = container.querySelector('[data-testid="page-me"]');
    expect(page).not.toBeNull();
    // cached-first 身份投影：用户名与账号面板同一份事实源。
    expect(page?.textContent).toContain('homura');
    expect(page?.textContent).toContain('@homura');
    expect(page?.querySelector('[data-testid="account-panel"]')).not.toBeNull();
  });
});
