import { describe, expect, test } from 'bun:test';

import { createAdminCrowdReviewCaseDetailHandler } from '@/pages/api/admin/crowd-review/cases/[roundId]';
import { createAdminCrowdReviewInspectorStatusHandler } from '@/pages/api/admin/crowd-review/inspectors/[userId]/status';

const auth = {
  user: { id: 77, username: 'admin', is_admin: 1 },
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
});
