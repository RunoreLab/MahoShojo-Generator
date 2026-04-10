import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

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
const COMPLETED_ASSIGNMENT_STATUSES: CrowdReviewAssignmentStatus[] = ['voted', 'abstained', 'expired', 'revoked'];
const OPEN_REPORT_CASE_STATUSES: ReportCaseStatus[] = ['open', 'under_review'];

type D1PreparedStatementLike = {
  bind?: (...params: unknown[]) => D1PreparedStatementLike;
  all: (...params: unknown[]) => Promise<unknown> | unknown;
  run?: () => Promise<unknown>;
};

type D1ClientLike = {
  prepare: (sqlText: string) => D1PreparedStatementLike;
  batch?: (statements: unknown[]) => Promise<unknown[]>;
  exec?: (sqlText: string) => unknown;
};

type D1LikeStatementResult = {
  success?: boolean;
  results?: unknown;
  error?: unknown;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const getD1Client = (db: AppDrizzleDb): D1ClientLike => {
  const client = (db as unknown as { $client?: unknown }).$client;
  const prepare = asObject(client)?.prepare;
  if (typeof prepare !== 'function') {
    throw new Error('Drizzle D1 client 不可用：未检测到 prepare 方法');
  }
  return client as D1ClientLike;
};

const parseStatementRows = (raw: unknown): Record<string, unknown>[] => {
  if (Array.isArray(raw)) {
    return raw
      .map((row) => asObject(row))
      .filter((row): row is Record<string, unknown> => Boolean(row));
  }

  const parsed = asObject(raw) as D1LikeStatementResult | null;
  if (parsed?.success === false) {
    throw new Error(typeof parsed.error === 'string' ? parsed.error : 'D1 查询失败');
  }
  return asArray(parsed?.results)
    .map((row) => asObject(row))
    .filter((row): row is Record<string, unknown> => Boolean(row));
};

type AtomicSqlStep = {
  sqlText: string;
  params?: unknown[];
};

const bindPreparedStatement = (
  statement: D1PreparedStatementLike,
  params: unknown[],
): D1PreparedStatementLike => {
  return typeof statement.bind === 'function' ? statement.bind(...params) : statement;
};

const executeAtomicSteps = async (
  db: AppDrizzleDb,
  steps: AtomicSqlStep[],
): Promise<Record<string, unknown>[][]> => {
  const client = getD1Client(db);
  if (typeof client.batch === 'function') {
    const rawResults = await client.batch(
      steps.map((step) => bindPreparedStatement(client.prepare(step.sqlText), step.params ?? [])),
    );
    return rawResults.map((raw) => parseStatementRows(raw));
  }

  if (typeof client.exec !== 'function') {
    throw new Error('Drizzle D1 client 不可用：未检测到 batch/exec 方法');
  }

  client.exec('BEGIN IMMEDIATE');
  try {
    const results: Record<string, unknown>[][] = [];
    for (const step of steps) {
      const params = step.params ?? [];
      const statement = client.prepare(step.sqlText);
      const raw = typeof statement.bind === 'function'
        ? await bindPreparedStatement(statement, params).all()
        : await statement.all(...params);
      results.push(parseStatementRows(raw));
    }
    client.exec('COMMIT');
    return results;
  } catch (error) {
    try {
      client.exec('ROLLBACK');
    } catch {}
    throw error;
  }
};

const toNullableString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const toInteger = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
};

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
  const [updatedCaseRows, insertedRoundRows] = await executeAtomicSteps(db, [
    {
      sqlText: `
        UPDATE report_cases
        SET status = 'under_review', updated_at = ?
        WHERE id = ?
          AND status IN ('open', 'under_review')
        RETURNING id
      `,
      params: [input.now, input.reportCaseId],
    },
    {
      sqlText: `
        INSERT INTO crowd_review_rounds (
          id,
          report_case_id,
          status,
          opened_at,
          deadline_at,
          extension_count,
          min_valid_votes,
          result_code,
          result_summary_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING
          id,
          report_case_id AS reportCaseId,
          status,
          opened_at AS openedAt,
          deadline_at AS deadlineAt,
          extension_count AS extensionCount,
          min_valid_votes AS minValidVotes,
          result_code AS resultCode,
          result_summary_json AS resultSummaryJson,
          created_at AS createdAt,
          updated_at AS updatedAt
      `,
      params: [
        input.id,
        input.reportCaseId,
        input.status,
        input.openedAt,
        input.deadlineAt,
        input.extensionCount,
        input.minValidVotes,
        input.resultCode,
        input.resultSummaryJson,
        input.now,
        input.now,
      ],
    },
  ]);

  if (updatedCaseRows.length === 0) {
    throw new Error('案件状态已变化，当前不可进入众查');
  }

  const row = insertedRoundRows[0];
  if (!row) {
    throw new Error('众查轮次创建失败');
  }

  return {
    id: String(row.id ?? ''),
    reportCaseId: String(row.reportCaseId ?? ''),
    status: row.status as CrowdReviewRoundStatus,
    openedAt: String(row.openedAt ?? ''),
    deadlineAt: String(row.deadlineAt ?? ''),
    extensionCount: toInteger(row.extensionCount, 0),
    minValidVotes: toInteger(row.minValidVotes, 0),
    resultCode: toNullableString(row.resultCode) as CrowdReviewResultCode | null,
    resultSummaryJson: String(row.resultSummaryJson ?? '{}'),
    createdAt: String(row.createdAt ?? ''),
    updatedAt: String(row.updatedAt ?? ''),
  };
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
  const rows = await db
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
    .orderBy(asc(crowdReviewAssignments.assignedAt), asc(crowdReviewAssignments.id))
    .limit(1);

  return rows[0] ?? null;
}

export async function getLatestCompletedAssignmentByInspector(
  db: AppDrizzleDb,
  userId: number,
): Promise<CrowdReviewAssignmentRow | null> {
  const row = await db.query.crowdReviewAssignments.findFirst({
    where: and(
      eq(crowdReviewAssignments.inspectorUserId, userId),
      inArray(crowdReviewAssignments.status, COMPLETED_ASSIGNMENT_STATUSES),
    ),
    orderBy: [desc(crowdReviewAssignments.updatedAt), desc(crowdReviewAssignments.id)],
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
    .where(
      and(
        eq(crowdReviewAssignments.inspectorUserId, userId),
        inArray(crowdReviewAssignments.status, COMPLETED_ASSIGNMENT_STATUSES),
      ),
    )
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
    .where(
      and(
        inArray(reportCases.status, OPEN_REPORT_CASE_STATUSES),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'approved'),
        isNull(dataCards.deletedAt),
      ),
    )
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
