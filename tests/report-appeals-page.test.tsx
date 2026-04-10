import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ReportAppealsPage from '@/components/report-appeals/ReportAppealsPage';

describe('ReportAppealsPage', () => {
  test('renders appeal form when reportCaseId query is eligible and no existing appeal exists', async () => {
    const html = renderToStaticMarkup(
      <ReportAppealsPage
        query={{ reportCaseId: 'case-1' }}
        initialHistory={{ items: [], fetchedAt: '2026-04-10T01:31:00.000Z' }}
        initialEntry={{
          reportCaseId: 'case-1',
          eligible: true,
          caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
          caseStatus: 'resolved',
          caseResolutionCode: 'confirmed_violation',
          targetCard: { id: 'card-1', name: '公开卡' },
          reasonOptions: [],
          existingAppeal: null,
        }}
      />,
    );

    expect(html).toContain('提交申诉');
    expect(html).toContain('公开卡');
  });

  test('renders appeal detail when appealId query is present', async () => {
    const html = renderToStaticMarkup(
      <ReportAppealsPage
        query={{ appealId: 'appeal-1' }}
        initialHistory={{ items: [], fetchedAt: '2026-04-10T01:31:00.000Z' }}
        initialDetail={{
          appealId: 'appeal-1',
          reportCaseId: 'case-1',
          targetCardId: 'card-1',
          targetCardName: '公开卡',
          appealReasonCode: 'missing_context',
          status: 'resolved',
          resolutionCode: 'upheld',
          resolutionNote: '维持原判',
          caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
          createdAt: '2026-04-10T01:30:00.000Z',
          updatedAt: '2026-04-10T01:40:00.000Z',
          details: '补充说明',
          references: [],
          caseSnapshot: {
            status: 'resolved',
            resolutionCode: 'confirmed_violation',
            updatedAt: '2026-04-10T01:20:00.000Z',
          },
          currentCase: {
            status: 'resolved',
            resolutionCode: 'confirmed_violation',
            closedAt: '2026-04-10T01:20:00.000Z',
            updatedAt: '2026-04-10T01:20:00.000Z',
          },
        }}
      />,
    );

    expect(html).toContain('补充说明');
    expect(html).toContain('已结案');
  });

  test('renders existing appeal status card instead of empty form when entry already exists', async () => {
    const html = renderToStaticMarkup(
      <ReportAppealsPage
        query={{ reportCaseId: 'case-1' }}
        initialHistory={{ items: [], fetchedAt: '2026-04-10T01:31:00.000Z' }}
        initialEntry={{
          reportCaseId: 'case-1',
          eligible: true,
          caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
          caseStatus: 'resolved',
          caseResolutionCode: 'confirmed_violation',
          targetCard: { id: 'card-1', name: '公开卡' },
          reasonOptions: [],
          existingAppeal: {
            appealId: 'appeal-1',
            reportCaseId: 'case-1',
            targetCardId: 'card-1',
            targetCardName: '公开卡',
            appealReasonCode: 'missing_context',
            status: 'submitted',
            resolutionCode: null,
            resolutionNote: null,
            caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
            createdAt: '2026-04-10T01:30:00.000Z',
            updatedAt: '2026-04-10T01:30:00.000Z',
          },
        }}
      />,
    );

    expect(html).toContain('申诉状态');
    expect(html).toContain('撤回申诉');
    expect(html).not.toContain('补充说明不能为空');
  });

  test('renders history list and empty state when no reportCaseId query is present', async () => {
    const html = renderToStaticMarkup(
      <ReportAppealsPage
        initialHistory={{ items: [], fetchedAt: '2026-04-10T01:31:00.000Z' }}
      />,
    );

    expect(html).toContain('申诉历史');
    expect(html).toContain('暂无申诉记录');
  });
});
