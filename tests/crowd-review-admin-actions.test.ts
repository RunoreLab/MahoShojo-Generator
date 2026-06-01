import { describe, expect, test } from 'vitest';

import { createAdminCrowdReviewServiceForTests } from '@/lib/admin/crowd-review';
import { AdminGovernanceConflictError } from '@/lib/admin/governance';

const now = '2026-04-11T09:00:00.000Z';

const baseRound = {
  id: 'round-1',
  reportCaseId: 'case-1',
  reportCaseUpdatedAt: '2026-04-11T07:25:00.000Z',
  status: 'active',
  openedAt: '2026-04-11T07:00:00.000Z',
  deadlineAt: '2026-04-11T10:00:00.000Z',
  extensionCount: 0,
  minValidVotes: 3,
  resultCode: null,
  resultSummaryJson: '{"voteSummary":{"valid":2}}',
  createdAt: '2026-04-11T07:00:00.000Z',
  updatedAt: '2026-04-11T07:30:00.000Z',
} as const;

describe('crowd review admin actions', () => {
  test('take-over writes round escalated + escalated and case under_review + null', async () => {
    const roundWrites: Array<Record<string, unknown>> = [];
    const caseWrites: Array<Record<string, unknown>> = [];
    const service = createAdminCrowdReviewServiceForTests({
      now: () => now,
      getRoundById: async () => ({ ...baseRound }),
      updateRound: async (_db, input) => {
        roundWrites.push(input as unknown as Record<string, unknown>);
        return true;
      },
      updateReportCaseDecision: async (_db, input) => {
        caseWrites.push(input as unknown as Record<string, unknown>);
        return true;
      },
      revokeAssignedAssignmentsByRound: async () => 0,
    });

    const result = await service.takeOverAdminCrowdReviewRound({
      db: {} as never,
      roundId: 'round-1',
      adminUserId: 88,
      reasonDetail: '管理员接管',
    });

    expect(result).toMatchObject({
      roundId: 'round-1',
      reportCaseId: 'case-1',
      roundStatus: 'escalated',
      roundResultCode: 'escalated',
      reportCaseStatus: 'under_review',
      reportCaseResolutionCode: null,
    });
    expect(roundWrites[0]).toMatchObject({
      roundId: 'round-1',
      status: 'escalated',
      resultCode: 'escalated',
      now,
    });
    expect(caseWrites[0]).toMatchObject({
      reportCaseId: 'case-1',
      status: 'under_review',
      resolutionCode: null,
      closedAt: null,
      now,
      expectedUpdatedAt: '2026-04-11T07:25:00.000Z',
    });
  });

  test('cancel writes round cancelled + null, revokes assigned assignments, and case under_review + null', async () => {
    const roundWrites: Array<Record<string, unknown>> = [];
    const caseWrites: Array<Record<string, unknown>> = [];
    let revokedRoundId = '';
    const service = createAdminCrowdReviewServiceForTests({
      now: () => now,
      getRoundById: async () => ({ ...baseRound }),
      updateRound: async (_db, input) => {
        roundWrites.push(input as unknown as Record<string, unknown>);
        return true;
      },
      updateReportCaseDecision: async (_db, input) => {
        caseWrites.push(input as unknown as Record<string, unknown>);
        return true;
      },
      revokeAssignedAssignmentsByRound: async (_db, input) => {
        revokedRoundId = input.roundId;
        return 2;
      },
    });

    const result = await service.cancelAdminCrowdReviewRound({
      db: {} as never,
      roundId: 'round-1',
      adminUserId: 88,
      reasonDetail: '证据不足，撤销轮次',
    });

    expect(result).toMatchObject({
      roundStatus: 'cancelled',
      roundResultCode: null,
      reportCaseStatus: 'under_review',
      reportCaseResolutionCode: null,
      revokedAssignmentsCount: 2,
    });
    expect(revokedRoundId).toBe('round-1');
    expect(roundWrites[0]).toMatchObject({
      status: 'cancelled',
      resultCode: null,
    });
    expect(caseWrites[0]).toMatchObject({
      reportCaseId: 'case-1',
      status: 'under_review',
      resolutionCode: null,
      closedAt: null,
      now,
      expectedUpdatedAt: '2026-04-11T07:25:00.000Z',
    });
  });

  test('override violation writes round concluded + admin_override and case resolved + confirmed_violation', async () => {
    const roundWrites: Array<Record<string, unknown>> = [];
    const caseWrites: Array<Record<string, unknown>> = [];
    const service = createAdminCrowdReviewServiceForTests({
      now: () => now,
      getRoundById: async () => ({ ...baseRound }),
      updateRound: async (_db, input) => {
        roundWrites.push(input as unknown as Record<string, unknown>);
        return true;
      },
      updateReportCaseDecision: async (_db, input) => {
        caseWrites.push(input as unknown as Record<string, unknown>);
        return true;
      },
      revokeAssignedAssignmentsByRound: async () => 1,
    });

    const result = await service.overrideAdminCrowdReviewRound({
      db: {} as never,
      roundId: 'round-1',
      adminUserId: 88,
      caseDecision: 'violation',
      reasonDetail: '管理员改判违规成立',
    });

    expect(result).toMatchObject({
      roundStatus: 'concluded',
      roundResultCode: 'admin_override',
      reportCaseStatus: 'resolved',
      reportCaseResolutionCode: 'confirmed_violation',
      revokedAssignmentsCount: 1,
    });
    expect(roundWrites[0]).toMatchObject({
      status: 'concluded',
      resultCode: 'admin_override',
    });
    expect(caseWrites[0]).toMatchObject({
      reportCaseId: 'case-1',
      status: 'resolved',
      resolutionCode: 'confirmed_violation',
      closedAt: now,
      now,
      expectedUpdatedAt: '2026-04-11T07:25:00.000Z',
    });
  });

  test('override no-violation writes case dismissed + no_violation', async () => {
    const caseWrites: Array<Record<string, unknown>> = [];
    const service = createAdminCrowdReviewServiceForTests({
      now: () => now,
      getRoundById: async () => ({ ...baseRound, status: 'escalated' }),
      updateRound: async () => true,
      updateReportCaseDecision: async (_db, input) => {
        caseWrites.push(input as unknown as Record<string, unknown>);
        return true;
      },
      revokeAssignedAssignmentsByRound: async () => 0,
    });

    const result = await service.overrideAdminCrowdReviewRound({
      db: {} as never,
      roundId: 'round-1',
      adminUserId: 88,
      caseDecision: 'no_violation',
    });

    expect(result.reportCaseStatus).toBe('dismissed');
    expect(result.reportCaseResolutionCode).toBe('no_violation');
    expect(caseWrites[0]).toMatchObject({
      reportCaseId: 'case-1',
      status: 'dismissed',
      resolutionCode: 'no_violation',
      closedAt: now,
      now,
      expectedUpdatedAt: '2026-04-11T07:25:00.000Z',
    });
  });

  test('override reopen writes case under_review + null', async () => {
    const caseWrites: Array<Record<string, unknown>> = [];
    const service = createAdminCrowdReviewServiceForTests({
      now: () => now,
      getRoundById: async () => ({ ...baseRound, status: 'concluded', resultCode: 'violation' }),
      updateRound: async () => true,
      updateReportCaseDecision: async (_db, input) => {
        caseWrites.push(input as unknown as Record<string, unknown>);
        return true;
      },
      revokeAssignedAssignmentsByRound: async () => 0,
    });

    const result = await service.overrideAdminCrowdReviewRound({
      db: {} as never,
      roundId: 'round-1',
      adminUserId: 88,
      caseDecision: 'reopen_under_review',
      reasonDetail: '转人工复核',
    });

    expect(result.reportCaseStatus).toBe('under_review');
    expect(result.reportCaseResolutionCode).toBeNull();
    expect(caseWrites[0]).toMatchObject({
      reportCaseId: 'case-1',
      status: 'under_review',
      resolutionCode: null,
      closedAt: null,
      now,
      expectedUpdatedAt: '2026-04-11T07:25:00.000Z',
    });
  });

  test('result summary JSON keeps admin metadata', async () => {
    let persistedSummary = '{}';
    const service = createAdminCrowdReviewServiceForTests({
      now: () => now,
      getRoundById: async () => ({ ...baseRound }),
      updateRound: async (_db, input) => {
        persistedSummary = String(input.resultSummaryJson);
        return true;
      },
      updateReportCaseDecision: async () => true,
      revokeAssignedAssignmentsByRound: async () => 0,
    });

    await service.overrideAdminCrowdReviewRound({
      db: {} as never,
      roundId: 'round-1',
      adminUserId: 88,
      caseDecision: 'violation',
      reasonDetail: '管理员补充说明',
    });

    const parsed = JSON.parse(persistedSummary) as Record<string, unknown>;

    expect(parsed.voteSummary).toEqual({ valid: 2 });
    expect(parsed.adminAction).toMatchObject({
      action: 'override',
      adminUserId: 88,
      caseDecision: 'violation',
      reasonDetail: '管理员补充说明',
    });
  });

  test('take-over rejects stale round snapshot when update returns false', async () => {
    let revokeCalled = false;
    const service = createAdminCrowdReviewServiceForTests({
      now: () => now,
      getRoundById: async () => ({ ...baseRound }),
      updateRound: async () => false,
      updateReportCaseDecision: async () => true,
      revokeAssignedAssignmentsByRound: async () => {
        revokeCalled = true;
        return 0;
      },
    });

    await expect(
      service.takeOverAdminCrowdReviewRound({
        db: {} as never,
        roundId: 'round-1',
        adminUserId: 88,
      }),
    ).rejects.toBeInstanceOf(AdminGovernanceConflictError);
    expect(revokeCalled).toBe(false);
  });

  test('take-over rolls round state back when case update conflicts', async () => {
    const roundWrites: Array<Record<string, unknown>> = [];
    let revokeCalled = false;
    let roundUpdateCount = 0;
    const service = createAdminCrowdReviewServiceForTests({
      now: () => now,
      getRoundById: async () => ({ ...baseRound }),
      updateRound: async (_db, input) => {
        roundWrites.push(input as unknown as Record<string, unknown>);
        roundUpdateCount += 1;
        return roundUpdateCount <= 2;
      },
      updateReportCaseDecision: async () => false,
      revokeAssignedAssignmentsByRound: async () => {
        revokeCalled = true;
        return 0;
      },
    });

    await expect(
      service.takeOverAdminCrowdReviewRound({
        db: {} as never,
        roundId: 'round-1',
        adminUserId: 88,
        reasonDetail: '管理员接管',
      }),
    ).rejects.toBeInstanceOf(AdminGovernanceConflictError);

    expect(roundWrites).toHaveLength(2);
    expect(roundWrites[0]).toMatchObject({
      roundId: 'round-1',
      status: 'escalated',
      resultCode: 'escalated',
      expectedUpdatedAt: '2026-04-11T07:30:00.000Z',
    });
    expect(roundWrites[1]).toMatchObject({
      roundId: 'round-1',
      status: 'active',
      resultCode: null,
      resultSummaryJson: '{"voteSummary":{"valid":2}}',
      expectedUpdatedAt: now,
    });
    expect(revokeCalled).toBe(false);
  });
});
