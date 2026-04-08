import type { AppDrizzleDb } from '@/lib/db/drizzle';
import type { DataCardByIdDbRow } from '@/lib/db/repositories/data-cards-core';
import { getDataCardByIdWithAuthorAndTags } from '@/lib/db/repositories/data-cards-core';
import * as repo from '@/lib/db/repositories/data-card-reports';
import { getEncyclopediaEntry } from '@/lib/encyclopedia';
import { createUserMessageEntry } from '@/lib/messages/service';
import {
  buildNormalizedReportPayloadHash,
  InvalidDataCardReportDetailsError,
  InvalidDataCardReportReferenceError,
  normalizeDataCardReportDetails,
  normalizeDataCardReportReferences,
} from '@/lib/data-card-reports/normalization';
import {
  DATA_CARD_REPORT_REASONS,
  getDataCardReportReasonLabel,
  isDataCardReportReasonCode,
} from '@/lib/data-card-reports/reasons';
import type {
  DataCardReportCapabilityDto,
  DataCardReportDraft,
  DataCardReportReferenceDraft,
  DataCardReportSubmissionDecision,
  NormalizedReportReference,
} from '@/lib/data-card-reports/types';

export type DataCardReportsServiceDb = AppDrizzleDb | null;

type ResolvedReferenceSnapshot = {
  referenceType: 'public_data_card' | 'encyclopedia_entry';
  referenceId: string;
  labelSnapshot: string;
  urlSnapshot: string | null;
  note: string | null;
  sortOrder: number;
};

type DataCardReportsRepository = {
  getOpenReportCaseByTarget: typeof repo.getOpenReportCaseByTarget;
  createReportCase: typeof repo.createReportCase;
  getActiveReportByCaseAndReporter: typeof repo.getActiveReportByCaseAndReporter;
  createReport: typeof repo.createReport;
  updateActiveReportForReporter: typeof repo.updateActiveReportForReporter;
  createReportSubmissionEvent: typeof repo.createReportSubmissionEvent;
  getLatestReportSubmissionEventByReport: typeof repo.getLatestReportSubmissionEventByReport;
  countReportSubmissionEventsByReporterSince: typeof repo.countReportSubmissionEventsByReporterSince;
  replaceReportReferences: typeof repo.replaceReportReferences;
  listReportReferencesByReport: typeof repo.listReportReferencesByReport;
  listActiveReportsByCase: typeof repo.listActiveReportsByCase;
  countActiveReportsByCase: typeof repo.countActiveReportsByCase;
  withdrawActiveReportByReporter: typeof repo.withdrawActiveReportByReporter;
  dismissCaseIfNoActiveReports: typeof repo.dismissCaseIfNoActiveReports;
  markReportCaseCreatorNotified: typeof repo.markReportCaseCreatorNotified;
  clearReportCaseCreatorNotified: typeof repo.clearReportCaseCreatorNotified;
};

export type DataCardReportsServiceDeps = {
  now: () => string;
  idFactory: () => string;
  repo: DataCardReportsRepository;
  getTargetCard: (db: AppDrizzleDb, cardId: string) => Promise<DataCardByIdDbRow | null>;
  resolveReferenceSnapshots: (input: {
    db: AppDrizzleDb;
    targetEntityId: string;
    references: NormalizedReportReference[];
  }) => Promise<ResolvedReferenceSnapshot[]>;
  rateLimit: (input: { reporterUserId: number; targetEntityId: string }) => Promise<{ allowed: boolean }>;
  screenSubmission: (input: {
    reporterUserId: number;
    targetEntityId: string;
    reasonCode: string;
    details: string | null;
  }) => Promise<{ allowed: boolean }>;
  createUserMessageEntry: typeof createUserMessageEntry;
};

export type SubmitDataCardReportInput = {
  db: DataCardReportsServiceDb;
  reporterUserId: number;
  targetEntityId: string;
  reasonCode: string;
  details: string | null;
  references: DataCardReportReferenceDraft[];
};

export type SubmitDataCardReportResult = {
  submissionDecision: DataCardReportSubmissionDecision;
  caseId: string | null;
  reportId: string | null;
  creatorNotified: boolean;
};

export type WithdrawDataCardReportInput = {
  db: DataCardReportsServiceDb;
  reporterUserId: number;
  targetEntityId: string;
};

export type WithdrawDataCardReportResult = {
  withdrawn: boolean;
  caseDismissed: boolean;
};

export class DataCardReportsServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataCardReportsServiceUnavailableError';
  }
}

export class DataCardReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataCardReportValidationError';
  }
}

export class DataCardReportForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataCardReportForbiddenError';
  }
}

const DATA_CARD_REPORT_RATE_LIMIT_PER_HOUR = 3;
const DATA_CARD_REPORT_RATE_LIMIT_PER_DAY = 10;
const DATA_CARD_REPORT_SAME_TARGET_COOLDOWN_MS = 60 * 1000;
const MAX_REPORT_WRITE_ATTEMPTS = 4;
const SQLITE_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

const requireDb = (db: DataCardReportsServiceDb): AppDrizzleDb => {
  if (!db) {
    throw new DataCardReportsServiceUnavailableError('举报服务当前不可用');
  }
  return db;
};

const toRepo = (): DataCardReportsRepository => ({
  getOpenReportCaseByTarget: (innerDb, input) => repo.getOpenReportCaseByTarget(innerDb, input),
  createReportCase: (innerDb, input) => repo.createReportCase(innerDb, input),
  getActiveReportByCaseAndReporter: (innerDb, input) => repo.getActiveReportByCaseAndReporter(innerDb, input),
  createReport: (innerDb, input) => repo.createReport(innerDb, input),
  updateActiveReportForReporter: (innerDb, input) => repo.updateActiveReportForReporter(innerDb, input),
  createReportSubmissionEvent: (innerDb, input) => repo.createReportSubmissionEvent(innerDb, input),
  getLatestReportSubmissionEventByReport: (innerDb, reportId) =>
    repo.getLatestReportSubmissionEventByReport(innerDb, reportId),
  countReportSubmissionEventsByReporterSince: (innerDb, input) =>
    repo.countReportSubmissionEventsByReporterSince(innerDb, input),
  replaceReportReferences: (innerDb, input) => repo.replaceReportReferences(innerDb, input),
  listReportReferencesByReport: (innerDb, reportId) => repo.listReportReferencesByReport(innerDb, reportId),
  listActiveReportsByCase: (innerDb, caseId) => repo.listActiveReportsByCase(innerDb, caseId),
  countActiveReportsByCase: (innerDb, caseId) => repo.countActiveReportsByCase(innerDb, caseId),
  withdrawActiveReportByReporter: (innerDb, input) => repo.withdrawActiveReportByReporter(innerDb, input),
  dismissCaseIfNoActiveReports: (innerDb, input) => repo.dismissCaseIfNoActiveReports(innerDb, input),
  markReportCaseCreatorNotified: (innerDb, input) => repo.markReportCaseCreatorNotified(innerDb, input),
  clearReportCaseCreatorNotified: (innerDb, input) => repo.clearReportCaseCreatorNotified(innerDb, input),
});

const resolveTargetCard = async (db: AppDrizzleDb, cardId: string): Promise<DataCardByIdDbRow | null> =>
  getDataCardByIdWithAuthorAndTags(db, { cardId, publicOnly: true });

const resolveReferenceSnapshots = async (input: {
  db: AppDrizzleDb;
  targetEntityId: string;
  references: NormalizedReportReference[];
}): Promise<ResolvedReferenceSnapshot[]> => {
  const resolved: ResolvedReferenceSnapshot[] = [];

  for (const reference of input.references) {
    if (reference.referenceType === 'public_data_card') {
      if (reference.referenceId === input.targetEntityId) {
        throw new DataCardReportValidationError('引用公开数据卡时不能引用被举报目标自身');
      }
      const card = await resolveTargetCard(input.db, reference.referenceId);
      if (!card) {
        throw new DataCardReportValidationError('引用的公开数据卡不存在或不可访问');
      }
      resolved.push({
        referenceType: reference.referenceType,
        referenceId: reference.referenceId,
        labelSnapshot: card.name,
        urlSnapshot: `/character-manager?dataCardId=${encodeURIComponent(card.id)}`,
        note: reference.note,
        sortOrder: reference.sortOrder,
      });
      continue;
    }

    const entry = getEncyclopediaEntry(reference.referenceId);
    if (!entry) {
      throw new DataCardReportValidationError('引用的百科条目不存在');
    }

    resolved.push({
      referenceType: reference.referenceType,
      referenceId: reference.referenceId,
      labelSnapshot: entry.title,
      urlSnapshot: `/encyclopedia/${entry.slug}`,
      note: reference.note,
      sortOrder: reference.sortOrder,
    });
  }

  return resolved;
};

const previewDetails = (details: string | null): string | null => {
  if (!details) return null;
  return details.length <= 80 ? details : `${details.slice(0, 80)}…`;
};

const formatReferenceSummaryItem = (referenceType: string, labelSnapshot: string): string =>
  referenceType === 'public_data_card' ? `引用公开数据卡：${labelSnapshot}` : `引用百科：${labelSnapshot}`;

const buildReferenceSummary = (references: ResolvedReferenceSnapshot[]): string[] =>
  references.map((reference) => formatReferenceSummaryItem(reference.referenceType, reference.labelSnapshot));

const buildEvidenceSummary = (input: {
  reasonCode: string;
  references: ResolvedReferenceSnapshot[];
  details: string | null;
}) => ({
  reasonLabels: [getDataCardReportReasonLabel(input.reasonCode)],
  referenceSummary: buildReferenceSummary(input.references),
  detailsPreview: previewDetails(input.details),
});

const parseEvidenceSummary = (payloadJson: string): {
  reasonLabels: string[];
  referenceSummary: string[];
  detailsPreview: string | null;
} => {
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    return {
      reasonLabels: Array.isArray(parsed.reasonLabels)
        ? parsed.reasonLabels.filter((item): item is string => typeof item === 'string')
        : [],
      referenceSummary: Array.isArray(parsed.referenceSummary)
        ? parsed.referenceSummary.filter((item): item is string => typeof item === 'string')
        : [],
      detailsPreview: typeof parsed.detailsPreview === 'string' ? parsed.detailsPreview : null,
    };
  } catch {
    return { reasonLabels: [], referenceSummary: [], detailsPreview: null };
  }
};

const canonicalizeReferenceIdentity = (
  references: Array<{ referenceType: string; referenceId: string; note: string | null }>,
): string[] =>
  references
    .map((reference) => JSON.stringify([reference.referenceType, reference.referenceId, reference.note ?? null]))
    .sort();

const hasMatchingReportReferences = (
  currentReferences: Array<{
    referenceType: string;
    referenceId: string;
    note: string | null;
    sortOrder: number;
  }>,
  normalizedReferences: NormalizedReportReference[],
): boolean => {
  if (currentReferences.length !== normalizedReferences.length) return false;

  const currentCanonical = canonicalizeReferenceIdentity(currentReferences);
  const normalizedCanonical = canonicalizeReferenceIdentity(normalizedReferences);

  return normalizedCanonical.every((referenceKey, index) => currentCanonical[index] === referenceKey);
};

type AggregatedCaseEvidenceSummary = {
  reasonLabels: string[];
  referenceSummary: string[];
  detailsPreview: string | null;
};

const aggregateDetailsPreview = (detailsPreviews: Array<string | null | undefined>): string | null => {
  const uniqueDetails = Array.from(
    new Set(detailsPreviews.filter((details): details is string => typeof details === 'string' && details.length > 0)),
  );
  if (uniqueDetails.length === 0) return null;
  return previewDetails(uniqueDetails.join('；'));
};

const toReportReferenceWriteInput = (
  idFactory: () => string,
  referenceSnapshots: ResolvedReferenceSnapshot[],
) =>
  referenceSnapshots.map((reference) => ({
    id: idFactory(),
    referenceType: reference.referenceType,
    referenceId: reference.referenceId,
    labelSnapshot: reference.labelSnapshot,
    urlSnapshot: reference.urlSnapshot,
    note: reference.note,
    sortOrder: reference.sortOrder,
  }));

const subtractWindowFromIso = (now: string, windowMs: number): string => {
  const baseMs = parseTimestampMs(now);
  if (!Number.isFinite(baseMs)) {
    return new Date(Date.now() - windowMs).toISOString();
  }
  return new Date(baseMs - windowMs).toISOString();
};

const parseTimestampMs = (value: string | null | undefined): number => {
  if (!value) return Number.NaN;

  if (SQLITE_UTC_TIMESTAMP_PATTERN.test(value)) {
    return Date.parse(value.replace(' ', 'T') + 'Z');
  }

  return Date.parse(value);
};

const isWithinCooldown = (updatedAt: string | null | undefined, now: string, cooldownMs: number): boolean => {
  if (!updatedAt) return false;
  const updatedAtMs = parseTimestampMs(updatedAt);
  const nowMs = parseTimestampMs(now);
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(nowMs)) return false;
  return nowMs - updatedAtMs >= 0 && nowMs - updatedAtMs < cooldownMs;
};

const shouldRepairMissingSubmissionEvent = (input: {
  reportCreatedAt: string | null | undefined;
  reportUpdatedAt: string | null | undefined;
  latestSubmissionEvent: { createdAt: string } | null;
}): boolean => {
  const reportWriteAtMs = parseTimestampMs(input.reportUpdatedAt ?? input.reportCreatedAt ?? '');
  if (!Number.isFinite(reportWriteAtMs)) {
    return false;
  }

  if (!input.latestSubmissionEvent) {
    return true;
  }

  const latestEventAtMs = parseTimestampMs(input.latestSubmissionEvent.createdAt);
  if (!Number.isFinite(latestEventAtMs)) {
    return false;
  }

  return latestEventAtMs < reportWriteAtMs;
};

const inferSubmissionEventRepairDecision = (
  latestSubmissionEvent: { createdAt: string } | null,
): 'created' | 'updated' => (latestSubmissionEvent ? 'updated' : 'created');

const buildReportSubmissionEventStableId = (input: {
  reportId: string;
  submissionDecision: 'created' | 'updated';
  normalizedPayloadHash: string | null | undefined;
  reportCreatedAt: string | null | undefined;
  reportUpdatedAt: string | null | undefined;
  fallbackNow: string;
}): string => {
  const reportVersionAt =
    input.submissionDecision === 'created'
      ? input.reportCreatedAt ?? input.reportUpdatedAt ?? input.fallbackNow
      : input.reportUpdatedAt ?? input.reportCreatedAt ?? input.fallbackNow;

  return [
    'report_submission_event',
    input.reportId,
    input.submissionDecision,
    reportVersionAt,
    input.normalizedPayloadHash ?? 'missing_payload_hash',
  ].join(':');
};

export async function screenDataCardReportSubmission(input: {
  reporterUserId: number;
  targetEntityId: string;
  reasonCode: string;
  details: string | null;
}): Promise<{ allowed: boolean }> {
  const normalizedDetails = normalizeDataCardReportDetails(input.details);

  if (input.reasonCode === 'rule_violation_other' && !normalizedDetails) {
    return { allowed: false };
  }

  return { allowed: true };
}

export async function rateLimitDataCardReportSubmission(
  db: AppDrizzleDb,
  input: {
    reporterUserId: number;
    targetEntityId: string;
    now?: string;
  },
): Promise<{ allowed: boolean }> {
  const now = input.now ?? new Date().toISOString();
  const openCase = await repo.getOpenReportCaseByTarget(db, {
    targetEntityType: 'data_card',
    targetEntityId: input.targetEntityId,
  });
  if (openCase) {
    const activeReport = await repo.getActiveReportByCaseAndReporter(db, {
      caseId: openCase.id,
      reporterUserId: input.reporterUserId,
    });
    if (isWithinCooldown(activeReport?.updatedAt, now, DATA_CARD_REPORT_SAME_TARGET_COOLDOWN_MS)) {
      return { allowed: false };
    }
  }

  const lastHourCount = await repo.countReportSubmissionEventsByReporterSince(db, {
    reporterUserId: input.reporterUserId,
    since: subtractWindowFromIso(now, 60 * 60 * 1000),
  });
  if (lastHourCount >= DATA_CARD_REPORT_RATE_LIMIT_PER_HOUR) {
    return { allowed: false };
  }

  const lastDayCount = await repo.countReportSubmissionEventsByReporterSince(db, {
    reporterUserId: input.reporterUserId,
    since: subtractWindowFromIso(now, 24 * 60 * 60 * 1000),
  });
  if (lastDayCount >= DATA_CARD_REPORT_RATE_LIMIT_PER_DAY) {
    return { allowed: false };
  }

  return { allowed: true };
}

const createDataCardReportsService = (deps: DataCardReportsServiceDeps) => {
  const getEligibleTargetCard = async (
    db: AppDrizzleDb,
    targetEntityId: string,
    reporterUserId: number,
  ): Promise<DataCardByIdDbRow> => {
    const targetCard = await deps.getTargetCard(db, targetEntityId);
    if (!targetCard) {
      throw new DataCardReportValidationError('目标数据卡不存在或当前不可举报');
    }
    if (targetCard.user_id === reporterUserId) {
      throw new DataCardReportForbiddenError('不能举报自己的公开数据卡');
    }
    return targetCard;
  };

  const buildNormalizedPayloadHashForTests = async (input: SubmitDataCardReportInput): Promise<string> =>
    buildNormalizedReportPayloadHash({
      targetEntityId: input.targetEntityId,
      reasonCode: input.reasonCode,
      details: normalizeDataCardReportDetails(input.details),
      references: normalizeDataCardReportReferences(input.references),
    });

  const buildSelfRemediationCandidateDto = (input: {
    caseId: string;
    creatorNotifiedAt: string | null;
    targetCardUpdatedAtAtNotice: string | null;
    currentTargetCardUpdatedAt: string | null;
  }) => {
    const remediationBaselineMs = parseTimestampMs(input.targetCardUpdatedAtAtNotice ?? input.creatorNotifiedAt);
    const currentTargetCardUpdatedAtMs = parseTimestampMs(input.currentTargetCardUpdatedAt);
    const isCandidate =
      Number.isFinite(remediationBaselineMs) &&
      Number.isFinite(currentTargetCardUpdatedAtMs) &&
      currentTargetCardUpdatedAtMs > remediationBaselineMs;

    return {
      caseId: input.caseId,
      isSelfRemediationCandidate: isCandidate,
      selfRemediationDetectedAt: isCandidate ? input.currentTargetCardUpdatedAt : null,
    };
  };

  const buildAggregatedCaseEvidenceSummary = async (
    db: AppDrizzleDb,
    activeReports: Awaited<ReturnType<typeof deps.repo.listActiveReportsByCase>>,
  ): Promise<AggregatedCaseEvidenceSummary> => {
    const summaries = await Promise.all(
      activeReports.map(async (report) => {
        const parsedSummary = parseEvidenceSummary(
          typeof report.evidenceSummaryJson === 'string' ? report.evidenceSummaryJson : '{}',
        );
        const referenceSummary =
          parsedSummary.referenceSummary.length > 0
            ? parsedSummary.referenceSummary
            : (
                await deps.repo.listReportReferencesByReport(db, report.id)
              ).map((reference) => formatReferenceSummaryItem(reference.referenceType, reference.labelSnapshot));

        return {
          reasonLabels:
            parsedSummary.reasonLabels.length > 0
              ? parsedSummary.reasonLabels
              : [getDataCardReportReasonLabel(report.reasonCode)],
          referenceSummary,
          detailsPreview: parsedSummary.detailsPreview ?? previewDetails(report.details),
        };
      }),
    );

    return {
      reasonLabels: Array.from(new Set(summaries.flatMap((summary) => summary.reasonLabels))),
      referenceSummary: Array.from(new Set(summaries.flatMap((summary) => summary.referenceSummary))),
      detailsPreview: aggregateDetailsPreview(summaries.map((summary) => summary.detailsPreview)),
    };
  };

  return {
    async getDataCardReportCapability(input: {
      db: DataCardReportsServiceDb;
      viewerUserId: number | null;
      targetEntityId: string;
    }): Promise<DataCardReportCapabilityDto> {
      if (input.viewerUserId == null) {
        return {
          canReport: false,
          reportDisabledReason: '登录后可举报',
          hasOpenCase: false,
          myActiveReport: null,
          reasons: DATA_CARD_REPORT_REASONS,
          caseSummary: null,
        };
      }

      const db = requireDb(input.db);
      const targetCard = await deps.getTargetCard(db, input.targetEntityId);
      if (!targetCard) {
        return {
          canReport: false,
          reportDisabledReason: '该数据卡当前不可举报',
          hasOpenCase: false,
          myActiveReport: null,
          reasons: DATA_CARD_REPORT_REASONS,
          caseSummary: null,
        };
      }

      if (targetCard.user_id === input.viewerUserId) {
        return {
          canReport: false,
          reportDisabledReason: '不能举报自己的公开数据卡',
          hasOpenCase: false,
          myActiveReport: null,
          reasons: DATA_CARD_REPORT_REASONS,
          caseSummary: null,
        };
      }

      const openCase = await deps.repo.getOpenReportCaseByTarget(db, {
        targetEntityType: 'data_card',
        targetEntityId: input.targetEntityId,
      });
      if (!openCase) {
        return {
          canReport: true,
          reportDisabledReason: null,
          hasOpenCase: false,
          myActiveReport: null,
          reasons: DATA_CARD_REPORT_REASONS,
          caseSummary: null,
        };
      }

      const myReport = await deps.repo.getActiveReportByCaseAndReporter(db, {
        caseId: openCase.id,
        reporterUserId: input.viewerUserId,
      });
      const myReferences = myReport ? await deps.repo.listReportReferencesByReport(db, myReport.id) : [];
      const activeReports = await deps.repo.listActiveReportsByCase(db, openCase.id);
      const caseEvidenceSummary = await buildAggregatedCaseEvidenceSummary(db, activeReports);

      return {
        canReport: true,
        reportDisabledReason: null,
        hasOpenCase: true,
        myActiveReport: myReport
          ? {
              reasonCode: myReport.reasonCode as DataCardReportDraft['reasonCode'],
              details: myReport.details,
              references: myReferences.map((reference) => ({
                referenceType: reference.referenceType,
                referenceId: reference.referenceId,
                note: reference.note,
                sortOrder: reference.sortOrder,
              })),
            }
          : null,
        reasons: DATA_CARD_REPORT_REASONS,
        caseSummary: {
          caseId: openCase.id,
          reportCount: activeReports.length,
          reasonLabels: caseEvidenceSummary.reasonLabels,
          referenceSummary: caseEvidenceSummary.referenceSummary,
        },
      };
    },

    async submitDataCardReport(input: SubmitDataCardReportInput): Promise<SubmitDataCardReportResult> {
      if (!isDataCardReportReasonCode(input.reasonCode)) {
        throw new DataCardReportValidationError('举报理由无效');
      }

      const db = requireDb(input.db);
      const targetCard = await getEligibleTargetCard(db, input.targetEntityId, input.reporterUserId);

      let normalizedReferences: NormalizedReportReference[];
      let normalizedDetails: string | null;
      try {
        normalizedReferences = normalizeDataCardReportReferences(input.references);
        normalizedDetails = normalizeDataCardReportDetails(input.details);
      } catch (error) {
        if (
          error instanceof InvalidDataCardReportReferenceError ||
          error instanceof InvalidDataCardReportDetailsError
        ) {
          throw new DataCardReportValidationError(error.message);
        }
        throw error;
      }
      const payloadHash = await buildNormalizedReportPayloadHash({
        targetEntityId: input.targetEntityId,
        reasonCode: input.reasonCode,
        details: normalizedDetails,
        references: normalizedReferences,
      });

      let openCase = await deps.repo.getOpenReportCaseByTarget(db, {
        targetEntityType: 'data_card',
        targetEntityId: input.targetEntityId,
      });
      let existingActiveReport = openCase
        ? await deps.repo.getActiveReportByCaseAndReporter(db, {
            caseId: openCase.id,
            reporterUserId: input.reporterUserId,
          })
        : null;
      const now = deps.now();
      let submissionDecision: SubmitDataCardReportResult['submissionDecision'] = existingActiveReport ? 'updated' : 'created';
      let reportRow = existingActiveReport;
      let isDuplicatePayload = false;
      let shouldReplaceReferences = false;
      let referenceSnapshots: ResolvedReferenceSnapshot[] | null = null;
      let evidenceSummary: ReturnType<typeof buildEvidenceSummary> | null = null;

      if (existingActiveReport && existingActiveReport.normalizedPayloadHash === payloadHash) {
        submissionDecision = 'noop_duplicate_payload';
        isDuplicatePayload = true;
        shouldReplaceReferences = false;
      }

      if (!isDuplicatePayload) {
        const rateLimit = await deps.rateLimit({
          reporterUserId: input.reporterUserId,
          targetEntityId: input.targetEntityId,
        });
        if (!rateLimit.allowed) {
          return {
            submissionDecision: 'rejected_rate_limited',
            caseId: null,
            reportId: null,
            creatorNotified: false,
          };
        }

        const screening = await deps.screenSubmission({
          reporterUserId: input.reporterUserId,
          targetEntityId: input.targetEntityId,
          reasonCode: input.reasonCode,
          details: normalizedDetails,
        });
        if (!screening.allowed) {
          return {
            submissionDecision: 'rejected_screened',
            caseId: null,
            reportId: null,
            creatorNotified: false,
          };
        }

        referenceSnapshots = await deps.resolveReferenceSnapshots({
          db,
          targetEntityId: input.targetEntityId,
          references: normalizedReferences,
        });
        evidenceSummary = buildEvidenceSummary({
          reasonCode: input.reasonCode,
          references: referenceSnapshots,
          details: normalizedDetails,
        });
        shouldReplaceReferences = true;
      }

      if (!openCase) {
        try {
          openCase = await deps.repo.createReportCase(db, {
            id: deps.idFactory(),
            targetEntityType: 'data_card',
            targetEntityId: input.targetEntityId,
            targetUserId: targetCard.user_id,
            now,
          });
        } catch (error) {
          const existingOpenCase = await deps.repo.getOpenReportCaseByTarget(db, {
            targetEntityType: 'data_card',
            targetEntityId: input.targetEntityId,
          });
          if (!existingOpenCase) {
            throw error;
          }
          openCase = existingOpenCase;
        }
      }

      if (!existingActiveReport) {
        existingActiveReport = await deps.repo.getActiveReportByCaseAndReporter(db, {
          caseId: openCase.id,
          reporterUserId: input.reporterUserId,
        });
        reportRow = existingActiveReport;
        if (existingActiveReport) {
          submissionDecision = 'updated';
          if (existingActiveReport.normalizedPayloadHash === payloadHash) {
            submissionDecision = 'noop_duplicate_payload';
            isDuplicatePayload = true;
            shouldReplaceReferences = false;
          }
        }
      }

      if (!isDuplicatePayload) {
        reportRow = null;
        const reportWriteInput = {
          caseId: openCase.id,
          reporterUserId: input.reporterUserId,
          reasonCode: input.reasonCode,
          details: normalizedDetails,
          evidenceSummaryJson: JSON.stringify(evidenceSummary),
          normalizedPayloadHash: payloadHash,
          targetNameSnapshot: targetCard.name,
          targetDescriptionSnapshot: targetCard.description,
          targetDataSnapshot: targetCard.data,
          targetUpdatedAtSnapshot: targetCard.updated_at,
          now,
        };

        let reportWriteAttempts = 0;
        while (!reportRow && !isDuplicatePayload && reportWriteAttempts < MAX_REPORT_WRITE_ATTEMPTS) {
          reportWriteAttempts += 1;

          if (existingActiveReport) {
            submissionDecision = 'updated';
            reportRow = await deps.repo.updateActiveReportForReporter(db, reportWriteInput);
            if (reportRow) {
              break;
            }

            existingActiveReport = null;
            submissionDecision = 'created';
            continue;
          }

          try {
            submissionDecision = 'created';
            reportRow = await deps.repo.createReport(db, {
              id: deps.idFactory(),
              ...reportWriteInput,
            });
          } catch (error) {
            const concurrentActiveReport = await deps.repo.getActiveReportByCaseAndReporter(db, {
              caseId: openCase.id,
              reporterUserId: input.reporterUserId,
            });
            if (!concurrentActiveReport) {
              throw error;
            }

            if (concurrentActiveReport.normalizedPayloadHash === payloadHash) {
              reportRow = concurrentActiveReport;
              submissionDecision = 'noop_duplicate_payload';
              isDuplicatePayload = true;
              shouldReplaceReferences = false;
              break;
            }

            existingActiveReport = concurrentActiveReport;
          }
        }
      }

      if (!reportRow) {
        throw new DataCardReportsServiceUnavailableError('更新举报失败');
      }

      if (submissionDecision === 'created' || submissionDecision === 'updated') {
        await deps.repo.createReportSubmissionEvent(db, {
          id: buildReportSubmissionEventStableId({
            reportId: reportRow.id,
            submissionDecision,
            normalizedPayloadHash: reportRow.normalizedPayloadHash,
            reportCreatedAt: reportRow.createdAt,
            reportUpdatedAt: reportRow.updatedAt,
            fallbackNow: now,
          }),
          caseId: openCase.id,
          reportId: reportRow.id,
          reporterUserId: input.reporterUserId,
          submissionDecision,
          now,
        });
      } else if (submissionDecision === 'noop_duplicate_payload') {
        const latestSubmissionEvent = await deps.repo.getLatestReportSubmissionEventByReport(db, reportRow.id);
        if (
          shouldRepairMissingSubmissionEvent({
            reportCreatedAt: reportRow.createdAt,
            reportUpdatedAt: reportRow.updatedAt,
            latestSubmissionEvent,
          })
        ) {
          const repairDecision = inferSubmissionEventRepairDecision(latestSubmissionEvent);
          await deps.repo.createReportSubmissionEvent(db, {
            id: buildReportSubmissionEventStableId({
              reportId: reportRow.id,
              submissionDecision: repairDecision,
              normalizedPayloadHash: reportRow.normalizedPayloadHash,
              reportCreatedAt: reportRow.createdAt,
              reportUpdatedAt: reportRow.updatedAt,
              fallbackNow: now,
            }),
            caseId: openCase.id,
            reportId: reportRow.id,
            reporterUserId: input.reporterUserId,
            submissionDecision: repairDecision,
            now,
          });
        }
      }

      if (isDuplicatePayload) {
        const currentReferences = await deps.repo.listReportReferencesByReport(db, reportRow.id);
        if (!hasMatchingReportReferences(currentReferences, normalizedReferences)) {
          referenceSnapshots =
            referenceSnapshots ??
            (await deps.resolveReferenceSnapshots({
              db,
              targetEntityId: input.targetEntityId,
              references: normalizedReferences,
            }));
          shouldReplaceReferences = true;
        }
      }

      if (shouldReplaceReferences && referenceSnapshots !== null) {
        await deps.repo.replaceReportReferences(db, {
          reportId: reportRow.id,
          references: toReportReferenceWriteInput(deps.idFactory, referenceSnapshots),
        });
      }

      let creatorNotified = false;
      if (!openCase.creatorNotifiedAt) {
        const claimedReportCount = await deps.repo.countActiveReportsByCase(db, openCase.id);
        creatorNotified = await deps.repo.markReportCaseCreatorNotified(db, {
          caseId: openCase.id,
          notifiedAt: now,
          reportCount: claimedReportCount,
          targetCardUpdatedAtAtNotice: targetCard.updated_at,
        });
        if (creatorNotified) {
          const notificationActiveReports = await deps.repo.listActiveReportsByCase(db, openCase.id);
          const activeReportsForNotification =
            notificationActiveReports.length > 0 ? notificationActiveReports : [reportRow];
          const notificationEvidenceSummary = await buildAggregatedCaseEvidenceSummary(db, activeReportsForNotification);
          const reportCount = activeReportsForNotification.length;
          try {
            await deps.createUserMessageEntry({
              db,
              recipientUserId: targetCard.user_id,
              actorUserId: null,
              channel: 'system',
              messageType: 'moderation',
              templateKey: 'user.moderation.data_card_reported',
              payload: {
                dataCardId: targetCard.id,
                dataCardName: targetCard.name,
                reasonLabels: notificationEvidenceSummary.reasonLabels,
                referenceSummary: notificationEvidenceSummary.referenceSummary,
                detailsPreview: notificationEvidenceSummary.detailsPreview,
                reportCount,
                updatedAfterNotice: false,
              },
              actionUrl: '/character-manager',
              sourceEntityType: 'report_case',
              sourceEntityId: openCase.id,
              priority: 'high',
            });
          } catch (error) {
            await deps.repo.clearReportCaseCreatorNotified(db, {
              caseId: openCase.id,
              notifiedAt: now,
            });
            throw error;
          }
        }
      }

      return {
        submissionDecision,
        caseId: openCase.id,
        reportId: reportRow.id,
        creatorNotified,
      };
    },

    async withdrawDataCardReport(input: WithdrawDataCardReportInput): Promise<WithdrawDataCardReportResult> {
      const db = requireDb(input.db);
      const openCase = await deps.repo.getOpenReportCaseByTarget(db, {
        targetEntityType: 'data_card',
        targetEntityId: input.targetEntityId,
      });
      if (!openCase) {
        return { withdrawn: false, caseDismissed: false };
      }

      const withdrawn = await deps.repo.withdrawActiveReportByReporter(db, {
        caseId: openCase.id,
        reporterUserId: input.reporterUserId,
        now: deps.now(),
      });
      if (!withdrawn) {
        return { withdrawn: false, caseDismissed: false };
      }

      const caseDismissed = await deps.repo.dismissCaseIfNoActiveReports(db, {
        caseId: openCase.id,
        now: deps.now(),
      });
      return { withdrawn: true, caseDismissed };
    },

    buildSelfRemediationCandidateDto,
    buildNormalizedPayloadHashForTests,
  };
};

export function createDataCardReportsServiceForTests(
  deps: Partial<Omit<DataCardReportsServiceDeps, 'repo'>> & { repo?: Partial<DataCardReportsRepository> } = {},
) {
  const missing = (name: string) => {
    throw new Error(`Missing test dependency: ${name}`);
  };

  return createDataCardReportsService({
    now: deps.now ?? (() => new Date().toISOString()),
    idFactory: deps.idFactory ?? (() => crypto.randomUUID()),
    repo: {
      getOpenReportCaseByTarget: deps.repo?.getOpenReportCaseByTarget ?? (() => missing('getOpenReportCaseByTarget')),
      createReportCase: deps.repo?.createReportCase ?? (() => missing('createReportCase')),
      getActiveReportByCaseAndReporter:
        deps.repo?.getActiveReportByCaseAndReporter ?? (() => missing('getActiveReportByCaseAndReporter')),
      createReport: deps.repo?.createReport ?? (() => missing('createReport')),
      updateActiveReportForReporter:
        deps.repo?.updateActiveReportForReporter ?? (() => missing('updateActiveReportForReporter')),
      createReportSubmissionEvent:
        deps.repo?.createReportSubmissionEvent ??
        (async (_db, input) => ({
          id: input.id,
          caseId: input.caseId,
          reportId: input.reportId,
          reporterUserId: input.reporterUserId,
          submissionDecision: input.submissionDecision,
          createdAt: input.now,
        })),
      getLatestReportSubmissionEventByReport:
        deps.repo?.getLatestReportSubmissionEventByReport ?? (async () => null),
      countReportSubmissionEventsByReporterSince:
        deps.repo?.countReportSubmissionEventsByReporterSince ?? (async () => 0),
      replaceReportReferences: deps.repo?.replaceReportReferences ?? (() => missing('replaceReportReferences')),
      listReportReferencesByReport:
        deps.repo?.listReportReferencesByReport ?? (async () => []),
      listActiveReportsByCase: deps.repo?.listActiveReportsByCase ?? (async () => []),
      countActiveReportsByCase: deps.repo?.countActiveReportsByCase ?? (() => missing('countActiveReportsByCase')),
      withdrawActiveReportByReporter:
        deps.repo?.withdrawActiveReportByReporter ?? (() => missing('withdrawActiveReportByReporter')),
      dismissCaseIfNoActiveReports:
        deps.repo?.dismissCaseIfNoActiveReports ?? (() => missing('dismissCaseIfNoActiveReports')),
      markReportCaseCreatorNotified:
        deps.repo?.markReportCaseCreatorNotified ?? (async () => false),
      clearReportCaseCreatorNotified:
        deps.repo?.clearReportCaseCreatorNotified ?? (async () => false),
    },
    getTargetCard: deps.getTargetCard ?? (async () => missing('getTargetCard')),
    resolveReferenceSnapshots: deps.resolveReferenceSnapshots ?? (async () => missing('resolveReferenceSnapshots')),
    rateLimit: deps.rateLimit ?? (async () => ({ allowed: true })),
    screenSubmission: deps.screenSubmission ?? (async () => ({ allowed: true })),
    createUserMessageEntry: deps.createUserMessageEntry ?? (async () => ({ id: null })),
  });
}

export async function getDataCardReportCapability(input: {
  db: DataCardReportsServiceDb;
  viewerUserId: number | null;
  targetEntityId: string;
}) {
  return createDataCardReportsService({
    now: () => new Date().toISOString(),
    idFactory: () => crypto.randomUUID(),
    repo: toRepo(),
    getTargetCard: resolveTargetCard,
    resolveReferenceSnapshots,
    rateLimit: async () => ({ allowed: true }),
    screenSubmission: screenDataCardReportSubmission,
    createUserMessageEntry,
  }).getDataCardReportCapability(input);
}

export async function submitDataCardReport(input: SubmitDataCardReportInput) {
  return createDataCardReportsService({
    now: () => new Date().toISOString(),
    idFactory: () => crypto.randomUUID(),
    repo: toRepo(),
    getTargetCard: resolveTargetCard,
    resolveReferenceSnapshots,
    rateLimit: ({ reporterUserId, targetEntityId }) =>
      rateLimitDataCardReportSubmission(requireDb(input.db), { reporterUserId, targetEntityId }),
    screenSubmission: screenDataCardReportSubmission,
    createUserMessageEntry,
  }).submitDataCardReport(input);
}

export async function withdrawDataCardReport(input: WithdrawDataCardReportInput) {
  return createDataCardReportsService({
    now: () => new Date().toISOString(),
    idFactory: () => crypto.randomUUID(),
    repo: toRepo(),
    getTargetCard: resolveTargetCard,
    resolveReferenceSnapshots,
    rateLimit: async () => ({ allowed: true }),
    screenSubmission: screenDataCardReportSubmission,
    createUserMessageEntry,
  }).withdrawDataCardReport(input);
}
