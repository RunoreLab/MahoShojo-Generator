import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ReportAppealsPage, {
  loadReportAppealsPageData,
  submitReportAppealAndRefreshPageData,
} from '@/components/report-appeals/ReportAppealsPage';

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
          resolutionNote: '管理员备注：维持原判，现有证据不足以推翻原结论',
          caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
          createdAt: '2026-04-10T01:30:00.000Z',
          updatedAt: '2026-04-10T01:40:00.000Z',
          details: '补充说明',
          references: [
            {
              referenceType: 'encyclopedia_entry',
              referenceId: 'community-rules',
              labelSnapshot: '社区守则',
              urlSnapshot: '/encyclopedia/community-rules',
              note: '需要核对处理依据',
              sortOrder: 0,
            },
          ],
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
    expect(html).toContain('管理员备注：维持原判，现有证据不足以推翻原结论');
    expect(html).toContain('社区守则');
    expect(html).toContain('需要核对处理依据');
    expect(html).toContain('案件快照');
    expect(html).toContain('当前案件');
    expect(html).toContain('确认违规');
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

  test('renders appeal form again when the current appeal was withdrawn for the same report case', async () => {
    const html = renderToStaticMarkup(
      <ReportAppealsPage
        query={{ reportCaseId: 'case-1' }}
        initialHistory={{
          items: [
            {
              appealId: 'appeal-1',
              reportCaseId: 'case-1',
              targetCardId: 'card-1',
              targetCardName: '公开卡',
              appealReasonCode: 'missing_context',
              status: 'withdrawn',
              resolutionCode: null,
              resolutionNote: null,
              caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
              createdAt: '2026-04-10T01:30:00.000Z',
              updatedAt: '2026-04-10T01:40:00.000Z',
            },
          ],
          fetchedAt: '2026-04-10T01:41:00.000Z',
        }}
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
            status: 'withdrawn',
            resolutionCode: null,
            resolutionNote: null,
            caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
            createdAt: '2026-04-10T01:30:00.000Z',
            updatedAt: '2026-04-10T01:40:00.000Z',
          },
        }}
        initialDetail={{
          appealId: 'appeal-1',
          reportCaseId: 'case-1',
          targetCardId: 'card-1',
          targetCardName: '公开卡',
          appealReasonCode: 'missing_context',
          status: 'withdrawn',
          resolutionCode: null,
          resolutionNote: null,
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

    expect(html).toContain('提交申诉');
    expect(html).toContain('补充说明');
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

  test('loadReportAppealsPageData fetches real detail when reportCaseId entry already has an existing appeal', async () => {
    const calls: string[] = [];
    const history = { items: [], fetchedAt: '2026-04-10T01:31:00.000Z' };
    const entry = {
      reportCaseId: 'case-1',
      eligible: true,
      caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
      caseStatus: 'resolved' as const,
      caseResolutionCode: 'confirmed_violation' as const,
      targetCard: { id: 'card-1', name: '公开卡' },
      reasonOptions: [],
      existingAppeal: {
        appealId: 'appeal-1',
        reportCaseId: 'case-1',
        targetCardId: 'card-1',
        targetCardName: '公开卡',
        appealReasonCode: 'missing_context' as const,
        status: 'submitted' as const,
        resolutionCode: null,
        resolutionNote: null,
        caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
        createdAt: '2026-04-10T01:30:00.000Z',
        updatedAt: '2026-04-10T01:30:00.000Z',
      },
    };
    const detail = {
      ...entry.existingAppeal,
      details: '补充说明',
      references: [
        {
          referenceType: 'encyclopedia_entry' as const,
          referenceId: 'community-rules',
          labelSnapshot: '社区守则',
          urlSnapshot: '/encyclopedia/community-rules',
          note: '需要核对',
          sortOrder: 0,
        },
      ],
      caseSnapshot: {
        status: 'resolved' as const,
        resolutionCode: 'confirmed_violation' as const,
        updatedAt: '2026-04-10T01:20:00.000Z',
      },
      currentCase: {
        status: 'resolved' as const,
        resolutionCode: 'confirmed_violation' as const,
        closedAt: '2026-04-10T01:20:00.000Z',
        updatedAt: '2026-04-10T01:20:00.000Z',
      },
    };

    const loaded = await loadReportAppealsPageData({ reportCaseId: 'case-1' }, async (url) => {
      calls.push(url);
      if (url === '/api/report-appeals') return history;
      if (url === '/api/report-appeals/entry?reportCaseId=case-1') return entry;
      if (url === '/api/report-appeals/detail?appealId=appeal-1') return detail;
      throw new Error(`Unexpected URL: ${url}`);
    });

    expect(calls).toEqual([
      '/api/report-appeals',
      '/api/report-appeals/entry?reportCaseId=case-1',
      '/api/report-appeals/detail?appealId=appeal-1',
    ]);
    expect(loaded.detail).toEqual(detail);
  });

  test('submitReportAppealAndRefreshPageData refreshes history and existingAppeal after submit succeeds', async () => {
    const calls: string[] = [];
    const submitInput = {
      reportCaseId: 'case-1',
      caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
      appealReasonCode: 'missing_context',
      details: '补充说明',
      references: [],
    };
    const history = {
      items: [
        {
          appealId: 'appeal-1',
          reportCaseId: 'case-1',
          targetCardId: 'card-1',
          targetCardName: '公开卡',
          appealReasonCode: 'missing_context' as const,
          status: 'submitted' as const,
          resolutionCode: null,
          resolutionNote: null,
          caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
          createdAt: '2026-04-10T01:30:00.000Z',
          updatedAt: '2026-04-10T01:30:00.000Z',
        },
      ],
      fetchedAt: '2026-04-10T01:31:00.000Z',
    };
    const entry = {
      reportCaseId: 'case-1',
      eligible: true,
      caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
      caseStatus: 'resolved' as const,
      caseResolutionCode: 'confirmed_violation' as const,
      targetCard: { id: 'card-1', name: '公开卡' },
      reasonOptions: [],
      existingAppeal: history.items[0],
    };
    const detail = {
      ...history.items[0],
      details: '补充说明',
      references: [],
      caseSnapshot: {
        status: 'resolved' as const,
        resolutionCode: 'confirmed_violation' as const,
        updatedAt: '2026-04-10T01:20:00.000Z',
      },
      currentCase: {
        status: 'resolved' as const,
        resolutionCode: 'confirmed_violation' as const,
        closedAt: '2026-04-10T01:20:00.000Z',
        updatedAt: '2026-04-10T01:20:00.000Z',
      },
    };

    const loaded = await submitReportAppealAndRefreshPageData(submitInput, async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/report-appeals' && init?.method === 'POST') {
        return {
          appealId: 'appeal-1',
          status: 'submitted',
          entryUrl: '/report-appeals?appealId=appeal-1',
        };
      }
      if (url === '/api/report-appeals') return history;
      if (url === '/api/report-appeals/entry?reportCaseId=case-1') return entry;
      if (url === '/api/report-appeals/detail?appealId=appeal-1') return detail;
      throw new Error(`Unexpected URL: ${url}`);
    });

    expect(calls).toEqual([
      'POST /api/report-appeals',
      'GET /api/report-appeals',
      'GET /api/report-appeals/entry?reportCaseId=case-1',
      'GET /api/report-appeals/detail?appealId=appeal-1',
    ]);
    expect(loaded.history).toEqual(history);
    expect(loaded.entry?.existingAppeal?.appealId).toBe('appeal-1');
    expect(loaded.detail).toEqual(detail);
  });
});
