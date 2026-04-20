import { and, count, eq, inArray } from 'drizzle-orm';

import { getDataCardReportReasonLabel } from '@/lib/data-card-reports/reasons';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import {
  crowdReviewAssignments,
  inspectorDisciplineEvents,
  users,
  type CrowdReviewInspectorStatus,
  type InspectorDisciplineEventType,
} from '@/lib/db/schema';
import {
  clearReportCaseCreatorNotified,
  countActiveReportsByCase,
  markReportCaseCreatorNotified,
} from '@/lib/db/repositories/data-card-reports';
import { getInspectorState, upsertCrowdReviewInspectorState } from '@/lib/db/repositories/crowd-review';
import { queryFromD1 } from '@/lib/database/core';
import { createUserMessageEntry } from '@/lib/messages/service';

export type AdminReportCaseListItem = {
  reportCaseId: string;
  status: string;
  resolutionCode: string | null;
  targetCardId: string | null;
  targetCardName: string | null;
  targetUsername: string | null;
  activeReportCount: number;
  creatorNotifiedAt: string | null;
  latestReportedAt: string;
  updatedAt: string;
  hasActiveCrowdReview: boolean;
  hasActiveAppeal: boolean;
  isSelfRemediationCandidate: boolean;
};

export type AdminCrowdReviewInspectorListItem = {
  userId: number;
  username: string | null;
  status: string;
  suspendedUntil: string | null;
  statusReasonCode: string | null;
  statusReasonDetail: string | null;
  activeAssignments: number;
  completedAssignments: number;
  updatedAt: string;
};

export type AdminCrowdReviewCaseListItem = {
  roundId: string;
  reportCaseId: string;
  status: string;
  targetCardId: string | null;
  targetCardName: string | null;
  deadlineAt: string;
  extensionCount: number;
  minValidVotes: number;
  resultCode: string | null;
  assignmentCount: number;
  votedCount: number;
  activeAssignmentCount: number;
  updatedAt: string;
};

export type AdminReportCaseReferenceDto = {
  referenceType: string;
  referenceId: string;
  labelSnapshot: string;
  urlSnapshot: string | null;
  note: string | null;
  sortOrder: number;
};

export type AdminReportCaseEvidenceSummaryDto = {
  reasonLabels: string[];
  referenceSummary: string[];
  detailsPreview: string | null;
};

export type AdminReportCaseActiveReportDto = {
  reportId: string;
  reporterUserId: number;
  reporterUsername: string | null;
  reasonCode: string;
  reasonLabel: string;
  details: string | null;
  createdAt: string;
  updatedAt: string;
  targetSnapshot: {
    name: string;
    description: string | null;
    updatedAt: string | null;
    dataPreview: string | null;
  };
  references: AdminReportCaseReferenceDto[];
  evidenceSummary: AdminReportCaseEvidenceSummaryDto;
};

export type AdminReportCaseCrowdReviewSummaryDto = {
  roundId: string;
  status: string;
  deadlineAt: string;
  extensionCount: number;
  minValidVotes: number;
  resultCode: string | null;
  updatedAt: string;
};

export type AdminReportCaseAppealSummaryDto = {
  appealId: string;
  appellantUserId: number;
  appellantUsername: string | null;
  status: string;
  appealReasonCode: string;
  resolutionCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminReportCaseDetailDto = AdminReportCaseListItem & {
  targetUserId: number | null;
  currentTargetCard: {
    id: string | null;
    name: string | null;
    description: string | null;
    updatedAt: string | null;
    reviewStatus: string | null;
    isPublic: boolean | null;
    deletedAt: string | null;
    dataPreview: string | null;
  };
  latestTargetSnapshot: {
    name: string;
    description: string | null;
    updatedAt: string | null;
    dataPreview: string | null;
  } | null;
  aggregatedSummary: AdminReportCaseEvidenceSummaryDto;
  activeReports: AdminReportCaseActiveReportDto[];
  crowdReviewRounds: AdminReportCaseCrowdReviewSummaryDto[];
  appeals: AdminReportCaseAppealSummaryDto[];
  creatorNotifiedReportCount: number;
  targetCardUpdatedAtAtNotice: string | null;
  resolutionNotifiedAt: string | null;
  resolutionNotifiedCaseUpdatedAt: string | null;
  closedAt: string | null;
  createdAt: string;
};

export type AdminReportCaseNotifyResult = {
  reportCaseId: string;
  creatorNotifiedAt: string | null;
  messageId: number | null;
  sentMessage: boolean;
};

export type AdminCrowdReviewAssignmentDetailItem = {
  assignmentId: string;
  inspectorUserId: number;
  inspectorUsername: string | null;
  inspectorEmail: string | null;
  status: string;
  assignedAt: string;
  expiresAt: string;
  completedAt: string | null;
  decision: string | null;
  decisionNote: string | null;
  postVoteSummary: Record<string, unknown>;
  postVoteSummarySeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminCrowdReviewCaseDetailDto = AdminCrowdReviewCaseListItem & {
  openedAt: string;
  resultSummary: Record<string, unknown>;
  reportCaseStatus: string | null;
  reportCaseResolutionCode: string | null;
  targetUsername: string | null;
  createdAt: string;
  assignments: AdminCrowdReviewAssignmentDetailItem[];
};

export class AdminGovernanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminGovernanceValidationError';
  }
}

export class AdminGovernanceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminGovernanceNotFoundError';
  }
}

export class AdminGovernanceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminGovernanceConflictError';
  }
}

export class AdminGovernanceServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminGovernanceServiceUnavailableError';
  }
}

const readInt = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return 0;
};

const readString = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const readBool = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    if (value === '1' || value.toLowerCase() === 'true') return true;
    if (value === '0' || value.toLowerCase() === 'false') return false;
  }
  return null;
};

const trimToNull = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const previewDetails = (details: string | null): string | null => {
  const normalized = trimToNull(details);
  if (!normalized) return null;
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 80)}…`;
};

const previewTextBlock = (value: string | null, maxLength = 400): string | null => {
  const normalized = trimToNull(value);
  if (!normalized) return null;
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
};

const formatReferenceSummaryItem = (referenceType: string, labelSnapshot: string): string =>
  referenceType === 'public_data_card' ? `引用公开数据卡：${labelSnapshot}` : `引用百科：${labelSnapshot}`;

const parseJsonObject = (raw: string | null): Record<string, unknown> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const parseEvidenceSummary = (payloadJson: string | null): AdminReportCaseEvidenceSummaryDto => {
  const parsed = parseJsonObject(payloadJson);
  return {
    reasonLabels: Array.isArray(parsed.reasonLabels)
      ? parsed.reasonLabels.filter((item): item is string => typeof item === 'string')
      : [],
    referenceSummary: Array.isArray(parsed.referenceSummary)
      ? parsed.referenceSummary.filter((item): item is string => typeof item === 'string')
      : [],
    detailsPreview: typeof parsed.detailsPreview === 'string' ? parsed.detailsPreview : null,
  };
};

const aggregateDetailsPreview = (detailsPreviews: Array<string | null | undefined>): string | null => {
  const unique = Array.from(
    new Set(detailsPreviews.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)),
  );
  if (unique.length === 0) return null;
  return previewDetails(unique.join('；'));
};

const aggregateReportSummaries = (reports: AdminReportCaseActiveReportDto[]): AdminReportCaseEvidenceSummaryDto => ({
  reasonLabels: Array.from(new Set(reports.flatMap((item) => item.evidenceSummary.reasonLabels))),
  referenceSummary: Array.from(new Set(reports.flatMap((item) => item.evidenceSummary.referenceSummary))),
  detailsPreview: aggregateDetailsPreview(reports.map((item) => item.evidenceSummary.detailsPreview)),
});

const requireDb = (db: AppDrizzleDb | null): AppDrizzleDb => {
  if (!db) {
    throw new AdminGovernanceServiceUnavailableError('治理后台数据库不可用');
  }
  return db;
};

const readRows = async (sql: string, params: Array<string | number> = []): Promise<Record<string, unknown>[]> => {
  const result = (await queryFromD1(sql, params)) as any;
  return result?.success ? result.result?.[0]?.results || [] : [];
};

export async function listAdminReportCases(input: {
  status?: 'open' | 'under_review' | 'resolved' | 'dismissed';
  limit?: number;
}): Promise<{ items: AdminReportCaseListItem[]; fetchedAt: string }> {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const params: Array<string | number> = [];
  const where: string[] = [];

  if (input.status) {
    where.push('rc.status = ?');
    params.push(input.status);
  }

  const sql = `
    SELECT
      rc.id AS report_case_id,
      rc.status,
      rc.resolution_code,
      rc.creator_notified_at,
      rc.latest_reported_at,
      rc.updated_at,
      dc.id AS target_card_id,
      dc.name AS target_card_name,
      u.username AS target_username,
      (
        SELECT COUNT(*)
        FROM reports r
        WHERE r.case_id = rc.id
          AND r.status = 'active'
      ) AS active_report_count,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM crowd_review_rounds crr
          WHERE crr.report_case_id = rc.id
            AND crr.status IN ('pending_dispatch', 'active', 'waiting_more_votes')
        ) THEN 1
        ELSE 0
      END AS has_active_crowd_review,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM report_appeals ra
          WHERE ra.report_case_id = rc.id
            AND ra.status IN ('submitted', 'under_review')
        ) THEN 1
        ELSE 0
      END AS has_active_appeal,
      CASE
        WHEN COALESCE(rc.target_card_updated_at_at_notice, rc.creator_notified_at) IS NULL THEN 0
        WHEN dc.updated_at > COALESCE(rc.target_card_updated_at_at_notice, rc.creator_notified_at) THEN 1
        ELSE 0
      END AS is_self_remediation_candidate
    FROM report_cases rc
    LEFT JOIN data_cards dc
      ON rc.target_entity_type = 'data_card' AND dc.id = rc.target_entity_id
    LEFT JOIN users u ON u.id = rc.target_user_id
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY rc.latest_reported_at DESC, rc.updated_at DESC, rc.id DESC
    LIMIT ?
  `;

  params.push(limit);
  const result = (await queryFromD1(sql, params)) as any;
  const rows = result?.success ? result.result?.[0]?.results || [] : [];
  return {
    items: rows.map((row: Record<string, unknown>) => ({
      reportCaseId: String(row.report_case_id),
      status: String(row.status ?? ''),
      resolutionCode: readString(row.resolution_code),
      targetCardId: readString(row.target_card_id),
      targetCardName: readString(row.target_card_name),
      targetUsername: readString(row.target_username),
      activeReportCount: readInt(row.active_report_count),
      creatorNotifiedAt: readString(row.creator_notified_at),
      latestReportedAt: String(row.latest_reported_at ?? ''),
      updatedAt: String(row.updated_at ?? ''),
      hasActiveCrowdReview: readInt(row.has_active_crowd_review) === 1,
      hasActiveAppeal: readInt(row.has_active_appeal) === 1,
      isSelfRemediationCandidate: readInt(row.is_self_remediation_candidate) === 1,
    })),
    fetchedAt: new Date().toISOString(),
  };
}

export async function listAdminCrowdReviewInspectors(input: {
  status?: 'active' | 'suspended' | 'revoked';
  limit?: number;
}): Promise<{ items: AdminCrowdReviewInspectorListItem[]; fetchedAt: string }> {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const params: Array<string | number> = [];
  const where: string[] = [];

  if (input.status) {
    where.push('cri.status = ?');
    params.push(input.status);
  }

  const sql = `
    SELECT
      cri.user_id,
      u.username,
      cri.status,
      cri.suspended_until,
      cri.status_reason_code,
      cri.status_reason_detail,
      cri.updated_at,
      (
        SELECT COUNT(*)
        FROM crowd_review_assignments cra
        WHERE cra.inspector_user_id = cri.user_id
          AND cra.status = 'assigned'
      ) AS active_assignments,
      (
        SELECT COUNT(*)
        FROM crowd_review_assignments cra
        WHERE cra.inspector_user_id = cri.user_id
          AND cra.status IN ('voted', 'abstained', 'expired', 'revoked')
      ) AS completed_assignments
    FROM crowd_review_inspectors cri
    LEFT JOIN users u ON u.id = cri.user_id
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY cri.updated_at DESC, cri.user_id DESC
    LIMIT ?
  `;

  params.push(limit);
  const result = (await queryFromD1(sql, params)) as any;
  const rows = result?.success ? result.result?.[0]?.results || [] : [];
  return {
    items: rows.map((row: Record<string, unknown>) => ({
      userId: readInt(row.user_id),
      username: readString(row.username),
      status: String(row.status ?? ''),
      suspendedUntil: readString(row.suspended_until),
      statusReasonCode: readString(row.status_reason_code),
      statusReasonDetail: readString(row.status_reason_detail),
      activeAssignments: readInt(row.active_assignments),
      completedAssignments: readInt(row.completed_assignments),
      updatedAt: String(row.updated_at ?? ''),
    })),
    fetchedAt: new Date().toISOString(),
  };
}

export async function listAdminCrowdReviewCases(input: {
  status?: 'pending_dispatch' | 'active' | 'waiting_more_votes' | 'concluded' | 'escalated' | 'cancelled';
  limit?: number;
}): Promise<{ items: AdminCrowdReviewCaseListItem[]; fetchedAt: string }> {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const params: Array<string | number> = [];
  const where: string[] = [];

  if (input.status) {
    where.push('crr.status = ?');
    params.push(input.status);
  }

  const sql = `
    SELECT
      crr.id AS round_id,
      crr.report_case_id,
      crr.status,
      crr.deadline_at,
      crr.extension_count,
      crr.min_valid_votes,
      crr.result_code,
      crr.updated_at,
      dc.id AS target_card_id,
      dc.name AS target_card_name,
      (
        SELECT COUNT(*)
        FROM crowd_review_assignments cra
        WHERE cra.crowd_review_round_id = crr.id
      ) AS assignment_count,
      (
        SELECT COUNT(*)
        FROM crowd_review_assignments cra
        WHERE cra.crowd_review_round_id = crr.id
          AND cra.status = 'voted'
      ) AS voted_count,
      (
        SELECT COUNT(*)
        FROM crowd_review_assignments cra
        WHERE cra.crowd_review_round_id = crr.id
          AND cra.status = 'assigned'
      ) AS active_assignment_count
    FROM crowd_review_rounds crr
    LEFT JOIN report_cases rc ON rc.id = crr.report_case_id
    LEFT JOIN data_cards dc
      ON rc.target_entity_type = 'data_card' AND dc.id = rc.target_entity_id
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY crr.updated_at DESC, crr.id DESC
    LIMIT ?
  `;

  params.push(limit);
  const result = (await queryFromD1(sql, params)) as any;
  const rows = result?.success ? result.result?.[0]?.results || [] : [];
  return {
    items: rows.map((row: Record<string, unknown>) => ({
      roundId: String(row.round_id),
      reportCaseId: String(row.report_case_id ?? ''),
      status: String(row.status ?? ''),
      targetCardId: readString(row.target_card_id),
      targetCardName: readString(row.target_card_name),
      deadlineAt: String(row.deadline_at ?? ''),
      extensionCount: readInt(row.extension_count),
      minValidVotes: readInt(row.min_valid_votes),
      resultCode: readString(row.result_code),
      assignmentCount: readInt(row.assignment_count),
      votedCount: readInt(row.voted_count),
      activeAssignmentCount: readInt(row.active_assignment_count),
      updatedAt: String(row.updated_at ?? ''),
    })),
    fetchedAt: new Date().toISOString(),
  };
}

export async function getAdminReportCaseDetail(caseId: string): Promise<AdminReportCaseDetailDto | null> {
  const [caseRow] = await readRows(
    `
      SELECT
        rc.id AS report_case_id,
        rc.status,
        rc.resolution_code,
        rc.creator_notified_at,
        rc.creator_notified_report_count,
        rc.latest_reported_at,
        rc.target_card_updated_at_at_notice,
        rc.resolution_notified_at,
        rc.resolution_notified_case_updated_at,
        rc.closed_at,
        rc.created_at,
        rc.updated_at,
        dc.id AS target_card_id,
        dc.name AS target_card_name,
        dc.description AS target_card_description,
        dc.data AS target_card_data,
        dc.updated_at AS target_card_updated_at,
        dc.review_status AS target_card_review_status,
        dc.is_public AS target_card_is_public,
        dc.deleted_at AS target_card_deleted_at,
        u.id AS target_user_id,
        u.username AS target_username,
        (
          SELECT COUNT(*)
          FROM reports r
          WHERE r.case_id = rc.id
            AND r.status = 'active'
        ) AS active_report_count,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM crowd_review_rounds crr
            WHERE crr.report_case_id = rc.id
              AND crr.status IN ('pending_dispatch', 'active', 'waiting_more_votes')
          ) THEN 1
          ELSE 0
        END AS has_active_crowd_review,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM report_appeals ra
            WHERE ra.report_case_id = rc.id
              AND ra.status IN ('submitted', 'under_review')
          ) THEN 1
          ELSE 0
        END AS has_active_appeal,
        CASE
          WHEN COALESCE(rc.target_card_updated_at_at_notice, rc.creator_notified_at) IS NULL THEN 0
          WHEN dc.updated_at > COALESCE(rc.target_card_updated_at_at_notice, rc.creator_notified_at) THEN 1
          ELSE 0
        END AS is_self_remediation_candidate
      FROM report_cases rc
      LEFT JOIN data_cards dc
        ON rc.target_entity_type = 'data_card' AND dc.id = rc.target_entity_id
      LEFT JOIN users u ON u.id = rc.target_user_id
      WHERE rc.id = ?
      LIMIT 1
    `,
    [caseId],
  );

  if (!caseRow) return null;

  const reportRows = await readRows(
    `
      SELECT
        r.id AS report_id,
        r.reporter_user_id,
        ru.username AS reporter_username,
        r.reason_code,
        r.details,
        r.evidence_summary_json,
        r.target_name_snapshot,
        r.target_description_snapshot,
        r.target_data_snapshot,
        r.target_updated_at_snapshot,
        r.created_at,
        r.updated_at
      FROM reports r
      LEFT JOIN users ru ON ru.id = r.reporter_user_id
      WHERE r.case_id = ?
        AND r.status = 'active'
      ORDER BY r.created_at ASC, r.id ASC
    `,
    [caseId],
  );

  const reportIds = reportRows.map((row) => String(row.report_id));
  const referenceRows =
    reportIds.length === 0
      ? []
      : await readRows(
          `
            SELECT
              rr.report_id,
              rr.reference_type,
              rr.reference_id,
              rr.label_snapshot,
              rr.url_snapshot,
              rr.note,
              rr.sort_order
            FROM report_references rr
            WHERE rr.report_id IN (${reportIds.map(() => '?').join(', ')})
            ORDER BY rr.report_id ASC, rr.sort_order ASC, rr.created_at ASC
          `,
          reportIds,
        );

  const referencesByReportId = new Map<string, AdminReportCaseReferenceDto[]>();
  for (const row of referenceRows) {
    const reportId = String(row.report_id ?? '');
    const list = referencesByReportId.get(reportId) ?? [];
    list.push({
      referenceType: String(row.reference_type ?? ''),
      referenceId: String(row.reference_id ?? ''),
      labelSnapshot: String(row.label_snapshot ?? ''),
      urlSnapshot: readString(row.url_snapshot),
      note: readString(row.note),
      sortOrder: readInt(row.sort_order),
    });
    referencesByReportId.set(reportId, list);
  }

  const activeReports = reportRows.map((row) => {
    const reportId = String(row.report_id ?? '');
    const references = referencesByReportId.get(reportId) ?? [];
    const parsedEvidenceSummary = parseEvidenceSummary(readString(row.evidence_summary_json));
    return {
      reportId,
      reporterUserId: readInt(row.reporter_user_id),
      reporterUsername: readString(row.reporter_username),
      reasonCode: String(row.reason_code ?? ''),
      reasonLabel: getDataCardReportReasonLabel(String(row.reason_code ?? '')),
      details: readString(row.details),
      createdAt: String(row.created_at ?? ''),
      updatedAt: String(row.updated_at ?? ''),
      targetSnapshot: {
        name: String(row.target_name_snapshot ?? ''),
        description: readString(row.target_description_snapshot),
        updatedAt: readString(row.target_updated_at_snapshot),
        dataPreview: previewTextBlock(readString(row.target_data_snapshot)),
      },
      references,
      evidenceSummary: {
        reasonLabels:
          parsedEvidenceSummary.reasonLabels.length > 0
            ? parsedEvidenceSummary.reasonLabels
            : [getDataCardReportReasonLabel(String(row.reason_code ?? ''))],
        referenceSummary:
          parsedEvidenceSummary.referenceSummary.length > 0
            ? parsedEvidenceSummary.referenceSummary
            : references.map((reference) =>
                formatReferenceSummaryItem(reference.referenceType, reference.labelSnapshot),
              ),
        detailsPreview: parsedEvidenceSummary.detailsPreview ?? previewDetails(readString(row.details)),
      },
    };
  });

  const crowdReviewRows = await readRows(
    `
      SELECT
        crr.id AS round_id,
        crr.status,
        crr.deadline_at,
        crr.extension_count,
        crr.min_valid_votes,
        crr.result_code,
        crr.updated_at
      FROM crowd_review_rounds crr
      WHERE crr.report_case_id = ?
      ORDER BY crr.opened_at DESC, crr.id DESC
    `,
    [caseId],
  );

  const appealRows = await readRows(
    `
      SELECT
        ra.id AS appeal_id,
        ra.appellant_user_id,
        au.username AS appellant_username,
        ra.status,
        ra.appeal_reason_code,
        ra.resolution_code,
        ra.created_at,
        ra.updated_at
      FROM report_appeals ra
      LEFT JOIN users au ON au.id = ra.appellant_user_id
      WHERE ra.report_case_id = ?
      ORDER BY ra.created_at DESC, ra.id DESC
    `,
    [caseId],
  );

  const latestTargetSnapshot = activeReports.length > 0 ? activeReports[activeReports.length - 1]!.targetSnapshot : null;

  return {
    reportCaseId: String(caseRow.report_case_id ?? ''),
    status: String(caseRow.status ?? ''),
    resolutionCode: readString(caseRow.resolution_code),
    targetCardId: readString(caseRow.target_card_id),
    targetCardName: readString(caseRow.target_card_name),
    targetUsername: readString(caseRow.target_username),
    activeReportCount: readInt(caseRow.active_report_count),
    creatorNotifiedAt: readString(caseRow.creator_notified_at),
    latestReportedAt: String(caseRow.latest_reported_at ?? ''),
    updatedAt: String(caseRow.updated_at ?? ''),
    hasActiveCrowdReview: readInt(caseRow.has_active_crowd_review) === 1,
    hasActiveAppeal: readInt(caseRow.has_active_appeal) === 1,
    isSelfRemediationCandidate: readInt(caseRow.is_self_remediation_candidate) === 1,
    targetUserId: readInt(caseRow.target_user_id) || null,
    currentTargetCard: {
      id: readString(caseRow.target_card_id),
      name: readString(caseRow.target_card_name),
      description: readString(caseRow.target_card_description),
      updatedAt: readString(caseRow.target_card_updated_at),
      reviewStatus: readString(caseRow.target_card_review_status),
      isPublic: readBool(caseRow.target_card_is_public),
      deletedAt: readString(caseRow.target_card_deleted_at),
      dataPreview: previewTextBlock(readString(caseRow.target_card_data)),
    },
    latestTargetSnapshot,
    aggregatedSummary: aggregateReportSummaries(activeReports),
    activeReports,
    crowdReviewRounds: crowdReviewRows.map((row) => ({
      roundId: String(row.round_id ?? ''),
      status: String(row.status ?? ''),
      deadlineAt: String(row.deadline_at ?? ''),
      extensionCount: readInt(row.extension_count),
      minValidVotes: readInt(row.min_valid_votes),
      resultCode: readString(row.result_code),
      updatedAt: String(row.updated_at ?? ''),
    })),
    appeals: appealRows.map((row) => ({
      appealId: String(row.appeal_id ?? ''),
      appellantUserId: readInt(row.appellant_user_id),
      appellantUsername: readString(row.appellant_username),
      status: String(row.status ?? ''),
      appealReasonCode: String(row.appeal_reason_code ?? ''),
      resolutionCode: readString(row.resolution_code),
      createdAt: String(row.created_at ?? ''),
      updatedAt: String(row.updated_at ?? ''),
    })),
    creatorNotifiedReportCount: readInt(caseRow.creator_notified_report_count),
    targetCardUpdatedAtAtNotice: readString(caseRow.target_card_updated_at_at_notice),
    resolutionNotifiedAt: readString(caseRow.resolution_notified_at),
    resolutionNotifiedCaseUpdatedAt: readString(caseRow.resolution_notified_case_updated_at),
    closedAt: readString(caseRow.closed_at),
    createdAt: String(caseRow.created_at ?? ''),
  };
}

export async function notifyAdminReportCaseCreator(input: {
  db: AppDrizzleDb | null;
  caseId: string;
  adminUserId: number;
  sendMessage: boolean;
  reason?: string | null;
}): Promise<AdminReportCaseNotifyResult> {
  const db = requireDb(input.db);
  const detail = await getAdminReportCaseDetail(input.caseId);
  if (!detail) {
    throw new AdminGovernanceNotFoundError('举报案件不存在');
  }
  if (detail.targetUserId == null) {
    throw new AdminGovernanceValidationError('案件缺少目标作者信息');
  }

  const reason = trimToNull(input.reason);
  const now = new Date().toISOString();
  let creatorNotifiedAt = detail.creatorNotifiedAt;
  let markedNow = false;

  if (!creatorNotifiedAt) {
    const reportCount = await countActiveReportsByCase(db, input.caseId);
    markedNow = await markReportCaseCreatorNotified(db, {
      caseId: input.caseId,
      notifiedAt: now,
      reportCount,
      targetCardUpdatedAtAtNotice: detail.currentTargetCard.updatedAt,
    });
    if (markedNow) {
      creatorNotifiedAt = now;
    } else {
      creatorNotifiedAt = (await getAdminReportCaseDetail(input.caseId))?.creatorNotifiedAt ?? null;
    }
  }

  let messageId: number | null = null;
  if (input.sendMessage) {
    try {
      const message = await createUserMessageEntry({
        db,
        recipientUserId: detail.targetUserId,
        actorUserId: input.adminUserId,
        channel: 'admin',
        messageType: 'moderation',
        templateKey: 'user.moderation.data_card_reported',
        payload: {
          dataCardId: detail.targetCardId,
          dataCardName: detail.targetCardName,
          reasonLabels: detail.aggregatedSummary.reasonLabels,
          referenceSummary: detail.aggregatedSummary.referenceSummary,
          detailsPreview: reason ?? detail.aggregatedSummary.detailsPreview,
          reportCount: detail.activeReportCount,
          updatedAfterNotice: detail.isSelfRemediationCandidate,
        },
        actionUrl: detail.targetCardId
          ? `/character-manager?dataCardId=${encodeURIComponent(detail.targetCardId)}`
          : '/character-manager',
        sourceEntityType: 'report_case',
        sourceEntityId: detail.reportCaseId,
        priority: 'high',
      });
      messageId = typeof message.id === 'number' ? message.id : null;
    } catch (error) {
      if (markedNow) {
        await clearReportCaseCreatorNotified(db, { caseId: input.caseId, notifiedAt: now });
      }
      throw error;
    }
  }

  return {
    reportCaseId: detail.reportCaseId,
    creatorNotifiedAt,
    messageId,
    sentMessage: input.sendMessage,
  };
}

export async function updateAdminCrowdReviewInspectorStatus(input: {
  db: AppDrizzleDb | null;
  userId: number;
  adminUserId: number;
  nextStatus: CrowdReviewInspectorStatus;
  reasonCode?: string | null;
  reasonDetail?: string | null;
  suspendedUntil?: string | null;
}): Promise<AdminCrowdReviewInspectorListItem> {
  if (input.nextStatus !== 'active' && input.nextStatus !== 'suspended' && input.nextStatus !== 'revoked') {
    throw new AdminGovernanceValidationError('巡查使状态无效');
  }

  const db = requireDb(input.db);
  const user = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
    columns: { id: true, username: true },
  });
  if (!user) {
    throw new AdminGovernanceNotFoundError('目标用户不存在');
  }

  const previousState = await getInspectorState(db, input.userId);
  const now = new Date().toISOString();
  const reasonCode = trimToNull(input.reasonCode);
  const reasonDetail = trimToNull(input.reasonDetail);
  const suspendedUntil = input.nextStatus === 'suspended' ? trimToNull(input.suspendedUntil) : null;

  const updated = await upsertCrowdReviewInspectorState(db, {
    userId: input.userId,
    status: input.nextStatus,
    suspendedUntil,
    statusReasonCode: input.nextStatus === 'active' ? null : reasonCode,
    statusReasonDetail: input.nextStatus === 'active' ? null : reasonDetail,
    updatedByUserId: input.adminUserId,
    now,
  });

  let eventType: InspectorDisciplineEventType | null = null;
  if (!previousState) {
    eventType = input.nextStatus === 'active' ? 'grant' : input.nextStatus === 'suspended' ? 'suspend' : 'revoke';
  } else if (previousState.status !== input.nextStatus) {
    eventType = input.nextStatus === 'active' ? 'restore' : input.nextStatus === 'suspended' ? 'suspend' : 'revoke';
  }

  if (eventType) {
    await db.insert(inspectorDisciplineEvents).values({
      id: crypto.randomUUID(),
      userId: input.userId,
      eventType,
      reasonCode,
      reasonDetail,
      sourceEntityType: 'admin_user',
      sourceEntityId: String(input.adminUserId),
      createdByUserId: input.adminUserId,
      createdAt: now,
    });
  }

  const [activeAssignmentsRow] = await db
    .select({ count: count() })
    .from(crowdReviewAssignments)
    .where(and(eq(crowdReviewAssignments.inspectorUserId, input.userId), eq(crowdReviewAssignments.status, 'assigned')));
  const [completedAssignmentsRow] = await db
    .select({ count: count() })
    .from(crowdReviewAssignments)
    .where(
      and(
        eq(crowdReviewAssignments.inspectorUserId, input.userId),
        inArray(crowdReviewAssignments.status, ['voted', 'abstained', 'expired', 'revoked']),
      ),
    );

  return {
    userId: input.userId,
    username: user.username ?? null,
    status: updated.status,
    suspendedUntil: updated.suspendedUntil,
    statusReasonCode: updated.statusReasonCode,
    statusReasonDetail: updated.statusReasonDetail,
    activeAssignments: Math.max(0, Number(activeAssignmentsRow?.count ?? 0)),
    completedAssignments: Math.max(0, Number(completedAssignmentsRow?.count ?? 0)),
    updatedAt: updated.updatedAt,
  };
}

export async function getAdminCrowdReviewCaseDetail(roundId: string): Promise<AdminCrowdReviewCaseDetailDto | null> {
  const [row] = await readRows(
    `
      SELECT
        crr.id AS round_id,
        crr.report_case_id,
        crr.status,
        crr.opened_at,
        crr.deadline_at,
        crr.extension_count,
        crr.min_valid_votes,
        crr.result_code,
        crr.result_summary_json,
        crr.created_at,
        crr.updated_at,
        rc.status AS report_case_status,
        rc.resolution_code AS report_case_resolution_code,
        dc.id AS target_card_id,
        dc.name AS target_card_name,
        tu.username AS target_username,
        (
          SELECT COUNT(*)
          FROM crowd_review_assignments cra
          WHERE cra.crowd_review_round_id = crr.id
        ) AS assignment_count,
        (
          SELECT COUNT(*)
          FROM crowd_review_assignments cra
          WHERE cra.crowd_review_round_id = crr.id
            AND cra.status = 'voted'
        ) AS voted_count,
        (
          SELECT COUNT(*)
          FROM crowd_review_assignments cra
          WHERE cra.crowd_review_round_id = crr.id
            AND cra.status = 'assigned'
        ) AS active_assignment_count
      FROM crowd_review_rounds crr
      LEFT JOIN report_cases rc ON rc.id = crr.report_case_id
      LEFT JOIN data_cards dc
        ON rc.target_entity_type = 'data_card' AND dc.id = rc.target_entity_id
      LEFT JOIN users tu ON tu.id = rc.target_user_id
      WHERE crr.id = ?
      LIMIT 1
    `,
    [roundId],
  );

  if (!row) return null;

  const assignmentRows = await readRows(
    `
      SELECT
        cra.id AS assignment_id,
        cra.inspector_user_id,
        u.username AS inspector_username,
        u.email AS inspector_email,
        cra.status,
        cra.assigned_at,
        cra.expires_at,
        cra.completed_at,
        cra.decision,
        cra.decision_note,
        cra.post_vote_summary_json,
        cra.post_vote_summary_seen_at,
        cra.created_at,
        cra.updated_at
      FROM crowd_review_assignments cra
      LEFT JOIN users u ON u.id = cra.inspector_user_id
      WHERE cra.crowd_review_round_id = ?
      ORDER BY cra.assigned_at ASC, cra.id ASC
    `,
    [roundId],
  );

  return {
    roundId: String(row.round_id ?? ''),
    reportCaseId: String(row.report_case_id ?? ''),
    status: String(row.status ?? ''),
    targetCardId: readString(row.target_card_id),
    targetCardName: readString(row.target_card_name),
    deadlineAt: String(row.deadline_at ?? ''),
    extensionCount: readInt(row.extension_count),
    minValidVotes: readInt(row.min_valid_votes),
    resultCode: readString(row.result_code),
    assignmentCount: readInt(row.assignment_count),
    votedCount: readInt(row.voted_count),
    activeAssignmentCount: readInt(row.active_assignment_count),
    updatedAt: String(row.updated_at ?? ''),
    openedAt: String(row.opened_at ?? ''),
    resultSummary: parseJsonObject(readString(row.result_summary_json)),
    reportCaseStatus: readString(row.report_case_status),
    reportCaseResolutionCode: readString(row.report_case_resolution_code),
    targetUsername: readString(row.target_username),
    createdAt: String(row.created_at ?? ''),
    assignments: assignmentRows.map((assignment) => ({
      assignmentId: String(assignment.assignment_id ?? ''),
      inspectorUserId: readInt(assignment.inspector_user_id),
      inspectorUsername: readString(assignment.inspector_username),
      inspectorEmail: readString(assignment.inspector_email),
      status: String(assignment.status ?? ''),
      assignedAt: String(assignment.assigned_at ?? ''),
      expiresAt: String(assignment.expires_at ?? ''),
      completedAt: readString(assignment.completed_at),
      decision: readString(assignment.decision),
      decisionNote: readString(assignment.decision_note),
      postVoteSummary: parseJsonObject(readString(assignment.post_vote_summary_json)),
      postVoteSummarySeenAt: readString(assignment.post_vote_summary_seen_at),
      createdAt: String(assignment.created_at ?? ''),
      updatedAt: String(assignment.updated_at ?? ''),
    })),
  };
}
