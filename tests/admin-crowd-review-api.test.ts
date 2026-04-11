import { describe, expect, test } from 'bun:test';

import { createAdminCrowdReviewCaseDetailHandler } from '@/pages/api/admin/crowd-review/cases/[roundId]';
import { createAdminCrowdReviewRoundCancelHandler } from '@/pages/api/admin/crowd-review/cases/[roundId]/cancel';
import { createAdminCrowdReviewRoundOverrideHandler } from '@/pages/api/admin/crowd-review/cases/[roundId]/override';
import { createAdminCrowdReviewRoundTakeOverHandler } from '@/pages/api/admin/crowd-review/cases/[roundId]/take-over';
import { createAdminCrowdReviewInspectorStatusHandler } from '@/pages/api/admin/crowd-review/inspectors/[userId]/status';
import { AdminGovernanceConflictError, AdminGovernanceNotFoundError } from '@/lib/admin/governance';

const auth = {
  user: { id: 77, username: 'admin', is_admin: 1 },
  source: 'better-auth-session' as const,
};
const nonAdminAuth = {
  user: { id: 78, username: 'user', is_admin: 0 },
  source: 'better-auth-session' as const,
};

const jsonBody = async <T>(response: Response): Promise<T> => (await response.json()) as T;

describe('admin crowd review API', () => {
  test('POST /api/admin/crowd-review/inspectors/[userId]/status validates nextStatus', async () => {
    const handler = createAdminCrowdReviewInspectorStatusHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      updateAdminCrowdReviewInspectorStatus: async () => ({
        userId: 12,
        status: 'active',
        suspendedUntil: null,
        statusReasonCode: null,
        statusReasonDetail: null,
        activeAssignments: 0,
        completedAssignments: 0,
        updatedAt: '2026-04-11T03:30:00.000Z',
      }),
    });

    const response = await handler(
      new Request('https://example.test/api/admin/crowd-review/inspectors/12/status', {
        method: 'POST',
        body: JSON.stringify({
          nextStatus: 'bad-status',
        }),
      }),
      { params: { userId: '12' } },
    );

    expect(response.status).toBe(400);
  });

  test('POST /api/admin/crowd-review/inspectors/[userId]/status forwards payload', async () => {
    let receivedUserId = 0;
    let receivedAdminUserId = 0;
    let receivedStatus = '';
    let receivedReasonCode: string | null = null;
    const handler = createAdminCrowdReviewInspectorStatusHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      updateAdminCrowdReviewInspectorStatus: async (input) => {
        receivedUserId = input.userId;
        receivedAdminUserId = input.adminUserId;
        receivedStatus = input.nextStatus;
        receivedReasonCode = input.reasonCode ?? null;
        return {
          userId: input.userId,
          status: input.nextStatus,
          suspendedUntil: input.suspendedUntil ?? null,
          statusReasonCode: input.reasonCode ?? null,
          statusReasonDetail: input.reasonDetail ?? null,
          activeAssignments: 1,
          completedAssignments: 4,
          updatedAt: '2026-04-11T03:31:00.000Z',
        };
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/crowd-review/inspectors/12/status', {
        method: 'POST',
        body: JSON.stringify({
          nextStatus: 'suspended',
          reasonCode: 'manual_pause',
          reasonDetail: '等待复核结果',
          suspendedUntil: '2026-04-20T00:00:00.000Z',
        }),
      }),
      { params: { userId: '12' } },
    );
    const payload = await jsonBody<{
      userId: number;
      status: string;
      statusReasonCode: string | null;
    }>(response);

    expect(response.status).toBe(200);
    expect(receivedUserId).toBe(12);
    expect(receivedAdminUserId).toBe(77);
    expect(receivedStatus).toBe('suspended');
    expect(receivedReasonCode).toBe('manual_pause');
    expect(payload.userId).toBe(12);
    expect(payload.status).toBe('suspended');
    expect(payload.statusReasonCode).toBe('manual_pause');
  });

  test('GET /api/admin/crowd-review/cases/[roundId] returns 404 when round is missing', async () => {
    const handler = createAdminCrowdReviewCaseDetailHandler({
      getAdminCrowdReviewCaseDetail: async () => null,
    });

    const response = await handler(
      new Request('https://example.test/api/admin/crowd-review/cases/round-1'),
      { params: { roundId: 'round-1' } },
    );

    expect(response.status).toBe(404);
  });

  test('POST /api/admin/crowd-review/cases/[roundId]/take-over requires login and forwards reason', async () => {
    const unauthorized = createAdminCrowdReviewRoundTakeOverHandler({
      requireAuthUser: async () =>
        ({ response: new Response(JSON.stringify({ error: '未授权' }), { status: 401 }) }) as never,
    });
    expect(
      (
        await unauthorized(
          new Request('https://example.test/api/admin/crowd-review/cases/round-1/take-over', {
            method: 'POST',
            body: JSON.stringify({ reasonDetail: '管理员接管' }),
          }),
          { params: { roundId: 'round-1' } },
        )
      ).status,
    ).toBe(401);

    let receivedRoundId = '';
    let receivedAdminUserId = 0;
    let receivedReason = '';
    const authorized = createAdminCrowdReviewRoundTakeOverHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      takeOverAdminCrowdReviewRound: async (input) => {
        receivedRoundId = input.roundId;
        receivedAdminUserId = input.adminUserId;
        receivedReason = input.reasonDetail ?? '';
        return {
          roundId: input.roundId,
          reportCaseId: 'case-1',
          roundStatus: 'escalated',
          roundResultCode: 'escalated',
          reportCaseStatus: 'under_review',
          reportCaseResolutionCode: null,
          revokedAssignmentsCount: 1,
        };
      },
    });

    const response = await authorized(
      new Request('https://example.test/api/admin/crowd-review/cases/round-1/take-over', {
        method: 'POST',
        body: JSON.stringify({ reasonDetail: '管理员接管' }),
      }),
      { params: { roundId: 'round-1' } },
    );

    expect(response.status).toBe(200);
    expect(receivedRoundId).toBe('round-1');
    expect(receivedAdminUserId).toBe(77);
    expect(receivedReason).toBe('管理员接管');
  });

  test('POST /api/admin/crowd-review/cases/[roundId]/cancel maps not-found and conflict errors', async () => {
    const notFoundHandler = createAdminCrowdReviewRoundCancelHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      cancelAdminCrowdReviewRound: async () => {
        throw new AdminGovernanceNotFoundError('轮次不存在');
      },
    });
    const conflictHandler = createAdminCrowdReviewRoundCancelHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      cancelAdminCrowdReviewRound: async () => {
        throw new AdminGovernanceConflictError('轮次状态已变化');
      },
    });

    const request = new Request('https://example.test/api/admin/crowd-review/cases/round-1/cancel', {
      method: 'POST',
      body: JSON.stringify({ reasonDetail: '管理员撤销' }),
    });

    expect((await notFoundHandler(request.clone(), { params: { roundId: 'round-1' } })).status).toBe(404);
    expect((await conflictHandler(request.clone(), { params: { roundId: 'round-1' } })).status).toBe(409);
  });

  test('POST /api/admin/crowd-review/cases/[roundId]/take-over rejects non-admin user', async () => {
    const handler = createAdminCrowdReviewRoundTakeOverHandler({
      requireAuthUser: async () => nonAdminAuth,
      getDb: () => ({ db: true }),
      takeOverAdminCrowdReviewRound: async () => {
        throw new Error('should not reach service');
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/crowd-review/cases/round-1/take-over', {
        method: 'POST',
        body: JSON.stringify({ reasonDetail: '管理员接管' }),
      }),
      { params: { roundId: 'round-1' } },
    );

    expect(response.status).toBe(403);
  });

  test('POST /api/admin/crowd-review/cases/[roundId]/override validates caseDecision', async () => {
    const handler = createAdminCrowdReviewRoundOverrideHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      overrideAdminCrowdReviewRound: async () => {
        throw new Error('should not reach service');
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/crowd-review/cases/round-1/override', {
        method: 'POST',
        body: JSON.stringify({ caseDecision: 'bad-value' }),
      }),
      { params: { roundId: 'round-1' } },
    );

    expect(response.status).toBe(400);
  });

  test('POST /api/admin/crowd-review/cases/[roundId]/override forwards admin user id and payload', async () => {
    let receivedRoundId = '';
    let receivedAdminUserId = 0;
    let receivedCaseDecision = '';
    let receivedReason = '';
    const handler = createAdminCrowdReviewRoundOverrideHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      overrideAdminCrowdReviewRound: async (input) => {
        receivedRoundId = input.roundId;
        receivedAdminUserId = input.adminUserId;
        receivedCaseDecision = input.caseDecision;
        receivedReason = input.reasonDetail ?? '';
        return {
          roundId: input.roundId,
          reportCaseId: 'case-1',
          roundStatus: 'concluded',
          roundResultCode: 'admin_override',
          reportCaseStatus: 'resolved',
          reportCaseResolutionCode: 'confirmed_violation',
          revokedAssignmentsCount: 2,
        };
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/crowd-review/cases/round-1/override', {
        method: 'POST',
        body: JSON.stringify({
          caseDecision: 'violation',
          reasonDetail: '管理员改判违规成立',
        }),
      }),
      { params: { roundId: 'round-1' } },
    );
    const payload = await jsonBody<{
      roundId: string;
      roundResultCode: string | null;
      reportCaseResolutionCode: string | null;
    }>(response);

    expect(response.status).toBe(200);
    expect(receivedRoundId).toBe('round-1');
    expect(receivedAdminUserId).toBe(77);
    expect(receivedCaseDecision).toBe('violation');
    expect(receivedReason).toBe('管理员改判违规成立');
    expect(payload).toMatchObject({
      roundId: 'round-1',
      roundResultCode: 'admin_override',
      reportCaseResolutionCode: 'confirmed_violation',
    });
  });
});
