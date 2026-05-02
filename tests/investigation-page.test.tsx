import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

class CustomEventPolyfill<T = unknown> extends Event {
  detail: T;

  constructor(type: string, init?: CustomEventInit<T>) {
    super(type);
    this.detail = (init?.detail ?? null) as T;
  }
}

describe('investigation page', () => {
  test('eligible inspectors still attempt current-case recovery after refresh without an active assignment', async () => {
    const { shouldFetchCurrentCaseOnLoad } = await import('@/components/investigation/InvestigationPage');

    expect(
      shouldFetchCurrentCaseOnLoad('authenticated', {
        eligible: true,
        inspectorStatus: 'active',
        statusReason: null,
        hasCurrentAssignment: false,
        hasCrowdReviewPending: false,
        entryUrl: '/investigation',
      }),
    ).toBe(true);
    expect(
      shouldFetchCurrentCaseOnLoad('anonymous', {
        eligible: true,
        inspectorStatus: 'active',
        statusReason: null,
        hasCurrentAssignment: true,
        hasCrowdReviewPending: true,
        entryUrl: '/investigation',
      }),
    ).toBe(false);
  });

  test('renders login-required state for anonymous viewers', async () => {
    const { InvestigationPage } = await import('@/components/investigation/InvestigationPage');
    const html = renderToStaticMarkup(
      <InvestigationPage
        initialStateOverride={{
          authState: 'anonymous',
          summary: {
            eligible: false,
            inspectorStatus: 'anonymous',
            statusReason: '登录后可查看调查院状态',
            hasCurrentAssignment: false,
            hasCrowdReviewPending: false,
            entryUrl: '/investigation',
          },
          currentCase: null,
          loading: false,
          error: null,
        }}
      />,
    );

    expect(html).toContain('请先登录');
    expect(html).toContain('调查院');
  });

  test('renders suspended state when inspector status is suspended', async () => {
    const { InvestigationPage } = await import('@/components/investigation/InvestigationPage');
    const html = renderToStaticMarkup(
      <InvestigationPage
        initialStateOverride={{
          authState: 'authenticated',
          summary: {
            eligible: false,
            inspectorStatus: 'suspended',
            statusReason: '等待人工复核',
            hasCurrentAssignment: false,
            hasCrowdReviewPending: false,
            entryUrl: '/investigation',
          },
          currentCase: null,
          loading: false,
          error: null,
        }}
      />,
    );

    expect(html).toContain('当前不可参与众查');
    expect(html).toContain('等待人工复核');
  });

  test('renders revoked state when inspector qualification has been removed', async () => {
    const { InvestigationPage } = await import('@/components/investigation/InvestigationPage');
    const html = renderToStaticMarkup(
      <InvestigationPage
        initialStateOverride={{
          authState: 'authenticated',
          summary: {
            eligible: false,
            inspectorStatus: 'revoked',
            statusReason: '资格已撤销',
            hasCurrentAssignment: false,
            hasCrowdReviewPending: false,
            entryUrl: '/investigation',
          },
          currentCase: null,
          loading: false,
          error: null,
        }}
      />,
    );

    expect(html).toContain('当前不可参与众查');
    expect(html).toContain('资格已撤销');
  });

  test('renders current case card with vote actions and no tally text before vote', async () => {
    const { InvestigationPage } = await import('@/components/investigation/InvestigationPage');
    const html = renderToStaticMarkup(
      <InvestigationPage
        initialStateOverride={{
          authState: 'authenticated',
          summary: {
            eligible: true,
            inspectorStatus: 'active',
            statusReason: null,
            hasCurrentAssignment: true,
            hasCrowdReviewPending: true,
            entryUrl: '/investigation',
          },
          currentCase: {
            assignmentId: 'assignment-1',
            assignmentStatus: 'assigned',
            assignedAt: '2026-04-08T12:00:00.000Z',
            expiresAt: '2026-04-08T12:30:00.000Z',
            caseId: 'round-1',
            reportCaseId: 'case-1',
            targetEntityType: 'data_card',
            targetEntityId: 'card-1',
            targetSnapshot: { name: '公开卡', description: '描述' },
            reportSummary: {
              reasonLabels: ['疑似抄袭'],
              details: ['文本高度近似'],
              references: ['引用公开数据卡：对照卡'],
              referenceItems: [
                {
                  referenceType: 'public_data_card',
                  referenceId: 'card-2',
                  labelSnapshot: '对照卡',
                  urlSnapshot: '/character-manager?dataCardId=card-2',
                  note: null,
                },
              ],
            },
            ruleHints: ['投票前不会展示票况'],
            availableDecisions: ['violation', 'no_violation', 'abstain'],
            postVoteSummary: null,
          },
          loading: false,
          error: null,
        }}
      />,
    );

    expect(html).toContain('支持违规');
    expect(html).toContain('支持不违规');
    expect(html).toContain('弃权');
    expect(html).toContain('查看卡片详情');
    expect(html).toContain('查看引用卡详情');
    expect(html).not.toContain('有效票');
  });

  test('renders assignable state again after a completed case is kept for post-vote summary', async () => {
    const { InvestigationPage } = await import('@/components/investigation/InvestigationPage');
    const html = renderToStaticMarkup(
      <InvestigationPage
        initialStateOverride={{
          authState: 'authenticated',
          summary: {
            eligible: true,
            inspectorStatus: 'active',
            statusReason: null,
            hasCurrentAssignment: false,
            hasCrowdReviewPending: true,
            entryUrl: '/investigation',
          },
          currentCase: {
            assignmentId: 'assignment-1',
            assignmentStatus: 'voted',
            assignedAt: '2026-04-08T12:00:00.000Z',
            expiresAt: '2026-04-08T12:30:00.000Z',
            caseId: 'round-1',
            reportCaseId: 'case-1',
            targetEntityType: 'data_card',
            targetEntityId: 'card-1',
            targetSnapshot: { name: '公开卡', description: '描述' },
            reportSummary: {
              reasonLabels: ['疑似抄袭'],
              details: ['文本高度近似'],
              references: ['引用公开数据卡：对照卡'],
            },
            ruleHints: ['投票前不会展示票况'],
            availableDecisions: ['violation', 'no_violation', 'abstain'],
            postVoteSummary: {
              roundStatus: 'concluded',
              resultCode: 'violation',
              summaryText: '当前轮次已形成“支持违规”结果。',
            },
          },
          loading: false,
          error: null,
        }}
      />,
    );

    expect(html).toContain('当前没有已领取案件');
    expect(html).toContain('领取当前案件');
    expect(html).toContain('本次提交已记录');
  });

  test('dispatches message-summary invalidation event after crowd-review completion refreshes availability', async () => {
    const module = await import('@/components/investigation/InvestigationPage');
    const notify = (module as { notifyMessagesSummaryUpdated?: () => void }).notifyMessagesSummaryUpdated;

    expect(typeof notify).toBe('function');

    const previousWindow = (globalThis as any).window;
    const previousCustomEvent = (globalThis as any).CustomEvent;

    try {
      const windowTarget = new EventTarget();
      let received = 0;
      windowTarget.addEventListener('mahoshojo:messages-updated', () => {
        received += 1;
      });

      (globalThis as any).window = windowTarget;
      if (typeof previousCustomEvent === 'undefined') {
        (globalThis as any).CustomEvent = CustomEventPolyfill;
      }

      notify?.();

      expect(received).toBe(1);
    } finally {
      (globalThis as any).window = previousWindow;
      (globalThis as any).CustomEvent = previousCustomEvent;
    }
  });
});
