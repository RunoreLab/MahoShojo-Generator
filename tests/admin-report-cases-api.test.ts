import { describe, expect, test } from 'bun:test';

import { createAdminReportCaseDetailHandler } from '@/pages/api/admin/report-cases/[caseId]';
import { createAdminReportCaseNotifyCreatorHandler } from '@/pages/api/admin/report-cases/[caseId]/notify-creator';

const auth = {
  user: { id: 66, username: 'admin', is_admin: 1 },
  source: 'better-auth-session' as const,
};

const jsonBody = async <T>(response: Response): Promise<T> => (await response.json()) as T;

describe('admin report cases API', () => {
  test('GET /api/admin/report-cases/[caseId] returns 404 when case is missing', async () => {
    const handler = createAdminReportCaseDetailHandler({
      getAdminReportCaseDetail: async () => null,
    });

    const response = await handler(
      new Request('https://example.test/api/admin/report-cases/case-1'),
      { params: { caseId: 'case-1' } },
    );

    expect(response.status).toBe(404);
  });

  test('POST /api/admin/report-cases/[caseId]/notify-creator requires login', async () => {
    const handler = createAdminReportCaseNotifyCreatorHandler({
      requireAuthUser: async () =>
        ({ response: new Response(JSON.stringify({ error: '未授权' }), { status: 401 }) }) as never,
    });

    const response = await handler(
      new Request('https://example.test/api/admin/report-cases/case-1/notify-creator', {
        method: 'POST',
        body: JSON.stringify({
          sendMessage: true,
          reason: '请尽快自查处理',
        }),
      }),
      { params: { caseId: 'case-1' } },
    );

    expect(response.status).toBe(401);
  });

  test('POST /api/admin/report-cases/[caseId]/notify-creator forwards payload to service', async () => {
    let receivedCaseId = '';
    let receivedAdminUserId = 0;
    let receivedReason = '';
    let receivedSendMessage = false;
    const handler = createAdminReportCaseNotifyCreatorHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      notifyAdminReportCaseCreator: async (input) => {
        receivedCaseId = input.caseId;
        receivedAdminUserId = input.adminUserId;
        receivedReason = input.reason ?? '';
        receivedSendMessage = input.sendMessage;
        return {
          reportCaseId: input.caseId,
          creatorNotifiedAt: '2026-04-11T03:00:00.000Z',
          messageId: 123,
          sentMessage: true,
        };
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/report-cases/case-1/notify-creator', {
        method: 'POST',
        body: JSON.stringify({
          sendMessage: true,
          reason: 'AI 审查：存在明确违规内容',
        }),
      }),
      { params: { caseId: 'case-1' } },
    );
    const payload = await jsonBody<{
      reportCaseId: string;
      creatorNotifiedAt: string;
      messageId: number | null;
      sentMessage: boolean;
    }>(response);

    expect(response.status).toBe(200);
    expect(receivedCaseId).toBe('case-1');
    expect(receivedAdminUserId).toBe(66);
    expect(receivedReason).toBe('AI 审查：存在明确违规内容');
    expect(receivedSendMessage).toBe(true);
    expect(payload).toEqual({
      reportCaseId: 'case-1',
      creatorNotifiedAt: '2026-04-11T03:00:00.000Z',
      messageId: 123,
      sentMessage: true,
    });
  });
});
