import { and, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import {
  dataCards,
  reportAppealReferences,
  reportAppeals,
  reportCases,
  users,
  type ReportAppealReasonCode,
  type ReportAppealResolutionCode,
  type ReportAppealStatus,
  type ReportCaseStatus,
  type ReportReferenceType,
  type ReportResolutionCode,
} from '@/lib/db/schema';

export type ReportAppealRow = {
  id: string;
  reportCaseId: string;
  appellantUserId: number;
  targetUserId: number;
  targetEntityType: string;
  targetEntityId: string;
  appealReasonCode: ReportAppealReasonCode;
  details: string;
  evidenceSummaryJson: string;
  status: ReportAppealStatus;
  resolutionCode: ReportAppealResolutionCode | null;
  resolutionNote: string | null;
  caseStatusSnapshot: ReportCaseStatus;
  caseResolutionCodeSnapshot: ReportResolutionCode | null;
  caseUpdatedAtSnapshot: string;
  reviewedByUserId: number | null;
  reviewedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReportAppealReferenceRow = {
  id: string;
  appealId: string;
  referenceType: ReportReferenceType;
  referenceId: string;
  labelSnapshot: string;
  urlSnapshot: string | null;
  note: string | null;
  sortOrder: number;
  createdAt: string;
};

export type AppealableCaseRow = {
  id: string;
  targetEntityType: string;
  targetEntityId: string;
  targetUserId: number;
  status: ReportCaseStatus;
  resolutionCode: ReportResolutionCode | null;
  updatedAt: string;
  targetCardName: string;
};

export type ReportAppealListRow = ReportAppealRow & {
  targetCardName: string;
};

export type ReportAppealDetailRow = ReportAppealRow & {
  targetCardName: string;
  currentCaseStatus: ReportCaseStatus;
  currentCaseResolutionCode: ReportResolutionCode | null;
  currentCaseClosedAt: string | null;
  currentCaseUpdatedAt: string;
};

export type ReportAppealAdminListRow = ReportAppealListRow & {
  appellantUsername: string | null;
};

export type ReportCaseResolutionNotificationRow = {
  id: string;
  targetUserId: number;
  targetEntityId: string;
  targetCardName: string;
  status: ReportCaseStatus;
  resolutionCode: ReportResolutionCode | null;
  updatedAt: string;
  resolutionNotifiedCaseUpdatedAt: string | null;
};

export type CreateReportAppealInput = {
  id: string;
  reportCaseId: string;
  appellantUserId: number;
  targetUserId: number;
  targetEntityType: 'data_card';
  targetEntityId: string;
  appealReasonCode: ReportAppealReasonCode;
  details: string;
  evidenceSummaryJson: string;
  status: ReportAppealStatus;
  resolutionCode: ReportAppealResolutionCode | null;
  resolutionNote: string | null;
  caseStatusSnapshot: ReportCaseStatus;
  caseResolutionCodeSnapshot: ReportResolutionCode | null;
  caseUpdatedAtSnapshot: string;
  reviewedByUserId: number | null;
  reviewedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateReportAppealReferenceInput = {
  id: string;
  referenceType: ReportReferenceType;
  referenceId: string;
  labelSnapshot: string;
  urlSnapshot: string | null;
  note: string | null;
  sortOrder: number;
  createdAt: string;
};

export type ResolveReportAppealInput = {
  appealId: string;
  resolutionCode: ReportAppealResolutionCode;
  resolutionNote: string | null;
  reviewedByUserId: number;
  reviewedAt: string;
  now: string;
};

export type UpdateReportAppealStatusInput = {
  appealId: string;
  currentStatuses: ReportAppealStatus[];
  nextStatus: ReportAppealStatus;
  now: string;
  withdrawnAt?: string | null;
};

export type UpdateReportCaseAfterAppealReviewInput = {
  reportCaseId: string;
  status: ReportCaseStatus;
  resolutionCode: ReportResolutionCode | null;
  closedAt: string | null;
  now: string;
};

export type RestoreReportAppealAfterReviewFailureInput = {
  appealId: string;
  status: ReportAppealStatus;
  now: string;
};

const FALLBACK_TARGET_CARD_NAME = '相关数据卡';

const withTargetCardNameFallback = <T extends { targetCardName: string | null }>(row: T): T & { targetCardName: string } => ({
  ...row,
  targetCardName:
    typeof row.targetCardName === 'string' && row.targetCardName.trim()
      ? row.targetCardName.trim()
      : FALLBACK_TARGET_CARD_NAME,
});

export async function getAppealableCaseForUser(
  db: AppDrizzleDb,
  input: { reportCaseId: string; userId: number },
): Promise<AppealableCaseRow | null> {
  const rows = await db
    .select({
      id: reportCases.id,
      targetEntityType: reportCases.targetEntityType,
      targetEntityId: reportCases.targetEntityId,
      targetUserId: reportCases.targetUserId,
      status: reportCases.status,
      resolutionCode: reportCases.resolutionCode,
      updatedAt: reportCases.updatedAt,
      targetCardName: dataCards.name,
    })
    .from(reportCases)
    .leftJoin(
      dataCards,
      and(eq(dataCards.id, reportCases.targetEntityId), eq(reportCases.targetEntityType, 'data_card')),
    )
    .where(and(eq(reportCases.id, input.reportCaseId), eq(reportCases.targetUserId, input.userId)));

  return rows[0] ? withTargetCardNameFallback(rows[0]) : null;
}

export async function getLatestNonWithdrawnAppealByCaseSnapshot(
  db: AppDrizzleDb,
  input: { reportCaseId: string; caseUpdatedAtSnapshot: string },
): Promise<ReportAppealRow | null> {
  const row = await db.query.reportAppeals.findFirst({
    where: and(
      eq(reportAppeals.reportCaseId, input.reportCaseId),
      eq(reportAppeals.caseUpdatedAtSnapshot, input.caseUpdatedAtSnapshot),
      ne(reportAppeals.status, 'withdrawn'),
    ),
    orderBy: [desc(reportAppeals.createdAt), desc(reportAppeals.id)],
  });

  return row ?? null;
}

export async function getActiveAppealByCase(db: AppDrizzleDb, reportCaseId: string): Promise<ReportAppealRow | null> {
  const row = await db.query.reportAppeals.findFirst({
    where: and(eq(reportAppeals.reportCaseId, reportCaseId), inArray(reportAppeals.status, ['submitted', 'under_review'])),
    orderBy: [desc(reportAppeals.createdAt), desc(reportAppeals.id)],
  });

  return row ?? null;
}

export async function getLatestActiveAppealByTargetForUser(
  db: AppDrizzleDb,
  input: { userId: number; targetEntityId: string },
): Promise<ReportAppealRow | null> {
  const row = await db.query.reportAppeals.findFirst({
    where: and(
      eq(reportAppeals.appellantUserId, input.userId),
      eq(reportAppeals.targetEntityType, 'data_card'),
      eq(reportAppeals.targetEntityId, input.targetEntityId),
      inArray(reportAppeals.status, ['submitted', 'under_review']),
    ),
    orderBy: [desc(reportAppeals.createdAt), desc(reportAppeals.id)],
  });

  return row ?? null;
}

export async function createReportAppeal(
  db: AppDrizzleDb,
  input: CreateReportAppealInput,
): Promise<ReportAppealRow> {
  const rows = await db
    .insert(reportAppeals)
    .values({
      id: input.id,
      reportCaseId: input.reportCaseId,
      appellantUserId: input.appellantUserId,
      targetUserId: input.targetUserId,
      targetEntityType: input.targetEntityType,
      targetEntityId: input.targetEntityId,
      appealReasonCode: input.appealReasonCode,
      details: input.details,
      evidenceSummaryJson: input.evidenceSummaryJson,
      status: input.status,
      resolutionCode: input.resolutionCode,
      resolutionNote: input.resolutionNote,
      caseStatusSnapshot: input.caseStatusSnapshot,
      caseResolutionCodeSnapshot: input.caseResolutionCodeSnapshot,
      caseUpdatedAtSnapshot: input.caseUpdatedAtSnapshot,
      reviewedByUserId: input.reviewedByUserId,
      reviewedAt: input.reviewedAt,
      withdrawnAt: input.withdrawnAt,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .returning();

  return rows[0]!;
}

export async function replaceReportAppealReferences(
  db: AppDrizzleDb,
  input: { appealId: string; references: CreateReportAppealReferenceInput[] },
): Promise<void> {
  await db.delete(reportAppealReferences).where(eq(reportAppealReferences.appealId, input.appealId));

  if (input.references.length === 0) return;

  await db
    .insert(reportAppealReferences)
    .values(
      input.references.map((reference) => ({
        id: reference.id,
        appealId: input.appealId,
        referenceType: reference.referenceType,
        referenceId: reference.referenceId,
        labelSnapshot: reference.labelSnapshot,
        urlSnapshot: reference.urlSnapshot,
        note: reference.note,
        sortOrder: reference.sortOrder,
        createdAt: reference.createdAt,
      })),
    )
    .onConflictDoNothing();
}

export async function listReportAppealReferences(
  db: AppDrizzleDb,
  appealId: string,
): Promise<ReportAppealReferenceRow[]> {
  return await db.query.reportAppealReferences.findMany({
    where: eq(reportAppealReferences.appealId, appealId),
    orderBy: [reportAppealReferences.sortOrder, reportAppealReferences.createdAt],
  });
}

export async function getReportAppealByIdForAppellant(
  db: AppDrizzleDb,
  input: { appealId: string; userId: number },
): Promise<ReportAppealDetailRow | null> {
  const rows = await db
    .select({
      id: reportAppeals.id,
      reportCaseId: reportAppeals.reportCaseId,
      appellantUserId: reportAppeals.appellantUserId,
      targetUserId: reportAppeals.targetUserId,
      targetEntityType: reportAppeals.targetEntityType,
      targetEntityId: reportAppeals.targetEntityId,
      appealReasonCode: reportAppeals.appealReasonCode,
      details: reportAppeals.details,
      evidenceSummaryJson: reportAppeals.evidenceSummaryJson,
      status: reportAppeals.status,
      resolutionCode: reportAppeals.resolutionCode,
      resolutionNote: reportAppeals.resolutionNote,
      caseStatusSnapshot: reportAppeals.caseStatusSnapshot,
      caseResolutionCodeSnapshot: reportAppeals.caseResolutionCodeSnapshot,
      caseUpdatedAtSnapshot: reportAppeals.caseUpdatedAtSnapshot,
      reviewedByUserId: reportAppeals.reviewedByUserId,
      reviewedAt: reportAppeals.reviewedAt,
      withdrawnAt: reportAppeals.withdrawnAt,
      createdAt: reportAppeals.createdAt,
      updatedAt: reportAppeals.updatedAt,
      targetCardName: dataCards.name,
      currentCaseStatus: reportCases.status,
      currentCaseResolutionCode: reportCases.resolutionCode,
      currentCaseClosedAt: reportCases.closedAt,
      currentCaseUpdatedAt: reportCases.updatedAt,
    })
    .from(reportAppeals)
    .innerJoin(
      reportCases,
      and(eq(reportCases.id, reportAppeals.reportCaseId), eq(reportCases.targetEntityType, 'data_card')),
    )
    .leftJoin(dataCards, eq(dataCards.id, reportCases.targetEntityId))
    .where(and(eq(reportAppeals.id, input.appealId), eq(reportAppeals.appellantUserId, input.userId)));

  return rows[0] ? withTargetCardNameFallback(rows[0]) : null;
}

export async function getReportAppealByIdForAdmin(
  db: AppDrizzleDb,
  appealId: string,
): Promise<ReportAppealDetailRow | null> {
  const rows = await db
    .select({
      id: reportAppeals.id,
      reportCaseId: reportAppeals.reportCaseId,
      appellantUserId: reportAppeals.appellantUserId,
      targetUserId: reportAppeals.targetUserId,
      targetEntityType: reportAppeals.targetEntityType,
      targetEntityId: reportAppeals.targetEntityId,
      appealReasonCode: reportAppeals.appealReasonCode,
      details: reportAppeals.details,
      evidenceSummaryJson: reportAppeals.evidenceSummaryJson,
      status: reportAppeals.status,
      resolutionCode: reportAppeals.resolutionCode,
      resolutionNote: reportAppeals.resolutionNote,
      caseStatusSnapshot: reportAppeals.caseStatusSnapshot,
      caseResolutionCodeSnapshot: reportAppeals.caseResolutionCodeSnapshot,
      caseUpdatedAtSnapshot: reportAppeals.caseUpdatedAtSnapshot,
      reviewedByUserId: reportAppeals.reviewedByUserId,
      reviewedAt: reportAppeals.reviewedAt,
      withdrawnAt: reportAppeals.withdrawnAt,
      createdAt: reportAppeals.createdAt,
      updatedAt: reportAppeals.updatedAt,
      targetCardName: dataCards.name,
      currentCaseStatus: reportCases.status,
      currentCaseResolutionCode: reportCases.resolutionCode,
      currentCaseClosedAt: reportCases.closedAt,
      currentCaseUpdatedAt: reportCases.updatedAt,
    })
    .from(reportAppeals)
    .innerJoin(
      reportCases,
      and(eq(reportCases.id, reportAppeals.reportCaseId), eq(reportCases.targetEntityType, 'data_card')),
    )
    .leftJoin(dataCards, eq(dataCards.id, reportCases.targetEntityId))
    .where(eq(reportAppeals.id, appealId));

  return rows[0] ? withTargetCardNameFallback(rows[0]) : null;
}

export async function listReportAppealsByAppellant(
  db: AppDrizzleDb,
  userId: number,
  limit: number,
): Promise<ReportAppealListRow[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  return await db
    .select({
      id: reportAppeals.id,
      reportCaseId: reportAppeals.reportCaseId,
      appellantUserId: reportAppeals.appellantUserId,
      targetUserId: reportAppeals.targetUserId,
      targetEntityType: reportAppeals.targetEntityType,
      targetEntityId: reportAppeals.targetEntityId,
      appealReasonCode: reportAppeals.appealReasonCode,
      details: reportAppeals.details,
      evidenceSummaryJson: reportAppeals.evidenceSummaryJson,
      status: reportAppeals.status,
      resolutionCode: reportAppeals.resolutionCode,
      resolutionNote: reportAppeals.resolutionNote,
      caseStatusSnapshot: reportAppeals.caseStatusSnapshot,
      caseResolutionCodeSnapshot: reportAppeals.caseResolutionCodeSnapshot,
      caseUpdatedAtSnapshot: reportAppeals.caseUpdatedAtSnapshot,
      reviewedByUserId: reportAppeals.reviewedByUserId,
      reviewedAt: reportAppeals.reviewedAt,
      withdrawnAt: reportAppeals.withdrawnAt,
      createdAt: reportAppeals.createdAt,
      updatedAt: reportAppeals.updatedAt,
      targetCardName: dataCards.name,
    })
    .from(reportAppeals)
    .innerJoin(
      reportCases,
      and(eq(reportCases.id, reportAppeals.reportCaseId), eq(reportCases.targetEntityType, 'data_card')),
    )
    .leftJoin(dataCards, eq(dataCards.id, reportCases.targetEntityId))
    .where(eq(reportAppeals.appellantUserId, userId))
    .orderBy(desc(reportAppeals.createdAt), desc(reportAppeals.id))
    .limit(safeLimit)
    .then((rows) => rows.map(withTargetCardNameFallback));
}

export async function listReportAppealsForAdmin(
  db: AppDrizzleDb,
  input: { status?: ReportAppealStatus; limit: number },
): Promise<ReportAppealAdminListRow[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
  return await db
    .select({
      id: reportAppeals.id,
      reportCaseId: reportAppeals.reportCaseId,
      appellantUserId: reportAppeals.appellantUserId,
      targetUserId: reportAppeals.targetUserId,
      targetEntityType: reportAppeals.targetEntityType,
      targetEntityId: reportAppeals.targetEntityId,
      appealReasonCode: reportAppeals.appealReasonCode,
      details: reportAppeals.details,
      evidenceSummaryJson: reportAppeals.evidenceSummaryJson,
      status: reportAppeals.status,
      resolutionCode: reportAppeals.resolutionCode,
      resolutionNote: reportAppeals.resolutionNote,
      caseStatusSnapshot: reportAppeals.caseStatusSnapshot,
      caseResolutionCodeSnapshot: reportAppeals.caseResolutionCodeSnapshot,
      caseUpdatedAtSnapshot: reportAppeals.caseUpdatedAtSnapshot,
      reviewedByUserId: reportAppeals.reviewedByUserId,
      reviewedAt: reportAppeals.reviewedAt,
      withdrawnAt: reportAppeals.withdrawnAt,
      createdAt: reportAppeals.createdAt,
      updatedAt: reportAppeals.updatedAt,
      targetCardName: dataCards.name,
      appellantUsername: users.username,
    })
    .from(reportAppeals)
    .innerJoin(
      reportCases,
      and(eq(reportCases.id, reportAppeals.reportCaseId), eq(reportCases.targetEntityType, 'data_card')),
    )
    .leftJoin(dataCards, eq(dataCards.id, reportCases.targetEntityId))
    .leftJoin(users, eq(users.id, reportAppeals.appellantUserId))
    .where(input.status ? eq(reportAppeals.status, input.status) : undefined)
    .orderBy(desc(reportAppeals.createdAt), desc(reportAppeals.id))
    .limit(safeLimit)
    .then((rows) => rows.map(withTargetCardNameFallback));
}

export async function updateReportAppealResolution(
  db: AppDrizzleDb,
  input: ResolveReportAppealInput,
): Promise<boolean> {
  const rows = await db
    .update(reportAppeals)
    .set({
      status: 'resolved',
      resolutionCode: input.resolutionCode,
      resolutionNote: input.resolutionNote,
      reviewedByUserId: input.reviewedByUserId,
      reviewedAt: input.reviewedAt,
      updatedAt: input.now,
    })
    .where(and(eq(reportAppeals.id, input.appealId), or(eq(reportAppeals.status, 'submitted'), eq(reportAppeals.status, 'under_review'))))
    .returning({ id: reportAppeals.id });

  return rows.length > 0;
}

export async function updateReportAppealStatus(
  db: AppDrizzleDb,
  input: UpdateReportAppealStatusInput,
): Promise<boolean> {
  const rows = await db
    .update(reportAppeals)
    .set({
      status: input.nextStatus,
      withdrawnAt: input.withdrawnAt ?? null,
      updatedAt: input.now,
    })
    .where(and(eq(reportAppeals.id, input.appealId), inArray(reportAppeals.status, input.currentStatuses)))
    .returning({ id: reportAppeals.id });

  return rows.length > 0;
}

export async function restoreReportAppealAfterReviewFailure(
  db: AppDrizzleDb,
  input: RestoreReportAppealAfterReviewFailureInput,
): Promise<boolean> {
  const rows = await db
    .update(reportAppeals)
    .set({
      status: input.status,
      resolutionCode: null,
      resolutionNote: null,
      reviewedByUserId: null,
      reviewedAt: null,
      updatedAt: input.now,
    })
    .where(eq(reportAppeals.id, input.appealId))
    .returning({ id: reportAppeals.id });

  return rows.length > 0;
}

export async function updateReportCaseAfterAppealReview(
  db: AppDrizzleDb,
  input: UpdateReportCaseAfterAppealReviewInput,
): Promise<boolean> {
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
}

export async function getReportCaseForResolutionNotification(
  db: AppDrizzleDb,
  reportCaseId: string,
): Promise<ReportCaseResolutionNotificationRow | null> {
  const rows = await db
    .select({
      id: reportCases.id,
      targetUserId: reportCases.targetUserId,
      targetEntityId: reportCases.targetEntityId,
      targetCardName: dataCards.name,
      status: reportCases.status,
      resolutionCode: reportCases.resolutionCode,
      updatedAt: reportCases.updatedAt,
      resolutionNotifiedCaseUpdatedAt: reportCases.resolutionNotifiedCaseUpdatedAt,
    })
    .from(reportCases)
    .leftJoin(
      dataCards,
      and(eq(dataCards.id, reportCases.targetEntityId), eq(reportCases.targetEntityType, 'data_card')),
    )
    .where(eq(reportCases.id, reportCaseId));

  return rows[0] ? withTargetCardNameFallback(rows[0]) : null;
}

export async function markReportCaseResolutionNotified(
  db: AppDrizzleDb,
  input: { reportCaseId: string; expectedCaseUpdatedAt: string; now: string },
): Promise<boolean> {
  const rows = await db
    .update(reportCases)
    .set({
      resolutionNotifiedAt: input.now,
      resolutionNotifiedCaseUpdatedAt: input.expectedCaseUpdatedAt,
    })
    .where(
      and(
        eq(reportCases.id, input.reportCaseId),
        eq(reportCases.updatedAt, input.expectedCaseUpdatedAt),
        or(
          isNull(reportCases.resolutionNotifiedCaseUpdatedAt),
          ne(reportCases.resolutionNotifiedCaseUpdatedAt, input.expectedCaseUpdatedAt),
        ),
      ),
    )
    .returning({ id: reportCases.id });

  return rows.length > 0;
}

export async function clearReportCaseResolutionNotified(
  db: AppDrizzleDb,
  input: { reportCaseId: string; expectedCaseUpdatedAt: string },
): Promise<boolean> {
  const rows = await db
    .update(reportCases)
    .set({
      resolutionNotifiedAt: null,
      resolutionNotifiedCaseUpdatedAt: null,
    })
    .where(
      and(
        eq(reportCases.id, input.reportCaseId),
        eq(reportCases.resolutionNotifiedCaseUpdatedAt, input.expectedCaseUpdatedAt),
      ),
    )
    .returning({ id: reportCases.id });

  return rows.length > 0;
}
