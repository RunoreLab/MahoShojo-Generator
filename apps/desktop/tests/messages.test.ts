import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopCloudError, type InvokeFn } from '../src/platform/cloud-bridge';
import { MESSAGES_REQUEST_COMMAND, requestMessagesRoute } from '../src/platform/messages-bridge';
import {
  isMessagesSessionRejected,
  listMessages,
  markAllMessagesRead,
  markMessagesRead,
  MessagesApiError,
  MessagesSessionRejectedError,
  readMessagesSummary,
} from '../src/features/messages/messages-api';
import {
  ensureMessagesSummary,
  getMessagesSummaryEntry,
  getTopbarMessagesProjection,
  invalidateMessagesSummary,
  refreshMessagesSummary,
  resetMessagesSummaryForTests,
} from '../src/features/messages/topbar-messages';

const SUMMARY = {
  unreadTotal: 3,
  siteUnread: 1,
  directUnread: 2,
  latest: null,
  fetchedAt: '2026-10-12T00:00:00.000Z',
  isAuthenticated: true,
  hasCrowdReviewPending: true,
  crowdReviewPrompt: { title: '调查院有新的可处理案件', body: '你有新的众查案件待处理', actionUrl: '/investigation' },
};

const LIST_PAGE = {
  messages: [
    {
      id: 'user:12',
      scope: 'user',
      numericId: 12,
      messageType: 'card-reviewed',
      templateKey: 'unknown',
      title: '审核结果',
      body: '你的数据卡已通过审核',
      actionUrl: null,
      priority: 'normal',
      isRead: false,
      readAt: null,
      createdAt: '2026-10-11T08:00:00.000Z',
    },
  ],
  nextCursor: 'c1',
  filter: 'all',
  appliedFilter: 'all',
  fetchedAt: '2026-10-12T00:00:00.000Z',
  isAuthenticated: true,
};

/** 等 microtask 链结算。 */
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('messages bridge', () => {
  it('透传契约内请求并返回 status+body', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: SUMMARY }));
    const response = await requestMessagesRoute(invoke, { routeId: 'messages.summary' });
    expect(invoke).toHaveBeenCalledWith(MESSAGES_REQUEST_COMMAND, {
      request: { routeId: 'messages.summary' },
    });
    expect(response.status).toBe(200);
  });

  it('白名单外 routeId 在发出 IPC 前被拒绝', async () => {
    const invoke = vi.fn();
    await expect(
      requestMessagesRoute(invoke, { routeId: 'data-cards.query' as never }),
    ).rejects.toMatchObject({ name: 'DesktopCloudError', code: 'invalid-request' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('strict 契约拒绝 URL/凭据字段注入', async () => {
    const invoke = vi.fn();
    await expect(
      requestMessagesRoute(invoke, {
        routeId: 'messages.list',
        path: '/api/admin/users',
      } as never),
    ).rejects.toMatchObject({ code: 'invalid-request' });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('messages api adapters', () => {
  it('readMessagesSummary 校验 DTO 并拒绝非 2xx', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: SUMMARY }));
    await expect(readMessagesSummary(invoke)).resolves.toMatchObject({ unreadTotal: 3 });

    const denied = vi.fn(async () => ({ status: 503, body: { error: 'down' } }));
    await expect(readMessagesSummary(denied)).rejects.toMatchObject({
      name: 'MessagesApiError',
      status: 503,
    });
  });

  it('readMessagesSummary 拒绝不满足契约的正文', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: { unreadTotal: 'many' } }));
    await expect(readMessagesSummary(invoke)).rejects.toMatchObject({
      name: 'MessagesApiError',
      status: 0,
    });
  });

  it('200 + isAuthenticated:false 投影为会话被拒（d-1-r1）', async () => {
    // 服务端允许匿名访问 summary/list：本机有账号却拿到匿名 DTO = 服务端
    // 已不认当前凭据——必须把「匿名零未读」挡在缓存外并按会话收束。
    const anonymousSummary = {
      ...SUMMARY,
      unreadTotal: 0,
      siteUnread: 0,
      directUnread: 0,
      isAuthenticated: false,
      hasCrowdReviewPending: false,
      crowdReviewPrompt: null,
    };
    const invoke = vi.fn(async () => ({ status: 200, body: anonymousSummary }));
    await expect(readMessagesSummary(invoke)).rejects.toMatchObject({
      name: 'MessagesSessionRejectedError',
    });

    const anonymousList = { ...LIST_PAGE, isAuthenticated: false };
    const listInvoke = vi.fn(async () => ({ status: 200, body: anonymousList }));
    await expect(
      listMessages(listInvoke, { filter: 'all', expectAuthenticated: true }),
    ).rejects.toMatchObject({ name: 'MessagesSessionRejectedError' });
    // 匿名调用不受 expectAuthenticated 影响：公开全站列表照常返回。
    await expect(listMessages(listInvoke, { filter: 'all' })).resolves.toMatchObject({
      isAuthenticated: false,
    });
  });

  it('HTTP 401 统一投影为会话被拒（native 已清凭据）', async () => {
    const invoke = vi.fn(async () => ({ status: 401, body: { error: '未登录' } }));
    await expect(readMessagesSummary(invoke)).rejects.toMatchObject({
      name: 'MessagesSessionRejectedError',
    });
    await expect(listMessages(invoke, { filter: 'all' })).rejects.toMatchObject({
      name: 'MessagesSessionRejectedError',
    });
    await expect(markMessagesRead(invoke, ['user:1'])).rejects.toMatchObject({
      name: 'MessagesSessionRejectedError',
    });
    await expect(markAllMessagesRead(invoke)).rejects.toMatchObject({
      name: 'MessagesSessionRejectedError',
    });
  });

  it('isMessagesSessionRejected 识别三种拒收来源，普通失败不误判', () => {
    expect(isMessagesSessionRejected(new MessagesSessionRejectedError('x'))).toBe(true);
    expect(
      isMessagesSessionRejected(
        new DesktopCloudError('cloud_messages_request', 'not-authenticated', 'x'),
      ),
    ).toBe(true);
    expect(isMessagesSessionRejected(new MessagesApiError(401, 'x'))).toBe(true);
    expect(isMessagesSessionRejected(new MessagesApiError(503, 'x'))).toBe(false);
    expect(isMessagesSessionRejected(new MessagesApiError(0, 'x'))).toBe(false);
    expect(isMessagesSessionRejected(new Error('x'))).toBe(false);
  });

  it('listMessages 组装 filter/limit/cursor 查询', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: LIST_PAGE }));
    const page = await listMessages(invoke, { filter: 'unread', cursor: 'c0', limit: 20 });
    expect(invoke).toHaveBeenCalledWith(MESSAGES_REQUEST_COMMAND, {
      request: {
        routeId: 'messages.list',
        query: { filter: 'unread', limit: '20', cursor: 'c0' },
      },
    });
    expect(page.messages).toHaveLength(1);
    expect(page.nextCursor).toBe('c1');
  });

  it('markMessagesRead 发送 ids 数组', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: { markedCount: 1, ignoredCount: 0 } }));
    await markMessagesRead(invoke, ['user:12']);
    expect(invoke).toHaveBeenCalledWith(MESSAGES_REQUEST_COMMAND, {
      request: { routeId: 'messages.read', body: { ids: ['user:12'] } },
    });
  });
});

describe('topbar messages summary cache', () => {
  beforeEach(() => {
    resetMessagesSummaryForTests();
    vi.useRealTimers();
  });

  it('fetches once and serves the fresh projection within 90s', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: SUMMARY })) as unknown as InvokeFn;

    ensureMessagesSummary(7, invoke);
    await flush();
    expect(getTopbarMessagesProjection(7)).toEqual({
      unreadTotal: 3,
      hasCrowdReviewPending: true,
    });
    expect(invoke).toHaveBeenCalledTimes(1);

    // 90s 新鲜度内的重复 ensure 零网络。
    ensureMessagesSummary(7, invoke);
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('refetches once the entry is stale', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: SUMMARY })) as unknown as InvokeFn;
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);

    ensureMessagesSummary(7, invoke);
    await flush();
    now.mockReturnValue(1_000_000 + 91_000);
    ensureMessagesSummary(7, invoke);
    await flush();
    expect(invoke).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('keeps the last known projection when a refresh fails', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: SUMMARY })) as unknown as InvokeFn;
    ensureMessagesSummary(7, invoke);
    await flush();

    const failing = vi.fn(async () => ({ status: 503, body: {} })) as unknown as InvokeFn;
    await refreshMessagesSummary(7, failing);
    // 失败不伪造也不清空——上一份已知摘要仍在。
    expect(getTopbarMessagesProjection(7).unreadTotal).toBe(3);
  });

  it('invalidate during an in-flight fetch expires the late response', async () => {
    let release = (): void => {
      throw new Error('release not captured');
    };
    const invoke = vi.fn(
      async () =>
        new Promise<{ status: number; body: unknown }>((resolve) => {
          release = () => resolve({ status: 200, body: SUMMARY });
        }),
    ) as unknown as InvokeFn;

    ensureMessagesSummary(7, invoke);
    invalidateMessagesSummary(7);
    release();
    await flush();

    // 迟到响应被世代闸丢弃：登出/换号竞态不会写入旧摘要。
    expect(getMessagesSummaryEntry(7)).toBeNull();
  });

  it('旧世代在途请求不挡新世代拉取（d-1-r1 快速重登竞态）', async () => {
    // 旧请求仍在途时登出/换号推进世代：新世代 ensure 必须立刻发起新请求，
    // 而不是被旧 inflight 挡住——否则旧响应被世代闸丢弃后无人补取，
    // 摘要一直空白到下一次挂载/可见性刷新。
    let releaseOld = (): void => {
      throw new Error('release not captured');
    };
    const slowInvoke = vi.fn(
      async () =>
        new Promise<{ status: number; body: unknown }>((resolve) => {
          releaseOld = () => resolve({ status: 200, body: SUMMARY });
        }),
    ) as unknown as InvokeFn;

    ensureMessagesSummary(7, slowInvoke);
    invalidateMessagesSummary(7);

    const freshInvoke = vi.fn(async () => ({
      status: 200,
      body: { ...SUMMARY, unreadTotal: 5 },
    })) as unknown as InvokeFn;
    ensureMessagesSummary(7, freshInvoke);
    await flush();

    expect(freshInvoke).toHaveBeenCalledTimes(1);
    expect(getTopbarMessagesProjection(7).unreadTotal).toBe(5);

    // 旧响应迟到结算：世代闸丢弃，且不得误删新请求的登记。
    releaseOld();
    await flush();
    expect(getTopbarMessagesProjection(7).unreadTotal).toBe(5);
  });

  it('refresh 在 pre-mutation 请求在途时保证一次写后读取（d-1-r1）', async () => {
    // 已读操作要求「写后读取」：在途请求读的是 pre-mutation 状态，refresh
    // 只等它结算不算刷新——必须在其后再取一次拿到真实未读数。
    let releaseFirst = (): void => {
      throw new Error('release not captured');
    };
    let calls = 0;
    const invoke = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Promise<{ status: number; body: unknown }>((resolve) => {
          releaseFirst = () => resolve({ status: 200, body: SUMMARY });
        });
      }
      return {
        status: 200,
        body: { ...SUMMARY, unreadTotal: 0, siteUnread: 0, directUnread: 0 },
      };
    }) as unknown as InvokeFn;

    ensureMessagesSummary(7, invoke);
    const refreshPromise = refreshMessagesSummary(7, invoke);
    releaseFirst();
    await refreshPromise;

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(getTopbarMessagesProjection(7).unreadTotal).toBe(0);
  });

  it('reports not-authenticated once via onSessionRejected; api failures stay silent', async () => {
    const rejected = vi.fn();
    const notAuth = vi.fn(async () => {
      throw { code: 'not-authenticated', message: 'session rejected' };
    }) as unknown as InvokeFn;

    await refreshMessagesSummary(7, notAuth, rejected);
    expect(rejected).toHaveBeenCalledTimes(1);

    const failing = vi.fn(async () => ({ status: 503, body: {} })) as unknown as InvokeFn;
    await refreshMessagesSummary(7, failing, rejected);
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it('200 + isAuthenticated:false 不写缓存并上报会话收束（d-1-r1）', async () => {
    // 本机有账号、服务端会话已失效：summary 路由回匿名 DTO 而不是 401——
    // 摘要不得写成「0 未读」，宿主据此触发一次 refresh 收束身份投影。
    const rejected = vi.fn();
    const anonymousSummary = {
      ...SUMMARY,
      unreadTotal: 0,
      siteUnread: 0,
      directUnread: 0,
      isAuthenticated: false,
      hasCrowdReviewPending: false,
      crowdReviewPrompt: null,
    };
    const invoke = vi.fn(async () => ({ status: 200, body: anonymousSummary })) as unknown as InvokeFn;

    await refreshMessagesSummary(7, invoke, rejected);

    expect(getMessagesSummaryEntry(7)).toBeNull();
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it('HTTP 401 同样经 onSessionRejected 收束（native 已清凭据）', async () => {
    const rejected = vi.fn();
    const denied = vi.fn(async () => ({ status: 401, body: { error: '未登录' } })) as unknown as InvokeFn;

    await refreshMessagesSummary(7, denied, rejected);

    expect(getMessagesSummaryEntry(7)).toBeNull();
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it('scopes the cache by userId — another account never sees a stale summary', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: SUMMARY })) as unknown as InvokeFn;
    ensureMessagesSummary(7, invoke);
    await flush();

    expect(getTopbarMessagesProjection(7).unreadTotal).toBe(3);
    expect(getTopbarMessagesProjection(9)).toEqual({
      unreadTotal: 0,
      hasCrowdReviewPending: false,
    });
    expect(getTopbarMessagesProjection(null)).toEqual({
      unreadTotal: 0,
      hasCrowdReviewPending: false,
    });
  });
});
