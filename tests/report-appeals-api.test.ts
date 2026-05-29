import { describe, expect, test } from 'vitest';

import {
  ReportAppealConflictError,
  ReportAppealForbiddenError,
  ReportAppealValidationError,
} from '@/lib/report-appeals/service';
import { createDataCardReportsHandler } from '@/pages/api/data-card-reports';
import { createReportAppealDetailHandler } from '@/pages/api/report-appeals/detail';
import { createReportAppealEntryHandler } from '@/pages/api/report-appeals/entry';
import { createReportAppealsHandler } from '@/pages/api/report-appeals';
import { createReportAppealWithdrawHandler } from '@/pages/api/report-appeals/withdraw';

const auth = {
  user: { id: 7, username: 'hana', is_admin: 0 },
  source: 'better-auth-session' as const,
};

const ownerAuth = {
  user: { id: 2, username: 'creator', is_admin: 0 },
  source: 'better-auth-session' as const,
};

const jsonBody = async <T>(response: Response): Promise<T> => (await response.json()) as T;

describe('report appeals API', () => {
  test('GET /api/report-appeals/entry returns 401 for anonymous viewers', async () => {
    const handler = createReportAppealEntryHandler({
      requireAuthUser: async () => ({ response: new Response(JSON.stringify({ error: '未授权' }), { status: 401 }) }) as never,
    });

    const response = await handler(new Request('https://example.test/api/report-appeals/entry?reportCaseId=case-1'));

    expect(response.status).toBe(401);
  });

  test('GET /api/report-appeals/entry returns 403 for non-owner viewers', async () => {
    const handler = createReportAppealEntryHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      getReportAppealEntry: async () => {
        throw new ReportAppealForbiddenError('仅案件目标创作者可发起申诉');
      },
    });

    const response = await handler(new Request('https://example.test/api/report-appeals/entry?reportCaseId=case-1'));

    expect(response.status).toBe(403);
  });

  test('GET /api/report-appeals/detail returns 403 for non-owner viewers', async () => {
    const handler = createReportAppealDetailHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      getReportAppealDetail: async () => {
        throw new ReportAppealForbiddenError('仅申诉发起者本人可查看');
      },
    });

    const response = await handler(new Request('https://example.test/api/report-appeals/detail?appealId=appeal-1'));

    expect(response.status).toBe(403);
  });

  test('POST /api/report-appeals rejects invalid appealReasonCode with 400', async () => {
    const handler = createReportAppealsHandler({
      requireAuthUser: async () => ownerAuth,
      getDb: () => ({ db: true }),
      submitReportAppeal: async () => {
        throw new ReportAppealValidationError('申诉理由无效');
      },
    });

    const response = await handler(
      new Request('https://example.test/api/report-appeals', {
        method: 'POST',
        body: JSON.stringify({
          reportCaseId: 'case-1',
          caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
          appealReasonCode: 'bad',
          details: '说明',
          references: [],
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  test('POST /api/report-appeals returns existing appeal when the same case snapshot already has a record', async () => {
    const handler = createReportAppealsHandler({
      requireAuthUser: async () => ownerAuth,
      getDb: () => ({ db: true }),
      submitReportAppeal: async () => ({
        appealId: 'appeal-1',
        status: 'submitted',
        entryUrl: '/report-appeals?appealId=appeal-1',
      }),
    });

    const response = await handler(
      new Request('https://example.test/api/report-appeals', {
        method: 'POST',
        body: JSON.stringify({
          reportCaseId: 'case-1',
          caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
          appealReasonCode: 'missing_context',
          details: '说明',
          references: [],
        }),
      }),
    );
    const payload = await jsonBody<any>(response);

    expect(response.status).toBe(200);
    expect(payload.appealId).toBe('appeal-1');
  });

  test('POST /api/report-appeals/withdraw returns 409 for resolved appeals', async () => {
    const handler = createReportAppealWithdrawHandler({
      requireAuthUser: async () => ownerAuth,
      getDb: () => ({ db: true }),
      withdrawReportAppeal: async () => {
        throw new ReportAppealConflictError('当前申诉状态不可撤回');
      },
    });

    const response = await handler(
      new Request('https://example.test/api/report-appeals/withdraw', {
        method: 'POST',
        body: JSON.stringify({ appealId: 'appeal-1' }),
      }),
    );

    expect(response.status).toBe(409);
  });

  test('GET /api/report-appeals lists only current user appeals', async () => {
    const handler = createReportAppealsHandler({
      requireAuthUser: async () => ownerAuth,
      getDb: () => ({ db: true }),
      listMyReportAppeals: async () => ({
        items: [
          {
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
        ],
        fetchedAt: '2026-04-10T01:31:00.000Z',
      }),
    });

    const response = await handler(new Request('https://example.test/api/report-appeals'));
    const payload = await jsonBody<any>(response);

    expect(response.status).toBe(200);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].appealId).toBe('appeal-1');
  });

  test('GET /api/data-card-reports includes ownerModerationSummary for the target owner', async () => {
    const handler = createDataCardReportsHandler({
      getAuthUser: async () => ownerAuth,
      getDb: () => ({ db: true }),
      getDataCardReportCapability: async () => ({
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
      }),
    });

    const response = await handler(new Request('https://example.test/api/data-card-reports?dataCardId=card-1'));
    const payload = await jsonBody<any>(response);

    expect(response.status).toBe(200);
    expect(payload.ownerModerationSummary?.canAppeal).toBe(true);
  });
});
