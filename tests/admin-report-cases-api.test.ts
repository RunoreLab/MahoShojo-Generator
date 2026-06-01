import { describe, expect, test } from 'vitest';

import { createAdminReportCaseDetailHandler } from '@/pages/api/admin/report-cases/[caseId]';
import { createAdminReportCaseDecisionHandler } from '@/pages/api/admin/report-cases/[caseId]/decision';
import { createAdminReportCaseNotifyCreatorHandler } from '@/pages/api/admin/report-cases/[caseId]/notify-creator';
import {
  AdminGovernanceConflictError,
  AdminGovernanceNotFoundError,
  AdminGovernanceValidationError,
} from '@/lib/admin/governance';

const auth = {
  user: { id: 66, username: 'admin', is_admin: 1 },
  source: 'better-auth-session' as const,
};
const nonAdminAuth = {
  user: { id: 67, username: 'user', is_admin: 0 },
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

  test('POST /api/admin/report-cases/[caseId]/decision requires login', async () => {
    const handler = createAdminReportCaseDecisionHandler({
      requireAuthUser: async () =>
        ({ response: new Response(JSON.stringify({ error: '未授权' }), { status: 401 }) }) as never,
    });

    const response = await handler(
      new Request('https://example.test/api/admin/report-cases/case-1/decision', {
        method: 'POST',
        body: JSON.stringify({
          nextStatus: 'resolved',
          resolutionCode: 'confirmed_violation',
        }),
      }),
      { params: { caseId: 'case-1' } },
    );

    expect(response.status).toBe(401);
  });

  test('POST /api/admin/report-cases/[caseId]/decision rejects invalid resolutionCode', async () => {
    const handler = createAdminReportCaseDecisionHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      decideAdminReportCase: async () => {
        throw new Error('should not reach service');
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/report-cases/case-1/decision', {
        method: 'POST',
        body: JSON.stringify({
          nextStatus: 'resolved',
          resolutionCode: 'bad-code',
        }),
      }),
      { params: { caseId: 'case-1' } },
    );

    expect(response.status).toBe(400);
  });

  test('POST /api/admin/report-cases/[caseId]/decision rejects non-admin user', async () => {
    const handler = createAdminReportCaseDecisionHandler({
      requireAuthUser: async () => nonAdminAuth,
      getDb: () => ({ db: true }),
      decideAdminReportCase: async () => {
        throw new Error('should not reach service');
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/report-cases/case-1/decision', {
        method: 'POST',
        body: JSON.stringify({
          nextStatus: 'resolved',
          resolutionCode: 'confirmed_violation',
        }),
      }),
      { params: { caseId: 'case-1' } },
    );

    expect(response.status).toBe(403);
  });

  test('POST /api/admin/report-cases/[caseId]/decision rejects punishment on dismissed + no_violation', async () => {
    const handler = createAdminReportCaseDecisionHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      decideAdminReportCase: async () => {
        throw new Error('should not reach service');
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/report-cases/case-1/decision', {
        method: 'POST',
        body: JSON.stringify({
          nextStatus: 'dismissed',
          resolutionCode: 'no_violation',
          cardModerationAction: {
            action: 'set_public_status',
            value: -1,
          },
        }),
      }),
      { params: { caseId: 'case-1' } },
    );

    expect(response.status).toBe(400);
  });

  test('POST /api/admin/report-cases/[caseId]/decision forwards valid payload to service', async () => {
    let receivedInput: Record<string, unknown> | null = null;
    const handler = createAdminReportCaseDecisionHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      decideAdminReportCase: async (input) => {
        receivedInput = input as unknown as Record<string, unknown>;
        return {
          reportCaseId: input.caseId,
          status: input.nextStatus,
          resolutionCode: input.resolutionCode,
          closedAt: '2026-04-11T04:00:00.000Z',
          notifiedCreator: true,
          dataCardModerationApplied: true,
        };
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/report-cases/case-1/decision', {
        method: 'POST',
        body: JSON.stringify({
          nextStatus: 'resolved',
          resolutionCode: 'confirmed_violation',
          resolutionNote: '管理员确认违规',
          notifyCreator: true,
          creatorMessageReason: '请按说明整改',
          cardModerationAction: {
            action: 'set_public_status',
            value: -1,
            messageOptions: {
              send: true,
              defaultReason: '公开卡违规封禁',
            },
          },
        }),
      }),
      { params: { caseId: 'case-1' } },
    );
    const payload = await jsonBody<{
      reportCaseId: string;
      status: string;
      resolutionCode: string | null;
      notifiedCreator: boolean;
      dataCardModerationApplied: boolean;
    }>(response);

    expect(response.status).toBe(200);
    expect(receivedInput).toMatchObject({
      caseId: 'case-1',
      adminUserId: 66,
      nextStatus: 'resolved',
      resolutionCode: 'confirmed_violation',
      resolutionNote: '管理员确认违规',
      notifyCreator: true,
      creatorMessageReason: '请按说明整改',
      cardModerationAction: {
        action: 'set_public_status',
        value: -1,
        messageOptions: {
          send: true,
          defaultReason: '公开卡违规封禁',
        },
      },
    });
    expect(payload).toMatchObject({
      reportCaseId: 'case-1',
      status: 'resolved',
      resolutionCode: 'confirmed_violation',
      notifiedCreator: true,
      dataCardModerationApplied: true,
    });
  });

  test('POST /api/admin/report-cases/[caseId]/decision maps governance errors', async () => {
    const notFoundHandler = createAdminReportCaseDecisionHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      decideAdminReportCase: async () => {
        throw new AdminGovernanceNotFoundError('举报案件不存在');
      },
    });
    const conflictHandler = createAdminReportCaseDecisionHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      decideAdminReportCase: async () => {
        throw new AdminGovernanceConflictError('举报案件状态已变化');
      },
    });
    const validationHandler = createAdminReportCaseDecisionHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      decideAdminReportCase: async () => {
        throw new AdminGovernanceValidationError('参数不合法');
      },
    });

    const request = new Request('https://example.test/api/admin/report-cases/case-1/decision', {
      method: 'POST',
      body: JSON.stringify({
        nextStatus: 'resolved',
        resolutionCode: 'confirmed_violation',
      }),
    });

    expect(
      (await notFoundHandler(request.clone(), { params: { caseId: 'case-1' } })).status,
    ).toBe(404);
    expect(
      (await conflictHandler(request.clone(), { params: { caseId: 'case-1' } })).status,
    ).toBe(409);
    expect(
      (await validationHandler(request.clone(), { params: { caseId: 'case-1' } })).status,
    ).toBe(400);
  });
});
