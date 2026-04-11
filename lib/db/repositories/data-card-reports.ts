import { and, asc, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { reportCases, reportReferences, reportSubmissionEvents, reports } from '@/lib/db/schema';
import type {
  ReportCaseStatus,
  ReportReferenceType,
  ReportResolutionCode,
  ReportStatus,
  ReportSubmissionDecision,
} from '@/lib/db/schema/business';

export type ReportCaseRow = {
  id: string;
  targetEntityType: string;
  targetEntityId: string;
  targetUserId: number;
  status: ReportCaseStatus;
  resolutionCode: string | null;
  creatorNotifiedAt: string | null;
  creatorNotifiedReportCount: number;
  latestReportedAt: string;
  targetCardUpdatedAtAtNotice: string | null;
  resolutionNotifiedAt: string | null;
  resolutionNotifiedCaseUpdatedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReportRow = {
  id: string;
  caseId: string;
  reporterUserId: number;
  reasonCode: string;
  details: string | null;
  status: ReportStatus;
  evidenceSummaryJson: string;
  normalizedPayloadHash: string;
  targetNameSnapshot: string;
  targetDescriptionSnapshot: string | null;
  targetDataSnapshot: string;
  targetUpdatedAtSnapshot: string | null;
  createdAt: string;
  updatedAt: string;
  withdrawnAt: string | null;
};

export type ReportReferenceRow = {
  id: string;
  reportId: string;
  referenceType: ReportReferenceType;
  referenceId: string;
  labelSnapshot: string;
  urlSnapshot: string | null;
  note: string | null;
  sortOrder: number;
  createdAt: string;
};

export type ReportSubmissionEventRow = {
  id: string;
  caseId: string;
  reportId: string;
  reporterUserId: number;
  submissionDecision: ReportSubmissionDecision;
  createdAt: string;
};

export type CreateReportCaseInput = {
  id: string;
  targetEntityType: 'data_card';
  targetEntityId: string;
  targetUserId: number;
  now: string;
};

export type CreateReportInput = {
  id: string;
  caseId: string;
  reporterUserId: number;
  reasonCode: string;
  details: string | null;
  evidenceSummaryJson: string;
  normalizedPayloadHash: string;
  targetNameSnapshot: string;
  targetDescriptionSnapshot: string | null;
  targetDataSnapshot: string;
  targetUpdatedAtSnapshot: string | null;
  now: string;
};

export type UpdateActiveReportInput = Omit<CreateReportInput, 'id' | 'caseId' | 'reporterUserId'> & {
  caseId: string;
  reporterUserId: number;
};

export type CreateReportReferenceInput = {
  id: string;
  referenceType: ReportReferenceType;
  referenceId: string;
  labelSnapshot: string;
  urlSnapshot: string | null;
  note: string | null;
  sortOrder: number;
};

export type CreateReportSubmissionEventInput = {
  id: string;
  caseId: string;
  reportId: string;
  reporterUserId: number;
  submissionDecision: ReportSubmissionDecision;
  now: string;
};

const openCaseStatuses: ReportCaseStatus[] = ['open', 'under_review'];
const activeCrowdReviewRoundStatuses = ['pending_dispatch', 'active', 'waiting_more_votes'] as const;

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

const toNullableString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

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

const getReportById = async (db: AppDrizzleDb, reportId: string): Promise<ReportRow | null> => {
  const row = await db.query.reports.findFirst({
    where: eq(reports.id, reportId),
  });

  return row ?? null;
};

const buildReferenceInsertSteps = (
  references: CreateReportReferenceInput[],
  input: {
    reportIdSql: string;
    reportIdParams: unknown[];
    guardSql: string;
    guardParams: unknown[];
  },
): AtomicSqlStep[] =>
  references.map((reference) => ({
    sqlText: `
      INSERT INTO report_references (
        id,
        report_id,
        reference_type,
        reference_id,
        label_snapshot,
        url_snapshot,
        note,
        sort_order
      )
      SELECT ?, ${input.reportIdSql}, ?, ?, ?, ?, ?, ?
      WHERE ${input.guardSql}
      RETURNING id
    `,
    params: [
      reference.id,
      ...input.reportIdParams,
      reference.referenceType,
      reference.referenceId,
      reference.labelSnapshot,
      reference.urlSnapshot,
      reference.note,
      reference.sortOrder,
      ...input.guardParams,
    ],
  }));

export async function getOpenReportCaseByTarget(
  db: AppDrizzleDb,
  input: { targetEntityType: 'data_card'; targetEntityId: string },
): Promise<ReportCaseRow | null> {
  const row = await db.query.reportCases.findFirst({
    where: and(
      eq(reportCases.targetEntityType, input.targetEntityType),
      eq(reportCases.targetEntityId, input.targetEntityId),
      inArray(reportCases.status, openCaseStatuses),
    ),
  });

  return row ?? null;
}

export async function getLatestReportCaseByTarget(
  db: AppDrizzleDb,
  input: { targetEntityType: 'data_card'; targetEntityId: string },
): Promise<ReportCaseRow | null> {
  const row = await db.query.reportCases.findFirst({
    where: and(
      eq(reportCases.targetEntityType, input.targetEntityType),
      eq(reportCases.targetEntityId, input.targetEntityId),
    ),
    orderBy: [desc(reportCases.latestReportedAt), desc(reportCases.createdAt), desc(reportCases.id)],
  });

  return row ?? null;
}

export async function createReportCase(
  db: AppDrizzleDb,
  input: CreateReportCaseInput,
): Promise<ReportCaseRow> {
  const rows = await db
    .insert(reportCases)
    .values({
      id: input.id,
      targetEntityType: input.targetEntityType,
      targetEntityId: input.targetEntityId,
      targetUserId: input.targetUserId,
      status: 'open',
      resolutionCode: null,
      creatorNotifiedAt: null,
      creatorNotifiedReportCount: 0,
      latestReportedAt: input.now,
      targetCardUpdatedAtAtNotice: null,
      resolutionNotifiedAt: null,
      resolutionNotifiedCaseUpdatedAt: null,
      closedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning();

  return rows[0]!;
}

export async function getActiveReportByCaseAndReporter(
  db: AppDrizzleDb,
  input: { caseId: string; reporterUserId: number },
): Promise<ReportRow | null> {
  const row = await db.query.reports.findFirst({
    where: and(
      eq(reports.caseId, input.caseId),
      eq(reports.reporterUserId, input.reporterUserId),
      eq(reports.status, 'active'),
    ),
  });

  return row ?? null;
}

export async function createReport(db: AppDrizzleDb, input: CreateReportInput): Promise<ReportRow> {
  const rows = await db
    .insert(reports)
    .values({
      id: input.id,
      caseId: input.caseId,
      reporterUserId: input.reporterUserId,
      reasonCode: input.reasonCode,
      details: input.details,
      status: 'active',
      evidenceSummaryJson: input.evidenceSummaryJson,
      normalizedPayloadHash: input.normalizedPayloadHash,
      targetNameSnapshot: input.targetNameSnapshot,
      targetDescriptionSnapshot: input.targetDescriptionSnapshot,
      targetDataSnapshot: input.targetDataSnapshot,
      targetUpdatedAtSnapshot: input.targetUpdatedAtSnapshot,
      createdAt: input.now,
      updatedAt: input.now,
      withdrawnAt: null,
    })
    .returning();

  await touchReportCaseLatestReportedAt(db, { caseId: input.caseId, now: input.now });
  return rows[0]!;
}

export async function createReportWithReferencesIfCaseEditable(
  db: AppDrizzleDb,
  input: CreateReportInput & { references: CreateReportReferenceInput[] },
): Promise<ReportRow | null> {
  const [editableRows, insertedRows] = await executeAtomicSteps(db, [
    {
      sqlText: `
        SELECT id
        FROM report_cases
        WHERE id = ?
          AND status IN ('open', 'under_review')
          AND NOT EXISTS (
            SELECT 1
            FROM crowd_review_rounds
            WHERE report_case_id = report_cases.id
              AND status IN (?, ?, ?)
          )
      `,
      params: [input.caseId, ...activeCrowdReviewRoundStatuses],
    },
    {
      sqlText: `
        INSERT INTO reports (
          id,
          case_id,
          reporter_user_id,
          reason_code,
          details,
          status,
          evidence_summary_json,
          normalized_payload_hash,
          target_name_snapshot,
          target_description_snapshot,
          target_data_snapshot,
          target_updated_at_snapshot,
          created_at,
          updated_at,
          withdrawn_at
        )
        SELECT ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, NULL
        WHERE EXISTS (
          SELECT 1
          FROM report_cases
          WHERE id = ?
            AND status IN ('open', 'under_review')
            AND NOT EXISTS (
              SELECT 1
              FROM crowd_review_rounds
              WHERE report_case_id = report_cases.id
                AND status IN (?, ?, ?)
            )
        )
        RETURNING id
      `,
      params: [
        input.id,
        input.caseId,
        input.reporterUserId,
        input.reasonCode,
        input.details,
        input.evidenceSummaryJson,
        input.normalizedPayloadHash,
        input.targetNameSnapshot,
        input.targetDescriptionSnapshot,
        input.targetDataSnapshot,
        input.targetUpdatedAtSnapshot,
        input.now,
        input.now,
        input.caseId,
        ...activeCrowdReviewRoundStatuses,
      ],
    },
    {
      sqlText: `
        UPDATE report_cases
        SET latest_reported_at = ?, updated_at = ?
        WHERE id = ?
          AND EXISTS (
            SELECT 1
            FROM reports
            WHERE id = ?
          )
        RETURNING id
      `,
      params: [input.now, input.now, input.caseId, input.id],
    },
    ...buildReferenceInsertSteps(input.references, {
      reportIdSql: '?',
      reportIdParams: [input.id],
      guardSql: 'EXISTS (SELECT 1 FROM reports WHERE id = ?)',
      guardParams: [input.id],
    }),
  ]);

  if (editableRows.length === 0 || insertedRows.length === 0) {
    return null;
  }

  return await getReportById(db, input.id);
}

export async function updateActiveReportForReporter(
  db: AppDrizzleDb,
  input: UpdateActiveReportInput,
): Promise<ReportRow | null> {
  const rows = await db
    .update(reports)
    .set({
      reasonCode: input.reasonCode,
      details: input.details,
      evidenceSummaryJson: input.evidenceSummaryJson,
      normalizedPayloadHash: input.normalizedPayloadHash,
      targetNameSnapshot: input.targetNameSnapshot,
      targetDescriptionSnapshot: input.targetDescriptionSnapshot,
      targetDataSnapshot: input.targetDataSnapshot,
      targetUpdatedAtSnapshot: input.targetUpdatedAtSnapshot,
      updatedAt: input.now,
      withdrawnAt: null,
    })
    .where(
      and(
        eq(reports.caseId, input.caseId),
        eq(reports.reporterUserId, input.reporterUserId),
        eq(reports.status, 'active'),
      ),
    )
    .returning();

  if (!rows[0]) return null;
  await touchReportCaseLatestReportedAt(db, { caseId: input.caseId, now: input.now });
  return rows[0];
}

export async function updateActiveReportForReporterWithReferencesIfCaseEditable(
  db: AppDrizzleDb,
  input: UpdateActiveReportInput & { references: CreateReportReferenceInput[] },
): Promise<ReportRow | null> {
  const [editableRows, updatedRows] = await executeAtomicSteps(db, [
    {
      sqlText: `
        SELECT id
        FROM report_cases
        WHERE id = ?
          AND status IN ('open', 'under_review')
          AND NOT EXISTS (
            SELECT 1
            FROM crowd_review_rounds
            WHERE report_case_id = report_cases.id
              AND status IN (?, ?, ?)
          )
      `,
      params: [input.caseId, ...activeCrowdReviewRoundStatuses],
    },
    {
      sqlText: `
        UPDATE reports
        SET
          reason_code = ?,
          details = ?,
          evidence_summary_json = ?,
          normalized_payload_hash = ?,
          target_name_snapshot = ?,
          target_description_snapshot = ?,
          target_data_snapshot = ?,
          target_updated_at_snapshot = ?,
          updated_at = ?,
          withdrawn_at = NULL
        WHERE case_id = ?
          AND reporter_user_id = ?
          AND status = 'active'
          AND EXISTS (
            SELECT 1
            FROM report_cases
            WHERE id = ?
              AND status IN ('open', 'under_review')
              AND NOT EXISTS (
                SELECT 1
                FROM crowd_review_rounds
                WHERE report_case_id = report_cases.id
                  AND status IN (?, ?, ?)
              )
          )
        RETURNING id
      `,
      params: [
        input.reasonCode,
        input.details,
        input.evidenceSummaryJson,
        input.normalizedPayloadHash,
        input.targetNameSnapshot,
        input.targetDescriptionSnapshot,
        input.targetDataSnapshot,
        input.targetUpdatedAtSnapshot,
        input.now,
        input.caseId,
        input.reporterUserId,
        input.caseId,
        ...activeCrowdReviewRoundStatuses,
      ],
    },
    {
      sqlText: `
        UPDATE report_cases
        SET latest_reported_at = ?, updated_at = ?
        WHERE id = ?
          AND EXISTS (
            SELECT 1
            FROM report_cases
            WHERE id = ?
              AND status IN ('open', 'under_review')
              AND NOT EXISTS (
                SELECT 1
                FROM crowd_review_rounds
                WHERE report_case_id = report_cases.id
                  AND status IN (?, ?, ?)
              )
          )
          AND EXISTS (
            SELECT 1
            FROM reports
            WHERE case_id = ?
              AND reporter_user_id = ?
              AND status = 'active'
              AND updated_at = ?
          )
        RETURNING id
      `,
      params: [
        input.now,
        input.now,
        input.caseId,
        input.caseId,
        ...activeCrowdReviewRoundStatuses,
        input.caseId,
        input.reporterUserId,
        input.now,
      ],
    },
    {
      sqlText: `
        DELETE FROM report_references
        WHERE report_id = (
          SELECT id
          FROM reports
          WHERE case_id = ?
            AND reporter_user_id = ?
            AND status = 'active'
            AND updated_at = ?
        )
          AND EXISTS (
            SELECT 1
            FROM report_cases
            WHERE id = ?
              AND status IN ('open', 'under_review')
              AND NOT EXISTS (
                SELECT 1
                FROM crowd_review_rounds
                WHERE report_case_id = report_cases.id
                  AND status IN (?, ?, ?)
              )
          )
        RETURNING id
      `,
      params: [
        input.caseId,
        input.reporterUserId,
        input.now,
        input.caseId,
        ...activeCrowdReviewRoundStatuses,
      ],
    },
    ...buildReferenceInsertSteps(input.references, {
      reportIdSql: `(SELECT id FROM reports WHERE case_id = ? AND reporter_user_id = ? AND status = 'active' AND updated_at = ?)`,
      reportIdParams: [input.caseId, input.reporterUserId, input.now],
      guardSql: `EXISTS (
        SELECT 1
        FROM report_cases
        WHERE id = ?
          AND status IN ('open', 'under_review')
          AND NOT EXISTS (
            SELECT 1
            FROM crowd_review_rounds
            WHERE report_case_id = report_cases.id
              AND status IN (?, ?, ?)
          )
      ) AND EXISTS (
        SELECT 1
        FROM reports
        WHERE case_id = ?
          AND reporter_user_id = ?
          AND status = 'active'
          AND updated_at = ?
      )`,
      guardParams: [
        input.caseId,
        ...activeCrowdReviewRoundStatuses,
        input.caseId,
        input.reporterUserId,
        input.now,
      ],
    }),
  ]);

  if (editableRows.length === 0 || updatedRows.length === 0) {
    return null;
  }

  const updatedReportId = toNullableString(updatedRows[0]?.id);
  if (!updatedReportId) {
    return null;
  }

  return await getReportById(db, updatedReportId);
}

export async function replaceReportReferences(
  db: AppDrizzleDb,
  input: { reportId: string; references: CreateReportReferenceInput[] },
): Promise<void> {
  await db.delete(reportReferences).where(eq(reportReferences.reportId, input.reportId));

  if (input.references.length === 0) return;

  await db
    .insert(reportReferences)
    .values(
      input.references.map((reference) => ({
        id: reference.id,
        reportId: input.reportId,
        referenceType: reference.referenceType,
        referenceId: reference.referenceId,
        labelSnapshot: reference.labelSnapshot,
        urlSnapshot: reference.urlSnapshot,
        note: reference.note,
        sortOrder: reference.sortOrder,
      })),
    )
    .onConflictDoNothing();
}

export async function replaceReportReferencesIfCaseEditable(
  db: AppDrizzleDb,
  input: { caseId: string; reportId: string; references: CreateReportReferenceInput[] },
): Promise<boolean> {
  const [editableRows, reportRows] = await executeAtomicSteps(db, [
    {
      sqlText: `
        SELECT id
        FROM report_cases
        WHERE id = ?
          AND status IN ('open', 'under_review')
          AND NOT EXISTS (
            SELECT 1
            FROM crowd_review_rounds
            WHERE report_case_id = report_cases.id
              AND status IN (?, ?, ?)
          )
      `,
      params: [input.caseId, ...activeCrowdReviewRoundStatuses],
    },
    {
      sqlText: `
        SELECT id
        FROM reports
        WHERE id = ?
          AND case_id = ?
      `,
      params: [input.reportId, input.caseId],
    },
    {
      sqlText: `
        DELETE FROM report_references
        WHERE report_id = ?
          AND EXISTS (
            SELECT 1
            FROM report_cases
            WHERE id = ?
              AND status IN ('open', 'under_review')
              AND NOT EXISTS (
                SELECT 1
                FROM crowd_review_rounds
                WHERE report_case_id = report_cases.id
                  AND status IN (?, ?, ?)
              )
          )
        RETURNING id
      `,
      params: [input.reportId, input.caseId, ...activeCrowdReviewRoundStatuses],
    },
    ...buildReferenceInsertSteps(input.references, {
      reportIdSql: '?',
      reportIdParams: [input.reportId],
      guardSql: `EXISTS (
        SELECT 1
        FROM report_cases
        WHERE id = ?
          AND status IN ('open', 'under_review')
          AND NOT EXISTS (
            SELECT 1
            FROM crowd_review_rounds
            WHERE report_case_id = report_cases.id
              AND status IN (?, ?, ?)
          )
      ) AND EXISTS (
        SELECT 1
        FROM reports
        WHERE id = ?
          AND case_id = ?
      )`,
      guardParams: [input.caseId, ...activeCrowdReviewRoundStatuses, input.reportId, input.caseId],
    }),
  ]);

  return editableRows.length > 0 && reportRows.length > 0;
}

export async function listReportReferencesByReport(
  db: AppDrizzleDb,
  reportId: string,
): Promise<ReportReferenceRow[]> {
  return await db
    .select()
    .from(reportReferences)
    .where(eq(reportReferences.reportId, reportId))
    .orderBy(asc(reportReferences.sortOrder), asc(reportReferences.createdAt));
}

export async function listActiveReportsByCase(db: AppDrizzleDb, caseId: string): Promise<ReportRow[]> {
  return await db
    .select()
    .from(reports)
    .where(and(eq(reports.caseId, caseId), eq(reports.status, 'active')))
    .orderBy(asc(reports.createdAt), asc(reports.id));
}

export async function countActiveReportsByCase(db: AppDrizzleDb, caseId: string): Promise<number> {
  const rows = await db
    .select({ count: count() })
    .from(reports)
    .where(and(eq(reports.caseId, caseId), eq(reports.status, 'active')));

  return Math.max(0, Number(rows[0]?.count ?? 0));
}

export async function createReportSubmissionEvent(
  db: AppDrizzleDb,
  input: CreateReportSubmissionEventInput,
): Promise<ReportSubmissionEventRow> {
  const rows = await db
    .insert(reportSubmissionEvents)
    .values({
      id: input.id,
      caseId: input.caseId,
      reportId: input.reportId,
      reporterUserId: input.reporterUserId,
      submissionDecision: input.submissionDecision,
      createdAt: input.now,
    })
    .onConflictDoNothing()
    .returning();

  if (rows[0]) {
    return rows[0];
  }

  const existingRow = await db.query.reportSubmissionEvents.findFirst({
    where: eq(reportSubmissionEvents.id, input.id),
  });
  if (!existingRow) {
    throw new Error('report submission event insert did not return a row');
  }

  return existingRow;
}

export async function getLatestReportSubmissionEventByReport(
  db: AppDrizzleDb,
  reportId: string,
): Promise<ReportSubmissionEventRow | null> {
  const row = await db.query.reportSubmissionEvents.findFirst({
    where: eq(reportSubmissionEvents.reportId, reportId),
    orderBy: [desc(reportSubmissionEvents.createdAt), desc(reportSubmissionEvents.id)],
  });

  return row ?? null;
}

export async function countReportSubmissionEventsByReporterSince(
  db: AppDrizzleDb,
  input: { reporterUserId: number; since: string },
): Promise<number> {
  const rows = await db
    .select({ count: count() })
    .from(reportSubmissionEvents)
    .where(
      and(
        eq(reportSubmissionEvents.reporterUserId, input.reporterUserId),
        gte(reportSubmissionEvents.createdAt, input.since),
      ),
    );

  return Math.max(0, Number(rows[0]?.count ?? 0));
}

export async function withdrawActiveReportByReporter(
  db: AppDrizzleDb,
  input: { caseId: string; reporterUserId: number; now: string },
): Promise<boolean> {
  const rows = await db
    .update(reports)
    .set({
      status: 'withdrawn',
      withdrawnAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(reports.caseId, input.caseId),
        eq(reports.reporterUserId, input.reporterUserId),
        eq(reports.status, 'active'),
      ),
    )
    .returning({ id: reports.id });

  return rows.length > 0;
}

export async function dismissCaseIfNoActiveReports(
  db: AppDrizzleDb,
  input: { caseId: string; now: string },
): Promise<boolean> {
  const rows = await db
    .update(reportCases)
    .set({
      status: 'dismissed',
      closedAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(reportCases.id, input.caseId),
        inArray(reportCases.status, openCaseStatuses),
        sql`NOT EXISTS (
          SELECT 1 FROM ${reports}
          WHERE ${reports.caseId} = ${reportCases.id}
            AND ${reports.status} = 'active'
        )`,
      ),
    )
    .returning({ id: reportCases.id });

  return rows.length > 0;
}

export async function withdrawActiveReportAndMaybeDismissCaseIfEditable(
  db: AppDrizzleDb,
  input: { caseId: string; reporterUserId: number; now: string },
): Promise<{ withdrawn: boolean; caseDismissed: boolean }> {
  const [editableRows, withdrawnRows, dismissedRows] = await executeAtomicSteps(db, [
    {
      sqlText: `
        SELECT id
        FROM report_cases
        WHERE id = ?
          AND status IN ('open', 'under_review')
          AND NOT EXISTS (
            SELECT 1
            FROM crowd_review_rounds
            WHERE report_case_id = report_cases.id
              AND status IN (?, ?, ?)
          )
      `,
      params: [input.caseId, ...activeCrowdReviewRoundStatuses],
    },
    {
      sqlText: `
        UPDATE reports
        SET status = 'withdrawn', withdrawn_at = ?, updated_at = ?
        WHERE case_id = ?
          AND reporter_user_id = ?
          AND status = 'active'
          AND EXISTS (
            SELECT 1
            FROM report_cases
            WHERE id = ?
              AND status IN ('open', 'under_review')
              AND NOT EXISTS (
                SELECT 1
                FROM crowd_review_rounds
                WHERE report_case_id = report_cases.id
                  AND status IN (?, ?, ?)
              )
          )
        RETURNING id
      `,
      params: [
        input.now,
        input.now,
        input.caseId,
        input.reporterUserId,
        input.caseId,
        ...activeCrowdReviewRoundStatuses,
      ],
    },
    {
      sqlText: `
        UPDATE report_cases
        SET status = 'dismissed', closed_at = ?, updated_at = ?
        WHERE id = ?
          AND status IN ('open', 'under_review')
          AND EXISTS (
            SELECT 1
            FROM reports
            WHERE case_id = ?
              AND reporter_user_id = ?
              AND status = 'withdrawn'
              AND updated_at = ?
          )
          AND NOT EXISTS (
            SELECT 1
            FROM reports
            WHERE case_id = report_cases.id
              AND status = 'active'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM crowd_review_rounds
            WHERE report_case_id = report_cases.id
              AND status IN (?, ?, ?)
          )
        RETURNING id
      `,
      params: [
        input.now,
        input.now,
        input.caseId,
        input.caseId,
        input.reporterUserId,
        input.now,
        ...activeCrowdReviewRoundStatuses,
      ],
    },
  ]);

  return {
    withdrawn: editableRows.length > 0 && withdrawnRows.length > 0,
    caseDismissed: dismissedRows.length > 0,
  };
}

export async function markReportCaseCreatorNotified(
  db: AppDrizzleDb,
  input: { caseId: string; notifiedAt: string; reportCount: number; targetCardUpdatedAtAtNotice: string | null },
): Promise<boolean> {
  const rows = await db
    .update(reportCases)
    .set({
      creatorNotifiedAt: input.notifiedAt,
      creatorNotifiedReportCount: sql<number>`(
        SELECT COUNT(*) FROM ${reports}
        WHERE ${reports.caseId} = ${reportCases.id}
          AND ${reports.status} = 'active'
      )`,
      targetCardUpdatedAtAtNotice: input.targetCardUpdatedAtAtNotice,
      updatedAt: input.notifiedAt,
    })
    .where(and(eq(reportCases.id, input.caseId), isNull(reportCases.creatorNotifiedAt)))
    .returning({ id: reportCases.id });

  return rows.length > 0;
}

export async function clearReportCaseCreatorNotified(
  db: AppDrizzleDb,
  input: { caseId: string; notifiedAt: string },
): Promise<boolean> {
  const rows = await db
    .update(reportCases)
    .set({
      creatorNotifiedAt: null,
      creatorNotifiedReportCount: 0,
      targetCardUpdatedAtAtNotice: null,
      updatedAt: input.notifiedAt,
    })
    .where(and(eq(reportCases.id, input.caseId), eq(reportCases.creatorNotifiedAt, input.notifiedAt)))
    .returning({ id: reportCases.id });

  return rows.length > 0;
}

export async function updateReportCaseDecision(
  db: AppDrizzleDb,
  input: {
    reportCaseId: string;
    status: ReportCaseStatus;
    resolutionCode: ReportResolutionCode | null;
    closedAt: string | null;
    now: string;
    expectedUpdatedAt?: string;
  },
): Promise<boolean> {
  const whereConditions = [eq(reportCases.id, input.reportCaseId)];
  if (input.expectedUpdatedAt) {
    whereConditions.push(eq(reportCases.updatedAt, input.expectedUpdatedAt));
  }

  const rows = await db
    .update(reportCases)
    .set({
      status: input.status,
      resolutionCode: input.resolutionCode,
      closedAt: input.closedAt,
      updatedAt: input.now,
    })
    .where(and(...whereConditions))
    .returning({ id: reportCases.id });

  return rows.length > 0;
}

export async function touchReportCaseLatestReportedAt(
  db: AppDrizzleDb,
  input: { caseId: string; now: string },
): Promise<boolean> {
  const rows = await db
    .update(reportCases)
    .set({
      latestReportedAt: input.now,
      updatedAt: input.now,
    })
    .where(eq(reportCases.id, input.caseId))
    .returning({ id: reportCases.id });

  return rows.length > 0;
}
