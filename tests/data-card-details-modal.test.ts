import { describe, expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import DataCardDetailsModal, { StrictSeasonExtremaBlock } from '@/components/DataCardDetailsModal';

describe('DataCardDetailsModal', () => {
  it('renders markdown strings with preserved line breaks', () => {
    const data = {
      templateId: 'narrative-history',
      version: 1,
      title: '测试历史卡',
      updatedAt: '2025-12-28T00:00:00.000Z',
      entries: [
        {
          id: 'e1',
          title: '第一章',
          content: '第一行\n第二行\n\n**加粗**',
          createdAt: '2025-12-28T00:00:00.000Z',
          updatedAt: '2025-12-28T00:00:00.000Z',
        },
      ],
    };

    const html = renderToStaticMarkup(
      React.createElement(DataCardDetailsModal, {
        isOpen: true,
        onClose: () => {},
        card: {
          id: 'c1',
          name: '测试卡片',
          description: '用于验证 Markdown 渲染',
          type: 'history',
          data: JSON.stringify(data),
          isPublic: false,
          author: 'tester',
        },
      }),
    );

    expect(html).toContain('<strong>加粗</strong>');
    expect(html).toContain('whitespace-pre-wrap');
  });

  it('StrictSeasonExtremaBlock 展示 strict 赛季极值与最高段位', () => {
    const html = renderToStaticMarkup(
      React.createElement(StrictSeasonExtremaBlock, {
        strict: {
          queue: 'strict',
          rating: 1520,
          games: 30,
          wins: 18,
          losses: 11,
          draws: 1,
          tier: '权杖',
          lastDelta: 12,
          lastAppliedAt: '2026-03-25T10:00:00.000Z',
          publicRank: null,
          publicTotal: null,
          seasonPeak: {
            rating: 1630,
            games: 30,
            occurredAt: '2026-03-21T10:00:00.000Z',
            tier: '权杖',
          },
          seasonPeakTier: '女王',
          seasonLow: {
            rating: 980,
            games: 6,
            occurredAt: '2026-01-20T10:00:00.000Z',
            tier: '白牌',
          },
        },
      }),
    );

    expect(html).toContain('赛季最高');
    expect(html).toContain('赛季最低');
    expect(html).toContain('赛季最高段位');
    expect(html).toContain('女王');
  });

  it('StrictSeasonExtremaBlock 在 season 信息全缺失时为空渲染', () => {
    const html = renderToStaticMarkup(
      React.createElement(StrictSeasonExtremaBlock, {
        strict: {
          queue: 'strict',
          rating: 1200,
          games: 8,
          wins: 4,
          losses: 3,
          draws: 1,
          tier: '花牌',
          lastDelta: null,
          lastAppliedAt: null,
          publicRank: null,
          publicTotal: null,
          seasonPeak: null,
          seasonPeakTier: null,
          seasonLow: null,
        },
      }),
    );

    expect(html).toBe('');
  });

  it('cloud public data card details render more actions entry for reporting', () => {
    const html = renderToStaticMarkup(
      React.createElement(DataCardDetailsModal, {
        isOpen: true,
        onClose: () => {},
        metaCardId: '00000000-0000-4000-8000-000000000001',
        card: {
          id: '00000000-0000-4000-8000-000000000001',
          name: '公开卡',
          description: '用于举报入口测试',
          type: 'character',
          data: JSON.stringify({ name: '公开卡' }),
          isPublic: true,
          author: 'tester',
        },
      }),
    );

    expect(html).toContain('更多');
  });

  it('owner view renders moderation summary banner when ownerModerationSummary.canAppeal is true', () => {
    const html = renderToStaticMarkup(
      React.createElement(DataCardDetailsModal, {
        isOpen: true,
        onClose: () => {},
        isOwner: true,
        initialReportCapability: {
          canReport: false,
          reportDisabledReason: '不能举报自己的公开数据卡',
          hasOpenCase: false,
          myActiveReport: null,
          reasons: [],
          ownerModerationSummary: {
            latestCaseId: 'case-1',
            status: 'resolved',
            resolutionCode: 'confirmed_violation',
            canAppeal: true,
            activeAppealId: null,
            activeAppealStatus: null,
            appealEntryUrl: '/report-appeals?reportCaseId=case-1',
            statusSummary: '该卡因举报处理结果被判定为违规，可提交申诉。',
          },
          caseSummary: null,
        },
        card: {
          id: 'card-1',
          name: '公开卡',
          description: '用于申诉入口测试',
          type: 'character',
          data: JSON.stringify({ name: '公开卡' }),
          isPublic: true,
          author: 'tester',
        },
      }),
    );

    expect(html).toContain('处理结果与申诉');
    expect(html).toContain('前往申诉页');
  });

  it('owner view renders active appeal status summary when activeAppealId exists', () => {
    const html = renderToStaticMarkup(
      React.createElement(DataCardDetailsModal, {
        isOpen: true,
        onClose: () => {},
        isOwner: true,
        initialReportCapability: {
          canReport: false,
          reportDisabledReason: '不能举报自己的公开数据卡',
          hasOpenCase: false,
          myActiveReport: null,
          reasons: [],
          ownerModerationSummary: {
            latestCaseId: 'case-1',
            status: 'resolved',
            resolutionCode: 'confirmed_violation',
            canAppeal: false,
            activeAppealId: 'appeal-1',
            activeAppealStatus: 'submitted',
            appealEntryUrl: '/report-appeals?appealId=appeal-1',
            statusSummary: '该处理结果的申诉正在处理中，可查看当前状态。',
          },
          caseSummary: null,
        },
        card: {
          id: 'card-1',
          name: '公开卡',
          description: '用于申诉状态测试',
          type: 'character',
          data: JSON.stringify({ name: '公开卡' }),
          isPublic: true,
          author: 'tester',
        },
      }),
    );

    expect(html).toContain('该处理结果的申诉正在处理中');
    expect(html).toContain('查看申诉状态');
  });
});
