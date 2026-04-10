import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { countUserBadgesByBadgeId } from '@/lib/db/repositories/badges';
import {
  createCrowdReviewAssignment as createCrowdReviewAssignmentRow,
  createCrowdReviewRound as createCrowdReviewRoundRow,
  finalizeAssignment as finalizeAssignmentRow,
  getActiveAssignmentByInspector as getActiveAssignmentByInspectorRow,
  getAssignmentByIdForInspector as getAssignmentByIdForInspectorRow,
  getInspectorState as getInspectorStateRow,
  getLatestCompletedAssignmentByInspector as getLatestCompletedAssignmentByInspectorRow,
  getRoundById as getRoundByIdRow,
  listAssignmentsByRound as listAssignmentsByRoundRows,
  listAssignableCases as listAssignableCasesRows,
  listCrowdReviewHistoryByInspector as listCrowdReviewHistoryByInspectorRows,
  updateAssignmentPostVoteSummary as updateAssignmentPostVoteSummaryRow,
  updateRound as updateRoundRow,
} from '@/lib/db/repositories/crowd-review';
import {
  crowdReviewAssignments,
  crowdReviewRounds,
  dataCards,
  reportCases,
  reportReferences,
  reports,
  type CrowdReviewDecision,
  type ReportCaseStatus,
  type ReportResolutionCode,
} from '@/lib/db/schema';
import { getDataCardReportReasonLabel, isDataCardReportReasonCode } from '@/lib/data-card-reports/reasons';
import { notifyReportCaseResolutionIfNeeded } from '@/lib/report-appeals/service';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type {
  AssignCurrentCaseResult,
  CrowdReviewCurrentCaseDto,
  CrowdReviewHistoryDto,
  CrowdReviewPostVoteSummaryDto,
  CrowdReviewSummaryDto,
  SubmitCrowdReviewDecisionResult,
} from '@/lib/crowd-review/types';
import type {
  CrowdReviewAssignmentRow,
  CrowdReviewInspectorRow,
  CrowdReviewRoundRow,
  CreateCrowdReviewAssignmentInput,
  CreateCrowdReviewRoundInput,
} from '@/lib/db/repositories/crowd-review';

export const CROWD_REVIEW_ENTRY_URL = '/investigation' as const;
export const CROWD_REVIEW_INSPECTOR_BADGE_ID = 'crowd_review_inspector' as const;
const ROUND_EXTENSION_MS = 60 * 60 * 1000;
const ACTIVE_ROUND_STATUSES = ['pending_dispatch', 'active', 'waiting_more_votes'] as const;

type CrowdReviewCaseCandidate = {
  reportCaseId: string;
  targetEntityId: string;
  targetUserId: number;
  reporterUserIds: number[];
  assignedInspectorUserIds: number[];
  existingRoundId: string | null;
};

type ServiceAssignmentRow = CrowdReviewAssignmentRow & {
  reportCaseId?: string;
  targetEntityId?: string;
  targetSnapshotName?: string | null;
  targetSnapshotDescription?: string | null;
  reasonLabels?: string[];
  detailPreviews?: string[];
  referenceSummary?: string[];
  roundStatus?: string;
  roundDeadlineAt?: string;
  roundMinValidVotes?: number;
  roundExtensionCount?: number;
  roundResultCode?: string | null;
};

type CrowdReviewServiceRepo = {
  getInspectorState: (db: AppDrizzleDb, userId: number) => Promise<CrowdReviewInspectorRow | null>;
  getActiveAssignmentByInspector: (db: AppDrizzleDb, userId: number) => Promise<ServiceAssignmentRow | null>;
  getLatestCompletedAssignmentByInspector: (
    db: AppDrizzleDb,
    userId: number,
  ) => Promise<ServiceAssignmentRow | null>;
  listAssignableCases: (db: AppDrizzleDb, userId: number) => Promise<CrowdReviewCaseCandidate[]>;
  getActiveRoundByReportCaseId: (db: AppDrizzleDb, reportCaseId: string) => Promise<CrowdReviewRoundRow | null>;
  createCrowdReviewRound: (db: AppDrizzleDb, input: CreateCrowdReviewRoundInput) => Promise<CrowdReviewRoundRow>;
  createCrowdReviewAssignment: (
    db: AppDrizzleDb,
    input: CreateCrowdReviewAssignmentInput,
  ) => Promise<ServiceAssignmentRow>;
  getAssignmentByIdForInspector: (
    db: AppDrizzleDb,
    input: { assignmentId: string; userId: number },
  ) => Promise<ServiceAssignmentRow | null>;
  getRoundById: (db: AppDrizzleDb, roundId: string) => Promise<CrowdReviewRoundRow | null>;
  listExpiredRounds: (db: AppDrizzleDb, now: string) => Promise<CrowdReviewRoundRow[]>;
  listAssignmentsByRound: (db: AppDrizzleDb, roundId: string) => Promise<ServiceAssignmentRow[]>;
  finalizeAssignment: (
    db: AppDrizzleDb,
    input: {
      assignmentId: string;
      userId: number;
      status: 'voted' | 'abstained' | 'expired' | 'revoked';
      decision: CrowdReviewDecision | null;
      note: string | null;
      postVoteSummaryJson: string;
      now: string;
    },
  ) => Promise<boolean>;
  updateAssignmentPostVoteSummary: (
    db: AppDrizzleDb,
    input: {
      assignmentId: string;
      userId: number;
      postVoteSummaryJson: string;
      now: string;
    },
  ) => Promise<boolean>;
  updateRound: (
    db: AppDrizzleDb,
    input: {
      roundId: string;
      status: string;
      deadlineAt?: string;
      extensionCount?: number;
      resultCode?: string | null;
      resultSummaryJson?: string;
      now: string;
    },
  ) => Promise<boolean>;
  updateReportCaseResolution: (
    db: AppDrizzleDb,
    input: {
      reportCaseId: string;
      status: ReportCaseStatus;
      resolutionCode: ReportResolutionCode | null;
      closedAt: string | null;
      now: string;
    },
  ) => Promise<boolean>;
  listCrowdReviewHistoryByInspector: (db: AppDrizzleDb, userId: number, limit: number) => Promise<any[]>;
  advanceExpiredState: (db: AppDrizzleDb, now: string) => Promise<void>;
};

export type CrowdReviewServiceDeps = {
  now: () => string;
  idFactory: () => string;
  hasInspectorBadge: (db: AppDrizzleDb, userId: number) => Promise<boolean>;
  repo: CrowdReviewServiceRepo;
  notifyReportCaseResolutionIfNeeded?: (input: { db: AppDrizzleDb | null; reportCaseId: string }) => Promise<boolean>;
};

export class CrowdReviewServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrowdReviewServiceUnavailableError';
  }
}

export class CrowdReviewForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrowdReviewForbiddenError';
  }
}

export class CrowdReviewNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrowdReviewNotFoundError';
  }
}

export class CrowdReviewConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrowdReviewConflictError';
  }
}

const requireDb = (db: AppDrizzleDb | null): AppDrizzleDb => {
  if (!db) {
    throw new CrowdReviewServiceUnavailableError('众查服务当前不可用');
  }
  return db;
};

const parseSummaryJson = (raw: string | null | undefined): CrowdReviewPostVoteSummaryDto | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CrowdReviewPostVoteSummaryDto>;
    if (typeof parsed.summaryText !== 'string') return null;
    return {
      roundStatus: typeof parsed.roundStatus === 'string' ? parsed.roundStatus : 'active',
      resultCode:
        parsed.resultCode === 'violation' ||
        parsed.resultCode === 'no_violation' ||
        parsed.resultCode === 'tie' ||
        parsed.resultCode === 'escalated' ||
        parsed.resultCode === 'admin_override'
          ? parsed.resultCode
          : null,
      summaryText: parsed.summaryText,
    };
  } catch {
    return null;
  }
};

const buildPostVoteSummary = (input: {
  roundStatus: string;
  resultCode: string | null;
  validViolationVotes: number;
  validNoViolationVotes: number;
  abstainCount: number;
}): CrowdReviewPostVoteSummaryDto => {
  const parts: string[] = [];
  if (input.resultCode === 'violation') {
    parts.push('当前轮次已形成“支持违规”结果。');
  } else if (input.resultCode === 'no_violation') {
    parts.push('当前轮次已形成“支持不违规”结果。');
  } else if (input.resultCode === 'escalated') {
    parts.push('当前轮次因平票已升级为管理员处理。');
  } else if (input.roundStatus === 'waiting_more_votes') {
    parts.push('当前轮次暂时平票，系统将延长一次并继续等待更多结果。');
  } else {
    parts.push('你的处理结果已记录，当前轮次仍在等待更多结果。');
  }

  parts.push(
    `有效票：支持违规 ${input.validViolationVotes}，支持不违规 ${input.validNoViolationVotes}，弃权 ${input.abstainCount}。`,
  );

  return {
    roundStatus: input.roundStatus,
    resultCode:
      input.resultCode === 'violation' ||
      input.resultCode === 'no_violation' ||
      input.resultCode === 'tie' ||
      input.resultCode === 'escalated' ||
      input.resultCode === 'admin_override'
        ? input.resultCode
        : null,
    summaryText: parts.join(' '),
  };
};

const mapAssignmentToCurrentCase = (
  row: ServiceAssignmentRow,
  fallback?: Partial<CrowdReviewCurrentCaseDto>,
): CrowdReviewCurrentCaseDto => ({
  assignmentId: row.id,
  assignmentStatus: row.status,
  assignedAt: row.assignedAt,
  expiresAt: row.expiresAt,
  caseId: row.crowdReviewRoundId,
  reportCaseId: row.reportCaseId ?? fallback?.reportCaseId ?? '',
  targetEntityType: 'data_card',
  targetEntityId: row.targetEntityId ?? fallback?.targetEntityId ?? '',
  targetSnapshot:
    row.targetSnapshotName || row.targetSnapshotDescription
      ? {
          name: row.targetSnapshotName ?? '',
          description: row.targetSnapshotDescription ?? null,
        }
      : (fallback?.targetSnapshot ?? null),
  reportSummary: {
    reasonLabels: row.reasonLabels ?? fallback?.reportSummary?.reasonLabels ?? [],
    details: row.detailPreviews ?? fallback?.reportSummary?.details ?? [],
    references: row.referenceSummary ?? fallback?.reportSummary?.references ?? [],
  },
  ruleHints: fallback?.ruleHints ?? ['投票前不会展示票况'],
  availableDecisions: ['violation', 'no_violation', 'abstain'],
  postVoteSummary: parseSummaryJson(row.postVoteSummaryJson) ?? fallback?.postVoteSummary ?? null,
});

const buildIneligibleSummary = (
  inspectorStatus: CrowdReviewSummaryDto['inspectorStatus'],
  statusReason: string | null,
): CrowdReviewSummaryDto => ({
  eligible: false,
  inspectorStatus,
  statusReason,
  hasCurrentAssignment: false,
  hasCrowdReviewPending: false,
  entryUrl: CROWD_REVIEW_ENTRY_URL,
});

const selectAssignableCase = (
  candidates: CrowdReviewCaseCandidate[],
  userId: number,
): CrowdReviewCaseCandidate | null =>
  candidates.find(
    (candidate) =>
      !candidate.reporterUserIds.includes(userId) &&
      candidate.targetUserId !== userId &&
      !candidate.assignedInspectorUserIds.includes(userId),
  ) ?? null;

const isFinalAssignmentStatus = (status: string): status is 'voted' | 'abstained' | 'expired' | 'revoked' =>
  status === 'voted' || status === 'abstained' || status === 'expired' || status === 'revoked';

const isActiveRoundStatus = (status: string): status is (typeof ACTIVE_ROUND_STATUSES)[number] =>
  ACTIVE_ROUND_STATUSES.includes(status as (typeof ACTIVE_ROUND_STATUSES)[number]);

const addMs = (iso: string, ms: number): string => new Date(new Date(iso).getTime() + ms).toISOString();

const isUniqueConstraintError = (error: unknown): error is Error =>
  error instanceof Error && /unique constraint/i.test(error.message);

const isActiveRoundUniqueConflict = (error: unknown): boolean =>
  isUniqueConstraintError(error) &&
  (
    error.message.includes('idx_crowd_review_rounds_report_case_active') ||
    error.message.includes('crowd_review_rounds.report_case_id')
  );

const isAssignmentUniqueConflict = (error: unknown): boolean =>
  isUniqueConstraintError(error) &&
  (
    error.message.includes('idx_crowd_review_assignments_active_inspector') ||
    error.message.includes('idx_crowd_review_assignments_round_inspector') ||
    error.message.includes('crowd_review_assignments.inspector_user_id') ||
    error.message.includes('crowd_review_assignments.crowd_review_round_id')
  );

const buildAssignmentReplaySummary = (assignment: ServiceAssignmentRow): CrowdReviewPostVoteSummaryDto => {
  const persisted = parseSummaryJson(assignment.postVoteSummaryJson);
  if (persisted) {
    return persisted;
  }

  if (assignment.status === 'expired') {
    return {
      roundStatus: assignment.roundStatus ?? 'active',
      resultCode:
        assignment.roundResultCode === 'violation' ||
        assignment.roundResultCode === 'no_violation' ||
        assignment.roundResultCode === 'tie' ||
        assignment.roundResultCode === 'escalated' ||
        assignment.roundResultCode === 'admin_override'
          ? assignment.roundResultCode
          : null,
      summaryText: '该派单已过期，本次提交未计入结果，也不会记录投票。',
    };
  }

  if (assignment.status === 'revoked') {
    return {
      roundStatus: assignment.roundStatus ?? 'active',
      resultCode:
        assignment.roundResultCode === 'violation' ||
        assignment.roundResultCode === 'no_violation' ||
        assignment.roundResultCode === 'tie' ||
        assignment.roundResultCode === 'escalated' ||
        assignment.roundResultCode === 'admin_override'
          ? assignment.roundResultCode
          : null,
      summaryText: '该派单已被撤销，本次提交未计入结果，也不会记录投票。',
    };
  }

  return buildPostVoteSummary({
    roundStatus: assignment.roundStatus ?? 'active',
    resultCode: assignment.roundResultCode ?? null,
    validViolationVotes: 0,
    validNoViolationVotes: 0,
    abstainCount: assignment.status === 'abstained' ? 1 : 0,
  });
};

const toReasonLabel = (reasonCode: string): string =>
  isDataCardReportReasonCode(reasonCode) ? getDataCardReportReasonLabel(reasonCode) : reasonCode;

const previewText = (value: string | null | undefined, maxLength = 80): string | null => {
  if (!value) return null;
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
};

const hydrateAssignmentForRuntime = async (
  db: AppDrizzleDb,
  assignment: CrowdReviewAssignmentRow | null,
): Promise<ServiceAssignmentRow | null> => {
  if (!assignment) return null;

  const round = await getRoundByIdRow(db, assignment.crowdReviewRoundId);
  if (!round) return assignment;

  const reportCase = await db.query.reportCases.findFirst({
    where: eq(reportCases.id, round.reportCaseId),
  });
  if (!reportCase) return { ...assignment, roundStatus: round.status, roundResultCode: round.resultCode };

  const targetCard = await db.query.dataCards.findFirst({
    where: eq(dataCards.id, reportCase.targetEntityId),
  });

  const activeReports = await db
    .select({
      id: reports.id,
      reasonCode: reports.reasonCode,
      details: reports.details,
    })
    .from(reports)
    .where(and(eq(reports.caseId, reportCase.id), eq(reports.status, 'active')))
    .orderBy(asc(reports.createdAt), asc(reports.id));

  const reasonLabels = Array.from(new Set(activeReports.map((item) => toReasonLabel(item.reasonCode))));
  const detailPreviews = activeReports
    .map((item) => previewText(item.details))
    .filter((item): item is string => Boolean(item));

  const reportIds = activeReports.map((item) => item.id);
  const referenceRows =
    reportIds.length === 0
      ? []
      : await db
          .select({
            reportId: reportReferences.reportId,
            referenceType: reportReferences.referenceType,
            labelSnapshot: reportReferences.labelSnapshot,
          })
          .from(reportReferences)
          .where(inArray(reportReferences.reportId, reportIds))
          .orderBy(asc(reportReferences.sortOrder), asc(reportReferences.createdAt));

  const referenceSummary = referenceRows.map((item) =>
    item.referenceType === 'public_data_card'
      ? `引用公开数据卡：${item.labelSnapshot}`
      : `引用百科：${item.labelSnapshot}`,
  );

  return {
    ...assignment,
    reportCaseId: reportCase.id,
    targetEntityId: reportCase.targetEntityId,
    targetSnapshotName: targetCard?.name ?? null,
    targetSnapshotDescription: targetCard?.description ?? null,
    reasonLabels,
    detailPreviews,
    referenceSummary,
    roundStatus: round.status,
    roundDeadlineAt: round.deadlineAt,
    roundMinValidVotes: round.minValidVotes,
    roundExtensionCount: round.extensionCount,
    roundResultCode: round.resultCode,
  };
};

const createRuntimeRepo = (): CrowdReviewServiceRepo => ({
  getInspectorState: (db, userId) => getInspectorStateRow(db, userId),
  getActiveAssignmentByInspector: async (db, userId) =>
    hydrateAssignmentForRuntime(db, await getActiveAssignmentByInspectorRow(db, userId)),
  getLatestCompletedAssignmentByInspector: async (db, userId) =>
    hydrateAssignmentForRuntime(db, await getLatestCompletedAssignmentByInspectorRow(db, userId)),
  listAssignableCases: (db, userId) => listAssignableCasesRows(db, userId),
  getActiveRoundByReportCaseId: async (db, reportCaseId) =>
    (
      await db.query.crowdReviewRounds.findFirst({
        where: and(
          eq(crowdReviewRounds.reportCaseId, reportCaseId),
          inArray(crowdReviewRounds.status, [...ACTIVE_ROUND_STATUSES]),
        ),
        orderBy: [asc(crowdReviewRounds.openedAt), asc(crowdReviewRounds.id)],
      })
    ) ?? null,
  createCrowdReviewRound: (db, input) => createCrowdReviewRoundRow(db, input),
  createCrowdReviewAssignment: async (db, input) =>
    hydrateAssignmentForRuntime(db, await createCrowdReviewAssignmentRow(db, input)) as Promise<ServiceAssignmentRow>,
  getAssignmentByIdForInspector: async (db, input) =>
    hydrateAssignmentForRuntime(db, await getAssignmentByIdForInspectorRow(db, input)),
  getRoundById: (db, roundId) => getRoundByIdRow(db, roundId),
  listExpiredRounds: (db, now) =>
    db
      .select()
      .from(crowdReviewRounds)
      .where(
        and(
          inArray(crowdReviewRounds.status, [...ACTIVE_ROUND_STATUSES]),
          lte(crowdReviewRounds.deadlineAt, now),
        ),
      )
      .orderBy(asc(crowdReviewRounds.deadlineAt), asc(crowdReviewRounds.id)),
  listAssignmentsByRound: async (db, roundId) => {
    const rows = await listAssignmentsByRoundRows(db, roundId);
    return await Promise.all(rows.map((row) => hydrateAssignmentForRuntime(db, row))) as ServiceAssignmentRow[];
  },
  finalizeAssignment: (db, input) => finalizeAssignmentRow(db, input),
  updateAssignmentPostVoteSummary: (db, input) => updateAssignmentPostVoteSummaryRow(db, input),
  updateRound: (db, input) => updateRoundRow(db, input),
  updateReportCaseResolution: async (db, input) => {
    const rows = await db
      .update(reportCases)
      .set({
        status: input.status,
        resolutionCode: input.resolutionCode,
        closedAt: input.closedAt,
        updatedAt: input.now,
      })
      .where(eq(reportCases.id, input.reportCaseId))
      .returning({ id: reportCases.id });

    return rows.length > 0;
  },
  listCrowdReviewHistoryByInspector: (db, userId, limit) => listCrowdReviewHistoryByInspectorRows(db, userId, limit),
  advanceExpiredState: async (db, now) => {
    await db
      .update(crowdReviewAssignments)
      .set({
        status: 'expired',
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(crowdReviewAssignments.status, 'assigned'),
          lte(crowdReviewAssignments.expiresAt, now),
        ),
      );
  },
});

const createCrowdReviewService = (deps: CrowdReviewServiceDeps) => {
  const ensureEligibility = async (db: AppDrizzleDb | null, userId: number | null) => {
    if (userId == null) {
      return {
        eligible: false,
        summary: buildIneligibleSummary('anonymous', '登录后可查看调查院状态'),
        inspector: null as CrowdReviewInspectorRow | null,
      };
    }

    const innerDb = requireDb(db);
    const hasBadge = await deps.hasInspectorBadge(innerDb, userId);
    if (!hasBadge) {
      return {
        eligible: false,
        summary: buildIneligibleSummary('ineligible', '当前账号未持有巡查使徽章'),
        inspector: null as CrowdReviewInspectorRow | null,
      };
    }

    const inspector = await deps.repo.getInspectorState(innerDb, userId);
    if (!inspector) {
      return {
        eligible: false,
        summary: buildIneligibleSummary('ineligible', '巡查使状态尚未启用'),
        inspector: null as CrowdReviewInspectorRow | null,
      };
    }

    if (inspector.status !== 'active') {
      const reason = inspector.statusReasonDetail ?? inspector.statusReasonCode ?? '当前不可参与众查';
      return {
        eligible: false,
        summary: buildIneligibleSummary(inspector.status, reason),
        inspector,
      };
    }

    return { eligible: true, summary: null, inspector };
  };

  const advanceExpiredState = async (db: AppDrizzleDb | null) => {
    if (!db) return;
    const now = deps.now();
    await deps.repo.advanceExpiredState(db, now);

    const expiredRounds = await deps.repo.listExpiredRounds(db, now);
    for (const round of expiredRounds) {
      const assignments = await deps.repo.listAssignmentsByRound(db, round.id);
      await resolveAssignmentSummary(db, round, assignments, now);
    }
  };

  const syncFinalizedRoundAssignments = async (
    db: AppDrizzleDb,
    assignments: ServiceAssignmentRow[],
    summary: CrowdReviewPostVoteSummaryDto,
    now: string,
  ) => {
    const finalSummaryJson = JSON.stringify(summary);

    await Promise.all(
      assignments.map(async (assignment) => {
        if (assignment.status === 'voted' || assignment.status === 'abstained') {
          await deps.repo.updateAssignmentPostVoteSummary(db, {
            assignmentId: assignment.id,
            userId: assignment.inspectorUserId,
            postVoteSummaryJson: finalSummaryJson,
            now,
          });
          return;
        }

        if (assignment.status !== 'assigned') {
          return;
        }

        const revokedSummary = buildAssignmentReplaySummary({
          ...assignment,
          status: 'revoked',
          decision: null,
          postVoteSummaryJson: '{}',
          roundStatus: summary.roundStatus,
          roundResultCode: summary.resultCode,
        });

        await deps.repo.finalizeAssignment(db, {
          assignmentId: assignment.id,
          userId: assignment.inspectorUserId,
          status: 'revoked',
          decision: null,
          note: null,
          postVoteSummaryJson: JSON.stringify(revokedSummary),
          now,
        });
      }),
    );
  };

  const resolveAssignmentSummary = async (
    db: AppDrizzleDb,
    round: CrowdReviewRoundRow,
    assignments: ServiceAssignmentRow[],
    now: string,
  ) => {
    const violationVotes = assignments.filter(
      (item) => item.status === 'voted' && item.decision === 'violation',
    ).length;
    const noViolationVotes = assignments.filter(
      (item) => item.status === 'voted' && item.decision === 'no_violation',
    ).length;
    const abstainCount = assignments.filter((item) => item.status === 'abstained').length;
    const validVotes = violationVotes + noViolationVotes;

    if (!isActiveRoundStatus(round.status)) {
      return (
        parseSummaryJson(round.resultSummaryJson) ??
        buildPostVoteSummary({
          roundStatus: round.status,
          resultCode: round.resultCode,
          validViolationVotes: violationVotes,
          validNoViolationVotes: noViolationVotes,
          abstainCount,
        })
      );
    }

    if (new Date(round.deadlineAt).getTime() > new Date(now).getTime() || validVotes < round.minValidVotes) {
      return buildPostVoteSummary({
        roundStatus: round.status,
        resultCode: round.resultCode,
        validViolationVotes: violationVotes,
        validNoViolationVotes: noViolationVotes,
        abstainCount,
      });
    }

    if (violationVotes === noViolationVotes) {
      if (round.extensionCount < 1) {
        const nextRoundStatus = 'waiting_more_votes';
        await deps.repo.updateRound(db, {
          roundId: round.id,
          status: nextRoundStatus,
          deadlineAt: addMs(round.deadlineAt, ROUND_EXTENSION_MS),
          extensionCount: round.extensionCount + 1,
          resultCode: null,
          resultSummaryJson: '{}',
          now,
        });
        return buildPostVoteSummary({
          roundStatus: nextRoundStatus,
          resultCode: null,
          validViolationVotes: violationVotes,
          validNoViolationVotes: noViolationVotes,
          abstainCount,
        });
      }

      const summary = buildPostVoteSummary({
        roundStatus: 'escalated',
        resultCode: 'escalated',
        validViolationVotes: violationVotes,
        validNoViolationVotes: noViolationVotes,
        abstainCount,
      });
      await deps.repo.updateRound(db, {
        roundId: round.id,
        status: 'escalated',
        resultCode: 'escalated',
        resultSummaryJson: JSON.stringify(summary),
        now,
      });
      await applyCrowdReviewRoundResultToReportCase({
        db,
        reportCaseId: round.reportCaseId,
        roundResult: 'escalated',
        now,
        updateReportCaseResolution: deps.repo.updateReportCaseResolution,
        notifyReportCaseResolutionIfNeeded: deps.notifyReportCaseResolutionIfNeeded,
      });
      await syncFinalizedRoundAssignments(db, assignments, summary, now);
      return summary;
    }

    const resultCode = violationVotes > noViolationVotes ? 'violation' : 'no_violation';
    const summary = buildPostVoteSummary({
      roundStatus: 'concluded',
      resultCode,
      validViolationVotes: violationVotes,
      validNoViolationVotes: noViolationVotes,
      abstainCount,
    });
    await deps.repo.updateRound(db, {
      roundId: round.id,
      status: 'concluded',
      resultCode,
      resultSummaryJson: JSON.stringify(summary),
      now,
    });
    await applyCrowdReviewRoundResultToReportCase({
      db,
      reportCaseId: round.reportCaseId,
      roundResult: resultCode,
      now,
      updateReportCaseResolution: deps.repo.updateReportCaseResolution,
      notifyReportCaseResolutionIfNeeded: deps.notifyReportCaseResolutionIfNeeded,
    });
    await syncFinalizedRoundAssignments(db, assignments, summary, now);
    return summary;
  };

  return {
    async getCrowdReviewSummary(input: {
      db: AppDrizzleDb | null;
      userId: number | null;
    }): Promise<CrowdReviewSummaryDto> {
      await advanceExpiredState(input.db);

      const eligibility = await ensureEligibility(input.db, input.userId);
      if (!eligibility.eligible || input.userId == null) {
        return eligibility.summary!;
      }

      const db = requireDb(input.db);
      const activeAssignment = await deps.repo.getActiveAssignmentByInspector(db, input.userId);
      const assignableCase =
        activeAssignment == null
          ? selectAssignableCase(await deps.repo.listAssignableCases(db, input.userId), input.userId)
          : null;

      return {
        eligible: true,
        inspectorStatus: 'active',
        statusReason: null,
        hasCurrentAssignment: Boolean(activeAssignment),
        hasCrowdReviewPending: Boolean(activeAssignment) || assignableCase != null,
        entryUrl: CROWD_REVIEW_ENTRY_URL,
      };
    },

    async assignCrowdReviewCurrentCase(input: {
      db: AppDrizzleDb | null;
      userId: number;
    }): Promise<AssignCurrentCaseResult> {
      const db = requireDb(input.db);
      await advanceExpiredState(db);

      const eligibility = await ensureEligibility(db, input.userId);
      if (!eligibility.eligible) {
        throw new CrowdReviewForbiddenError(eligibility.summary?.statusReason ?? '当前不可参与众查');
      }

      const current = await deps.repo.getActiveAssignmentByInspector(db, input.userId);
      if (current) {
        return {
          createdNewAssignment: false,
          currentCase: mapAssignmentToCurrentCase(current),
        };
      }

      const candidates = await deps.repo.listAssignableCases(db, input.userId);
      const selected = selectAssignableCase(candidates, input.userId);

      if (!selected) {
        throw new CrowdReviewNotFoundError('当前没有可处理的众查案件');
      }

      const roundId =
        selected.existingRoundId ??
        (
          await (async () => {
            const now = deps.now();

            try {
              return await deps.repo.createCrowdReviewRound(db, {
                id: deps.idFactory(),
                reportCaseId: selected.reportCaseId,
                status: 'pending_dispatch',
                openedAt: now,
                deadlineAt: addMs(now, ROUND_EXTENSION_MS),
                extensionCount: 0,
                minValidVotes: 3,
                resultCode: null,
                resultSummaryJson: '{}',
                now,
              });
            } catch (error) {
              if (!isActiveRoundUniqueConflict(error)) {
                throw error;
              }

              const existingRound = await deps.repo.getActiveRoundByReportCaseId(db, selected.reportCaseId);
              if (!existingRound) {
                throw new CrowdReviewConflictError('案件轮次已变化，请刷新后重试');
              }
              return existingRound;
            }
          })()
        ).id;

      const assignmentResult = await (async () => {
        try {
          const assignment = await deps.repo.createCrowdReviewAssignment(db, {
            id: deps.idFactory(),
            crowdReviewRoundId: roundId,
            inspectorUserId: input.userId,
            status: 'assigned',
            assignedAt: deps.now(),
            expiresAt: addMs(deps.now(), ROUND_EXTENSION_MS / 2),
            completedAt: null,
            decision: null,
            decisionNote: null,
            postVoteSummaryJson: '{}',
            postVoteSummarySeenAt: null,
            now: deps.now(),
          });
          return { assignment, createdNewAssignment: true };
        } catch (error) {
          if (!isAssignmentUniqueConflict(error)) {
            throw error;
          }

          const currentAssignment = await deps.repo.getActiveAssignmentByInspector(db, input.userId);
          if (!currentAssignment) {
            throw new CrowdReviewConflictError('派单状态已变化，请刷新后重试');
          }

          return { assignment: currentAssignment, createdNewAssignment: false };
        }
      })();

      return {
        createdNewAssignment: assignmentResult.createdNewAssignment,
        currentCase: mapAssignmentToCurrentCase(assignmentResult.assignment, {
          reportCaseId: selected.reportCaseId,
          targetEntityId: selected.targetEntityId,
          targetSnapshot: null,
          reportSummary: { reasonLabels: [], details: [], references: [] },
          ruleHints: ['投票前不会展示票况'],
          postVoteSummary: null,
        }),
      };
    },

    async getCrowdReviewCurrentCase(input: {
      db: AppDrizzleDb | null;
      userId: number;
    }): Promise<CrowdReviewCurrentCaseDto | null> {
      const db = requireDb(input.db);
      await advanceExpiredState(db);
      const eligibility = await ensureEligibility(db, input.userId);
      if (!eligibility.eligible) {
        throw new CrowdReviewForbiddenError(eligibility.summary?.statusReason ?? '当前不可参与众查');
      }

      const current = await deps.repo.getActiveAssignmentByInspector(db, input.userId);
      if (current) {
        return mapAssignmentToCurrentCase(current);
      }

      const latestCompleted = await deps.repo.getLatestCompletedAssignmentByInspector(db, input.userId);
      return latestCompleted ? mapAssignmentToCurrentCase(latestCompleted) : null;
    },

    async submitCrowdReviewDecision(input: {
      db: AppDrizzleDb | null;
      userId: number;
      assignmentId: string;
      decision: CrowdReviewDecision;
      note: string | null;
    }): Promise<SubmitCrowdReviewDecisionResult> {
      const db = requireDb(input.db);
      await advanceExpiredState(db);
      const eligibility = await ensureEligibility(db, input.userId);
      if (!eligibility.eligible) {
        throw new CrowdReviewForbiddenError(eligibility.summary?.statusReason ?? '当前不可参与众查');
      }

      const assignment = await deps.repo.getAssignmentByIdForInspector(db, {
        assignmentId: input.assignmentId,
        userId: input.userId,
      });
      if (!assignment) {
        throw new CrowdReviewNotFoundError('当前派单不存在');
      }

      if (isFinalAssignmentStatus(assignment.status)) {
        return {
          assignmentId: assignment.id,
          assignmentStatus: assignment.status,
          decision: assignment.decision,
          postVoteSummary: buildAssignmentReplaySummary(assignment),
          idempotentReplay: true,
        };
      }

      const round = await deps.repo.getRoundById(db, assignment.crowdReviewRoundId);
      if (!round) {
        throw new CrowdReviewNotFoundError('众查轮次不存在');
      }

      const now = deps.now();
      if (!isActiveRoundStatus(round.status)) {
        const revokedSummary = buildAssignmentReplaySummary({
          ...assignment,
          status: 'revoked',
          decision: null,
          postVoteSummaryJson: '{}',
          roundStatus: round.status,
          roundResultCode: round.resultCode,
        });
        const revoked = await deps.repo.finalizeAssignment(db, {
          assignmentId: assignment.id,
          userId: input.userId,
          status: 'revoked',
          decision: null,
          note: null,
          postVoteSummaryJson: JSON.stringify(revokedSummary),
          now,
        });
        if (!revoked) {
          const latest = await deps.repo.getAssignmentByIdForInspector(db, {
            assignmentId: input.assignmentId,
            userId: input.userId,
          });
          if (latest && isFinalAssignmentStatus(latest.status)) {
            return {
              assignmentId: latest.id,
              assignmentStatus: latest.status,
              decision: latest.decision,
              postVoteSummary: buildAssignmentReplaySummary(latest),
              idempotentReplay: true,
            };
          }
          throw new CrowdReviewConflictError('派单状态已变化，请刷新后重试');
        }

        return {
          assignmentId: assignment.id,
          assignmentStatus: 'revoked',
          decision: null,
          postVoteSummary: revokedSummary,
          idempotentReplay: false,
        };
      }

      const nextStatus = input.decision === 'abstain' ? 'abstained' : 'voted';
      const finalized = await deps.repo.finalizeAssignment(db, {
        assignmentId: assignment.id,
        userId: input.userId,
        status: nextStatus,
        decision: input.decision,
        note: input.note,
        postVoteSummaryJson: '{}',
        now,
      });
      if (!finalized) {
        throw new CrowdReviewConflictError('派单状态已变化，请刷新后重试');
      }

      const assignments = await deps.repo.listAssignmentsByRound(db, round.id);
      const postVoteSummary = await resolveAssignmentSummary(db, round, assignments, now);
      await deps.repo.updateAssignmentPostVoteSummary(db, {
        assignmentId: assignment.id,
        userId: input.userId,
        postVoteSummaryJson: JSON.stringify(postVoteSummary),
        now,
      });

      return {
        assignmentId: assignment.id,
        assignmentStatus: nextStatus,
        decision: input.decision,
        postVoteSummary,
        idempotentReplay: false,
      };
    },

    async listCrowdReviewHistory(input: {
      db: AppDrizzleDb | null;
      userId: number;
      limit?: number;
    }): Promise<CrowdReviewHistoryDto> {
      const db = requireDb(input.db);
      await advanceExpiredState(db);
      const eligibility = await ensureEligibility(db, input.userId);
      if (!eligibility.eligible) {
        throw new CrowdReviewForbiddenError(eligibility.summary?.statusReason ?? '当前不可参与众查');
      }

      const items = await deps.repo.listCrowdReviewHistoryByInspector(db, input.userId, input.limit ?? 20);
      return {
        items,
        fetchedAt: deps.now(),
      };
    },
  };
};

export async function applyCrowdReviewRoundResultToReportCase(input: {
  db: AppDrizzleDb;
  reportCaseId: string;
  roundResult: 'violation' | 'no_violation' | 'tie' | 'escalated';
  now: string;
  updateReportCaseResolution: CrowdReviewServiceRepo['updateReportCaseResolution'];
  notifyReportCaseResolutionIfNeeded?: (input: { db: AppDrizzleDb | null; reportCaseId: string }) => Promise<boolean>;
}): Promise<void> {
  if (input.roundResult === 'violation') {
    await input.updateReportCaseResolution(input.db, {
      reportCaseId: input.reportCaseId,
      status: 'resolved',
      resolutionCode: 'confirmed_violation',
      closedAt: input.now,
      now: input.now,
    });
    await input.notifyReportCaseResolutionIfNeeded?.({
      db: input.db,
      reportCaseId: input.reportCaseId,
    });
    return;
  }

  if (input.roundResult === 'no_violation') {
    await input.updateReportCaseResolution(input.db, {
      reportCaseId: input.reportCaseId,
      status: 'dismissed',
      resolutionCode: 'no_violation',
      closedAt: input.now,
      now: input.now,
    });
    return;
  }

  await input.updateReportCaseResolution(input.db, {
    reportCaseId: input.reportCaseId,
    status: 'under_review',
    resolutionCode: null,
    closedAt: null,
    now: input.now,
  });
}

export function createCrowdReviewServiceForTests(
  deps: Partial<Omit<CrowdReviewServiceDeps, 'repo'>> & { repo?: Partial<CrowdReviewServiceRepo> } = {},
) {
  const missing = (name: string) => {
    throw new CrowdReviewServiceUnavailableError(`missing crowd review dependency: ${name}`);
  };

  return createCrowdReviewService({
    now: deps.now ?? (() => new Date().toISOString()),
    idFactory:
      deps.idFactory ??
      (() => {
        throw new CrowdReviewServiceUnavailableError('missing crowd review dependency: idFactory');
      }),
    hasInspectorBadge: deps.hasInspectorBadge ?? (async () => missing('hasInspectorBadge')),
    repo: {
      getInspectorState: deps.repo?.getInspectorState ?? (async () => missing('getInspectorState')),
      getActiveAssignmentByInspector:
        deps.repo?.getActiveAssignmentByInspector ?? (async () => missing('getActiveAssignmentByInspector')),
      getLatestCompletedAssignmentByInspector:
        deps.repo?.getLatestCompletedAssignmentByInspector ??
        (async () => missing('getLatestCompletedAssignmentByInspector')),
      listAssignableCases: deps.repo?.listAssignableCases ?? (async () => missing('listAssignableCases')),
      getActiveRoundByReportCaseId:
        deps.repo?.getActiveRoundByReportCaseId ?? (async () => missing('getActiveRoundByReportCaseId')),
      createCrowdReviewRound: deps.repo?.createCrowdReviewRound ?? (async () => missing('createCrowdReviewRound')),
      createCrowdReviewAssignment:
        deps.repo?.createCrowdReviewAssignment ?? (async () => missing('createCrowdReviewAssignment')),
      getAssignmentByIdForInspector:
        deps.repo?.getAssignmentByIdForInspector ?? (async () => missing('getAssignmentByIdForInspector')),
      getRoundById: deps.repo?.getRoundById ?? (async () => missing('getRoundById')),
      listExpiredRounds: deps.repo?.listExpiredRounds ?? (async () => []),
      listAssignmentsByRound: deps.repo?.listAssignmentsByRound ?? (async () => missing('listAssignmentsByRound')),
      finalizeAssignment: deps.repo?.finalizeAssignment ?? (async () => missing('finalizeAssignment')),
      updateAssignmentPostVoteSummary:
        deps.repo?.updateAssignmentPostVoteSummary ?? (async () => missing('updateAssignmentPostVoteSummary')),
      updateRound: deps.repo?.updateRound ?? (async () => missing('updateRound')),
      updateReportCaseResolution:
        deps.repo?.updateReportCaseResolution ?? (async () => missing('updateReportCaseResolution')),
      listCrowdReviewHistoryByInspector:
        deps.repo?.listCrowdReviewHistoryByInspector ?? (async () => missing('listCrowdReviewHistoryByInspector')),
      advanceExpiredState: deps.repo?.advanceExpiredState ?? (async () => undefined),
    },
    notifyReportCaseResolutionIfNeeded: deps.notifyReportCaseResolutionIfNeeded,
  });
}

const defaultService = createCrowdReviewService({
  now: () => new Date().toISOString(),
  idFactory: () => crypto.randomUUID(),
  hasInspectorBadge: async (db, userId) => {
    const count = await countUserBadgesByBadgeId(db, userId, CROWD_REVIEW_INSPECTOR_BADGE_ID);
    return count > 0;
  },
  repo: createRuntimeRepo(),
  notifyReportCaseResolutionIfNeeded,
});

export async function getCrowdReviewSummary(input: {
  db: AppDrizzleDb | null;
  userId: number | null;
}): Promise<CrowdReviewSummaryDto> {
  return defaultService.getCrowdReviewSummary(input);
}

export async function assignCrowdReviewCurrentCase(input: {
  db: AppDrizzleDb | null;
  userId: number;
}): Promise<AssignCurrentCaseResult> {
  return defaultService.assignCrowdReviewCurrentCase(input);
}

export async function getCrowdReviewCurrentCase(input: {
  db: AppDrizzleDb | null;
  userId: number;
}): Promise<CrowdReviewCurrentCaseDto | null> {
  return defaultService.getCrowdReviewCurrentCase(input);
}

export async function submitCrowdReviewDecision(input: {
  db: AppDrizzleDb | null;
  userId: number;
  assignmentId: string;
  decision: CrowdReviewDecision;
  note: string | null;
}): Promise<SubmitCrowdReviewDecisionResult> {
  return defaultService.submitCrowdReviewDecision(input);
}

export async function listCrowdReviewHistory(input: {
  db: AppDrizzleDb | null;
  userId: number;
  limit?: number;
}): Promise<CrowdReviewHistoryDto> {
  return defaultService.listCrowdReviewHistory(input);
}
