import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import {
  crowdReviewAssignments,
  crowdReviewInspectors,
  crowdReviewRounds,
  dataCards,
  reportCases,
  reports,
  type CrowdReviewAssignmentStatus,
  type CrowdReviewDecision,
  type CrowdReviewInspectorStatus,
  type CrowdReviewResultCode,
  type CrowdReviewRoundStatus,
  type ReportCaseStatus,
} from '@/lib/db/schema';

export type CrowdReviewInspectorRow = {
  userId: number;
  status: CrowdReviewInspectorStatus;
  suspendedUntil: string | null;
  statusReasonCode: string | null;
  statusReasonDetail: string | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CrowdReviewRoundRow = {
  id: string;
  reportCaseId: string;
  status: CrowdReviewRoundStatus;
  openedAt: string;
  deadlineAt: string;
  extensionCount: number;
  minValidVotes: number;
  resultCode: CrowdReviewResultCode | null;
  resultSummaryJson: string;
  createdAt: string;
  updatedAt: string;
};

export type CrowdReviewAssignmentRow = {
  id: string;
  crowdReviewRoundId: string;
  inspectorUserId: number;
  status: CrowdReviewAssignmentStatus;
  assignedAt: string;
  expiresAt: string;
  completedAt: string | null;
  decision: CrowdReviewDecision | null;
  decisionNote: string | null;
  postVoteSummaryJson: string;
  postVoteSummarySeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertCrowdReviewInspectorStateInput = {
  userId: number;
  status: CrowdReviewInspectorStatus;
  suspendedUntil: string | null;
  statusReasonCode: string | null;
  statusReasonDetail: string | null;
  updatedByUserId: number | null;
  now: string;
};

export type CreateCrowdReviewRoundInput = {
  id: string;
  reportCaseId: string;
  status: CrowdReviewRoundStatus;
  openedAt: string;
  deadlineAt: string;
  extensionCount: number;
  minValidVotes: number;
  resultCode: CrowdReviewResultCode | null;
  resultSummaryJson: string;
  now: string;
};

export type CreateCrowdReviewAssignmentInput = {
  id: string;
  crowdReviewRoundId: string;
  inspectorUserId: number;
  status: CrowdReviewAssignmentStatus;
  assignedAt: string;
  expiresAt: string;
  completedAt: string | null;
  decision: CrowdReviewDecision | null;
  decisionNote: string | null;
  postVoteSummaryJson: string;
  postVoteSummarySeenAt: string | null;
  now: string;
};

const ACTIVE_ROUND_STATUSES: CrowdReviewRoundStatus[] = ['pending_dispatch', 'active', 'waiting_more_votes'];
const OPEN_REPORT_CASE_STATUSES: ReportCaseStatus[] = ['open', 'under_review'];

export async function getInspectorState(
  db: AppDrizzleDb,
  userId: number,
): Promise<CrowdReviewInspectorRow | null> {
  const row = await db.query.crowdReviewInspectors.findFirst({
    where: eq(crowdReviewInspectors.userId, userId),
  });

  return row ?? null;
}

export async function upsertCrowdReviewInspectorState(
  db: AppDrizzleDb,
  input: UpsertCrowdReviewInspectorStateInput,
): Promise<CrowdReviewInspectorRow> {
  const rows = await db
    .insert(crowdReviewInspectors)
    .values({
      userId: input.userId,
      status: input.status,
      suspendedUntil: input.suspendedUntil,
      statusReasonCode: input.statusReasonCode,
      statusReasonDetail: input.statusReasonDetail,
      updatedByUserId: input.updatedByUserId,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: crowdReviewInspectors.userId,
      set: {
        status: input.status,
        suspendedUntil: input.suspendedUntil,
        statusReasonCode: input.statusReasonCode,
        statusReasonDetail: input.statusReasonDetail,
        updatedByUserId: input.updatedByUserId,
        updatedAt: input.now,
      },
    })
    .returning();

  return rows[0]!;
}

export async function createCrowdReviewRound(
  db: AppDrizzleDb,
  input: CreateCrowdReviewRoundInput,
): Promise<CrowdReviewRoundRow> {
  const rows = await db
    .insert(crowdReviewRounds)
    .values({
      id: input.id,
      reportCaseId: input.reportCaseId,
      status: input.status,
      openedAt: input.openedAt,
      deadlineAt: input.deadlineAt,
      extensionCount: input.extensionCount,
      minValidVotes: input.minValidVotes,
      resultCode: input.resultCode,
      resultSummaryJson: input.resultSummaryJson,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning();

  return rows[0]!;
}

export async function createCrowdReviewAssignment(
  db: AppDrizzleDb,
  input: CreateCrowdReviewAssignmentInput,
): Promise<CrowdReviewAssignmentRow> {
  const rows = await db
    .insert(crowdReviewAssignments)
    .values({
      id: input.id,
      crowdReviewRoundId: input.crowdReviewRoundId,
      inspectorUserId: input.inspectorUserId,
      status: input.status,
      assignedAt: input.assignedAt,
      expiresAt: input.expiresAt,
      completedAt: input.completedAt,
      decision: input.decision,
      decisionNote: input.decisionNote,
      postVoteSummaryJson: input.postVoteSummaryJson,
      postVoteSummarySeenAt: input.postVoteSummarySeenAt,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning();

  return rows[0]!;
}

export async function getActiveAssignmentByInspector(
  db: AppDrizzleDb,
  userId: number,
): Promise<CrowdReviewAssignmentRow | null> {
  const row = await db.query.crowdReviewAssignments.findFirst({
    where: and(eq(crowdReviewAssignments.inspectorUserId, userId), eq(crowdReviewAssignments.status, 'assigned')),
  });

  return row ?? null;
}

export async function getAssignmentByIdForInspector(
  db: AppDrizzleDb,
  input: { assignmentId: string; userId: number },
): Promise<CrowdReviewAssignmentRow | null> {
  const row = await db.query.crowdReviewAssignments.findFirst({
    where: and(
      eq(crowdReviewAssignments.id, input.assignmentId),
      eq(crowdReviewAssignments.inspectorUserId, input.userId),
    ),
  });

  return row ?? null;
}

export async function getRoundById(
  db: AppDrizzleDb,
  roundId: string,
): Promise<CrowdReviewRoundRow | null> {
  const row = await db.query.crowdReviewRounds.findFirst({
    where: eq(crowdReviewRounds.id, roundId),
  });

  return row ?? null;
}

export async function listAssignmentsByRound(
  db: AppDrizzleDb,
  roundId: string,
): Promise<CrowdReviewAssignmentRow[]> {
  return await db
    .select()
    .from(crowdReviewAssignments)
    .where(eq(crowdReviewAssignments.crowdReviewRoundId, roundId))
    .orderBy(asc(crowdReviewAssignments.assignedAt), asc(crowdReviewAssignments.id));
}

export async function finalizeAssignment(
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
): Promise<boolean> {
  const rows = await db
    .update(crowdReviewAssignments)
    .set({
      status: input.status,
      decision: input.decision,
      decisionNote: input.note,
      completedAt: input.now,
      postVoteSummaryJson: input.postVoteSummaryJson,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(crowdReviewAssignments.id, input.assignmentId),
        eq(crowdReviewAssignments.inspectorUserId, input.userId),
        eq(crowdReviewAssignments.status, 'assigned'),
      ),
    )
    .returning({ id: crowdReviewAssignments.id });

  return rows.length > 0;
}

export async function updateAssignmentPostVoteSummary(
  db: AppDrizzleDb,
  input: {
    assignmentId: string;
    userId: number;
    postVoteSummaryJson: string;
    now: string;
  },
): Promise<boolean> {
  const rows = await db
    .update(crowdReviewAssignments)
    .set({
      postVoteSummaryJson: input.postVoteSummaryJson,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(crowdReviewAssignments.id, input.assignmentId),
        eq(crowdReviewAssignments.inspectorUserId, input.userId),
      ),
    )
    .returning({ id: crowdReviewAssignments.id });

  return rows.length > 0;
}

export async function updateRound(
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
): Promise<boolean> {
  const rows = await db
    .update(crowdReviewRounds)
    .set({
      status: input.status as CrowdReviewRoundStatus,
      deadlineAt: input.deadlineAt,
      extensionCount: input.extensionCount,
      resultCode: (input.resultCode ?? null) as CrowdReviewResultCode | null,
      resultSummaryJson: input.resultSummaryJson,
      updatedAt: input.now,
    })
    .where(eq(crowdReviewRounds.id, input.roundId))
    .returning({ id: crowdReviewRounds.id });

  return rows.length > 0;
}

export async function listCrowdReviewHistoryByInspector(
  db: AppDrizzleDb,
  userId: number,
  limit: number,
): Promise<
  Array<{
    assignmentId: string;
    reportCaseId: string;
    assignmentStatus: CrowdReviewAssignmentStatus;
    decision: CrowdReviewDecision | null;
    completedAt: string | null;
    resultCode: CrowdReviewResultCode | null;
  }>
> {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  return await db
    .select({
      assignmentId: crowdReviewAssignments.id,
      reportCaseId: crowdReviewRounds.reportCaseId,
      assignmentStatus: crowdReviewAssignments.status,
      decision: crowdReviewAssignments.decision,
      completedAt: crowdReviewAssignments.completedAt,
      resultCode: crowdReviewRounds.resultCode,
    })
    .from(crowdReviewAssignments)
    .innerJoin(crowdReviewRounds, eq(crowdReviewRounds.id, crowdReviewAssignments.crowdReviewRoundId))
    .where(eq(crowdReviewAssignments.inspectorUserId, userId))
    .orderBy(desc(crowdReviewAssignments.updatedAt), desc(crowdReviewAssignments.id))
    .limit(safeLimit);
}

export async function listAssignableCases(
  db: AppDrizzleDb,
  userId: number,
): Promise<
  Array<{
    reportCaseId: string;
    targetEntityId: string;
    targetUserId: number;
    reporterUserIds: number[];
    assignedInspectorUserIds: number[];
    existingRoundId: string | null;
  }>
> {
  void userId;
  const caseRows = await db
    .select({
      id: reportCases.id,
      targetEntityId: reportCases.targetEntityId,
      targetUserId: reportCases.targetUserId,
      latestReportedAt: reportCases.latestReportedAt,
    })
    .from(reportCases)
    .innerJoin(
      dataCards,
      and(eq(dataCards.id, reportCases.targetEntityId), eq(reportCases.targetEntityType, 'data_card')),
    )
    .where(and(inArray(reportCases.status, OPEN_REPORT_CASE_STATUSES), eq(dataCards.isPublic, true)))
    .orderBy(asc(reportCases.latestReportedAt), asc(reportCases.id));

  const candidates: Array<{
    reportCaseId: string;
    targetEntityId: string;
    targetUserId: number;
    reporterUserIds: number[];
    assignedInspectorUserIds: number[];
    existingRoundId: string | null;
  }> = [];

  for (const row of caseRows) {
    const activeReporterRows = await db
      .select({ reporterUserId: reports.reporterUserId })
      .from(reports)
      .where(and(eq(reports.caseId, row.id), eq(reports.status, 'active')))
      .orderBy(asc(reports.createdAt), asc(reports.id));

    if (activeReporterRows.length === 0) {
      continue;
    }

    const activeRound = await db.query.crowdReviewRounds.findFirst({
      where: and(eq(crowdReviewRounds.reportCaseId, row.id), inArray(crowdReviewRounds.status, ACTIVE_ROUND_STATUSES)),
      orderBy: [asc(crowdReviewRounds.openedAt), asc(crowdReviewRounds.id)],
    });

    const assignmentRows = activeRound
      ? await db
          .select({ inspectorUserId: crowdReviewAssignments.inspectorUserId })
          .from(crowdReviewAssignments)
          .where(eq(crowdReviewAssignments.crowdReviewRoundId, activeRound.id))
      : [];

    candidates.push({
      reportCaseId: row.id,
      targetEntityId: row.targetEntityId,
      targetUserId: row.targetUserId,
      reporterUserIds: activeReporterRows.map((item) => item.reporterUserId),
      assignedInspectorUserIds: assignmentRows.map((item) => item.inspectorUserId),
      existingRoundId: activeRound?.id ?? null,
    });
  }

  return candidates;
}

export async function hasActiveCrowdReviewRoundForCase(
  db: AppDrizzleDb,
  reportCaseId: string,
): Promise<boolean> {
  const row = await db.query.crowdReviewRounds.findFirst({
    where: and(eq(crowdReviewRounds.reportCaseId, reportCaseId), inArray(crowdReviewRounds.status, ACTIVE_ROUND_STATUSES)),
  });

  return row != null;
}

export async function listActionableAssignmentsByInspector(
  db: AppDrizzleDb,
  userId: number,
): Promise<CrowdReviewAssignmentRow[]> {
  return await db
    .select({
      id: crowdReviewAssignments.id,
      crowdReviewRoundId: crowdReviewAssignments.crowdReviewRoundId,
      inspectorUserId: crowdReviewAssignments.inspectorUserId,
      status: crowdReviewAssignments.status,
      assignedAt: crowdReviewAssignments.assignedAt,
      expiresAt: crowdReviewAssignments.expiresAt,
      completedAt: crowdReviewAssignments.completedAt,
      decision: crowdReviewAssignments.decision,
      decisionNote: crowdReviewAssignments.decisionNote,
      postVoteSummaryJson: crowdReviewAssignments.postVoteSummaryJson,
      postVoteSummarySeenAt: crowdReviewAssignments.postVoteSummarySeenAt,
      createdAt: crowdReviewAssignments.createdAt,
      updatedAt: crowdReviewAssignments.updatedAt,
    })
    .from(crowdReviewAssignments)
    .innerJoin(crowdReviewRounds, eq(crowdReviewRounds.id, crowdReviewAssignments.crowdReviewRoundId))
    .where(
      and(
        eq(crowdReviewAssignments.inspectorUserId, userId),
        eq(crowdReviewAssignments.status, 'assigned'),
        inArray(crowdReviewRounds.status, ACTIVE_ROUND_STATUSES),
      ),
    )
    .orderBy(asc(crowdReviewAssignments.assignedAt));
}
