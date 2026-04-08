import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { reportCases, reportReferences, reports } from '@/lib/db/schema';
import type { ReportCaseStatus, ReportReferenceType, ReportStatus } from '@/lib/db/schema/business';

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

const openCaseStatuses: ReportCaseStatus[] = ['open', 'under_review'];

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

export async function markReportCaseCreatorNotified(
  db: AppDrizzleDb,
  input: { caseId: string; notifiedAt: string; reportCount: number; targetCardUpdatedAtAtNotice: string | null },
): Promise<boolean> {
  const rows = await db
    .update(reportCases)
    .set({
      creatorNotifiedAt: input.notifiedAt,
      creatorNotifiedReportCount: input.reportCount,
      targetCardUpdatedAtAtNotice: input.targetCardUpdatedAtAtNotice,
      updatedAt: input.notifiedAt,
    })
    .where(and(eq(reportCases.id, input.caseId), isNull(reportCases.creatorNotifiedAt)))
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
