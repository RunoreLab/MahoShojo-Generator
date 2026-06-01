import { describe, expect, test } from 'vitest';

import {
  ReportAppealConflictError,
  ReportAppealNotFoundError,
  ReportAppealValidationError,
} from '@/lib/report-appeals/service';
import { createAdminReportAppealDetailHandler } from '@/pages/api/admin/report-appeals/[appealId]';
import { createAdminReportAppealReviewHandler } from '@/pages/api/admin/report-appeals/[appealId]/review';
import { createAdminReportAppealsHandler } from '@/pages/api/admin/report-appeals';

const auth = {
  user: { id: 99, username: 'admin', is_admin: 1 },
  source: 'better-auth-session' as const,
};

const jsonBody = async <T>(response: Response): Promise<T> => (await response.json()) as T;

describe('admin report appeals API', () => {
  test('GET /api/admin/report-appeals returns 401 when not logged in', async () => {
    const handler = createAdminReportAppealsHandler({
      requireAuthUser: async () => ({ response: new Response(JSON.stringify({ error: '未授权' }), { status: 401 }) }) as never,
    });

    const response = await handler(new Request('https://example.test/api/admin/report-appeals'));

    expect(response.status).toBe(401);
  });

  test('GET /api/admin/report-appeals forwards status and limit to service', async () => {
    let receivedStatus: string | undefined;
    let receivedLimit: number | undefined;
    const handler = createAdminReportAppealsHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      listReportAppealsForAdmin: async (input) => {
        receivedStatus = input.status;
        receivedLimit = input.limit;
        return {
          items: [],
          fetchedAt: '2026-04-11T01:00:00.000Z',
        };
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/report-appeals?status=submitted&limit=12'),
    );

    expect(response.status).toBe(200);
    expect(receivedStatus).toBe('submitted');
    expect(receivedLimit).toBe(12);
  });

  test('GET /api/admin/report-appeals/[appealId] maps not found to 404', async () => {
    const handler = createAdminReportAppealDetailHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      getReportAppealForAdmin: async () => {
        throw new ReportAppealNotFoundError('申诉记录不存在');
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/report-appeals/appeal-1'),
      { params: { appealId: 'appeal-1' } },
    );

    expect(response.status).toBe(404);
  });

  test('POST /api/admin/report-appeals/[appealId]/review validates resolutionCode', async () => {
    const handler = createAdminReportAppealReviewHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      reviewReportAppeal: async () => {
        throw new ReportAppealValidationError('管理员复核结论无效');
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/report-appeals/appeal-1/review', {
        method: 'POST',
        body: JSON.stringify({
          resolutionCode: 'bad-code',
          resolutionNote: 'note',
        }),
      }),
      { params: { appealId: 'appeal-1' } },
    );

    expect(response.status).toBe(400);
  });

  test('POST /api/admin/report-appeals/[appealId]/review maps conflict and returns payload on success', async () => {
    const conflictHandler = createAdminReportAppealReviewHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      reviewReportAppeal: async () => {
        throw new ReportAppealConflictError('该申诉已处理完成');
      },
    });

    const conflictResponse = await conflictHandler(
      new Request('https://example.test/api/admin/report-appeals/appeal-1/review', {
        method: 'POST',
        body: JSON.stringify({
          resolutionCode: 'upheld',
          resolutionNote: 'note',
        }),
      }),
      { params: { appealId: 'appeal-1' } },
    );

    expect(conflictResponse.status).toBe(409);

    const successHandler = createAdminReportAppealReviewHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      reviewReportAppeal: async () => ({
        appealId: 'appeal-1',
        status: 'resolved',
        resolutionCode: 'upheld',
        resolutionNote: '维持原结论',
      }),
    });

    const successResponse = await successHandler(
      new Request('https://example.test/api/admin/report-appeals/appeal-1/review', {
        method: 'POST',
        body: JSON.stringify({
          resolutionCode: 'upheld',
          resolutionNote: '维持原结论',
        }),
      }),
      { params: { appealId: 'appeal-1' } },
    );
    const payload = await jsonBody<{
      appealId: string;
      status: string;
      resolutionCode: string;
      resolutionNote: string | null;
    }>(successResponse);

    expect(successResponse.status).toBe(200);
    expect(payload).toEqual({
      appealId: 'appeal-1',
      status: 'resolved',
      resolutionCode: 'upheld',
      resolutionNote: '维持原结论',
    });
  });
});
