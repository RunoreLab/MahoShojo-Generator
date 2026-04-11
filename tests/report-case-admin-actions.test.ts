import { describe, expect, test } from 'bun:test';

import {
  createAdminReportCasesServiceForTests,
  decideAdminReportCase,
} from '@/lib/admin/report-cases';
import { AdminGovernanceConflictError, AdminGovernanceValidationError } from '@/lib/admin/governance';
import { updateReportCaseDecision } from '@/lib/db/repositories/data-card-reports';

const now = '2026-04-11T08:00:00.000Z';

const createUpdateDb = () => {
  const calls: Array<Record<string, unknown>> = [];
  const db = {
    update() {
      return {
        set(values: Record<string, unknown>) {
          calls.push(values);
          return {
            where() {
              return {
                returning: async () => [{ id: 'case-1' }],
              };
            },
          };
        },
      };
    },
  };

  return { db: db as never, calls };
};

describe('report case admin actions', () => {
  test('updateReportCaseDecision writes resolved + confirmed_violation + closedAt', async () => {
    const { db, calls } = createUpdateDb();

    const updated = await updateReportCaseDecision(db, {
      reportCaseId: 'case-1',
      status: 'resolved',
      resolutionCode: 'confirmed_violation',
      closedAt: now,
      now,
    });

    expect(updated).toBe(true);
    expect(calls[0]).toMatchObject({
      status: 'resolved',
      resolutionCode: 'confirmed_violation',
      closedAt: now,
      updatedAt: now,
    });
  });

  test('updateReportCaseDecision writes dismissed + no_violation + closedAt', async () => {
    const { db, calls } = createUpdateDb();

    const updated = await updateReportCaseDecision(db, {
      reportCaseId: 'case-1',
      status: 'dismissed',
      resolutionCode: 'no_violation',
      closedAt: now,
      now,
    });

    expect(updated).toBe(true);
    expect(calls[0]).toMatchObject({
      status: 'dismissed',
      resolutionCode: 'no_violation',
      closedAt: now,
      updatedAt: now,
    });
  });

  test('updateReportCaseDecision writes under_review + null + closedAt null', async () => {
    const { db, calls } = createUpdateDb();

    const updated = await updateReportCaseDecision(db, {
      reportCaseId: 'case-1',
      status: 'under_review',
      resolutionCode: null,
      closedAt: null,
      now,
    });

    expect(updated).toBe(true);
    expect(calls[0]).toMatchObject({
      status: 'under_review',
      resolutionCode: null,
      closedAt: null,
      updatedAt: now,
    });
  });

  test('admin action rejects invalid status and resolution combinations', async () => {
    await expect(
      decideAdminReportCase({
        db: {} as never,
        caseId: 'case-1',
        adminUserId: 99,
        nextStatus: 'dismissed',
        resolutionCode: 'confirmed_violation',
      }),
    ).rejects.toBeInstanceOf(AdminGovernanceValidationError);
  });

  test('data card punishment payload is forwarded to existing moderation helpers', async () => {
    const batchUpdates: Array<Record<string, unknown>> = [];
    const sentMessages: Array<Record<string, unknown>> = [];
    const service = createAdminReportCasesServiceForTests({
      now: () => now,
      getReportCaseById: async () => ({
        id: 'case-1',
        targetEntityType: 'data_card',
        targetEntityId: 'card-1',
        targetUserId: 7,
        targetCardName: '雪沫',
        status: 'open',
        resolutionCode: null,
      }),
      updateReportCaseDecision: async () => true,
      batchUpdateDataCards: async (cardIds, updates) => {
        batchUpdates.push({ cardIds, updates });
        return true;
      },
      getDataCardNotificationTargets: async () => [
        {
          recipientUserId: 7,
          dataCardId: 'card-1',
          dataCardName: '雪沫',
          reasonKey: 'card-1',
        },
      ],
      sendDataCardModerationMessages: async (input) => {
        sentMessages.push({
          templateKey: input.templateKey,
          defaultReason: input.defaultReason,
          actorUserId: input.actorUserId,
        });
        return { createdCount: 1, messageIds: [101] };
      },
    });

    const result = await service.decideAdminReportCase({
      db: {} as never,
      caseId: 'case-1',
      adminUserId: 99,
      nextStatus: 'resolved',
      resolutionCode: 'confirmed_violation',
      cardModerationAction: {
        action: 'set_public_status',
        value: -1,
        messageOptions: {
          send: true,
          defaultReason: '公开卡违规封禁',
        },
      },
    });

    expect(result).toMatchObject({
      reportCaseId: 'case-1',
      status: 'resolved',
      resolutionCode: 'confirmed_violation',
      closedAt: now,
      notifiedCreator: false,
      dataCardModerationApplied: true,
    });
    expect(batchUpdates).toEqual([
      {
        cardIds: ['card-1'],
        updates: { is_public: -1 },
      },
    ]);
    expect(sentMessages).toEqual([
      {
        templateKey: 'user.moderation.data_card_banned',
        defaultReason: '公开卡违规封禁',
        actorUserId: 99,
      },
    ]);
  });

  test('service returns conflict when report case snapshot is stale', async () => {
    const service = createAdminReportCasesServiceForTests({
      now: () => now,
      getReportCaseById: async () => ({
        id: 'case-1',
        targetEntityType: 'data_card',
        targetEntityId: 'card-1',
        targetUserId: 7,
        targetCardName: '雪沫',
        status: 'open',
        resolutionCode: null,
        updatedAt: '2026-04-11T07:59:00.000Z',
      }),
      updateReportCaseDecision: async () => false,
    });

    await expect(
      service.decideAdminReportCase({
        db: {} as never,
        caseId: 'case-1',
        adminUserId: 99,
        nextStatus: 'resolved',
        resolutionCode: 'confirmed_violation',
      }),
    ).rejects.toBeInstanceOf(AdminGovernanceConflictError);
  });
});
