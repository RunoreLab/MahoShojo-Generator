import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { MessageCard } from '@/components/messages/MessageCard';

describe('messages page UI', () => {
  test('message card renders title, body, unread marker and action link', () => {
    const html = renderToStaticMarkup(
      <MessageCard
        message={{
          id: 'site:3',
          scope: 'site',
          numericId: 3,
          messageType: 'issue',
          templateKey: 'site.issue.update',
          title: '问题处理进展',
          body: 'PVP 结算异常已修复。',
          actionUrl: '/pvp',
          priority: 'normal',
          isRead: false,
          readAt: null,
          createdAt: '2026-04-07T10:00:00.000Z',
        }}
      />,
    );

    expect(html).toContain('问题处理进展');
    expect(html).toContain('PVP 结算异常已修复');
    expect(html).toContain('href="/pvp"');
    expect(html).toContain('普通优先级');
  });

  test('only unread direct messages render per-item mark-read action', () => {
    const unreadDirect = renderToStaticMarkup(
      <MessageCard
        message={{
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
        }}
        canMarkRead={true}
      />,
    );
    const unreadSite = renderToStaticMarkup(
      <MessageCard
        message={{
          id: 'site:3',
          scope: 'site',
          numericId: 3,
          messageType: 'issue',
          templateKey: 'site.issue.update',
          title: '问题处理进展',
          body: 'PVP 结算异常已修复。',
          actionUrl: null,
          priority: 'normal',
          isRead: false,
          readAt: null,
          createdAt: '2026-04-07T10:00:00.000Z',
        }}
        canMarkRead={false}
      />,
    );

    expect(unreadDirect).toContain('标记已读');
    expect(unreadSite).not.toContain('标记已读');
  });

  test('messages page renders load-more affordance when nextCursor exists', async () => {
    const { MessagesPage } = await import('@/components/messages/MessagesPage');
    const html = renderToStaticMarkup(
      <MessagesPage
        initialStateOverride={{
          isAuthenticated: true,
          filter: 'all',
          appliedFilter: 'all',
          messages: [],
          nextCursor: 'cursor-1',
          loading: false,
          summary: null,
        }}
      />,
    );

    expect(html).toContain('加载更多');
  });

  test('messages page header renders unread summary counts for authenticated users', async () => {
    const { MessagesPage } = await import('@/components/messages/MessagesPage');
    const html = renderToStaticMarkup(
      <MessagesPage
        initialStateOverride={{
          isAuthenticated: true,
          filter: 'all',
          appliedFilter: 'all',
          messages: [],
          nextCursor: null,
          loading: false,
          summary: {
            unreadTotal: 5,
            siteUnread: 2,
            directUnread: 3,
            latest: null,
            fetchedAt: '2026-04-07T10:00:00.000Z',
            isAuthenticated: true,
            hasCrowdReviewPending: false,
            crowdReviewPrompt: null,
          },
        }}
      />,
    );

    expect(html).toContain('未读');
    expect(html).toContain('5');
    expect(html).toContain('2');
    expect(html).toContain('3');
  });

  test('auth downgrade clears private messages and coerces restricted filters', async () => {
    const { reconcileMessagesPageStateForAuth } = await import('@/components/messages/MessagesPage');
    const next = reconcileMessagesPageStateForAuth(
      {
        isAuthenticated: true,
        filter: 'direct',
        appliedFilter: 'direct',
        messages: [
          {
            id: 'user:9',
            scope: 'user',
            numericId: 9,
            messageType: 'moderation',
            templateKey: 'user.moderation.data_card_rejected',
            title: '审核未通过',
            body: '仅登录用户可见',
            actionUrl: null,
            priority: 'high',
            isRead: false,
            readAt: null,
            createdAt: '2026-04-07T10:00:00.000Z',
          },
        ],
        nextCursor: 'private-cursor',
        loading: false,
        summary: {
          unreadTotal: 3,
          siteUnread: 1,
          directUnread: 2,
          latest: null,
          fetchedAt: '2026-04-07T10:00:00.000Z',
          isAuthenticated: true,
          hasCrowdReviewPending: false,
          crowdReviewPrompt: null,
        },
        error: 'old error',
      },
      false,
    );

    expect(next.filter).toBe('site');
    expect(next.appliedFilter).toBe('site');
    expect(next.messages).toEqual([]);
    expect(next.nextCursor).toBeNull();
    expect(next.summary).toBeNull();
    expect(next.error).toBeNull();
  });

  test('stale load-more responses are ignored when filter or cursor changed', async () => {
    const { shouldApplyMessagesLoadMore } = await import('@/components/messages/MessagesPage');

    expect(
      shouldApplyMessagesLoadMore(
        {
          isAuthenticated: true,
          filter: 'unread',
          appliedFilter: 'unread',
          messages: [],
          nextCursor: 'cursor-new',
          loading: false,
          summary: null,
          error: null,
        },
        { filter: 'all', cursor: 'cursor-old' },
      ),
    ).toBe(false);
  });

  test('user switch while staying authenticated clears previous user payloads', async () => {
    const { reconcileMessagesPageStateForAuth } = await import('@/components/messages/MessagesPage');
    const next = reconcileMessagesPageStateForAuth(
      {
        isAuthenticated: true,
        filter: 'direct',
        appliedFilter: 'direct',
        messages: [
          {
            id: 'user:9',
            scope: 'user',
            numericId: 9,
            messageType: 'moderation',
            templateKey: 'user.moderation.data_card_rejected',
            title: '用户 A 的消息',
            body: '不应保留到用户 B',
            actionUrl: null,
            priority: 'high',
            isRead: false,
            readAt: null,
            createdAt: '2026-04-07T10:00:00.000Z',
          },
        ],
        nextCursor: 'user-a-cursor',
        loading: false,
        summary: {
          unreadTotal: 2,
          siteUnread: 0,
          directUnread: 2,
          latest: null,
          fetchedAt: '2026-04-07T10:00:00.000Z',
          isAuthenticated: true,
          hasCrowdReviewPending: false,
          crowdReviewPrompt: null,
        },
        error: 'old error',
      },
      true,
      true,
    );

    expect(next.filter).toBe('direct');
    expect(next.messages).toEqual([]);
    expect(next.nextCursor).toBeNull();
    expect(next.summary).toBeNull();
    expect(next.error).toBeNull();
  });

  test('viewer ownership guard hides stale messages before auth effects run', async () => {
    const { isMessagesPageStateForViewer } = await import('@/components/messages/MessagesPage');

    expect(isMessagesPageStateForViewer(7, 7)).toBe(true);
    expect(isMessagesPageStateForViewer(7, 8)).toBe(false);
    expect(isMessagesPageStateForViewer(7, null)).toBe(false);
  });

  test('summary failure preserves successful message list payload for authenticated users', async () => {
    const { resolveMessagesPageDataRequests } = await import('@/components/messages/MessagesPage');
    const listPayload = {
      messages: [
        {
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
        },
      ],
      nextCursor: null,
      filter: 'all',
      appliedFilter: 'all',
      fetchedAt: '2026-04-07T10:00:00.000Z',
      isAuthenticated: true,
    } as const;

    expect(
      resolveMessagesPageDataRequests({
        isAuthenticated: true,
        listResult: { status: 'fulfilled', value: listPayload },
        summaryResult: { status: 'rejected', reason: new Error('summary:503') },
      }),
    ).toEqual({
      listPayload,
      summaryPayload: null,
    });
  });

  test('empty-state copy follows the active filter semantics', async () => {
    const { getMessagesPageEmptyStateCopy } = await import('@/components/messages/MessagesPage');

    expect(getMessagesPageEmptyStateCopy('all', true)).toBe('暂无消息');
    expect(getMessagesPageEmptyStateCopy('unread', true)).toBe('没有未读消息');
    expect(getMessagesPageEmptyStateCopy('site', true)).toBe('暂无全站通知');
    expect(getMessagesPageEmptyStateCopy('direct', true)).toBe('暂无定向消息');
  });

  test('renders crowd review prompt card above the list when summary includes prompt data', async () => {
    const { MessagesPage } = await import('@/components/messages/MessagesPage');
    const html = renderToStaticMarkup(
      <MessagesPage
        initialStateOverride={{
          isAuthenticated: true,
          filter: 'all',
          appliedFilter: 'all',
          messages: [],
          nextCursor: null,
          loading: false,
          summary: {
            unreadTotal: 0,
            siteUnread: 0,
            directUnread: 0,
            latest: null,
            fetchedAt: '2026-04-07T10:00:00.000Z',
            isAuthenticated: true,
            hasCrowdReviewPending: true,
            crowdReviewPrompt: {
              title: '调查院有新的可处理案件',
              body: '你有新的众查案件待处理，前往调查院查看',
              actionUrl: '/investigation',
            },
          },
        }}
      />,
    );

    expect(html).toContain('调查院有新的可处理案件');
    expect(html).toContain('href="/investigation"');
  });
});
