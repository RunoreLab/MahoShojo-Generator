import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { getRoundById, revokeAssignedAssignmentsByRound, updateRound } from '@/lib/db/repositories/crowd-review';
import { updateReportCaseDecision } from '@/lib/db/repositories/data-card-reports';
import type { CrowdReviewResultCode, CrowdReviewRoundStatus, ReportCaseStatus, ReportResolutionCode } from '@/lib/db/schema';
import {
  AdminGovernanceConflictError,
  AdminGovernanceNotFoundError,
  AdminGovernanceServiceUnavailableError,
} from '@/lib/admin/governance';

type AdminCrowdReviewManagedRound = {
  id: string;
  reportCaseId: string;
  reportCaseUpdatedAt?: string;
  status: CrowdReviewRoundStatus;
  resultCode: CrowdReviewResultCode | null;
  resultSummaryJson: string;
  updatedAt: string;
};

export type AdminCrowdReviewActionResult = {
  roundId: string;
  reportCaseId: string;
  roundStatus: string;
  roundResultCode: string | null;
  reportCaseStatus: string;
  reportCaseResolutionCode: string | null;
  revokedAssignmentsCount: number;
};

type AdminCrowdReviewServiceDeps = {
  now: () => string;
  getRoundById: (db: AppDrizzleDb, roundId: string) => Promise<AdminCrowdReviewManagedRound | null>;
  updateRound: typeof updateRound;
  revokeAssignedAssignmentsByRound: typeof revokeAssignedAssignmentsByRound;
  updateReportCaseDecision: typeof updateReportCaseDecision;
};

const requireDb = (db: AppDrizzleDb | null): AppDrizzleDb => {
  if (!db) {
    throw new AdminGovernanceServiceUnavailableError('治理后台数据库不可用');
  }
  return db;
};

const parseSummaryJson = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return {};
};

const buildSummaryJson = (
  round: AdminCrowdReviewManagedRound,
  input: {
    action: 'take_over' | 'cancel' | 'override';
    adminUserId: number;
    now: string;
    reasonDetail?: string | null;
    caseDecision?: 'violation' | 'no_violation' | 'reopen_under_review';
    nextRoundStatus: CrowdReviewRoundStatus;
    nextResultCode: CrowdReviewResultCode | null;
  },
): string => {
  const current = parseSummaryJson(round.resultSummaryJson);
  return JSON.stringify({
    ...current,
    adminAction: {
      action: input.action === 'take_over' ? 'takeOver' : input.action,
      adminUserId: input.adminUserId,
      reasonDetail: input.reasonDetail ?? null,
      caseDecision: input.caseDecision ?? null,
      previousStatus: round.status,
      previousResultCode: round.resultCode,
      nextRoundStatus: input.nextRoundStatus,
      nextResultCode: input.nextResultCode,
      actedAt: input.now,
    },
  });
};

const ensureRoundEditable = (
  round: AdminCrowdReviewManagedRound,
  action: 'take_over' | 'cancel' | 'override',
): void => {
  if (round.status === 'cancelled') {
    throw new AdminGovernanceConflictError('该众查轮次已撤销');
  }
  if (action === 'take_over' && round.status === 'escalated') {
    throw new AdminGovernanceConflictError('该众查轮次已被管理员接管');
  }
  if ((action === 'take_over' || action === 'cancel') && round.status === 'concluded') {
    throw new AdminGovernanceConflictError('已出结论的众查轮次不能再执行该操作');
  }
};

const resolveCaseDecision = (
  decision: 'violation' | 'no_violation' | 'reopen_under_review',
  now: string,
): {
  reportCaseStatus: ReportCaseStatus;
  reportCaseResolutionCode: ReportResolutionCode | null;
  closedAt: string | null;
} => {
  if (decision === 'violation') {
    return {
      reportCaseStatus: 'resolved',
      reportCaseResolutionCode: 'confirmed_violation',
      closedAt: now,
    };
  }
  if (decision === 'no_violation') {
    return {
      reportCaseStatus: 'dismissed',
      reportCaseResolutionCode: 'no_violation',
      closedAt: now,
    };
  }
  return {
    reportCaseStatus: 'under_review',
    reportCaseResolutionCode: null,
    closedAt: null,
  };
};

const commitAdminRoundAction = async (
  deps: AdminCrowdReviewServiceDeps,
  input: {
    db: AppDrizzleDb;
    round: AdminCrowdReviewManagedRound;
    now: string;
    nextRoundStatus: CrowdReviewRoundStatus;
    nextRoundResultCode: CrowdReviewResultCode | null;
    nextRoundSummaryJson: string;
    nextCaseStatus: ReportCaseStatus;
    nextCaseResolutionCode: ReportResolutionCode | null;
    nextCaseClosedAt: string | null;
  },
): Promise<number> => {
  const roundUpdated = await deps.updateRound(input.db, {
    roundId: input.round.id,
    status: input.nextRoundStatus,
    resultCode: input.nextRoundResultCode,
    resultSummaryJson: input.nextRoundSummaryJson,
    now: input.now,
    expectedUpdatedAt: input.round.updatedAt,
  });
  if (!roundUpdated) {
    throw new AdminGovernanceConflictError('众查轮次状态已变化，请刷新后重试');
  }

  const caseUpdated = await deps.updateReportCaseDecision(input.db, {
    reportCaseId: input.round.reportCaseId,
    status: input.nextCaseStatus,
    resolutionCode: input.nextCaseResolutionCode,
    closedAt: input.nextCaseClosedAt,
    now: input.now,
    expectedUpdatedAt: input.round.reportCaseUpdatedAt,
  });
  if (!caseUpdated) {
    await deps.updateRound(input.db, {
      roundId: input.round.id,
      status: input.round.status,
      resultCode: input.round.resultCode,
      resultSummaryJson: input.round.resultSummaryJson,
      now: input.now,
      expectedUpdatedAt: input.now,
    });
    throw new AdminGovernanceConflictError('举报案件状态已变化，请刷新后重试');
  }

  return await deps.revokeAssignedAssignmentsByRound(input.db, {
    roundId: input.round.id,
    now: input.now,
  });
};

const defaultDeps: AdminCrowdReviewServiceDeps = {
  now: () => new Date().toISOString(),
  getRoundById,
  updateRound,
  revokeAssignedAssignmentsByRound,
  updateReportCaseDecision,
};

const createAdminCrowdReviewService = (deps: AdminCrowdReviewServiceDeps) => ({
  async takeOverAdminCrowdReviewRound(input: {
    db: AppDrizzleDb | null;
    roundId: string;
    adminUserId: number;
    reasonDetail?: string | null;
  }): Promise<AdminCrowdReviewActionResult> {
    const db = requireDb(input.db);
    const round = await deps.getRoundById(db, input.roundId);
    if (!round) {
      throw new AdminGovernanceNotFoundError('众查轮次不存在');
    }
    ensureRoundEditable(round, 'take_over');

    const now = deps.now();
    const resultSummaryJson = buildSummaryJson(round, {
      action: 'take_over',
      adminUserId: input.adminUserId,
      reasonDetail: input.reasonDetail,
      now,
      nextRoundStatus: 'escalated',
      nextResultCode: 'escalated',
    });
    const revokedAssignmentsCount = await commitAdminRoundAction(deps, {
      db,
      round,
      now,
      nextRoundStatus: 'escalated',
      nextRoundResultCode: 'escalated',
      nextRoundSummaryJson: resultSummaryJson,
      nextCaseStatus: 'under_review',
      nextCaseResolutionCode: null,
      nextCaseClosedAt: null,
    });

    return {
      roundId: round.id,
      reportCaseId: round.reportCaseId,
      roundStatus: 'escalated',
      roundResultCode: 'escalated',
      reportCaseStatus: 'under_review',
      reportCaseResolutionCode: null,
      revokedAssignmentsCount,
    };
  },

  async cancelAdminCrowdReviewRound(input: {
    db: AppDrizzleDb | null;
    roundId: string;
    adminUserId: number;
    reasonDetail?: string | null;
  }): Promise<AdminCrowdReviewActionResult> {
    const db = requireDb(input.db);
    const round = await deps.getRoundById(db, input.roundId);
    if (!round) {
      throw new AdminGovernanceNotFoundError('众查轮次不存在');
    }
    ensureRoundEditable(round, 'cancel');

    const now = deps.now();
    const resultSummaryJson = buildSummaryJson(round, {
      action: 'cancel',
      adminUserId: input.adminUserId,
      reasonDetail: input.reasonDetail,
      now,
      nextRoundStatus: 'cancelled',
      nextResultCode: null,
    });
    const revokedAssignmentsCount = await commitAdminRoundAction(deps, {
      db,
      round,
      now,
      nextRoundStatus: 'cancelled',
      nextRoundResultCode: null,
      nextRoundSummaryJson: resultSummaryJson,
      nextCaseStatus: 'under_review',
      nextCaseResolutionCode: null,
      nextCaseClosedAt: null,
    });

    return {
      roundId: round.id,
      reportCaseId: round.reportCaseId,
      roundStatus: 'cancelled',
      roundResultCode: null,
      reportCaseStatus: 'under_review',
      reportCaseResolutionCode: null,
      revokedAssignmentsCount,
    };
  },

  async overrideAdminCrowdReviewRound(input: {
    db: AppDrizzleDb | null;
    roundId: string;
    adminUserId: number;
    caseDecision: 'violation' | 'no_violation' | 'reopen_under_review';
    reasonDetail?: string | null;
  }): Promise<AdminCrowdReviewActionResult> {
    const db = requireDb(input.db);
    const round = await deps.getRoundById(db, input.roundId);
    if (!round) {
      throw new AdminGovernanceNotFoundError('众查轮次不存在');
    }
    ensureRoundEditable(round, 'override');

    const now = deps.now();
    const nextCaseDecision = resolveCaseDecision(input.caseDecision, now);
    const resultSummaryJson = buildSummaryJson(round, {
      action: 'override',
      adminUserId: input.adminUserId,
      reasonDetail: input.reasonDetail,
      caseDecision: input.caseDecision,
      now,
      nextRoundStatus: 'concluded',
      nextResultCode: 'admin_override',
    });
    const revokedAssignmentsCount = await commitAdminRoundAction(deps, {
      db,
      round,
      now,
      nextRoundStatus: 'concluded',
      nextRoundResultCode: 'admin_override',
      nextRoundSummaryJson: resultSummaryJson,
      nextCaseStatus: nextCaseDecision.reportCaseStatus,
      nextCaseResolutionCode: nextCaseDecision.reportCaseResolutionCode,
      nextCaseClosedAt: nextCaseDecision.closedAt,
    });

    return {
      roundId: round.id,
      reportCaseId: round.reportCaseId,
      roundStatus: 'concluded',
      roundResultCode: 'admin_override',
      reportCaseStatus: nextCaseDecision.reportCaseStatus,
      reportCaseResolutionCode: nextCaseDecision.reportCaseResolutionCode,
      revokedAssignmentsCount,
    };
  },
});

export function createAdminCrowdReviewServiceForTests(
  overrides: Partial<AdminCrowdReviewServiceDeps> = {},
) {
  return createAdminCrowdReviewService({
    ...defaultDeps,
    ...overrides,
  });
}

const defaultService = createAdminCrowdReviewService(defaultDeps);

export async function takeOverAdminCrowdReviewRound(input: {
  db: AppDrizzleDb | null;
  roundId: string;
  adminUserId: number;
  reasonDetail?: string | null;
}) {
  return defaultService.takeOverAdminCrowdReviewRound(input);
}

export async function cancelAdminCrowdReviewRound(input: {
  db: AppDrizzleDb | null;
  roundId: string;
  adminUserId: number;
  reasonDetail?: string | null;
}) {
  return defaultService.cancelAdminCrowdReviewRound(input);
}

export async function overrideAdminCrowdReviewRound(input: {
  db: AppDrizzleDb | null;
  roundId: string;
  adminUserId: number;
  caseDecision: 'violation' | 'no_violation' | 'reopen_under_review';
  reasonDetail?: string | null;
}) {
  return defaultService.overrideAdminCrowdReviewRound(input);
}
