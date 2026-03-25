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
});
